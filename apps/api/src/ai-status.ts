import { asc, eq } from "drizzle-orm";
import type { AiProblem, AiStatus } from "@plantes/shared";
import { AiProviderError, type AiProvider } from "./ai/provider.js";
import { db } from "./db/instance.js";
import { householdMembers, households, systemState } from "./db/schema.js";
import { addDays, diffDays, parisParts } from "./lib/time.js";
import type { PushService } from "./push.js";

/**
 * État de l'IA et surveillance du jeton Claude.
 * Le jeton dure un an, ne se renouvelle pas sans navigateur et ne peut pas être vérifié gratuitement : on détecte
 * donc passivement les échecs d'authentification sur les vraies générations, et on prévient à l'avance de la date
 * d'expiration estimée (CLAUDE_TOKEN_CREATED + 365 jours). Seuls les propriétaires de foyer sont notifiés.
 */

type Payload = { title: string; body: string; url: string };

const KEY_STATUS = "ai.status";
const KEY_WATCH_DAY = "ai.watch.day";
const KEY_THRESHOLDS = "ai.watch.thresholds";
const KEY_LAST_NOTIFIED = "ai.problem.notified";

const DAY_MS = 24 * 3_600_000;
/** Seuils (en jours restants) d'alerte avant l'expiration ; 0 = expiré. */
const THRESHOLDS = [30, 14, 7, 3, 1] as const;

let pushService: PushService | null = null;

function getState(key: string): string | undefined {
  return db.select({ value: systemState.value }).from(systemState).where(eq(systemState.key, key)).get()?.value;
}

function setState(key: string, value: string, now: Date): void {
  db.insert(systemState).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now } }).run();
}

interface StoredStatus {
  status: "ok" | "problem";
  problem: AiProblem | null;
  /** Début du problème (ms). */
  since: number | null;
}

function readStatus(): StoredStatus {
  const raw = getState(KEY_STATUS);
  if (raw) {
    try {
      const v = JSON.parse(raw) as StoredStatus;
      if (v.status === "problem" && (v.problem === "auth" || v.problem === "account")) return v;
    } catch {
      /* état illisible : on repart de « ok » */
    }
  }
  return { status: "ok", problem: null, since: null };
}

function writeStatus(s: StoredStatus, now: Date): void {
  setState(KEY_STATUS, JSON.stringify(s), now);
}

/** État courant de l'IA (« ok » ou « problem »), sans les infos propres à une personne. */
export const currentAiState = () => readStatus();

/** Mémorise le service push (utilisé par la file de génération) et crée l'état initial s'il n'existe pas. */
export function initAiStatus(push: PushService | null, now = new Date()): void {
  pushService = push;
  if (getState(KEY_STATUS) === undefined) writeStatus(readStatus(), now);
}

/** Service push mémorisé par initAiStatus (null avant l'initialisation, ex. outils en ligne de commande). */
export const getPush = () => pushService;

/** Expiration estimée du jeton, d'après CLAUDE_TOKEN_CREATED (AAAA-MM-JJ, jour de création). */
let warnedCreated = false;
function warnCreatedOnce(created: string, reason: string): void {
  if (warnedCreated) return;
  warnedCreated = true;
  const shown = created.length > 12 ? `${created.slice(0, 12)}…` : created;
  console.warn(`[jeton] CLAUDE_TOKEN_CREATED (« ${shown} ») ${reason} : aucune alerte d'expiration. Attendu : AAAA-MM-JJ, la date de création du jeton.`);
}

export function tokenInfo(now: Date): { expiresAt: string; daysLeft: number; created: string } | null {
  const created = process.env.CLAUDE_TOKEN_CREATED?.trim();
  if (!created) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created) || addDays(created, 0) !== created) {
    warnCreatedOnce(created, "n'est pas une date valide");
    return null;
  }
  if (created > parisParts(now).date) {
    warnCreatedOnce(created, "est dans le futur");
    return null;
  }
  const expiresAt = addDays(created, 365);
  return { expiresAt, daysLeft: diffDays(parisParts(now).date, expiresAt), created };
}

/** Propriétaire d'un foyer : le membre arrivé en premier (égalité : identifiant le plus petit). */
export function ownerOf(householdId: string): string | null {
  return (
    db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, householdId))
      .orderBy(asc(householdMembers.joinedAt), asc(householdMembers.userId))
      .get()?.userId ?? null
  );
}

export function getAiStatus(userId: string, now: Date): AiStatus {
  const s = readStatus();
  const info = tokenInfo(now);
  const member = db.select({ householdId: householdMembers.householdId }).from(householdMembers).where(eq(householdMembers.userId, userId)).get();
  return {
    status: s.status,
    problem: s.problem,
    since: s.since === null ? null : new Date(s.since).toISOString(),
    tokenExpiresAt: info?.expiresAt ?? null,
    daysLeft: info?.daysLeft ?? null,
    isOwner: member ? ownerOf(member.householdId) === userId : false,
  };
}

/** Envoie un message aux propriétaires de chaque foyer (jamais aux autres membres). */
async function notifyOwners(push: PushService | null, payload: Payload): Promise<void> {
  if (!push) return;
  const owners = db
    .select({ id: households.id })
    .from(households)
    .all()
    .map((h) => ownerOf(h.id))
    .filter((id): id is string => id !== null);
  try {
    await push.sendToUsers(owners, payload);
  } catch (err) {
    console.error("[ai] notification impossible", err);
  }
}

