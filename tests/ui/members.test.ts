// Retrait d'un membre depuis « Réglages » : le propriétaire voit le bouton (avec confirmation), le membre ne le voit pas.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, countIs, gone, launch, newPage, shot, shown } from "./helpers.js";

describe("interface : retirer un membre du foyer", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let alice: Page;
  let bob: Page;
  const errors: string[] = [];
  const dialogs: string[] = [];
  const members = (p: Page) => p.locator("section", { hasText: "Mon foyer" }).locator("li");

  before(async () => {
    s = await TestServer.start();
    browser = await launch();
    ({ page: alice } = await newPage(browser, errors));
    alice.on("dialog", (d) => dialogs.push(d.message()));
    await alice.goto(s.url + "/setup");
    await alice.getByLabel("Prénom").fill("Alice");
    await alice.getByLabel("E-mail").fill("alice@plantes.test");
    await alice.getByLabel(/Mot de passe/).fill("motdepasse-1234");
    await alice.getByLabel(/Clé d'installation/).fill(KEY);
    await alice.getByRole("button", { name: "Créer mon compte" }).click();
    await alice.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await alice.goto(s.url + "/settings");
    await alice.getByRole("button", { name: /Inviter quelqu'un/ }).click();
    const link = await alice.locator("input[readonly]").last().inputValue();
    ({ page: bob } = await newPage(browser, errors));
    await bob.goto(link);
    await bob.getByLabel("Prénom").fill("Bob");
    await bob.getByLabel("E-mail").fill("bob@plantes.test");
    await bob.getByLabel(/Mot de passe/).fill("motdepasse-5678");
    await bob.getByRole("button", { name: "Créer mon compte" }).click();
    await bob.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await bob.goto(s.url + "/settings");
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("le membre ne voit pas « Retirer du foyer »", async () => {
    assert.ok(await countIs(members(bob), 2));
    assert.ok(await shown(bob.getByRole("button", { name: "Mot de passe oublié" })));
    assert.equal(await bob.getByRole("button", { name: /Retirer/ }).count(), 0);
  });

  it("le propriétaire annule la confirmation : rien ne change", async () => {
    await alice.reload();
    assert.ok(await countIs(members(alice), 2));
    alice.removeAllListeners("dialog");
    alice.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const btn = alice.getByRole("button", { name: "Retirer Bob du foyer" });
    assert.ok(await shown(btn));
    const box = (await btn.boundingBox())!;
    assert.ok(box.height >= 48, "cible tactile d'au moins 48 px");
    assert.equal(await alice.getByRole("button", { name: /Retirer/ }).count(), 1, "pas de bouton pour soi-même");
    await btn.click();
    await new Promise((r) => setTimeout(r, 500));
    assert.match(dialogs.at(-1)!, /Bob/);
    assert.match(dialogs.at(-1)!, /plantes et le journal restent/);
    assert.equal(await members(alice).count(), 2);
  });

  it("le propriétaire confirme : la liste se met à jour, Bob retombe sur la connexion", async () => {
    alice.removeAllListeners("dialog");
    alice.on("dialog", (d) => void d.accept());
    await alice.getByRole("button", { name: "Retirer Bob du foyer" }).click();
    assert.ok(await countIs(members(alice), 1));
    assert.ok(await gone(alice.getByRole("button", { name: "Retirer Bob du foyer" })));
    await shot(alice, "40-membre-retire");
    // Bob (app ouverte) : prochaine requête -> 401 -> écran de connexion, sans plantage
    await bob.reload();
    assert.ok(await shown(bob.getByRole("button", { name: /Se connecter/ })));
    assert.deepEqual(errors, []);
  });
});
