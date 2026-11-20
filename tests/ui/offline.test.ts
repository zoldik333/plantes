// Hors connexion : coque précachée, données et photos déjà vues lisibles, bandeau, écritures refusées proprement, caches vidés à la déconnexion.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, countIs, gone, imageLoaded, launch, newPage, photoFile, shown } from "./helpers.js";

describe("interface : hors connexion", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let ctx: BrowserContext;
  let page: Page;
  const errors: string[] = [];
  const banner = () => page.getByRole("status").filter({ hasText: "Hors connexion" });
  const privateCaches = () => page.evaluate(async () => {
    const names = (await caches.keys()).filter((k) => /^plantes-(data|photos)/.test(k));
    let entries = 0;
    for (const n of names) entries += (await (await caches.open(n)).keys()).length;
    return { names: names.length, entries };
  });

  before(async () => {
    s = await TestServer.start();
    browser = await launch();
    ({ ctx, page } = await newPage(browser, errors, { serviceWorker: true }));
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("préparation : compte, pièce, plante avec photo, service worker actif", async () => {
    await page.goto(s.url + "/setup");
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByLabel("E-mail").fill("alice@plantes.test");
    await page.getByLabel(/Mot de passe/).fill("motdepasse-1234");
    await page.getByLabel(/Clé d'installation/).fill(KEY);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await page.getByRole("link", { name: /Pièces/ }).click();
    await page.getByLabel("Nouvelle pièce").fill("Salon");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await page.getByText("0 plante").waitFor();
    await page.getByRole("link", { name: /Plantes/ }).click();
    await page.getByRole("link", { name: "Ajouter", exact: true }).click();
    await page.getByLabel("Nom", { exact: true }).fill("Ma Calathea");
    await page.getByLabel("Pièce").selectOption({ label: "Salon" });
    await page.locator('input[type="file"]').setInputFiles(await photoFile());
    await page.getByRole("button", { name: "Ajouter la plante" }).click();
    await page.waitForURL(/\/plants\/[a-f0-9]+$/);
    assert.ok(await imageLoaded(page, "img"), "photo chargée en ligne");
    // Le SW doit contrôler la page ; un rechargement charge ensuite les données par lui (remplit les caches).
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    for (const [name, heading] of [["Aujourd'hui", "Aujourd'hui"], ["Plantes", "Plantes"], ["Pièces", "Pièces"]] as const) {
      await page.getByRole("link", { name: new RegExp(name) }).first().click();
      await page.getByRole("heading", { name: heading }).waitFor();
    }
    await page.getByRole("link", { name: /Plantes/ }).first().click();
    await page.getByText("Ma Calathea").first().click();
    await page.getByText("Ma Calathea").first().waitFor();
    assert.ok(await imageLoaded(page, "img"));
    const c = await privateCaches();
    assert.ok(c.entries >= 4, `données mises en cache (${c.entries})`);
  });

  it("hors ligne : rechargement de la fiche, bandeau, photo, navigation entre écrans, sans écran de connexion", async () => {
    const url = page.url();
    await ctx.setOffline(true);
    await page.reload();
    assert.ok(await shown(page.getByText("Ma Calathea")), "fiche lisible hors ligne");
    assert.ok(await shown(banner()), "bandeau Hors connexion");
    assert.ok(await imageLoaded(page, "img"), "photo déjà vue affichée hors ligne");
    assert.ok(!page.url().includes("/login"));
    await page.getByRole("link", { name: /Plantes/ }).first().click();
    assert.ok(await shown(page.getByText("Ma Calathea")), "liste des plantes");
    await page.getByRole("link", { name: /Pièces/ }).first().click();
    assert.ok(await shown(page.getByText("Salon")), "pièces");
    await page.getByRole("link", { name: /Aujourd'hui/ }).first().click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    assert.ok(await shown(banner()));
    assert.ok(url.includes("/plants/"));
  });

  it("hors ligne : une écriture échoue avec un message en français, rien n'est mis en file", async () => {
    await page.getByRole("link", { name: /Pièces/ }).first().click();
    await page.getByLabel("Nouvelle pièce").fill("Bureau");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    assert.ok(await shown(page.getByText(/Pas de connexion/)), "message d'échec explicite");
    assert.ok(await countIs(page.getByText("Bureau", { exact: true }), 0), "la pièce n'apparaît pas");
  });

  it("retour en ligne : le bandeau disparaît et l'écriture marche", async () => {
    await ctx.setOffline(false);
    assert.ok(await gone(banner(), 15_000), "bandeau retiré");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    assert.ok(await shown(page.getByText("Bureau", { exact: true })));
  });

  it("déconnexion : les caches privés sont vidés, plus rien de lisible hors ligne", async () => {
    await page.getByRole("link", { name: /Réglages/ }).first().click();
    await page.getByRole("button", { name: "Déconnexion" }).click();
    await page.waitForURL("**/login");
    await page.waitForFunction(async () => {
      for (const n of await caches.keys()) if (/^plantes-(data|photos)/.test(n)) return false;
      return true;
    });
    assert.deepEqual(await privateCaches(), { names: 0, entries: 0 });
    await ctx.setOffline(true);
    await page.goto(s.url + "/plants");
    assert.ok(await shown(banner()));
    assert.ok(await countIs(page.getByText("Ma Calathea"), 0), "aucune donnée privée après déconnexion");
    await ctx.setOffline(false);
    assert.deepEqual(errors, [], `aucune erreur de console/CSP : ${errors.join(" | ")}`);
  });
});
