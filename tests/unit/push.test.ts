// Purge des abonnements push sans compte au démarrage.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import webpush from "web-push";

const DIR = mkdtempSync(join(tmpdir(), "plantes-push-"));
const keys = webpush.generateVAPIDKeys();
process.env.DATA_DIR = DIR;
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
const { db } = await import("../../apps/api/src/db/instance.js");
const { PushService } = await import("../../apps/api/src/push.js");
after(() => rmSync(DIR, { recursive: true, force: true }));

it("les abonnements sans compte sont supprimés au démarrage, celui qui est lié est conservé", () => {
  const raw = db.sqlite;
  raw.prepare("insert into user(id,name,email) values('u1','u1','u1@t.test')").run();
  const add = (e: string, u: string | null) => raw.prepare("insert into push_subscriptions(endpoint,p256dh,auth,user_id,created_at) values(?,?,?,?,?)").run(e, "p", "a", u, 1);
  add("https://x/orphelin-1", null);
  add("https://x/orphelin-2", null);
  add("https://x/lie", "u1");
  new PushService(db);
  assert.deepEqual((raw.prepare("select endpoint from push_subscriptions").all() as { endpoint: string }[]).map((r) => r.endpoint), ["https://x/lie"]);
  new PushService(db); // second démarrage : rien de plus à supprimer
  assert.equal((raw.prepare("select count(*) n from push_subscriptions").get() as { n: number }).n, 1);
});
