import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { ShortcutWaterInput, type ShortcutToday, type ShortcutWaterResponse } from "@plantes/shared";
import { db } from "../db/instance.js";
import { careEvents, rooms } from "../db/schema.js";
import { requireApiToken, type ShortcutEnv } from "../lib/api-token-auth.js";
import { rateLimit } from "../lib/rate-limit.js";
import { parisDate } from "../lib/time.js";
import { newId } from "../lib/tokens.js";
import { parseBody } from "../lib/validate.js";
import { waterStatuses } from "../lib/watering.js";
import { listSummaries } from "./plants.js";

const MAX_EVENTS_PER_PLANT = 1000; // même plafond que le journal de l'app
const MAX_ALL = 100;

/**
 * Actions du raccourci iOS, authentifiées par jeton Bearer (jamais par cookie : pas de CSRF possible).
 * Le limiteur passe AVANT l'authentification, pour freiner aussi les essais de jetons.
 */
export const shortcutRoutes = new Hono<ShortcutEnv>();
shortcutRoutes.use("*", rateLimit(120, 60_000));
shortcutRoutes.use("*", requireApiToken);

/** Minuscules, sans accents ni espaces superflus : « Ficus  Élastica » = « ficus elastica ». */
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const inDays = (n: number) => (n <= 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`);
const listNames = (names: string[]) => names.join(", ");

function roomNames(householdId: string): Map<string, string> {
  return new Map(db.select({ id: rooms.id, name: rooms.name }).from(rooms).where(eq(rooms.householdId, householdId)).all().map((r) => [r.id, r.name]));
}

shortcutRoutes.get("/plants", (c) => {
  const householdId = c.get("householdId");
  const names = roomNames(householdId);
  return c.json(listSummaries(householdId).map((p) => ({ id: p.id, name: p.name, room: p.roomId ? (names.get(p.roomId) ?? null) : null })));
});

shortcutRoutes.get("/today", (c) => {
  const householdId = c.get("householdId");
  const now = new Date();
  const names = roomNames(householdId);
  const all = listSummaries(householdId, now).filter((p) => p.water);
  const room = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const due = all
    .filter((p) => p.water!.daysUntil <= 0)
    .sort((a, b) => a.water!.daysUntil - b.water!.daysUntil)
    .map((p) => ({ id: p.id, name: p.name, room: room(p.roomId), daysLate: Math.max(0, -p.water!.daysUntil) }));
  const upcoming = all
    .filter((p) => p.water!.daysUntil >= 1 && p.water!.daysUntil <= 7)
    .sort((a, b) => a.water!.daysUntil - b.water!.daysUntil)
    .map((p) => ({ id: p.id, name: p.name, room: room(p.roomId), daysUntil: p.water!.daysUntil }));

  let text = due.length ? `${due.length} ${plural(due.length, "plante", "plantes")} à arroser : ${listNames(due.map((p) => p.name))}.` : "Rien à arroser aujourd'hui.";
  if (upcoming.length) {
    const next = upcoming.slice(0, 5).map((p) => `${p.name} ${inDays(p.daysUntil)}`);
    text += ` À venir : ${listNames(next)}${upcoming.length > 5 ? "…" : ""}.`;
  }
  const body: ShortcutToday = { date: parisDate(now), text, due, upcoming };
  return c.json(body);
});

shortcutRoutes.post("/water", async (c) => {
  const householdId = c.get("householdId");
  const userId = c.get("userId");
  const body = await parseBody(c, ShortcutWaterInput);
  if ("res" in body) return body.res;
  const { daysAgo } = body.data;
  const all = listSummaries(householdId);

  // 1. Résolution de TOUTES les cibles avant d'écrire quoi que ce soit : une ambiguïté n'arrose rien.
  let targets: { id: string; name: string }[];
  if (body.data.all === "due") {
    targets = all.filter((p) => p.water && p.water.daysUntil <= 0).slice(0, MAX_ALL).map((p) => ({ id: p.id, name: p.name }));
    if (!targets.length) return c.json({ watered: [], text: "Rien à arroser aujourd'hui." } satisfies ShortcutWaterResponse);
  } else {
    const queries = body.data.plants ?? [body.data.plant!];
    targets = [];
    for (const q of queries) {
      const nq = norm(q);
      const byId = all.find((p) => p.id === q);
      let found = byId ? [byId] : all.filter((p) => norm(p.name) === nq);
      if (!found.length) found = all.filter((p) => norm(p.name).includes(nq) || (nq.length >= 4 && nq.includes(norm(p.name))));
      if (found.length > 1) {
        const candidates = found.map((p) => ({ id: p.id, name: p.name }));
        return c.json({ error: "Plusieurs plantes correspondent", candidates, text: `Plusieurs plantes correspondent à ${q} : ${listNames(candidates.map((p) => p.name))}. Précise laquelle.` }, 409);
      }
      if (!found.length) {
        // Distance au nom entier ou à l'un de ses mots (« monstra » ≈ « Monstera deliciosa »).
        const dist = (name: string) => Math.min(...[name, ...name.split(" ")].map((w) => levenshtein(nq, w)));
        const best = all.map((p) => ({ p, d: dist(norm(p.name)) })).sort((a, b) => a.d - b.d)[0];
        const suggestion = best && best.d <= Math.max(2, Math.floor(nq.length / 3)) ? best.p.name : null;
        return c.json({ error: "Plante introuvable", suggestion, text: suggestion ? `Je ne trouve pas ${q}. Tu voulais dire ${suggestion} ?` : `Je ne trouve pas ${q}.` }, 404);
      }
      if (!targets.some((t) => t.id === found[0].id)) targets.push({ id: found[0].id, name: found[0].name });
    }
  }

  // 2. Journal plein : refus avant toute écriture.
  for (const t of targets) {
    const total = db.select({ n: count() }).from(careEvents).where(eq(careEvents.plantId, t.id)).get()?.n ?? 0;
    if (total >= MAX_EVENTS_PER_PLANT) return c.json({ error: "Journal plein", text: `Le journal de ${t.name} est plein.` }, 400);
  }

  // 3. Même effet que « arrosé » dans l'app : un événement `watered` au nom du propriétaire du jeton.
  db.transaction((tx) => {
    for (const t of targets) {
      tx.insert(careEvents)
        .values({ id: newId(), plantId: t.id, householdId, userId, type: "watered", note: null, ...(daysAgo ? { createdAt: new Date(Date.now() - daysAgo * 86_400_000) } : {}) })
        .run();
    }
  });

  const water = waterStatuses(householdId);
  const watered = targets.map((t) => ({ ...t, nextInDays: water.get(t.id)?.daysUntil ?? null }));
  let text: string;
  if (watered.length === 1) {
    const w = watered[0];
    text = `${w.name} arrosée.` + (w.nextInDays === null ? "" : ` Prochain arrosage ${w.nextInDays <= 0 ? "aujourd'hui" : w.nextInDays === 1 ? "demain" : `dans ${w.nextInDays} jours`}.`);
  } else {
    text = `${watered.length} plantes arrosées : ${listNames(watered.map((w) => w.name))}.`;
  }
  return c.json({ watered, text } satisfies ShortcutWaterResponse);
});
