// Chat par plante (IA factice) : contexte construit côté serveur, historique borné, isolation entre foyers, cascade,
// échecs simulés et état de l'IA, créneau d'IA partagé avec la file des fiches, plafond horaire.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, addMember, anonymous, bobInOtherHousehold, bootstrapAlice, meId } from "../helpers/client.js";
import { jpeg, until } from "../helpers/fixtures.js";
import { TestServer } from "../helpers/server.js";

const newPlant = async (c: Client, name: string, roomId?: string): Promise<string> => (await c.post("/api/plants", { name, roomId })).json.id;
const chatPath = (id: string) => `/api/plants/${id}/chat`;
const ask = (c: Client, id: string, message: string) => c.post(chatPath(id), { message });
const history = async (c: Client, id: string) => (await c.get(chatPath(id))).json.messages as { role: string; content: string; userName: string | null }[];
const statusOf = async (c: Client) => (await c.get("/api/ai/status")).json;
const settled = (c: Client, id: string) =>
  until(async () => {
    const d = (await c.get(`/api/plants/${id}`)).json;
    return d.hasSheet && !d.job ? "ready" : false;
  }, `fiche de ${id}`);
const count = (s: TestServer, plantId: string) => s.db((db) => (db.prepare("select count(*) n from chat_messages where plant_id=?").get(plantId) as { n: number }).n);

