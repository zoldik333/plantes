import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, addMember, anonymous, bobInOtherHousehold, bootstrapAlice, meId } from "../helpers/client.js";
import { FICHE } from "../helpers/fixtures.js";
import { TestServer } from "../helpers/server.js";

describe("raccourci iOS : jetons et routes /api/shortcuts", () => {
  let s: TestServer;
  let alice: Client;
  let bob: Client;
  let aliceToken: string;
  let aliceTokenId: string;
  let bobToken: string;
  const ids: Record<string, string> = {};
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  /** Appel sans cookie, comme le fait l'app Raccourcis. */
  const call = (t: string, method: "GET" | "POST", path: string, json?: unknown) => {
    const c = anonymous(s);
    return method === "GET" ? c.get(path, auth(t)) : c.post(path, json, auth(t));
  };
  const plant = async (c: Client, name: string, careSheet = true) => {
    const r = await c.post("/api/plants", { name });
    assert.equal(r.status, 201);
    if (careSheet) assert.equal((await c.patch(`/api/plants/${r.json.id}`, { careSheet: FICHE })).status, 200);
    return r.json.id as string;
  };

  before(async () => {
    s = await TestServer.start();
    alice = await bootstrapAlice(s);
    bob = await bobInOtherHousehold(s, await meId(alice));
    ids.monstera = await plant(alice, "Monstera deliciosa");
    ids.ficus = await plant(alice, "Ficus élastica");
    ids.ficus2 = await plant(alice, "Ficus Lyrata");
    ids.bobPlant = await plant(bob, "Orchidée de Bob");
    const room = await alice.post("/api/rooms", { name: "Salon" });
    await alice.patch(`/api/plants/${ids.monstera}`, { roomId: room.json.id });
  });
  after(() => s.cleanup());

  describe("gestion des jetons (session)", () => {
    it("création : jeton en clair une fois, format plt_, hash seul en base", async () => {
      const r = await alice.post("/api/tokens", { name: "iPhone" });
      assert.equal(r.status, 201);
      aliceToken = r.json.token;
      aliceTokenId = r.json.id;
      assert.match(aliceToken, /^plt_[A-Za-z0-9_-]{43}$/);
      const rows = s.db((db) => db.prepare("select * from api_tokens").all()) as any[];
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].token_hash, aliceToken);
      assert.equal(JSON.stringify(rows).includes(aliceToken), false);
      bobToken = (await bob.post("/api/tokens", { name: "Téléphone de Bob" })).json.token;
    });
    it("la liste ne contient jamais le jeton ; nom vide refusé", async () => {
      const l = await alice.get("/api/tokens");
      assert.equal(l.json.length, 1);
      assert.equal(l.json[0].lastUsedAt, null);
      assert.equal(l.text.includes(aliceToken), false);
      assert.equal(l.json[0].token, undefined);
      assert.equal((await alice.post("/api/tokens", { name: "  " })).status, 400);
    });
    it("sans session : 401", async () => {
      assert.equal((await anonymous(s).get("/api/tokens")).status, 401);
      assert.equal((await anonymous(s).post("/api/tokens", { name: "x" })).status, 401);
    });
    it("un jeton ne sert ni sur /api/tokens ni sur les autres routes /api", async () => {
      for (const path of ["/api/tokens", "/api/plants", "/api/today", "/api/me", "/api/rooms"]) {
        assert.equal((await anonymous(s).get(path, auth(aliceToken))).status, 401, path);
      }
      assert.equal((await anonymous(s).post("/api/tokens", { name: "x" }, auth(aliceToken))).status, 401);
      assert.equal((await anonymous(s).request("DELETE", `/api/tokens/${aliceTokenId}`, { headers: auth(aliceToken) })).status, 401);
      assert.equal((await anonymous(s).post(`/api/plants/${ids.monstera}/events`, { type: "watered" }, auth(aliceToken))).status, 401);
    });
    it("un autre utilisateur ne peut pas révoquer mon jeton (404), même dans le foyer", async () => {
      const carol = await addMember(s, alice, "Carol", "carol@plantes.test");
      assert.equal((await carol.delete(`/api/tokens/${aliceTokenId}`)).status, 404);
      assert.equal((await bob.delete(`/api/tokens/${aliceTokenId}`)).status, 404);
      assert.equal((await carol.get("/api/tokens")).json.length, 0);
      assert.equal((await call(aliceToken, "GET", "/api/shortcuts/plants")).status, 200);
    });
    it("plafond de 5 jetons par personne", async () => {
      for (let i = 0; i < 4; i++) assert.equal((await alice.post("/api/tokens", { name: `T${i}` })).status, 201);
      assert.equal((await alice.post("/api/tokens", { name: "de trop" })).status, 400);
      const l = (await alice.get("/api/tokens")).json as { id: string; name: string }[];
      for (const t of l.filter((x) => x.id !== aliceTokenId)) assert.equal((await alice.delete(`/api/tokens/${t.id}`)).status, 200);
      assert.equal((await alice.get("/api/tokens")).json.length, 1);
    });
  });

  describe("authentification Bearer", () => {
    it("401 identique pour absent, faux, mal formé, en query string", async () => {
      const bodies = new Set<string>();
      const cases = [
        await anonymous(s).get("/api/shortcuts/plants"),
        await anonymous(s).get("/api/shortcuts/plants", auth("plt_" + "A".repeat(43))),
        await anonymous(s).get("/api/shortcuts/plants", { authorization: "Bearer n'importe quoi" }),
        await anonymous(s).get(`/api/shortcuts/plants?token=${aliceToken}`),
        await anonymous(s).get("/api/shortcuts/plants", { authorization: aliceToken }),
      ];
      for (const r of cases) {
        assert.equal(r.status, 401);
        bodies.add(r.text);
      }
      assert.equal(bodies.size, 1);
    });
    it("lastUsedAt mis à jour, mais jamais le jeton dans la réponse ni les journaux", async () => {
      assert.equal((await call(aliceToken, "GET", "/api/shortcuts/plants")).status, 200);
      const l = (await alice.get("/api/tokens")).json;
      assert.ok(l[0].lastUsedAt);
      assert.equal(s.logs.includes(aliceToken), false);
    });
    it("lastUsedAt : au plus une écriture par minute", async () => {
      const read = () => (s.db((db) => db.prepare("select last_used_at as t from api_tokens where id = ?").get(aliceTokenId)) as any).t;
      const first = read();
      await call(aliceToken, "GET", "/api/shortcuts/plants");
      await call(aliceToken, "GET", "/api/shortcuts/plants");
      assert.equal(read(), first);
    });
    it("l'en-tête Origin n'est pas requis, mais une origine étrangère reste refusée", async () => {
      const r = await fetch(`${s.url}/api/shortcuts/water`, { method: "POST", headers: { ...auth(aliceToken), "content-type": "application/json", origin: "https://evil.example", "x-forwarded-for": "203.0.113.9" }, body: "{}" });
      assert.equal(r.status, 403);
    });
  });

  describe("lecture", () => {
    it("liste des plantes du foyer seulement, avec la pièce", async () => {
      const r = await call(aliceToken, "GET", "/api/shortcuts/plants");
      assert.equal(r.json.length, 3);
      assert.deepEqual(r.json.find((p: any) => p.id === ids.monstera), { id: ids.monstera, name: "Monstera deliciosa", room: "Salon" });
      assert.equal(r.json.find((p: any) => p.id === ids.bobPlant), undefined);
      assert.deepEqual((await call(bobToken, "GET", "/api/shortcuts/plants")).json.map((p: any) => p.name), ["Orchidée de Bob"]);
    });
    it("today : texte pour Siri, et phrase vide quand il n'y a rien", async () => {
      // Les trois plantes sont créées à l'instant : rien à arroser avant leur intervalle.
      const r = await call(aliceToken, "GET", "/api/shortcuts/today");
      assert.equal(r.status, 200);
      assert.equal(r.json.due.length, 0);
      assert.match(r.json.text, /^Rien à arroser aujourd'hui\./);
    });
  });

  describe("arrosage", () => {
    it("résolution insensible à la casse et aux accents, effet sur la fiche", async () => {
      const r = await call(aliceToken, "POST", "/api/shortcuts/water", { plant: "FICUS ELASTICA" });
      assert.equal(r.status, 200);
      assert.match(r.json.text, /^Ficus élastica arrosée\. Prochain arrosage dans \d+ jours\.$/);
      const ev = (await alice.get(`/api/plants/${ids.ficus}/events`)).json;
      assert.equal(ev.length, 1);
      assert.equal(ev[0].type, "watered");
      assert.equal(ev[0].userName, "Alice");
      assert.ok((await alice.get(`/api/plants/${ids.ficus}`)).json.water.lastWateredAt);
    });
    it("par id", async () => {
      assert.equal((await call(aliceToken, "POST", "/api/shortcuts/water", { plant: ids.monstera })).status, 200);
    });
    it("ambiguïté : 409 avec candidats, rien d'enregistré", async () => {
      const before = (await alice.get(`/api/plants/${ids.ficus2}/events`)).json.length;
      const r = await call(aliceToken, "POST", "/api/shortcuts/water", { plant: "ficus" });
      assert.equal(r.status, 409);
      assert.deepEqual(r.json.candidates.map((c: any) => c.name).sort(), ["Ficus Lyrata", "Ficus élastica"]);
      assert.equal((await alice.get(`/api/plants/${ids.ficus2}/events`)).json.length, before);
    });
    it("ambiguïté dans une liste : aucune plante arrosée", async () => {
      const pothos = await plant(alice, "Pothos");
      const r = await call(aliceToken, "POST", "/api/shortcuts/water", { plants: ["pothos", "ficus"] });
      assert.equal(r.status, 409);
      assert.equal((await alice.get(`/api/plants/${pothos}/events`)).json.length, 0);
    });
    it("introuvable : 404 avec suggestion", async () => {
      const r = await call(aliceToken, "POST", "/api/shortcuts/water", { plant: "Monstra" });
      assert.equal(r.status, 404);
      assert.equal(r.json.suggestion, "Monstera deliciosa");
      const none = await call(aliceToken, "POST", "/api/shortcuts/water", { plant: "zzzzzzzz" });
      assert.equal(none.status, 404);
      assert.equal(none.json.suggestion, null);
    });
    it("liste de plantes", async () => {
      const r = await call(aliceToken, "POST", "/api/shortcuts/water", { plants: ["monstera", "pothos"] });
      assert.equal(r.status, 200);
      assert.equal(r.json.watered.length, 2);
      assert.match(r.json.text, /^2 plantes arrosées : /);
    });
    it("daysAgo : arrosage daté, et validé", async () => {
      const id = await plant(alice, "Calathea");
      const r = await call(aliceToken, "POST", "/api/shortcuts/water", { plant: "calathea", daysAgo: 3 });
      assert.equal(r.status, 200);
      const ev = (await alice.get(`/api/plants/${id}/events`)).json[0];
      const age = (Date.now() - new Date(ev.createdAt).getTime()) / 86_400_000;
      assert.ok(age > 2.9 && age < 3.1, String(age));
      assert.equal((await call(aliceToken, "POST", "/api/shortcuts/water", { plant: "calathea", daysAgo: 61 })).status, 400);
      assert.equal((await call(aliceToken, "POST", "/api/shortcuts/water", { plant: "calathea", daysAgo: -1 })).status, 400);
    });
    it("corps invalide : 400 (aucune ou plusieurs cibles)", async () => {
      assert.equal((await call(aliceToken, "POST", "/api/shortcuts/water", {})).status, 400);
      assert.equal((await call(aliceToken, "POST", "/api/shortcuts/water", { plant: "a", all: "due" })).status, 400);
      assert.equal((await call(aliceToken, "POST", "/api/shortcuts/water", { all: "tout" })).status, 400);
    });
    it("all=due : arrose les plantes en retard, puis plus rien", async () => {
      const late = await plant(alice, "Yucca");
      // Un arrosage daté d'il y a 40 jours rend la plante en retard.
      assert.equal((await alice.post(`/api/plants/${late}/events`, { type: "watered", daysAgo: 40 })).status, 201);
      const today = await call(aliceToken, "GET", "/api/shortcuts/today");
      assert.match(today.json.text, /^1 plante à arroser : Yucca\./);
      assert.equal(today.json.due[0].daysLate > 0, true);
      const r = await call(aliceToken, "POST", "/api/shortcuts/water", { all: "due" });
      assert.equal(r.status, 200);
      assert.match(r.json.text, /^Yucca arrosée\./);
      assert.deepEqual(r.json.watered.map((w: any) => w.name), ["Yucca"]);
      const again = await call(aliceToken, "POST", "/api/shortcuts/water", { all: "due" });
      assert.deepEqual(again.json, { watered: [], text: "Rien à arroser aujourd'hui." });
      assert.equal((await alice.get("/api/today")).json.due.length, 0);
    });
    it("isolation : un jeton n'arrose que dans son foyer", async () => {
      const r = await call(bobToken, "POST", "/api/shortcuts/water", { plant: ids.monstera });
      assert.equal(r.status, 404);
      assert.equal((await call(bobToken, "POST", "/api/shortcuts/water", { plant: "monstera" })).status, 404);
      const before = (await alice.get(`/api/plants/${ids.monstera}/events`)).json.length;
      await call(bobToken, "POST", "/api/shortcuts/water", { all: "due" });
      assert.equal((await alice.get(`/api/plants/${ids.monstera}/events`)).json.length, before);
      assert.equal((await call(bobToken, "POST", "/api/shortcuts/water", { plant: "orchidée" })).status, 200);
    });
  });

  describe("révocation et suppression", () => {
    it("jeton révoqué refusé immédiatement", async () => {
      assert.equal((await call(bobToken, "GET", "/api/shortcuts/plants")).status, 200);
      const id = (await bob.get("/api/tokens")).json[0].id;
      assert.equal((await bob.delete(`/api/tokens/${id}`)).status, 200);
      assert.equal((await call(bobToken, "GET", "/api/shortcuts/plants")).status, 401);
      assert.equal((await bob.delete(`/api/tokens/${id}`)).status, 404);
    });
    it("suppression du compte : jetons supprimés (cascade)", async () => {
      const dan = await addMember(s, alice, "Dan", "dan@plantes.test");
      const t = (await dan.post("/api/tokens", { name: "Dan" })).json.token;
      assert.equal((await call(t, "GET", "/api/shortcuts/plants")).status, 200);
      const danId = await meId(dan);
      s.db((db) => db.prepare("delete from user where id = ?").run(danId));
      assert.equal((s.db((db) => db.prepare("select count(*) as n from api_tokens where user_id = ?").get(danId)) as any).n, 0);
      assert.equal((await call(t, "GET", "/api/shortcuts/plants")).status, 401);
    });
  });
});
