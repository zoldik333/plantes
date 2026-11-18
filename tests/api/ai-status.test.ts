// GET /api/ai/status et transitions d'état déclenchées par de vraies générations (IA factice, serveur réel).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, addMember, anonymous, bootstrapAlice, meId } from "../helpers/client.js";
import { until } from "../helpers/fixtures.js";
import { TestServer } from "../helpers/server.js";

const newPlant = async (c: Client, name: string): Promise<string> => (await c.post("/api/plants", { name })).json.id;
const generate = (c: Client, id: string) => c.post(`/api/plants/${id}/care-sheet`);
const settle = (c: Client, id: string) =>
  until(async () => {
    const d = (await c.get(`/api/plants/${id}`)).json;
    if (d.job?.status === "error") return d.job.error as string;
    return d.hasSheet && !d.job ? "ready" : false;
  }, `génération de ${id}`);
const statusOf = async (c: Client) => (await c.get("/api/ai/status")).json;

describe("API /api/ai/status", () => {
  let s: TestServer;
  let alice: Client;
  let bob: Client;
  before(async () => {
    s = await TestServer.start({ env: { CLAUDE_TOKEN_CREATED: "2026-01-10" } });
    alice = await bootstrapAlice(s);
    bob = await addMember(s, alice, "Bob", "bob@plantes.test");
  });
  after(() => s.cleanup());

  it("sans session : 401", async () => {
    assert.equal((await anonymous(s).get("/api/ai/status")).status, 401);
  });

  it("état initial : ok ; propriétaire = Alice, pas Bob ; expiration estimée", async () => {
    const a = await statusOf(alice);
    const b = await statusOf(bob);
    assert.deepEqual([a.status, a.problem, a.since, a.isOwner], ["ok", null, null, true]);
    assert.equal(b.isOwner, false);
    assert.equal(a.tokenExpiresAt, "2027-01-10");
    assert.equal(typeof a.daysLeft, "number");
    assert.equal(a.daysLeft, b.daysLeft);
    assert.ok(Math.abs(a.daysLeft - Math.round((Date.parse("2027-01-10") - Date.now()) / 86_400_000)) <= 1);
  });

  it("limite d'usage : message dédié, état inchangé, aucune notification", async () => {
    const id = await newPlant(alice, "Plante LIMITE");
    await generate(alice, id);
    assert.equal(await settle(alice, id), "La limite d'usage de l'abonnement Claude est atteinte : réessaie plus tard.");
    assert.equal((await statusOf(alice)).status, "ok");
    assert.equal(s.pushes().length, 0);
  });

  it("jeton invalide : message français, état « problem/auth », notification au seul propriétaire ; puis rétabli", async () => {
    // Un abonnement push pour Alice (propriétaire) et un pour Bob
    for (const [c, ep] of [[alice, "alice"], [bob, "bob"]] as const) {
      const r = await c.post("/api/push/subscribe", { endpoint: `https://push.test/${ep}`, keys: { p256dh: "p", auth: "a" } });
      assert.equal(r.status, 200);
    }
    const aliceId = await meId(alice);

    const bad = await newPlant(alice, "Plante AUTHFAIL");
    await generate(alice, bad);
    const msg = await settle(alice, bad);
    assert.match(msg, /^Le jeton Claude n'est plus valide/);

    const st = await until(async () => {
      const v = await statusOf(alice);
      return v.status === "problem" ? v : false;
    }, "état problem");
    assert.deepEqual([st.problem, st.isOwner], ["auth", true]);
    assert.equal((await statusOf(bob)).status, "problem", "tout le monde voit l'état");

    const pushes = await until(() => (s.pushes().length ? s.pushes() : false), "notification");
    assert.deepEqual(pushes.map((p) => p.userId), [aliceId], "propriétaire seulement");
    assert.match(pushes[0].payload.title, /jeton Claude est invalide/);
    assert.equal(pushes[0].payload.url, "/settings");

    // Une limite d'usage pendant le problème ne change rien
    const lim = await newPlant(alice, "Autre LIMITE");
    await generate(alice, lim);
    await settle(alice, lim);
    assert.equal((await statusOf(alice)).status, "problem");
    assert.equal(s.pushes().length, 1);

    // Une génération réussie rétablit l'état
    s.clearPushes();
    const good = await newPlant(alice, "Pothos");
    await generate(alice, good);
    assert.equal(await settle(alice, good), "ready");
    const ok = await until(async () => {
      const v = await statusOf(alice);
      return v.status === "ok" ? v : false;
    }, "retour à ok");
    assert.deepEqual([ok.problem, ok.since], [null, null]);
    const back = await until(() => (s.pushes().length ? s.pushes() : false), "notification de rétablissement");
    assert.deepEqual(back.map((p) => [p.userId, p.payload.title]), [[aliceId, "✅ Les fiches fonctionnent de nouveau"]]);
  });

  it("l'état survit à un redémarrage", async () => {
    const bad = await newPlant(alice, "Encore AUTHFAIL");
    await generate(alice, bad);
    await settle(alice, bad);
    await until(async () => (await statusOf(alice)).status === "problem", "état problem");
    const before = (await statusOf(alice)).since;
    await s.restart();
    assert.deepEqual(await statusOf(alice).then((v) => [v.status, v.since]), ["problem", before]);
  });
});