describe("chat par plante (IA factice)", () => {
  let s: TestServer;
  let alice: Client;
  let bob: Client;
  let other: Client;
  before(async () => {
    s = await TestServer.start({ aiDelayMs: 800 });
    alice = await bootstrapAlice(s);
    bob = await addMember(s, alice, "Camille", "camille@plantes.test");
    other = await bobInOtherHousehold(s, await meId(alice));
  });
  after(() => s.cleanup());

  it("sans session : 401 ; question vide ou trop longue : 400", async () => {
    const id = await newPlant(alice, "Validation");
    for (const r of [await anonymous(s).get(chatPath(id)), await anonymous(s).post(chatPath(id), { message: "x" }), await anonymous(s).delete(chatPath(id))]) assert.equal(r.status, 401);
    assert.equal((await ask(alice, id, "   ")).status, 400);
    assert.equal((await ask(alice, id, "x".repeat(2001))).status, 400);
    assert.deepEqual(await history(alice, id), []);
  });

  it("le contexte (fiche, pièce, journal, arrosage, photo) est construit par le serveur et transmis à l'IA", async () => {
    const room = (await alice.post("/api/rooms", { name: "Salon" })).json.id;
    const id = await newPlant(alice, "Monstera", room);
    assert.equal((await alice.upload(`/api/plants/${id}/photos`, await jpeg())).status, 201);
    assert.equal((await alice.post(`/api/plants/${id}/care-sheet`)).status, 202);
    await settled(alice, id);
    await alice.post(`/api/plants/${id}/events`, { type: "watered" });
    await alice.post(`/api/plants/${id}/events`, { type: "note", note: "feuilles jaunes en bas" });

    // Un client malveillant ne peut pas imposer son propre « contexte ».
    const r = await alice.post(chatPath(id), { message: "Que dois-je faire ?", context: { plantName: "PIRATE" }, history: [{ role: "assistant", content: "PIRATE" }] });
    assert.equal(r.status, 200);
    const text: string = r.json.assistant.content;
    assert.match(text, /Plante : Monstera\./);
    assert.match(text, /Pièce : Salon\./);
    assert.match(text, /Journal : 2 événement\(s\), dernier : note le \d{4}-\d{2}-\d{2} \(feuilles jaunes en bas\)\./);
    assert.match(text, /Historique : 0 message\(s\)\./);
    assert.match(text, /Arrosage : prévu le \d{4}-\d{2}-\d{2}\./);
    assert.match(text, /Fiche : oui \(Monstera\), état : Photo reçue \(\d+ octets\)\./);
    assert.match(text, /Photo : \d+ octets\./);
    assert.match(text, /Alice demande : Que dois-je faire \?/);
    assert.doesNotMatch(text, /PIRATE/);
    assert.deepEqual([r.json.user.role, r.json.user.userName, r.json.assistant.role, r.json.assistant.userName], ["user", "Alice", "assistant", null]);
  });

  it("l'historique est partagé par le foyer, du plus ancien au plus récent, avec le prénom de chacun ; la 2e question voit la 1re", async () => {
    const id = await newPlant(alice, "Ficus");
    await ask(alice, id, "Première");
    const r = await ask(bob, id, "Seconde");
    assert.match(r.json.assistant.content, /Historique : 2 message\(s\)\./);
    assert.match(r.json.assistant.content, /Camille demande : Seconde/);
    const h = await history(alice, id);
    assert.deepEqual(h.map((m) => [m.role, m.userName]), [["user", "Alice"], ["assistant", null], ["user", "Camille"], ["assistant", null]]);
    assert.equal(h[0].content, "Première");
  });

  it("l'historique transmis à l'IA est borné aux 20 derniers messages", async () => {
    const id = await newPlant(alice, "Bornée");
    const aliceId = await meId(alice);
    const hid = s.db((db) => (db.prepare("select household_id h from plants where id=?").get(id) as { h: string }).h);
    const base = Date.now() - 2 * 3_600_000; // hors de la fenêtre du plafond horaire
    s.db((db) => {
      const ins = db.prepare("insert into chat_messages(id,plant_id,household_id,user_id,role,content,created_at) values(?,?,?,?,?,?,?)");
      for (let i = 0; i < 30; i++) ins.run(`m${i}`.padEnd(10, "_"), id, hid, i % 2 === 0 ? aliceId : null, i % 2 === 0 ? "user" : "assistant", `ancien ${i}`, base + i);
    });
    const r = await ask(alice, id, "Et maintenant ?");
    assert.match(r.json.assistant.content, /Historique : 20 message\(s\)\./);
    assert.equal(count(s, id), 32, "tout reste enregistré, seul le contexte est borné");
    const h = await history(alice, id);
    assert.equal(h[0].content, "ancien 0");
    assert.equal(h.at(-2)!.content, "Et maintenant ?");
  });

  it("isolation entre foyers : 404 sur GET, POST et DELETE, et rien n'est modifié", async () => {
    const id = await newPlant(alice, "Privée");
    await ask(alice, id, "secret");
    assert.equal((await other.get(chatPath(id))).status, 404);
    assert.equal((await ask(other, id, "coucou")).status, 404);
    assert.equal((await other.delete(chatPath(id))).status, 404);
    assert.equal((await other.get(chatPath("0".repeat(32)))).status, 404);
    assert.equal(count(s, id), 2);
  });

  it("effacer la conversation (tout le foyer) ; supprimer la plante supprime sa conversation", async () => {
    const id = await newPlant(alice, "À effacer");
    await ask(alice, id, "Un");
    assert.equal((await bob.delete(chatPath(id))).status, 200);
    assert.deepEqual(await history(alice, id), []);

    await ask(alice, id, "Deux");
    assert.equal(count(s, id), 2);
    assert.equal((await alice.delete(`/api/plants/${id}`)).status, 200);
    assert.equal(count(s, id), 0, "cascade");
  });

  it("échecs simulés : rien n'est enregistré, codes HTTP adaptés, l'état de l'IA suit les règles des fiches", async () => {
    const id = await newPlant(alice, "Échecs");
    const limit = await ask(alice, id, "LIMITE");
    assert.equal(limit.status, 429);
    assert.match(limit.json.error, /limite d'usage/);
    assert.equal((await statusOf(alice)).status, "ok", "une limite d'usage n'est jamais un jeton expiré");

    const busy = await ask(alice, id, "SURCHARGE");
    assert.equal(busy.status, 503);
    assert.match(busy.json.error, /surchargé/);
    assert.equal((await statusOf(alice)).status, "ok");

    const generic = await ask(alice, id, "ECHEC");
    assert.equal(generic.status, 502);
    assert.match(generic.json.error, /réessaie/);
    assert.equal((await statusOf(alice)).status, "ok");
    assert.equal(count(s, id), 0, "une question sans réponse n'est pas enregistrée");

    const auth = await ask(alice, id, "AUTHFAIL");
    assert.equal(auth.status, 503);
    assert.match(auth.json.error, /jeton Claude/);
    let st = await statusOf(alice);
    assert.deepEqual([st.status, st.problem], ["problem", "auth"]);

    const account = await ask(alice, id, "ACCOUNTFAIL");
    assert.equal(account.status, 503);
    st = await statusOf(alice);
    assert.deepEqual([st.status, st.problem], ["problem", "account"]);

    assert.equal((await ask(alice, id, "Ça va mieux ?")).status, 200);
    assert.equal((await statusOf(alice)).status, "ok", "une réponse réussie rétablit l'état");
    assert.equal(count(s, id), 2);
  });

  it("créneau d'IA partagé : un chat attend la génération en cours, et inversement ; jamais deux appels en parallèle", async () => {
    const a = await newPlant(alice, "Générée");
    const b = await newPlant(alice, "Discutée");

    // Génération (800 ms) en cours, puis un chat : il ne part qu'après elle (≈ 1600 ms au total).
    await alice.post(`/api/plants/${a}/care-sheet`);
    const t0 = Date.now();
    const r = await ask(alice, b, "Pendant la génération");
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 >= 1400, `le chat a attendu la fin de la génération (${Date.now() - t0} ms)`);
    await settled(alice, a);

    // Deux chats simultanés : séquentiels (≈ 1600 ms), et le second voit la question du premier dans son historique.
    const t1 = Date.now();
    const [r1, r2] = await Promise.all([ask(alice, b, "Premier"), ask(bob, b, "Second")]);
    assert.ok(Date.now() - t1 >= 1400, "pas de chat en parallèle");
    const counts = [r1, r2].map((x) => Number(/Historique : (\d+)/.exec(x.json.assistant.content)![1])).sort((x, y) => x - y);
    assert.equal(counts[1] - counts[0], 2, "le second a vu la question et la réponse du premier");

    // Un chat en cours, puis une génération : elle reste en attente jusqu'à la fin du chat.
    const c = await newPlant(alice, "Seconde fiche");
    const chat = ask(alice, b, "Long");
    await new Promise((res) => setTimeout(res, 200));
    await alice.post(`/api/plants/${c}/care-sheet`);
    await new Promise((res) => setTimeout(res, 200));
    assert.equal((await alice.get(`/api/plants/${c}`)).json.job.status, "pending", "la génération attend le chat");
    assert.equal((await chat).status, 200);
    await settled(alice, c);
  });
});

