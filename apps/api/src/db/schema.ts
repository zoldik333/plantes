import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Abonnements Web Push. Rattachés à un compte à l'étape 3 (Better Auth). */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
