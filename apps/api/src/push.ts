import { existsSync, readFileSync, renameSync } from "node:fs";
import { eq } from "drizzle-orm";
import webpush, { type PushSubscription } from "web-push";
import type { Db } from "./db/index.js";
import { pushSubscriptions } from "./db/schema.js";

export class PushService {
  constructor(
    private readonly db: Db,
    legacyFile?: string,
  ) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquantes : lance `pnpm vapid`.");
    }
    // Apple exige un subject valide (mailto: ou https:).
    webpush.setVapidDetails(VAPID_SUBJECT ?? "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    if (legacyFile) this.importLegacy(legacyFile);
  }

  get publicKey(): string {
    return process.env.VAPID_PUBLIC_KEY!;
  }

  /** Reprend une fois les abonnements du POC (fichier JSON), puis renomme le fichier. */
  private importLegacy(file: string): void {
    if (!existsSync(file)) return;
    try {
      const subs: PushSubscription[] = JSON.parse(readFileSync(file, "utf8"));
      for (const s of subs) this.upsert(s);
      renameSync(file, `${file}.migrated`);
      console.log(`[push] ${subs.length} abonnement(s) importé(s) depuis ${file}`);
    } catch (err) {
      console.error("[push] import de l'ancien fichier impossible", err);
    }
  }

  private upsert(sub: PushSubscription): void {
    const row = { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth };
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

  async subscribe(sub: PushSubscription): Promise<number> {
    this.upsert(sub);
    return this.all().length;
  }

  /** Envoie à tous les abonnés ; supprime ceux que le service push déclare expirés. */
  async sendToAll(payload: { title: string; body: string; url?: string }) {
    const subs = this.all();
    let sent = 0;
    for (const sub of subs) {
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