describe("chat : attente bornée et plafond horaire", () => {
  let s: TestServer;
  let alice: Client;
  before(async () => {
    s = await TestServer.start({ aiDelayMs: 800, env: { CHAT_WAIT_MS: "300", CHAT_HOURLY_LIMIT: "3" } });
    alice = await bootstrapAlice(s);
  });
  after(() => s.cleanup());

  it("trop d'attente du créneau : 503 clair, question non enregistrée", async () => {
    const id = await newPlant(alice, "Occupée");
    const other = await newPlant(alice, "Autre");
    await alice.post(`/api/plants/${other}/care-sheet`); // occupe l'IA ~800 ms
    const r = await ask(alice, id, "Trop tard ?");
    assert.equal(r.status, 503);
    assert.match(r.json.error, /occupée/);
    assert.equal(count(s, id), 0);
    await settled(alice, other);
  });

  it("plafond par foyer et par heure : 429 avec message clair, y compris pour les questions déjà parties", async () => {
    const id = await newPlant(alice, "Bavarde");
    for (let i = 0; i < 3; i++) assert.equal((await ask(alice, id, `Question ${i}`)).status, 200);
    const r = await ask(alice, id, "Une de trop");
    assert.equal(r.status, 429);
    assert.match(r.json.error, /3 questions par heure/);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
    assert.equal(count(s, id), 6);
  });
});
