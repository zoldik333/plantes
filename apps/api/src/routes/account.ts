import { and, count, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { APP_URL, auth } from "../auth.js";
import { ownerOf } from "../ai-status.js";
import { db } from "../db/instance.js";
import { households, householdMembers, invitations, passwordResets, pushSubscriptions, user } from "../db/schema.js";
import { hashToken, newId, newToken, safeEqual } from "../lib/tokens.js";
import { rateLimit } from "../lib/rate-limit.js";
import { requireMember, type AuthEnv } from "../session.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 24 * 60 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;

const Signup = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(128),
  inviteToken: z.string().max(200).optional(),
  /** Pour le tout premier compte : la clé POC_ACCESS_KEY du serveur. */
  bootstrapKey: z.string().max(200).optional(),
});

/** Sérialise les inscriptions : évite deux « premiers comptes » ou deux usages d'une même invitation. */
let signupQueue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = signupQueue.then(fn, fn);
  signupQueue = run.catch(() => {});
  return run;
}

const findInvite = (token: string) =>
  db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.usedAt)))
    .get();

const isLive = (expiresAt: Date) => expiresAt.getTime() > Date.now();

export function accountRoutes(accessKey: string) {
  const app = new Hono<AuthEnv>();

  /** Le serveur n'a-t-il encore aucun foyer ? (l'écran propose alors de le créer) */
  app.get("/setup", (c) => {
    const n = db.select({ n: count() }).from(households).get()?.n ?? 0;
    return c.json({ needsBootstrap: n === 0 });
  });

  app.get("/invitations/:token", rateLimit(30, TEN_MIN), (c) => {
    const inv = findInvite(c.req.param("token"));
    if (!inv || !isLive(inv.expiresAt)) return c.json({ error: "Invitation invalide ou expirée" }, 404);
    const household = db.select().from(households).where(eq(households.id, inv.householdId)).get();
    const inviter = db.select().from(user).where(eq(user.id, inv.createdBy)).get();
    return c.json({ householdName: household?.name, invitedBy: inviter?.name });
  });

  app.post("/signup", rateLimit(10, TEN_MIN), async (c) => {
    const parsed = Signup.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Données invalides", details: parsed.error.issues }, 400);
    const { name, email, password, inviteToken, bootstrapKey } = parsed.data;

    return exclusive(async () => {
      const bootstrap = (db.select({ n: count() }).from(households).get()?.n ?? 0) === 0;
      let inviteId: string | undefined;
      let householdId: string | undefined;
      if (bootstrap) {
        if (!bootstrapKey || !safeEqual(bootstrapKey, accessKey)) return c.json({ error: "Clé d'installation invalide" }, 403);
      } else {
        const inv = inviteToken ? findInvite(inviteToken) : undefined;
        if (!inv || !isLive(inv.expiresAt)) return c.json({ error: "Invitation invalide ou expirée" }, 403);
        inviteId = inv.id;
        householdId = inv.householdId;
      }

      const res = await auth.api.signUpEmail({ body: { name, email, password }, headers: c.req.raw.headers, asResponse: true });
      if (!res.ok) return res; // ex. e-mail déjà utilisé : on relaie l'erreur de Better Auth
      const { user: created } = (await res.clone().json()) as { user: { id: string } };

      try {
        db.transaction((tx) => {
          let hid = householdId;
          if (bootstrap) {
            hid = newId();
            tx.insert(households).values({ id: hid, name: "Mon foyer" }).run();
          }
          tx.insert(householdMembers).values({ userId: created.id, householdId: hid! }).run();
          if (inviteId) tx.update(invitations).set({ usedAt: new Date(), usedBy: created.id }).where(eq(invitations.id, inviteId)).run();
        });
      } catch (err) {
        db.delete(user).where(eq(user.id, created.id)).run(); // pas de compte orphelin sans foyer
        throw err;
      }
      return res; // contient le cookie de session
    });
  });

  app.post("/reset-password", rateLimit(10, TEN_MIN), async (c) => {
    const parsed = z
      .object({ token: z.string().max(200), password: z.string().min(10).max(128) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Données invalides" }, 400);
    const row = db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, hashToken(parsed.data.token)), isNull(passwordResets.usedAt)))
      .get();
    if (!row || !isLive(row.expiresAt)) return c.json({ error: "Lien invalide ou expiré" }, 404);

    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(row.userId, await ctx.password.hash(parsed.data.password));
    await ctx.internalAdapter.deleteUserSessions(row.userId); // déconnecte les appareils existants
    db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id)).run();
    return c.json({ ok: true });
  });

  // --- Routes réservées aux membres -------------------------------------------------------------

  app.get("/me", requireMember, (c) => {
    const me = c.get("user");
    const householdId = c.get("householdId");
    const household = db.select().from(households).where(eq(households.id, householdId)).get();
    const members = db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(householdMembers)
      .innerJoin(user, eq(user.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, householdId))
      .all();
    return c.json({ user: me, household: { id: householdId, name: household?.name, ownerId: ownerOf(householdId), members } });
  });

  app.post("/household/invitations", requireMember, (c) => {
    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    db.insert(invitations)
      .values({ id: newId(), tokenHash: hashToken(token), householdId: c.get("householdId"), createdBy: c.get("user").id, expiresAt })
      .run();
    return c.json({ url: `${APP_URL}/join/${token}`, expiresAt });
  });

  app.post("/household/members/:id/reset-link", requireMember, (c) => {
    const targetId = c.req.param("id");
    const me = c.get("user");
    if (targetId === me.id) return c.json({ error: "Pour toi-même, utilise ton mot de passe actuel" }, 400);
    const target = db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, targetId), eq(householdMembers.householdId, c.get("householdId"))))
      .get();
    if (!target) return c.json({ error: "Membre introuvable" }, 404);
    const token = newToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    db.insert(passwordResets)
      .values({ id: newId(), tokenHash: hashToken(token), userId: targetId, createdBy: me.id, expiresAt })
      .run();
    return c.json({ url: `${APP_URL}/reset/${token}`, expiresAt });
  });

  /**
   * Retire un compte du foyer (propriétaire seulement) : la ligne `user` est supprimée, et les clés étrangères en
   * cascade emportent sessions (déconnexion immédiate), mots de passe, passkeys, abonnements push, jetons API,
   * invitations et liens de réinitialisation. Les plantes, photos, journal et messages restent (auteur mis à null).
   * L'ordre des contrôles ne révèle rien aux non-propriétaires ; un id d'un autre foyer est un 404.
   */
  app.delete("/household/members/:id", requireMember, (c) => {
    const me = c.get("user");
    const householdId = c.get("householdId");
    if (ownerOf(householdId) !== me.id) return c.json({ error: "Seule la personne qui a créé le foyer peut retirer un membre" }, 403);
    const targetId = c.req.param("id");
    if (targetId === me.id) return c.json({ error: "Tu ne peux pas te retirer toi-même du foyer" }, 400);
    const target = db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, targetId), eq(householdMembers.householdId, householdId)))
      .get();
    if (!target) return c.json({ error: "Membre introuvable" }, 404);
    db.transaction((tx) => {
      // push_subscriptions.user_id a été ajouté par ALTER TABLE (migration 0001) sans ON DELETE : pas de cascade en base.
      tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, targetId)).run();
      tx.delete(user).where(eq(user.id, targetId)).run();
    });
    return c.json({ ok: true });
  });

  return app;
}
