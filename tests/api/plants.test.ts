import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import { Client, anonymous, bobInOtherHousehold, bootstrapAlice, meId } from "../helpers/client.js";
import { FICHE, bytes, jpeg } from "../helpers/fixtures.js";
import { TestServer } from "../helpers/server.js";

describe("pièces, plantes, photos", () => {
  let s: TestServer;
  let alice: Client;
  let bob: Client;
  let roomId: string;
  let plantId: string;
  let photoId: string;
  before(async () => {
    s = await TestServer.start();
    alice = await bootstrapAlice(s);
    bob = await bobInOtherHousehold(s, await meId(alice));
  });
  after(() => s.cleanup());

  describe("pièces", () => {
    it("création, nom vide refusé, liste triée avec compteur", async () => {
      const r = await alice.post("/api/rooms", { name: "Salon" });
      assert.equal(r.status, 201);
      assert.equal(r.json.plantCount, 0);
      roomId = r.json.id;
      assert.equal((await alice.post("/api/rooms", { name: "   " })).status, 400);
      assert.equal((await alice.post("/api/rooms", { name: "Cuisine" })).status, 201);
      assert.deepEqual((await alice.get("/api/rooms")).json.map((x: { name: string }) => x.name), ["Cuisine", "Salon"]);
    });
    it("l'autre foyer ne voit aucune pièce", async () => {
      assert.deepEqual((await bob.get("/api/rooms")).json, []);
    });
    it("limite de 50 pièces par foyer", async () => {
      for (let i = 0; i < 48; i++) assert.equal((await alice.post("/api/rooms", { name: `Pièce ${i}` })).status, 201);
      assert.equal((await alice.post("/api/rooms", { name: "De trop" })).status, 400);
    });
  });

  describe("plantes", () => {
    it("création dans une pièce, compteur de la pièce", async () => {
      const r = await alice.post("/api/plants", { name: "Calathea", roomId });
      assert.equal(r.status, 201);
      plantId = r.json.id;
      assert.equal((await alice.get("/api/rooms")).json.find((x: { id: string }) => x.id === roomId).plantCount, 1);
    });
    it("une pièce inexistante, ou d'un autre foyer, est refusée", async () => {
      assert.equal((await alice.post("/api/plants", { name: "X", roomId: "inexistante" })).status, 400);
      assert.equal((await bob.post("/api/plants", { name: "Volée", roomId })).status, 400);
    });
    it("renommer ; une fiche invalide est refusée, une fiche valide est enregistrée et relue", async () => {
      assert.equal((await alice.patch(`/api/plants/${plantId}`, { name: "Calathea sanderiana" })).status, 200);
      assert.equal((await alice.patch(`/api/plants/${plantId}`, { careSheet: { commonName: "x" } })).status, 400);
      assert.equal((await alice.patch(`/api/plants/${plantId}`, { careSheet: FICHE })).status, 200);
      assert.equal((await alice.get(`/api/plants/${plantId}`)).json.careSheet.watering.intervalDaysSummer, 7);
    });
    it("nom vide refusé", async () => {
      assert.equal((await alice.post("/api/plants", { name: "" })).status, 400);
    });
  });

  describe("photos", () => {
    it("envoi, puis lecture de la grande version et de la vignette", async () => {
      const r = await alice.upload(`/api/plants/${plantId}/photos`, await jpeg({ width: 1200, height: 600, orientation: 6 }));
      assert.equal(r.status, 201);
      assert.match(r.json.id, /^[a-f0-9]{32}$/);
      photoId = r.json.id;
    });
    it("la rotation EXIF est appliquée et l'EXIF (donc le GPS) supprimé ; vignette carrée de 400 px", async () => {
      const full = await alice.get(`/api/photos/${photoId}`);
      const thumb = await alice.get(`/api/photos/${photoId}?size=thumb`);
      assert.equal(full.headers.get("content-type"), "image/jpeg");
      assert.match(full.headers.get("cache-control") ?? "", /private/, "jamais de cache partagé");
      const f = await sharp(full.body).metadata();
      const t = await sharp(thumb.body).metadata();
      assert.equal(f.exif, undefined, "EXIF supprimé");
      assert.ok(!f.orientation || f.orientation === 1, "orientation normalisée");
      assert.deepEqual([f.width, f.height], [600, 1200], "1200×600 tourné de 90°");
      assert.deepEqual([t.width, t.height], [400, 400]);
    });
    it("un faux fichier .jpg (415), un fichier trop lourd (413), l'absence de fichier (400)", async () => {
      assert.equal((await alice.upload(`/api/plants/${plantId}/photos`, Buffer.from("ceci n'est pas une image"))).status, 415);
      assert.equal((await alice.upload(`/api/plants/${plantId}/photos`, bytes(9 * 1024 * 1024))).status, 413);
      assert.equal((await alice.request("POST", `/api/plants/${plantId}/photos`, { form: new FormData() })).status, 400);
    });
    it("une photo n'est lisible qu'avec une session, et pas par un autre foyer ; pas de traversée de chemin", async () => {
      assert.equal((await anonymous(s).get(`/api/photos/${photoId}`)).status, 401);
      assert.equal((await bob.get(`/api/photos/${photoId}`)).status, 404);
      assert.equal((await alice.get("/api/photos/..%2F..%2Fetc%2Fpasswd")).status, 404);
      assert.equal((await alice.get("/api/photos/pas-un-identifiant")).status, 404);
    });
    it("la couverture d'une plante est sa photo la plus récente", async () => {
      const second = await alice.upload(`/api/plants/${plantId}/photos`, await jpeg());
      const cover = (await alice.get("/api/plants")).json.find((p: { id: string }) => p.id === plantId).coverPhotoId;
      assert.equal(cover, second.json.id);
      assert.deepEqual((await alice.get(`/api/plants/${plantId}`)).json.photoIds, [second.json.id, photoId]);
    });
  });

  describe("isolation entre foyers : Bob contre les données d'Alice", () => {
    it("Bob ne voit aucune plante", async () => {
      assert.deepEqual((await bob.get("/api/plants")).json, []);
    });
    it("lecture, modification, suppression, envoi de photo : tout est introuvable (404)", async () => {
      assert.equal((await bob.get(`/api/plants/${plantId}`)).status, 404);
      assert.equal((await bob.patch(`/api/plants/${plantId}`, { name: "Piratée" })).status, 404);
      assert.equal((await bob.delete(`/api/plants/${plantId}`)).status, 404);
      assert.equal((await bob.upload(`/api/plants/${plantId}/photos`, await jpeg())).status, 404);
      assert.equal((await bob.delete(`/api/plants/${plantId}/photos/${photoId}`)).status, 404);
      assert.equal((await bob.patch(`/api/rooms/${roomId}`, { name: "Piratée" })).status, 404);
      assert.equal((await bob.delete(`/api/rooms/${roomId}`)).status, 404);
    });
    it("rien n'a changé chez Alice", async () => {
      assert.equal((await alice.get(`/api/plants/${plantId}`)).json.name, "Calathea sanderiana");
      assert.equal((await alice.get("/api/rooms")).json.find((x: { id: string }) => x.id === roomId).name, "Salon");
    });
    it("sans session : 401 partout", async () => {
      for (const p of ["/api/plants", "/api/rooms", `/api/plants/${plantId}`]) assert.equal((await anonymous(s).get(p)).status, 401, p);
    });
  });

  describe("suppressions", () => {
    const householdDir = () => join(s.dataDir, "photos", readdirSync(join(s.dataDir, "photos"))[0]);
    it("supprimer une pièce laisse la plante, sans pièce", async () => {
      assert.equal((await alice.delete(`/api/rooms/${roomId}`)).status, 200);
      assert.equal((await alice.get(`/api/plants/${plantId}`)).json.roomId, null);
    });
    it("supprimer une photo supprime ses deux fichiers", async () => {
      assert.equal(readdirSync(householdDir()).length, 4, "2 photos × (grande + vignette)");
      assert.equal((await alice.delete(`/api/plants/${plantId}/photos/${photoId}`)).status, 200);
      assert.equal(readdirSync(householdDir()).length, 2);
      assert.equal((await alice.get(`/api/photos/${photoId}`)).status, 404);
    });
    it("supprimer une plante supprime ses photos sur le disque", async () => {
      assert.equal((await alice.delete(`/api/plants/${plantId}`)).status, 200);
      assert.equal(readdirSync(householdDir()).length, 0);
      assert.equal((await alice.get(`/api/plants/${plantId}`)).status, 404);
    });
    it("le dossier de photos du foyer n'est jamais celui d'un autre", async () => {
      assert.equal(existsSync(join(s.dataDir, "photos", "b".repeat(32))), false);
    });
  });
});
