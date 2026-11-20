import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, bobInOtherHousehold, bootstrapAlice, meId } from "../helpers/client.js";
import { jpeg } from "../helpers/fixtures.js";
import { TestServer } from "../helpers/server.js";

const DAY = 86_400_000;
const daysAgo = (n: number) => Date.now() - n * DAY;

describe("timeline : évolution d'une plante", () => {
  let s: TestServer;
  let alice: Client;
  let bob: Client;
  let plantId: string;
  let emptyId: string;
  const photoIds: string[] = [];

  before(async () => {
    s = await TestServer.start();
    alice = await bootstrapAlice(s);
    bob = await bobInOtherHousehold(s, await meId(alice));
    plantId = (await alice.post("/api/plants", { name: "Monstera" })).json.id;
    emptyId = (await alice.post("/api/plants", { name: "Sans photo" })).json.id;
    for (let i = 0; i < 2; i++) photoIds.push((await alice.upload(`/api/plants/${plantId}/photos`, await jpeg())).json.id);
    await alice.post(`/api/plants/${plantId}/events`, { type: "watered" });
    await alice.post(`/api/plants/${plantId}/events`, { type: "note", note: "Nouvelle feuille" });
    const ev = (await alice.get(`/api/plants/${plantId}/events`)).json as { id: string; type: string }[];
    const idOf = (t: string) => ev.find((e) => e.type === t)!.id;
    // Chronologie maîtrisée : photo 0 (40 j) < arrosage (30 j) < photo 1 (20 j) < note (5 j).
    s.db((db) => {
      db.prepare("update plant_photos set created_at=? where id=?").run(daysAgo(40), photoIds[0]);
      db.prepare("update plant_photos set created_at=? where id=?").run(daysAgo(20), photoIds[1]);
      db.prepare("update care_events set created_at=? where id=?").run(daysAgo(30), idOf("watered"));
      db.prepare("update care_events set created_at=? where id=?").run(daysAgo(5), idOf("note"));
    });
  });
  after(() => s.cleanup());

  it("mêle photos et événements, du plus récent au plus ancien, avec le prénom", async () => {
    const r = await alice.get(`/api/plants/${plantId}/timeline`);
    assert.equal(r.status, 200);
    const e = r.json.entries as { kind: string; id?: string; createdAt?: string; event?: { type: string; note: string | null; userName: string | null; createdAt: string } }[];
    assert.deepEqual(
      e.map((x) => (x.kind === "photo" ? "photo" : x.event!.type)),
      ["note", "photo", "watered", "photo"],
    );
    assert.equal(e[1].id, photoIds[1]);
    assert.equal(e[3].id, photoIds[0]);
    assert.equal(e[0].event!.note, "Nouvelle feuille");
    assert.equal(e[0].event!.userName, "Alice");
    const times = e.map((x) => Date.parse(x.createdAt ?? x.event!.createdAt));
    assert.deepEqual([...times].sort((a, b) => b - a), times);
  });

  it("plante sans photo ni événement : liste vide", async () => {
    const r = await alice.get(`/api/plants/${emptyId}/timeline`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { entries: [] });
  });

  it("une plante sans photo mais avec des événements reste lisible", async () => {
    await alice.post(`/api/plants/${emptyId}/events`, { type: "fertilized" });
    const r = await alice.get(`/api/plants/${emptyId}/timeline`);
    assert.deepEqual(r.json.entries.map((x: { kind: string }) => x.kind), ["event"]);
  });

  it("accès croisé : plante d'un autre foyer ou inexistante = 404, sans session = 401", async () => {
    assert.equal((await bob.get(`/api/plants/${plantId}/timeline`)).status, 404);
    assert.equal((await alice.get(`/api/plants/inexistante/timeline`)).status, 404);
    assert.deepEqual((await bob.get("/api/plants")).json, []);
    const anon = new Client(s.url);
    assert.equal((await anon.get(`/api/plants/${plantId}/timeline`)).status, 401);
  });

  it("n'expose rien d'un autre foyer : la frise de Bob n'a que ses données", async () => {
    const bobPlant = (await bob.post("/api/plants", { name: "Ficus" })).json.id;
    await bob.post(`/api/plants/${bobPlant}/events`, { type: "watered" });
    const r = await bob.get(`/api/plants/${bobPlant}/timeline`);
    assert.equal(r.json.entries.length, 1);
    assert.equal((await alice.get(`/api/plants/${bobPlant}/timeline`)).status, 404);
  });

  it("événements bornés à 200 (les plus récents), photos à 20", async () => {
    const big = (await alice.post("/api/plants", { name: "Beaucoup" })).json.id;
    s.db((db) => {
      const hh = (db.prepare("select household_id h from plants where id=?").get(big) as { h: string }).h;
      const ins = db.prepare("insert into care_events(id,plant_id,household_id,type,created_at) values(?,?,?,?,?)");
      for (let i = 0; i < 250; i++) ins.run(`ev${String(i).padStart(4, "0")}`, big, hh, "watered", daysAgo(i));
      const ph = db.prepare("insert into plant_photos(id,plant_id,household_id,created_at) values(?,?,?,?)");
      for (let i = 0; i < 25; i++) ph.run(`ph${String(i).padStart(4, "0")}`, big, hh, daysAgo(i));
    });
    const r = await alice.get(`/api/plants/${big}/timeline`);
    const e = r.json.entries as { kind: string; event?: { id: string } }[];
    assert.equal(e.filter((x) => x.kind === "event").length, 200);
    assert.equal(e.filter((x) => x.kind === "photo").length, 20);
    assert.ok(e.some((x) => x.event?.id === "ev0000"), "le plus récent est gardé");
    assert.ok(!e.some((x) => x.event?.id === "ev0249"), "le plus ancien est écarté");
  });
});
