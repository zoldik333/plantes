// Réglages : carte « Raccourci iOS » (création, affichage unique du jeton, révocation).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, countIs, gone, launch, newPage, shown } from "./helpers.js";

describe("interface : raccourci iOS", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];
  let token = "";
  const card = () => page.locator("section", { hasText: "Raccourci iOS" });
  const rows = () => card().locator("ul > li");

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
    await page.goto(s.url + "/settings");
    await shown(card());
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("création : le jeton est affiché avec l'avertissement, la liste le mentionne", async () => {
    await card().getByLabel("Nom du jeton").fill("iPhone de test");
    await card().getByRole("button", { name: "Créer un jeton" }).click();
    assert.ok(await shown(card().getByText(/ne sera plus jamais affiché/)));
    const field = card().locator("input[readonly]");
    assert.ok(await shown(field));
    token = await field.inputValue();
    assert.match(token, /^plt_[A-Za-z0-9_-]{43}$/);
    assert.ok(await countIs(rows(), 1));
    assert.ok(await shown(rows().first().getByText("iPhone de test")));
    assert.ok(await shown(rows().first().getByText(/jamais utilisé/)));
  });

  it("le jeton n'est ni dans l'adresse ni dans le stockage du navigateur", async () => {
    assert.equal(page.url().includes(token), false);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    assert.equal(stored.includes(token), false);
  });

  it("après rechargement, le jeton n'est plus affiché", async () => {
    await page.reload();
    assert.ok(await shown(rows().first()));
    assert.ok(await countIs(card().locator("input[readonly]"), 0));
    assert.equal((await page.content()).includes(token), false);
  });

  it("le jeton fonctionne, puis la révocation (avec confirmation) le coupe", async () => {
    const call = () => fetch(`${s.url}/api/shortcuts/plants`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await call()).status, 200);
    let asked = "";
    page.once("dialog", (d) => (asked = d.message())); // la confirmation est acceptée par newPage
    await rows().first().getByRole("button", { name: "Révoquer" }).click();
    assert.ok(await gone(rows()));
    assert.match(asked, /Révoquer le jeton/);
    assert.equal((await call()).status, 401);
  });

  it("aucune erreur de console (CSP comprise)", () => {
    assert.deepEqual(errors, []);
  });
});
