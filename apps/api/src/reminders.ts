import { eq, notInArray } from "drizzle-orm";
import { currentAiState, runTokenWatch } from "./ai-status.js";
import { db } from "./db/instance.js";
import { householdMembers, households, plants, reminderLog } from "./db/schema.js";
import { parisParts } from "./lib/time.js";
import { waterStatuses } from "./lib/watering.js";
import type { PushService } from "./push.js";

/**
 * Heures (Paris) des rappels : le premier est le rappel du jour, les suivants des relances qui n'ont lieu
 * que s'il reste des plantes à arroser (personne ne les a cochées entre-temps).
 */
export const REMINDER_HOURS = (process.env.REMINDER_HOURS ?? "9,18")
  .split(",")
  .map((h) => h.trim())
  .filter((h) => h !== "") // REMINDER_HOURS= (vide) désactive les rappels
  .map(Number)
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
  .sort((a, b) => a - b);

/** Un créneau manqué (serveur éteint) est rattrapé pendant ce nombre d'heures, puis abandonné. */
const CATCHUP_HOURS = 3;

type Payload = { title: string; body: string; url: string };

/** Plantes à arroser aujourd'hui ou en retard, par ordre alphabétique. */
export function duePlantNames(householdId: string, now: Date): string[] {
  const due = new Set([...waterStatuses(householdId, now)].filter(([, w]) => w.daysUntil <= 0).map(([id]) => id));
  if (due.size === 0) return [];
  return db
    .select({ id: plants.id, name: plants.name })
    .from(plants)
    .where(eq(plants.householdId, householdId))
    .all()
    .filter((p) => due.has(p.id))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b, "fr"));
}

export function reminderMessage(names: string[], relance: boolean): Payload {
  const n = names.length;
  const shown = names.slice(0, 4).join(", ");
  const rest = n > 4 ? ` et ${n - 4} autre${n - 4 > 1 ? "s" : ""}` : "";
  return {
    title: `💧 ${n} plante${n > 1 ? "s" : ""} à arroser`,
    body: `${relance ? "Toujours à arroser : " : ""}${shown}${rest}`,
    url: "/",
  };
}

export interface ReminderResult {
  slot: string;
  householdId: string;
  plants: number;
  devices: number;
}

/**
 * Traite le créneau de rappel en cours (s'il y en a un) pour chaque foyer qui n'a pas déjà été traité.
 * Le créneau est noté AVANT l'envoi : en cas de plantage, on préfère un rappel manqué à un rappel en double.
 */
export async function runReminders(push: PushService, now = new Date()): Promise<ReminderResult[]> {
  const { date, hour } = parisParts(now);
  const idx = REMINDER_HOURS.map((h, i) => ({ h, i })).filter(({ h }) => hour >= h && hour < h + CATCHUP_HOURS).pop();
  if (!idx) return [];
  const slot = `${date}#${idx.h}`;

  const done = db.select({ id: reminderLog.householdId }).from(reminderLog).where(eq(reminderLog.slot, slot)).all().map((r) => r.id);
  const todo = (done.length ? db.select({ id: households.id }).from(households).where(notInArray(households.id, done)) : db.select({ id: households.id }).from(households)).all();

  const results: ReminderResult[] = [];
  for (const { id: householdId } of todo) {
    const names = duePlantNames(householdId, now);
    const claimed = db.insert(reminderLog).values({ slot, householdId, plantCount: names.length }).onConflictDoNothing().run();
    if (claimed.changes === 0 || names.length === 0) continue;
    const members = db.select({ userId: householdMembers.userId }).from(householdMembers).where(eq(householdMembers.householdId, householdId)).all();
    const res = await push.sendToUsers(members.map((m) => m.userId), reminderMessage(names, idx.i > 0));
    results.push({ slot, householdId, plants: names.length, devices: res.sent });
    console.log(`[rappel] ${slot} foyer ${householdId.slice(0, 6)} : ${names.length} plante(s), ${res.sent}/${res.total} appareil(s)`);
  }
  return results;
}

/** Envoie le vrai rappel (ou un message « rien à arroser ») aux seuls appareils de la personne : pour tester. */
export async function sendReminderTest(push: PushService, userId: string, householdId: string, now = new Date()) {
  const names = duePlantNames(householdId, now);
  const payload: Payload = names.length
    ? { ...reminderMessage(names, false), title: `🧪 Test : ${reminderMessage(names, false).title}` }
    : { title: "🧪 Test : rien à arroser", body: "Aucune plante n'est à arroser aujourd'hui.", url: "/" };
  const res = await push.sendToUsers([userId], payload);
  return { plants: names.length, ...res };
}

/**
 * Signale « je suis vivant » à un service de surveillance externe (ex. healthchecks.io). Ne lève jamais d'erreur :
 * un service de surveillance injoignable ne doit pas gêner l'application.
 */
export async function pingHeartbeat(url: string, timeoutMs = 10_000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

const HEARTBEAT_EVERY_MS = 5 * 60_000;

/** Adresse du signal : « /fail » (format healthchecks.io) tant que l'IA est en panne de jeton ou de compte. */
export function heartbeatTarget(baseUrl: string, status: "ok" | "problem"): string {
  if (status !== "problem") return baseUrl;
  try {
    const u = new URL(baseUrl);
    u.pathname = `${u.pathname.replace(/\/+$/, "")}/fail`;
    return u.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Vérifie chaque minute s'il faut envoyer le rappel. Si HEARTBEAT_URL est défini, signale aussi toutes les 5 minutes
 * que le planificateur tourne ET que la base répond (le signal n'est pas envoyé si le traitement échoue) : un service
 * externe qui ne reçoit plus rien prévient de la panne.
 */
export function startReminderScheduler(push: PushService): void {
  const heartbeatUrl = process.env.HEARTBEAT_URL;
  let busy = false;
  let lastPing = 0;
  let heartbeatDown = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runReminders(push);
      await runTokenWatch(push, new Date(), REMINDER_HOURS);
      if (heartbeatUrl && Date.now() - lastPing >= HEARTBEAT_EVERY_MS) {
        lastPing = Date.now();
        const ok = await pingHeartbeat(heartbeatTarget(heartbeatUrl, currentAiState().status));
        if (!ok && !heartbeatDown) console.error("[surveillance] le signal « je suis vivant » n'a pas pu être envoyé");
        if (ok && heartbeatDown) console.log("[surveillance] signal rétabli");
        heartbeatDown = !ok;
      }
    } catch (err) {
      console.error("[rappel]", err);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 60_000).unref();
  void tick();
}
