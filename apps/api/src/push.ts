import { appendFileSync } from "node:fs";
import { eq, inArray, isNull } from "drizzle-orm";
import webpush, { type PushSubscription } from "web-push";
import type { Db } from "./db/index.js";
import { pushSubscriptions } from "./db/schema.js";

export class PushService {
  constructor(private readonly db: Db) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquantes : lance `pnpm vapid`.");
    }
    // Apple exige un subject valide (mailto: ou https:).
    webpush.setVapidDetails(VAPID_SUBJECT ?? "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    // Un abonnement sans compte (d'avant l'étape 3) ne peut recevoir aucun rappel : on le supprime.
    const orphans = this.db.delete(pushSubscriptions).where(isNull(pushSubscriptions.userId)).run().changes;
    if (orphans > 0) console.log(`[push] ${orphans} abonnement(s) sans compte supprimé(s)`);
  }

  get publicKey(): string {
    return process.env.VAPID_PUBLIC_KEY!;
  }

  private upsert(sub: PushSubscription, userId: string): void {
    const row = { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userId };
    this.db
      .insert(pushSubscriptions)
      .values(row)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row })
      .run();
  }

  private all(): PushSubscription[] {
    return this.db
      .select()
      .from(pushSubscriptions)
      .all()
      .map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
  }

  async subscribe(sub: PushSubscription, userId: string): Promise<number> {
    this.upsert(sub, userId);
    return this.all().length;
  }

  /**
   * Envoie à tous les appareils des personnes données ; supprime ceux que le service push déclare expirés.
   * Avec PUSH_DRY_RUN_FILE (tests uniquement), écrit les messages dans ce fichier au lieu de les envoyer.
   */
  async sendToUsers(userIds: string[], payload: { title: string; body: string; url?: string }) {
    if (userIds.length === 0) return { sent: 0, total: 0 };
    const subs = this.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds)).all();
    const dryRun = process.env.PUSH_DRY_RUN_FILE;
    let sent = 0;
    for (const row of subs) {
      if (dryRun) {
        appendFileSync(dryRun, JSON.stringify({ endpoint: row.endpoint, userId: row.userId, payload }) + "\n");
        sent++;
        continue;
      }
      const sub: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: "normal" });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).run();
        }
        console.error(`[push] échec (${status ?? "?"}) vers ${new URL(sub.endpoint).host}`);
      }
    }
    return { sent, total: subs.length };
  }
}
