import { and, asc, count, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { ChatInput, type ChatHistory, type ChatMessage, type ChatReply } from "@plantes/shared";
import { ai } from "../ai/instance.js";
import { messageFor, type AiErrorCode } from "../ai/errors.js";
import { AiProviderError } from "../ai/provider.js";
import { acquire, release } from "../ai/slot.js";
import { getPush, recordGenerationOutcome } from "../ai-status.js";
import { db } from "../db/instance.js";
import { chatMessages, plants, user } from "../db/schema.js";
import { buildChatContext } from "../lib/chat-context.js";
import { newId } from "../lib/tokens.js";
import { parseBody } from "../lib/validate.js";
import { requireMember, type AuthEnv } from "../session.js";

/** Plafond de questions par foyer et par heure : l'abonnement Claude est partagé et limité. */
const HOURLY_LIMIT = () => Number(process.env.CHAT_HOURLY_LIMIT) || 20;
/** Attente maximale du créneau d'IA (une génération de fiche ou un autre chat peut être en cours). */
const WAIT_MS = () => Number(process.env.CHAT_WAIT_MS) || 120_000;
const HOUR_MS = 3_600_000;
/** Messages renvoyés au plus par GET (les plus récents). */
const MAX_LISTED = 200;

/** Codes HTTP des échecs de l'IA : limite d'usage = 429, le reste = IA indisponible (503) ou en échec (502). */
const STATUS: Record<AiErrorCode, 429 | 502 | 503> = { usage_limit: 429, auth: 503, account: 503, overloaded: 503, timeout: 502, other: 502 };

/** Questions déjà parties pour un foyer (en cours d'attente ou d'appel) : elles comptent dans le plafond avant d'être enregistrées. */
const inFlight = new Map<string, number>();

const ownedPlant = (householdId: string, id: string) =>
  db.select().from(plants).where(and(eq(plants.id, id), eq(plants.householdId, householdId))).get();

type Row = { id: string; role: "user" | "assistant"; content: string; createdAt: Date; userName: string | null };
const toMessage = (r: Row): ChatMessage => ({
  id: r.id,
  role: r.role,
  content: r.content,
  userName: r.role === "user" ? r.userName : null,
  createdAt: r.createdAt.toISOString(),
});

export const chatRoutes = new Hono<AuthEnv>();
chatRoutes.use("*", requireMember);

/** Conversation de la plante, du plus ancien au plus récent (partagée par tout le foyer). */
chatRoutes.get("/:id/chat", (c) => {
  const householdId = c.get("householdId");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const rows = db
    .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, createdAt: chatMessages.createdAt, userName: user.name })
    .from(chatMessages)
    .leftJoin(user, eq(user.id, chatMessages.userId))
    .where(and(eq(chatMessages.plantId, p.id), eq(chatMessages.householdId, householdId)))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(MAX_LISTED)
    .all()
    .reverse();
  const out: ChatHistory = { messages: rows.map(toMessage) };
  return c.json(out);
});

/**
 * Pose une question. Le contexte est construit ici (jamais fourni par le client) ; l'appel passe par le créneau
 * d'IA partagé avec la file des fiches. La question et la réponse ne sont enregistrées que si l'IA a répondu.
 */
chatRoutes.post("/:id/chat", async (c) => {
  const householdId = c.get("householdId");
  const me = c.get("user");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const body = await parseBody(c, ChatInput);
  if ("res" in body) return body.res;
  const { message } = body.data;

  // Plafond horaire du foyer (questions enregistrées + questions en cours).
  const since = new Date(Date.now() - HOUR_MS);
  const recent = db
    .select({ createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.householdId, householdId), eq(chatMessages.role, "user"), gte(chatMessages.createdAt, since)))
    .orderBy(asc(chatMessages.createdAt))
    .all();
  const limit = HOURLY_LIMIT();
  if (recent.length + (inFlight.get(householdId) ?? 0) >= limit) {
    const wait = recent[0] ? Math.max(1, Math.ceil((recent[0].createdAt.getTime() + HOUR_MS - Date.now()) / 60_000)) : 1;
    c.header("Retry-After", String(wait * 60));
    return c.json({ error: `Limite atteinte : ${limit} questions par heure pour le foyer. Réessaie dans ${wait} minute${wait > 1 ? "s" : ""}.` }, 429);
  }

  inFlight.set(householdId, (inFlight.get(householdId) ?? 0) + 1);
  try {
    if (!(await acquire(WAIT_MS()))) {
      return c.json({ error: "L'IA est occupée (une autre question ou une fiche est en cours). Réessaie dans un instant." }, 503);
    }
    let out: ChatReply;
    try {
      // Contexte lu une fois le créneau obtenu : il reflète l'état réel (journal, conversation) au moment de l'appel.
      // La plante a pu être supprimée pendant l'attente.
      const fresh = ownedPlant(householdId, p.id);
      if (!fresh) return c.json({ error: "Plante introuvable" }, 404);
      const context = await buildChatContext(fresh);
      const { text } = await ai.chat({ context, message, userName: me.name });

      // Enregistré AVANT de rendre le créneau : la question suivante (déjà en attente) voit celle-ci dans l'historique.
      // La plante a pu disparaître pendant l'appel : rien à enregistrer.
      if (!ownedPlant(householdId, p.id)) return c.json({ error: "Plante introuvable" }, 404);
      const now = Date.now();
      const userRow = { id: newId(), plantId: p.id, householdId, userId: me.id, role: "user" as const, content: message, createdAt: new Date(now) };
      const reply = { id: newId(), plantId: p.id, householdId, userId: null, role: "assistant" as const, content: text, createdAt: new Date(now + 1) };
      db.insert(chatMessages).values([userRow, reply]).run();
      out = { user: toMessage({ ...userRow, userName: me.name }), assistant: toMessage({ ...reply, userName: null }) };
    } catch (err) {
      console.error("[ai] chat", err);
      await recordGenerationOutcome(getPush(), err).catch((e) => console.error("[ai] état", e));
      const code: AiErrorCode = err instanceof AiProviderError ? err.code : "other";
      return c.json({ error: code === "other" ? "L'IA n'a pas pu répondre : réessaie dans un moment." : messageFor(code) }, STATUS[code]);
    } finally {
      release();
    }
    await recordGenerationOutcome(getPush(), null).catch((e) => console.error("[ai] état", e));
    return c.json(out);
  } finally {
    const n = (inFlight.get(householdId) ?? 1) - 1;
    if (n <= 0) inFlight.delete(householdId);
    else inFlight.set(householdId, n);
  }
});

/** Efface toute la conversation de la plante. */
chatRoutes.delete("/:id/chat", (c) => {
  const householdId = c.get("householdId");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  db.delete(chatMessages).where(and(eq(chatMessages.plantId, p.id), eq(chatMessages.householdId, householdId))).run();
  return c.json({ ok: true });
});