const problemMessage = (problem: AiProblem): Payload =>
  problem === "auth"
    ? { title: "⚠️ Les fiches ne se génèrent plus : le jeton Claude est invalide", body: "Il doit être renouvelé sur le serveur.", url: "/settings" }
    : { title: "⚠️ Les fiches ne se génèrent plus : le compte Claude a un problème", body: "Le compte est suspendu ou a un souci de facturation.", url: "/settings" };

/**
 * À appeler après chaque génération (`null` = succès). Seuls les échecs d'authentification ou de compte font passer
 * l'état à « problem » ; les autres échecs (limite d'usage, surcharge, délai…) ne changent rien et ne notifient pas.
 * Les notifications n'ont lieu qu'aux transitions.
 */
export async function recordGenerationOutcome(push: PushService | null, err: unknown, now = new Date()): Promise<void> {
  const state = readStatus();
  if (err === null) {
    if (state.status === "ok") return;
    writeStatus({ status: "ok", problem: null, since: null }, now);
    await notifyOwners(push, { title: "✅ Les fiches fonctionnent de nouveau", body: "La génération des fiches est rétablie.", url: "/settings" });
    return;
  }
  if (!(err instanceof AiProviderError) || (err.code !== "auth" && err.code !== "account")) return;
  const problem: AiProblem = err.code;
  if (state.status === "problem") {
    if (state.problem !== problem) writeStatus({ ...state, problem }, now);
    return;
  }
  writeStatus({ status: "problem", problem, since: now.getTime() }, now);
  setState(KEY_LAST_NOTIFIED, String(now.getTime()), now);
  await notifyOwners(push, problemMessage(problem));
}

/**
 * Surveillance quotidienne du jeton, appelée à chaque minute par le planificateur : au plus une alerte d'expiration
 * par seuil et par jeton, et une relance toutes les 24 h tant que l'état est « problem ». `hours` = heures de rappel
 * (Paris) : rien n'est envoyé avant la première, ni si la liste est vide.
 */
export async function runTokenWatch(push: PushService | null, now: Date, hours: readonly number[]): Promise<void> {
  if (hours.length === 0) return;
  const { date, hour } = parisParts(now);
  if (hour < hours[0]) return;

  // Relance tant que le problème dure.
  const state = readStatus();
  if (state.status === "problem" && state.problem) {
    const last = Number(getState(KEY_LAST_NOTIFIED) ?? state.since ?? 0);
    if (now.getTime() - last >= DAY_MS) {
      setState(KEY_LAST_NOTIFIED, String(now.getTime()), now);
      await notifyOwners(push, problemMessage(state.problem));
    }
  }

  // Alertes d'expiration : une exécution par jour.
  if (getState(KEY_WATCH_DAY) === date) return;
  setState(KEY_WATCH_DAY, date, now);
  const info = tokenInfo(now);
  if (!info) return;

  let memo: { created: string; sent: number[] } = { created: info.created, sent: [] };
  try {
    const stored = JSON.parse(getState(KEY_THRESHOLDS) ?? "null");
    if (stored?.created === info.created && Array.isArray(stored.sent)) memo = stored;
  } catch {
    /* mémoire illisible : on recommence */
  }
  // Seuil courant : le plus petit seuil encore au-dessus des jours restants (0 si expiré).
  const bucket = info.daysLeft <= 0 ? 0 : THRESHOLDS.filter((t) => t >= info.daysLeft).pop();
  if (bucket === undefined || memo.sent.includes(bucket)) return;
  memo.sent = [...new Set([...memo.sent, bucket, ...THRESHOLDS.filter((t) => t > bucket)])];
  setState(KEY_THRESHOLDS, JSON.stringify(memo), now);

  const n = info.daysLeft;
  await notifyOwners(push, {
    title: n <= 0 ? "🔑 Le jeton Claude a expiré" : `🔑 Le jeton Claude expire dans ${n} jour${n > 1 ? "s" : ""}`,
    body: "Il doit être renouvelé sur le serveur, sinon les fiches ne se généreront plus.",
    url: "/settings",
  });
}

/**
 * Résultat de `ai:ping` (code de sortie + message) : met aussi à jour l'état persistant partagé avec le serveur
 * (succès : retour à « ok », sans notification ; échec d'authentification ou de compte : « problem »).
 */
export async function pingOutcome(provider: AiProvider, now = new Date()): Promise<{ code: 0 | 2 | 3 | 4; message: string }> {
  try {
    const { durationMs } = await provider.generateCareSheet({ plantName: "Pothos" });
    await recordGenerationOutcome(null, null, now);
    return { code: 0, message: `✓ La génération fonctionne (${(durationMs / 1000).toFixed(1)} s)` };
  } catch (err) {
    await recordGenerationOutcome(null, err, now);
    if (err instanceof AiProviderError && err.code === "auth") return { code: 2, message: "✗ Jeton Claude invalide ou expiré" };
    if (err instanceof AiProviderError && err.code === "account") return { code: 4, message: "✗ Compte Claude suspendu ou souci de facturation" };
    // Seul le message (déjà lisible, sans secret) est affiché, jamais les détails ni l'environnement.
    return { code: 3, message: `✗ ${err instanceof AiProviderError ? err.message : "Échec inattendu de la génération"}` };
  }
}
