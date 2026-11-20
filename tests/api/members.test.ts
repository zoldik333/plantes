// Retrait d'un compte du foyer par le propriétaire : DELETE /api/household/members/:id (serveur réel).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, addMember, anonymous, bobInOtherHousehold, bootstrapAlice, meId } from "../helpers/client.js";
import { until } from "../helpers/fixtures.js";
import { TestServer } from "../helpers/server.js";

const USER_TABLES: [string, string][] = [
  ["session", "user_id"],
  ["account", "user_id"],
  ["passkey", "user_id"],
  ["push_subscriptions", "user_id"],
  ["api_tokens", "user_id"],
  ["household_members", "user_id"],
  ["invitations", "created_by"],
  ["password_resets", "user_id"],
  ["password_resets", "created_by"],
  ["user", "id"],
];

describe("API retrait d'un membre du foyer", () => {
  let s: TestServer;
  let alice: Client;
  let bob: Client;
  let aliceId: string;
  let bobId: string;
  let plantId: string;
  const countOf = (table: string, col: string, id: string) =>
    s.db((db) => (db.prepare(`select count(*) n from ${table} where ${col} = ?`).get(id) as { n: number }).n);

  before(async () => {
    s = await TestServer.start();
    alice = await bootstrapAlice(s);
    bob = await addMember(s, alice, "Bob", "bob@plantes.test");
    aliceId = await meId(alice);
    bobId = await meId(bob);
  });
  after(() => s.cleanup());

  it("GET /api/me expose le propriétaire", async () => {
    assert.equal((await alice.get("/api/me")).json.household.ownerId, aliceId);
    assert.equal((await bob.get("/api/me")).json.household.ownerId, aliceId);
  });

  it("sans session : 401 ; non-propriétaire : 403 (même pour un id inconnu) ; rien n'est supprimé", async () => {
    assert.equal((await anonymous(s).delete(`/api/household/members/${bobId}`)).status, 401);
    const r = await bob.delete(`/api/household/members/${aliceId}`);
    assert.equal(r.status, 403);
    assert.match(r.json.error, /créé le foyer/);
    assert.equal((await bob.delete("/api/household/members/inconnu")).status, 403);
    assert.equal(countOf("user", "id", aliceId), 1);
  });

  it("le propriétaire ne peut pas se retirer lui-même", async () => {
    const r = await alice.delete(`/api/household/members/${aliceId}`);
    assert.equal(r.status, 400);
    assert.equal(countOf("user", "id", aliceId), 1);
  });

  it("retrait : tout ce qui dépend du compte disparaît, les données du foyer restent", async () => {
    // Données de Bob : plante + journal + chat, abonnement push, jeton API, passkey, invitation et lien de réinitialisation
    plantId = (await bob.post("/api/plants", { name: "Ficus de Bob" })).json.id;
    assert.ok((await bob.post(`/api/plants/${plantId}/events`, { type: "watered" })).status < 300);
    assert.ok((await bob.post("/api/push/subscribe", { endpoint: "https://push.test/bob", keys: { p256dh: "p", auth: "a" } })).status < 300);
    assert.ok((await alice.post("/api/push/subscribe", { endpoint: "https://push.test/alice", keys: { p256dh: "p", auth: "a" } })).status < 300);
    assert.ok((await bob.post("/api/household/invitations")).status < 300);
    assert.ok((await alice.post(`/api/household/members/${bobId}/reset-link`)).status < 300);
    assert.ok((await bob.post(`/api/household/members/${aliceId}/reset-link`)).status < 300);
    s.db((db) => {
      db.prepare("insert into api_tokens(id,token_hash,user_id,household_id,name,created_at) values(?,?,?,(select household_id from household_members where user_id=?),?,?)").run("t1", "h".repeat(64), bobId, bobId, "raccourci", Date.now());
      db.prepare("insert into passkey(id,public_key,user_id,credential_id,counter,device_type,backed_up) values(?,?,?,?,?,?,?)").run("pk1", "k", bobId, "cred1", 0, "singleDevice", 0);
      db.prepare("insert into chat_messages(id,plant_id,household_id,user_id,role,content,created_at) values(?,?,(select household_id from household_members where user_id=?),?,?,?,?)").run("m1", plantId, bobId, bobId, "user", "Bonjour", Date.now());
    });
    for (const [t, c] of USER_TABLES) assert.ok(countOf(t, c, bobId) > 0, `préparation : ${t}.${c} contient une ligne de Bob`);

    const r = await alice.delete(`/api/household/members/${bobId}`);
    assert.equal(r.status, 200);

    for (const [t, c] of USER_TABLES) assert.equal(countOf(t, c, bobId), 0, `${t}.${c} nettoyé`);
    assert.equal(countOf("invitations", "used_by", bobId), 0);

    const me = (await alice.get("/api/me")).json;
    assert.deepEqual(me.household.members.map((m: { id: string }) => m.id), [aliceId]);
    // Les données du foyer restent ; l'auteur devient anonyme
    assert.equal((await alice.get(`/api/plants/${plantId}`)).status, 200);
    const events = (await alice.get(`/api/plants/${plantId}/events`)).json;
    assert.ok(events.length >= 1);
    assert.ok(events.every((e: { userName: string | null }) => e.userName === null));
    assert.equal(s.db((db) => (db.prepare("select user_id u from chat_messages where id='m1'").get() as { u: string | null }).u), null);
    assert.equal(s.db((db) => (db.prepare("select count(*) n from chat_messages where id='m1'").get() as { n: number }).n), 1);
  });

  it("la session de la personne retirée est invalide tout de suite (401)", async () => {
    assert.equal((await bob.get("/api/me")).status, 401);
    assert.equal((await bob.get("/api/plants")).status, 401);
    // Les liens de réinitialisation qui le concernent (reçus ou créés) n'existent plus
    assert.equal(s.db((db) => (db.prepare("select count(*) n from password_resets").get() as { n: number }).n), 0);
  });

  it("plus de notification vers ses appareils ; ceux des autres restent", async () => {
    s.clearPushes();
    const r = await alice.post("/api/push/test");
    assert.equal(r.status, 200);
    await until(() => s.pushes().length > 0, "notification de test d'Alice");
    const to = s.pushes().map((p) => p.endpoint);
    assert.ok(!to.includes("https://push.test/bob"));
    assert.ok(to.includes("https://push.test/alice"));
  });

  it("le même e-mail peut être ré-invité, avec un nouvel identifiant", async () => {
    const again = await addMember(s, alice, "Bob", "bob@plantes.test");
    const newId = await meId(again);
    assert.notEqual(newId, bobId);
    assert.equal((await again.get("/api/plants")).status, 200);
    // Un membre ré-invité ne devient pas propriétaire
    assert.equal((await alice.get("/api/me")).json.household.ownerId, aliceId);
  });
});

