import { and, count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { ApiTokenInput, type ApiTokenCreated, type ApiTokenSummary } from "@plantes/shared";
import { db } from "../db/instance.js";
import { apiTokens } from "../db/schema.js";
import { TOKEN_PREFIX } from "../lib/api-token-auth.js";
import { hashToken, newId, newToken } from "../lib/tokens.js";
import { parseBody } from "../lib/validate.js";
import { requireMember, type AuthEnv } from "../session.js";

const MAX_TOKENS_PER_USER = 5;

/** Gestion des jetons du raccourci iOS : par SESSION uniquement (un jeton ne peut jamais en créer ni en révoquer). */
export const tokenRoutes = new Hono<AuthEnv>();
tokenRoutes.use("*", requireMember);

const summary = (r: typeof apiTokens.$inferSelect): ApiTokenSummary => ({
  id: r.id,
  name: r.name,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
});

tokenRoutes.get("/", (c) => {
  const rows = db.select().from(apiTokens).where(eq(apiTokens.userId, c.get("user").id)).orderBy(desc(apiTokens.createdAt)).all();
  return c.json(rows.map(summary));
});

tokenRoutes.post("/", async (c) => {
  const body = await parseBody(c, ApiTokenInput);
  if ("res" in body) return body.res;
  const userId = c.get("user").id;
  const total = db.select({ n: count() }).from(apiTokens).where(eq(apiTokens.userId, userId)).get()?.n ?? 0;
  if (total >= MAX_TOKENS_PER_USER) return c.json({ error: `Maximum ${MAX_TOKENS_PER_USER} jetons : révoque-en un d'abord.` }, 400);
  const token = TOKEN_PREFIX + newToken();
  const row = { id: newId(), tokenHash: hashToken(token), userId, householdId: c.get("householdId"), name: body.data.name, createdAt: new Date(), lastUsedAt: null };
  db.insert(apiTokens).values(row).run();
  const created: ApiTokenCreated = { ...summary(row), token }; // seule fois où le jeton en clair existe
  c.header("Cache-Control", "no-store");
  return c.json(created, 201);
});

tokenRoutes.delete("/:id", (c) => {
  const r = db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, c.req.param("id")), eq(apiTokens.userId, c.get("user").id)))
    .run();
  if (r.changes === 0) return c.json({ error: "Jeton introuvable" }, 404);
  return c.json({ ok: true });
});
