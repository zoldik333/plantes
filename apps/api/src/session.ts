import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { auth } from "./auth.js";
import { db } from "./db/instance.js";
import { householdMembers } from "./db/schema.js";

export type AuthEnv = {
  Variables: {
    user: { id: string; name: string; email: string };
    householdId: string;
  };
};

/** Exige une session valide ET l'appartenance à un foyer (chaque compte en a un). */
export const requireMember = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Non connecté" }, 401);
  const member = db.select().from(householdMembers).where(eq(householdMembers.userId, session.user.id)).get();
  if (!member) return c.json({ error: "Compte sans foyer" }, 403);
  c.set("user", { id: session.user.id, name: session.user.name, email: session.user.email });
  c.set("householdId", member.householdId);
  await next();
});
