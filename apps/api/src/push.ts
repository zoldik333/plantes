import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import webpush, { type PushSubscription } from "web-push";

/** Stockage minimal des abonnements push dans un fichier JSON (suffisant pour le POC). */
export class PushService {
  constructor(private readonly file: string) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquantes : lance `npm run vapid`.");
    }
    // Apple exige un subject valide (mailto: ou https:).
    webpush.setVapidDetails(VAPID_SUBJECT ?? "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }

  get publicKey(): string {
    return process.env.VAPID_PUBLIC_KEY!;
  }

  private async load(): Promise<PushSubscription[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      return [];
    }
  }

  private async save(subs: PushSubscription[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(subs, null, 2));
  }

  async subscribe(sub: PushSubscription): Promise<number> {
    const subs = (await this.load()).filter((s) => s.endpoint !== sub.endpoint);
    subs.push(sub);
    await this.save(subs);
    return subs.length;
  }

  /** Envoie à tous les abonnés ; supprime ceux que le service push déclare expirés. */
  async sendToAll(payload: { title: string; body: string; url?: string }) {
    const subs = await this.load();
    const alive: PushSubscription[] = [];
    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: "normal" });
        alive.push(sub);
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status !== 404 && status !== 410) alive.push(sub);
        console.error(`[push] échec (${status ?? "?"}) vers ${new URL(sub.endpoint).host}`);
      }
    }
    if (alive.length !== subs.length) await this.save(alive);
    return { sent, total: subs.length };
  }
}
