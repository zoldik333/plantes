// Évolution d'une plante : frise, visionneur plein écran, comparaison, état vide, ajout d'une photo.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, countIs, gone, imageLoaded, launch, newPage, photoFile, shot, shown } from "./helpers.js";

const DAY = 86_400_000;
const daysAgo = (n: number) => Date.now() - n * DAY;

describe("interface : évolution d'une plante (timeline)", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let page: Page;
  let plantId: string;
  let emptyId: string;
  const errors: string[] = [];
  const headers = () => ({ origin: s.url });
  const post = async (path: string, data: unknown) => (await page.request.post(s.url + path, { data, headers: headers() })).json();
  const upload = async (id: string) => {
    const f = await photoFile();
    const r = await page.request.post(`${s.url}/api/plants/${id}/photos`, { multipart: { photo: f }, headers: headers() });
    assert.equal(r.status(), 201);
    return (await r.json()).id as string;
  };

  before(async () => {
    s = await TestServer.start();
    browser = await launch();
    ({ page } = await newPage(browser, errors));
    await page.goto(s.url + "/setup");
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByLabel("E-mail").fill("alice@plantes.test");
    await page.getByLabel(/Mot de passe/).fill("motdepasse-1234");
    await page.getByLabel(/Clé d'installation/).fill(KEY);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();

    plantId = (await post("/api/plants", { name: "Monstera" })).id;
    emptyId = (await post("/api/plants", { name: "Pothos" })).id;
    const old = await upload(plantId);
    const recent = await upload(plantId);
    await post(`/api/plants/${plantId}/events`, { type: "fertilized", note: "Engrais liquide" });
    await post(`/api/plants/${plantId}/events`, { type: "watered" });
    const events = (await (await page.request.get(`${s.url}/api/plants/${plantId}/events`)).json()) as { id: string; type: string }[];
    s.db((db) => {
      db.prepare("update plant_photos set created_at=? where id=?").run(daysAgo(37), old);
      db.prepare("update plant_photos set created_at=? where id=?").run(daysAgo(2), recent);
      db.prepare("update care_events set created_at=? where id=?").run(daysAgo(10), events.find((e) => e.type === "fertilized")!.id);
    });
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("la fiche mène à l'évolution ; la frise montre photos et soins, du plus récent au plus ancien", async () => {
    await page.goto(`${s.url}/plants/${plantId}`);
    await page.getByRole("link", { name: "Évolution" }).click();
    assert.ok(await shown(page.getByRole("heading", { name: "Évolution" })));
    const photos = page.locator("ol img");
    assert.ok(await countIs(photos, 2));
    assert.ok(await imageLoaded(page, "ol img"));
    assert.ok(await shown(page.getByText("Engrais liquide")));
    assert.ok(await shown(page.locator("ol li").filter({ hasText: "Arrosée" })));
    assert.ok(await shown(page.getByText(/il y a 2 jours/)));
    assert.ok(await shown(page.getByText(/il y a 5 semaines/)));
    // Alternative accessible : « Photo du … » et durée relative en texte.
    const alts = await photos.evaluateAll((els) => els.map((e) => e.getAttribute("alt")));
    assert.ok(alts.every((a) => /^Photo du \d+ \p{L}+/u.test(a ?? "")), `alt descriptifs : ${alts}`);
    assert.equal(await photos.first().getAttribute("loading"), "lazy");
    // Un seul bouton citron (pas d'état vide ici : deux photos).
    assert.equal(await page.locator("main a, main button, main label").filter({ hasText: "Ajouter une photo" }).count(), 1);
    await shot(page, "40-timeline");
  });

  it("toucher une photo l'ouvre en plein écran ; Échap et le bouton la ferment", async () => {
    const open = page.getByRole("button", { name: /Voir la photo du .* en grand/ }).first();
    await open.click();
    const dialog = page.getByRole("dialog");
    assert.ok(await shown(dialog));
    assert.ok(await imageLoaded(page, "dialog img"));
    assert.ok(await shown(dialog.getByRole("button", { name: "Fermer la photo" })));
    assert.ok(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Fermer la photo"), "le focus est sur le bouton de fermeture");
    await page.keyboard.press("Escape");
    assert.ok(await gone(dialog));
    await open.click();
    assert.ok(await shown(dialog));
    await dialog.getByRole("button", { name: "Fermer la photo" }).click();
    assert.ok(await gone(dialog));
  });

  it("comparer : la première et la dernière photo par défaut, avec l'écart ; choix modifiable", async () => {
    await page.getByRole("button", { name: "Comparer" }).click();
    assert.ok(await shown(page.getByText("Comparer deux photos")));
    assert.ok(await shown(page.getByText("5 semaines entre les deux")));
    const imgs = page.locator("figure img");
    assert.ok(await countIs(imgs, 2));
    assert.ok(await imageLoaded(page, "figure img"));
    // Même photo des deux côtés : « même jour ».
    const after = page.getByLabel("Après");
    await after.selectOption({ index: 1 });
    assert.ok(await shown(page.getByText("Prises le même jour")));
    await page.getByRole("button", { name: "Fermer la comparaison" }).click();
    assert.ok(await gone(page.getByText("Comparer deux photos")));
  });

  it("sans photo : état vide utile ; ajouter une photo depuis la frise la fait apparaître", async () => {
    await page.goto(`${s.url}/plants/${emptyId}/timeline`);
    assert.ok(await shown(page.getByText("Aucune photo pour l'instant")));
    assert.equal(await page.getByRole("button", { name: "Comparer" }).count(), 0);
    await page.locator('input[type="file"]').setInputFiles(await photoFile());
    assert.ok(await countIs(page.locator("ol img"), 1));
    assert.ok(await imageLoaded(page, "ol img"));
    assert.ok(await shown(page.getByText("Une seule photo pour l'instant")));
    assert.ok(await gone(page.getByText("Aucune photo pour l'instant")));
  });

  it("plante d'un autre foyer ou inexistante : erreur affichée", async () => {
    await page.goto(`${s.url}/plants/inexistante/timeline`);
    assert.ok(await shown(page.getByText("Plante introuvable")));
  });

  it("aucune erreur JavaScript ni violation CSP", () => {
    assert.deepEqual(errors, []);
  });
});
