import { and, eq, isNull, lt, or } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/instance.js";
import { apiTokens } from "../db/schema.js";
import { hashToken } from "./tokens.js";

export const TOKEN_PREFIX = "plt_";
/** `plt_` + 32 octets en base64url (43 caractères). */
const TOKEN_RE = /^Bearer (plt_[A-Za-z0-9_-]{43})$/;
const TOUCH_EVERY_MS = 60_000;

export type ShortcutEnv = {
  Variables: { userId: string; householdId: string; tokenId: string };
};

/**
 * Authentifie un jeton personnel (en-tête `Authorization: Bearer plt_…` uniquement, jamais en query string).
 * Réponse 401 identique pour un jeton absent, mal formé, inconnu ou révoqué ; le jeton n'est jamais journalisé.
 * N'est monté que sur /api/shortcuts : `requireMember` (session) ignore ces jetons.
 */
export const requireApiToken = createMiddleware<ShortcutEnv>(async (c, next) => {
  const m = TOKEN_RE.exec(c.req.header("authorization") ?? "");
  const row = m ? db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(m[1]))).get() : undefined;
  if (!row) return c.json({ error: "Jeton invalide" }, 401);
  const now = Date.now();
  // Au plus une écriture par minute et par jeton.
  db.update(apiTokens)
    .set({ lastUsedAt: new Date(now) })
    .where(and(eq(apiTokens.id, row.id), or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, new Date(now - TOUCH_EVERY_MS)))))
    .run();
  c.set("userId", row.userId);
  c.set("householdId", row.householdId);
  c.set("tokenId", row.id);
  await next();
});
