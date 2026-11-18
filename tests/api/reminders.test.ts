import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, anonymous, bobInOtherHousehold, bootstrapAlice, meId } from "../helpers/client.js";
import { FICHE } from "../helpers/fixtures.js";
import { TestServer } from "../helpers/server.js";

type Plant = { id: string; name: string; water: { daysUntil: number; intervalDays: number; snoozed: boolean; lastWateredAt: string | null } | null };
const DAY = 86_400_000;

describe("journal d'entretien, « Aujourd'hui », notifications ciblées", () => {
  let s: TestServer;
  let alice: Client;
  let bob: Client;
  let aliceId: string;
  let bobId: string;
  let calathea: string, pothos: string, sansFiche: string, plantDeBob: string;
  let firstWatering: string;

  const names = (list: Plant[]) => list.map((p) => p.name).sort();
  const today = async (c: Client) => (await c.get("/api/today")).json as { due: Plant[]; upcoming: Plant[]; withoutSheet: number };
  const event = (c: Client, plant: string, body: object) => c.post(`/api/plants/${plant}/events`, body);
  const journal = async (c: Client, plant: string) => (await c.get(`/api/plants/${plant}/events`)).json as { id: string; type: string; note: string | null; userName: string | null }[];

  before(async () => {
    s = await TestServer.start();
    alice = await bootstrapAlice(s);
    aliceId = await meId(alice);
    bob = await bobInOtherHousehold(s, aliceId);
    bobId = await meId(bob);
    const mk = async (c: Client, name: string, sheet = true) => (await c.post("/api/plants", { name, ...(sheet && { careSheet: FICHE }) })).json.id as string;
    calathea = await mk(alice, "Calathea");
    pothos = await mk(alice, "Pothos");
    sansFiche = await mk(alice, "Sans fiche", false);
    plantDeBob = await mk(bob, "Plante de Bob");
    // créées il y a 20 jours : à arroser (le rythme est de 7 ou 12 jours)
    s.db((db) => db.prepare("update plants set created_at = ? where id in (?,?,?)").run(Date.now() - 20 * DAY, calathea, pothos, plantDeBob));
  });
  after(() => s.cleanup());

  describe("Aujourd'hui", () => {
    it("exige une session", async () => {
      assert.equal((await anonymous(s).get("/api/today")).status, 401);
    });
    it("liste les plantes en retard, signale celles sans fiche, n'annonce rien d'autre", async () => {
      const t = await today(alice);
      assert.deepEqual(names(t.due), ["Calathea", "Pothos"]);
      assert.ok(t.due.every((p) => p.water!.daysUntil < 0), "en retard");
      assert.equal(t.withoutSheet, 1);
      assert.deepEqual(t.upcoming, []);
    });
    it("une plante sans fiche n'a pas d'état d'arrosage (donc pas de rappel)", async () => {
      const p = (await alice.get("/api/plants")).json.find((x: Plant) => x.id === sansFiche);
      assert.equal(p.water, null);
    });
    it("chaque foyer ne voit que ses plantes", async () => {
      assert.deepEqual(names((await today(bob)).due), ["Plante de Bob"]);
    });
  });

  describe("arrosé et encore humide", () => {
    it("« arrosé » : un intervalle complet devant, la plante quitte la liste du jour", async () => {
      const r = await event(alice, calathea, { type: "watered" });
      firstWatering = r.json.id;
      assert.equal(r.status, 201);
      assert.equal(r.json.water.daysUntil, r.json.water.intervalDays);
      assert.deepEqual(names((await today(alice)).due), ["Pothos"]);
      assert.deepEqual(names((await today(bob)).due), ["Plante de Bob"], "rien ne change chez l'autre foyer");
    });
    it("« encore humide » : rappel repoussé d'au moins 2 jours", async () => {
      const r = await event(alice, pothos, { type: "still_wet" });
      assert.equal(r.json.water.snoozed, true);
      assert.ok(r.json.water.daysUntil >= 2);
      assert.deepEqual((await today(alice)).due, []);
    });
    it("annuler un arrosage recalcule l'état depuis le journal", async () => {
      assert.equal((await alice.delete(`/api/plants/${calathea}/events/${firstWatering}`)).status, 200);
      assert.deepEqual(names((await today(alice)).due), ["Calathea"]);
      assert.equal((await alice.delete(`/api/plants/${calathea}/events/${firstWatering}`)).status, 404, "annuler deux fois");
    });
  });

  describe("journal d'entretien", () => {
    it("engrais, rempotage avec précision, note libre", async () => {
      assert.equal((await event(alice, calathea, { type: "watered" })).status, 201);
      assert.equal((await event(alice, calathea, { type: "fertilized" })).status, 201);
      assert.equal((await event(alice, calathea, { type: "repotted", note: "Pot de 17 cm" })).status, 201);
      assert.equal((await event(alice, calathea, { type: "note", note: "Feuille jaunie à gauche" })).status, 201);
    });
    it("validation : note vide, type inconnu, note trop longue", async () => {
      assert.equal((await event(alice, calathea, { type: "note" })).status, 400);
      assert.equal((await event(alice, calathea, { type: "danse" })).status, 400);
      assert.equal((await event(alice, calathea, { type: "note", note: "x".repeat(501) })).status, 400);
      assert.equal((await event(alice, pothos, { type: "note", note: "x".repeat(500) })).status, 201, "limite exacte");
    });
    it("du plus récent au plus ancien, signé, avec les notes ; engrais et notes ne changent pas l'arrosage", async () => {
      const j = await journal(alice, calathea);
      assert.deepEqual(j.map((e) => e.type), ["note", "repotted", "fertilized", "watered"]);
      assert.equal(j[0].userName, "Alice");
      assert.deepEqual(j.slice(0, 2).map((e) => e.note), ["Feuille jaunie à gauche", "Pot de 17 cm"]);
      const detail = (await alice.get(`/api/plants/${calathea}`)).json;
      assert.notEqual(detail.water.lastWateredAt, null);
      assert.equal(detail.water.daysUntil, detail.water.intervalDays);
    });
  });

  describe("arrosage daté (dernier arrosage à la création, rattrapage)", () => {
    let ficus: string;
    let iv: number;
    before(async () => {
      ficus = (await alice.post("/api/plants", { name: "Ficus", careSheet: FICHE })).json.id;
    });
    it("arrosée il y a 7 jours : échéance = intervalle − 7 jours, à la bonne date", async () => {
      const r = await event(alice, ficus, { type: "watered", daysAgo: 7 });
      iv = r.json.water.intervalDays;
      assert.equal(r.json.water.daysUntil, iv - 7);
      const expected = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
      assert.equal((await alice.get(`/api/plants/${ficus}`)).json.water.lastWateredAt.slice(0, 10), expected);
    });
    it("le journal range l'arrosage ancien sous l'action récente", async () => {
      await event(alice, ficus, { type: "fertilized" });
      assert.deepEqual((await journal(alice, ficus)).map((e) => e.type), ["fertilized", "watered"]);
    });
    it("un arrosage plus ancien ne remplace pas le plus récent ; un arrosage d'aujourd'hui repart d'un intervalle complet", async () => {
      assert.equal((await event(alice, ficus, { type: "watered", daysAgo: 14 })).json.water.daysUntil, iv - 7);
      assert.equal((await event(alice, ficus, { type: "watered" })).json.water.daysUntil, iv);
    });
    it("valeurs refusées : hors limites, non entières, texte, ou type autre qu'un arrosage", async () => {
      for (const body of [
        { type: "watered", daysAgo: 61 },
        { type: "watered", daysAgo: -1 },
        { type: "watered", daysAgo: 1.5 },
        { type: "watered", daysAgo: "7" },
        { type: "still_wet", daysAgo: 2 },
        { type: "note", note: "x", daysAgo: 2 },
        { type: "fertilized", daysAgo: 1 },
      ]) {
        assert.equal((await event(alice, ficus, body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await event(alice, ficus, { type: "watered", daysAgo: 60 })).status, 201, "60 jours : limite exacte");
    });
  });

  describe("isolation entre foyers", () => {
    it("Bob ne peut ni lire, ni écrire, ni supprimer dans le journal d'Alice", async () => {
      assert.equal((await bob.get(`/api/plants/${calathea}/events`)).status, 404);
      assert.equal((await event(bob, calathea, { type: "watered" })).status, 404);
      assert.equal((await event(bob, calathea, { type: "watered", daysAgo: 3 })).status, 404);
      const e = (await journal(alice, calathea))[0].id;
      assert.equal((await bob.delete(`/api/plants/${calathea}/events/${e}`)).status, 404);
      assert.equal((await bob.delete(`/api/plants/${plantDeBob}/events/${e}`)).status, 404, "même avec sa propre plante");
    });
    it("sans session : 401", async () => {
      assert.equal((await event(anonymous(s), calathea, { type: "watered" })).status, 401);
    });
  });

  describe("notifications (mode simulation)", () => {
    before(() => {
      s.db((db) => {
        const add = db.prepare("insert into push_subscriptions(endpoint,p256dh,auth,user_id,created_at) values(?,?,?,?,?)");
        add.run("https://push.test/alice", "p", "a", aliceId, 1);
        add.run("https://push.test/bob", "p", "a", bobId, 1);
        add.run("https://push.test/orphelin", "p", "a", null, 1);
      });
      s.clearPushes();
    });
    it("le vrai rappel de test part vers les seuls appareils de la personne, avec le vrai contenu", async () => {
      // état : Calathea arrosée (arrosage récent), Pothos repoussée ; on rend la Calathea à arroser
      s.db((db) => db.prepare("delete from care_events where plant_id = ?").run(calathea));
      const r = await alice.post("/api/reminders/test");
      assert.deepEqual([r.json.plants, r.json.sent, r.json.total], [1, 1, 1]);
      const sent = s.pushes();
      assert.deepEqual(sent.map((m) => m.endpoint.split("/").pop()), ["alice"]);
      assert.equal(sent[0].payload.title, "🧪 Test : 💧 1 plante à arroser");
      assert.equal(sent[0].payload.body, "Calathea");
    });
    it("la notification de test ne va ni à Bob, ni à l'abonnement sans compte", async () => {
      s.clearPushes();
      await alice.post("/api/push/test", { delaySeconds: 1 });
      await new Promise((r) => setTimeout(r, 2500));
      assert.deepEqual(s.pushes().map((m) => m.endpoint.split("/").pop()), ["alice"]);
    });
    it("rien à arroser : le test le dit (0 plante)", async () => {
      await event(alice, calathea, { type: "watered" });
      assert.equal((await alice.post("/api/reminders/test")).json.plants, 0);
    });
  });

  describe("suppression", () => {
    it("supprimer une plante supprime son journal", async () => {
      const count = () => s.db((db) => (db.prepare("select count(*) n from care_events where plant_id = ?").get(calathea) as { n: number }).n);
      assert.ok(count() > 0);
      assert.equal((await alice.delete(`/api/plants/${calathea}`)).status, 200);
      assert.equal(count(), 0);
    });
  });
});