describe("API retrait d'un membre : isolation entre foyers", () => {
  let s: TestServer;
  let alice: Client;
  let bob2: Client;
  let aliceId: string;
  const countOf = (id: string) => s.db((db) => (db.prepare("select count(*) n from user where id = ?").get(id) as { n: number }).n);
  before(async () => {
    s = await TestServer.start();
    alice = await bootstrapAlice(s);
    bob2 = await addMember(s, alice, "Carl", "carl@plantes.test");
    aliceId = await meId(alice);
  });
  after(() => s.cleanup());

  it("id absent ou d'un autre foyer : 404 identique, rien n'est supprimé", async () => {
    const other = await bobInOtherHousehold(s, aliceId);
    const bobId = await meId(bob2);
    const otherId = await meId(other);
    const a = await alice.delete(`/api/household/members/${otherId}`);
    const b = await alice.delete("/api/household/members/n-existe-pas");
    assert.equal(a.status, 404);
    assert.equal(b.status, 404);
    assert.deepEqual(a.json, b.json);
    assert.equal(countOf(otherId), 1);
    // Et le propriétaire de l'autre foyer ne peut pas retirer Bob
    assert.equal((await other.delete(`/api/household/members/${bobId}`)).status, 404);
    assert.equal(countOf(bobId), 1);
  });
});
