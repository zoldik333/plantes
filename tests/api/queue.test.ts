import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, anonymous, bobInOtherHousehold, bootstrapAlice, meId } from "../helpers/client.js";
import { jpeg, until } from "../helpers/fixtures.js";
import { TestServer } from "../helpers/server.js";

type Plant = { id: string; name: string; hasSheet: boolean; job: { status: string; error: string | null; ahead: number } | null };

const listOf = async (c: Client): Promise<Plant[]> => (await c.get("/api/plants")).json;
const detail = async (c: Client, id: string) => (await c.get(`/api/plants/${id}`)).json;
const generate = (c: Client, id: string) => c.post(`/api/plants/${id}/care-sheet`);
const newPlant = async (c: Client, name: string): Promise<string> => (await c.post("/api/plants", { name })).json.id;
const settled = (c: Client, id: string) =>
  until(async () => {
    const d = await detail(c, id);
    if (d.job?.status === "error") return "error";
    return d.hasSheet && !d.job ? "ready" : false;
  }, `fiche de ${id}`);

describe("file de génération des fiches (IA factice)", () => {
  let s: TestServer;
  let alice: Client;
  let bob: Client;
  before(async () => {
    s = await TestServer.start({ aiDelayMs: 1500 });
    alice = await bootstrapAlice(s);
    bob = await bobInOtherHousehold(s, await meId(alice));
  });
  after(() => s.cleanup());

  it("ordre d'arrivée, une seule génération à la fois, la photo est transmise à l'IA", async () => {
    const [a, b, c] = [await newPlant(alice, "Plante A"), await newPlant(alice, "Plante B"), await newPlant(alice, "Plante C")];
    assert.equal((await alice.upload(`/api/plants/${a}/photos`, await jpeg())).status, 201);
    for (const id of [a, b, c]) assert.equal((await generate(alice, id)).status, 202);

    assert.equal((await detail(alice, a)).job.status, "running");
    assert.deepEqual([(await detail(alice, b)).job.status, (await detail(alice, b)).job.ahead], ["pending", 1]);
    assert.deepEqual([(await detail(alice, c)).job.status, (await detail(alice, c)).job.ahead], ["pending", 2]);

    let maxRunning = 0;
    let sawPending = false;
    await until(async () => {
      const l = await listOf(alice);
      maxRunning = Math.max(maxRunning, l.filter((p) => p.job?.status === "running").length);
      sawPending ||= l.some((p) => p.job?.status === "pending");
      return l.every((p) => p.job === null);
    }, "les 3 générations");
    assert.equal(maxRunning, 1, "jamais deux générations en même temps");
    assert.ok(sawPending, "les suivantes ont attendu leur tour");
    assert.match((await detail(alice, a)).careSheet.observedCondition, /^Photo reçue/);
    assert.equal((await detail(alice, b)).careSheet.observedCondition, undefined, "sans photo : générée sur le nom seul");
  });

  it("relancer ne crée pas de doublon ; une fiche est modifiable à la main", async () => {
    const id = await newPlant(alice, "Plante D");
    await generate(alice, id);
    assert.equal((await generate(alice, id)).status, 202, "double demande");
    assert.equal(s.db((db) => (db.prepare("select count(*) n from care_sheet_jobs where plant_id=?").get(id) as { n: number }).n), 1);
    assert.equal(await settled(alice, id), "ready");

    const sheet = (await detail(alice, id)).careSheet;
    sheet.watering.intervalDaysSummer = 3;
    assert.equal((await alice.patch(`/api/plants/${id}`, { careSheet: sheet })).status, 200);
    assert.equal((await detail(alice, id)).careSheet.watering.intervalDaysSummer, 3);

    await generate(alice, id); // régénérer écrase la modification
    await until(async () => (await detail(alice, id)).careSheet.watering.intervalDaysSummer === 7, "régénération");
  });

  it("erreur, message lisible, relance, puis succès après correction du nom", async () => {
    const id = await newPlant(alice, "Mauvaise ECHEC");
    await generate(alice, id);
    assert.equal(await settled(alice, id), "error");
    assert.equal((await detail(alice, id)).job.error, "Échec simulé");
    await generate(alice, id);
    assert.equal(await settled(alice, id), "error", "même nom : échoue encore");
    await alice.patch(`/api/plants/${id}`, { name: "Bonne plante" });
    await generate(alice, id);
    assert.equal(await settled(alice, id), "ready");
  });

  it("supprimer une plante en pleine génération ne bloque pas la file", async () => {
    const [x, y] = [await newPlant(alice, "À supprimer"), await newPlant(alice, "Suivante")];
    await generate(alice, x);
    await generate(alice, y);
    assert.equal((await alice.delete(`/api/plants/${x}`)).status, 200);
    assert.equal(await settled(alice, y), "ready");
    const unexpected = s.logs.split("\n").filter((l) => /rror/.test(l) && !/Échec simulé/.test(l) && !/\[ai\]\s*$/.test(l));
    assert.deepEqual(unexpected, [], "aucune erreur serveur inattendue");
  });

  it("isolation : Bob ne peut pas lancer une génération sur la plante d'Alice et ne voit aucune génération", async () => {
    const id = (await listOf(alice))[0].id;
    assert.equal((await generate(bob, id)).status, 404);
    assert.deepEqual(await listOf(bob), []);
  });

  it("sans session : 401 ; l'ancienne route synchrone n'existe plus", async () => {
    const id = (await listOf(alice))[0].id;
    assert.equal((await generate(anonymous(s), id)).status, 401);
    assert.equal((await alice.post("/api/care-sheet")).status, 404);
  });
});

describe("limites et reprise après arrêt brutal (IA lente)", () => {
  let s: TestServer;
  let alice: Client;
  let ids: string[] = [];
  before(async () => {
    s = await TestServer.start({ aiDelayMs: 6000 });
    alice = await bootstrapAlice(s);
  });
  after(() => s.cleanup());

  it("au plus 5 générations actives par foyer : la 6e est refusée (429)", async () => {
    for (let i = 1; i <= 6; i++) ids.push(await newPlant(alice, `Lot ${i}`));
    const codes = [];
    for (const id of ids) codes.push((await generate(alice, id)).status);
    assert.deepEqual(codes, [202, 202, 202, 202, 202, 429]);
  });

  it("après un arrêt brutal (kill -9), les générations non terminées reprennent et aboutissent", async () => {
    await s.kill();
    const unfinished = s.db((db) => (db.prepare("select count(*) n from care_sheet_jobs where status in ('running','pending')").get() as { n: number }).n);
    assert.equal(unfinished, 5, "5 générations interrompues en base");
    await s.startAgain({ AI_FAKE_DELAY_MS: "200" });
    for (const id of ids.slice(0, 5)) assert.equal(await settled(alice, id), "ready");
    assert.equal((await alice.get(`/api/plants/${ids[5]}`)).json.job, null, "la 6e, jamais lancée, n'a pas de génération");
  });
});
