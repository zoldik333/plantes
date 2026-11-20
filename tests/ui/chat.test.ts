// Chat par plante, dans un vrai navigateur (écran d'iPhone) : suggestions, envoi, réponse, texte brut, attente, erreur, effacement.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, countIs, gone, launch, newPage, shown } from "./helpers.js";

describe("interface : chat par plante", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];
  const bubble = (role: "user" | "assistant") => page.locator(`[data-role=${role}]`);

  before(async () => {
    s = await TestServer.start({ aiDelayMs: 700 });
    browser = await launch();
    ({ page } = await newPage(browser, errors));
    await page.goto(s.url + "/setup");
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByLabel("E-mail").fill("alice@plantes.test");
    await page.getByLabel(/Mot de passe/).fill("motdepasse-1234");
    await page.getByLabel(/Clé d'installation/).fill(KEY);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await page.goto(s.url + "/plants/new");
    await page.getByLabel("Nom", { exact: true }).fill("Pothos");
    await page.getByRole("button", { name: "Ajouter la plante" }).click();
    await page.waitForURL(/\/plants\/[a-f0-9]+$/);
    await page.getByRole("link", { name: /Poser une question/ }).click();
    await page.waitForURL(/\/chat$/);
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("conversation vide : suggestions ; un clic envoie la question, « Claude réfléchit… » pendant l'attente, puis la réponse", async () => {
    assert.ok(await shown(page.getByRole("heading", { name: "Pothos" })));
    for (const q of ["Pourquoi les feuilles jaunissent ?", "Dois-je l'arroser maintenant ?", "Quelle lumière lui faut-il ?"]) {
      assert.ok(await shown(page.getByRole("button", { name: q, exact: true })), q);
    }
    assert.ok(await shown(page.getByText("Claude voit le journal d'entretien et la dernière photo")));
    await page.getByRole("button", { name: "Dois-je l'arroser maintenant ?", exact: true }).click();
    assert.ok(await shown(page.getByText("Claude réfléchit…")));
    assert.ok(await page.getByRole("button", { name: "Envoyer" }).isDisabled(), "envoi désactivé pendant l'attente");
    assert.ok(await shown(bubble("assistant")));
    assert.match((await bubble("assistant").first().textContent()) ?? "", /Plante : Pothos\./);
    assert.ok(await gone(page.getByText("Claude réfléchit…")));
    assert.ok(await countIs(bubble("user"), 1));
    assert.ok(await gone(page.getByRole("button", { name: "Quelle lumière lui faut-il ?" })), "plus de suggestions une fois la conversation lancée");
  });

  it("le texte est affiché brut (jamais de HTML) avec ses retours à la ligne, et signé du prénom", async () => {
    await page.getByLabel("Ta question").fill("<b>gras</b>\nsecond ligne");
    await page.getByRole("button", { name: "Envoyer" }).click();
    assert.ok(await countIs(bubble("user"), 2));
    assert.ok(await countIs(bubble("assistant"), 2));
    const mine = bubble("user").nth(1);
    assert.equal(await mine.textContent(), "<b>gras</b>\nsecond ligne");
    assert.equal(await mine.locator("b").count(), 0);
    assert.equal(await mine.evaluate((e) => getComputedStyle(e).whiteSpace), "pre-wrap");
    assert.ok(await shown(page.getByText(/^Alice · /).first()));
    assert.equal(await page.getByLabel("Ta question").inputValue(), "", "zone de saisie vidée");
  });

  it("erreur de l'IA : message lisible, question rendue dans la zone de saisie, conversation intacte", async () => {
    await page.getByLabel("Ta question").fill("AUTHFAIL maintenant");
    await page.getByRole("button", { name: "Envoyer" }).click();
    const alert = page.locator("[role=alert]", { hasText: "jeton Claude n'est plus valide" });
    assert.ok(await shown(alert.last()));
    assert.equal(await page.getByLabel("Ta question").inputValue(), "AUTHFAIL maintenant");
    assert.ok(await countIs(bubble("user"), 2));
    // L'état « jeton invalide » est aussi annoncé par le bandeau de l'IA.
    await page.reload();
    assert.ok(await shown(page.locator("[role=alert]", { hasText: "génération des fiches est arrêtée" })));
  });

  it("effacer la conversation : confirmation, puis retour aux suggestions", async () => {
    await page.getByRole("button", { name: "Effacer la conversation" }).click(); // la boîte de confirmation est acceptée par newPage
    assert.ok(await countIs(bubble("user"), 0));
    assert.ok(await shown(page.getByRole("button", { name: "Quelle lumière lui faut-il ?", exact: true })));
    assert.ok(await gone(page.getByRole("button", { name: "Effacer la conversation" })));
  });

  it("aucune erreur de console ni violation de CSP", () => {
    assert.deepEqual(errors, []);
  });
});
