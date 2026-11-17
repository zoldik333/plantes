import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.js";

// Tables de Better Auth : user, session, account, verification, passkey.
export * from "./auth-schema.js";

const now = () => new Date();

/** Un foyer possède les plantes ; il est créé avec le premier compte. */
export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

/** Une personne appartient à un seul foyer (user_id est la clé primaire). */
export const householdMembers = sqliteTable("household_members", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

/** Invitation à usage unique. Seul le hash du jeton est stocké. */
export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  usedBy: text("used_by").references(() => user.id, { onDelete: "set null" }),
});

/** Lien de réinitialisation de mot de passe généré par un autre membre (pas de mail). */
export const passwordResets = sqliteTable("password_resets", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
});

/** Abonnements Web Push. user_id est vide pour les abonnements antérieurs aux comptes. */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});
