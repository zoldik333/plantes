// Arrosage, annulation, « encore humide », journal, foyer partagé, rappel de test : dans un vrai Chrome (écran d'iPhone).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, countIs, launch, newPage, shot, shown } from "./helpers.js";

const DAY = 86_400_000;

describe("interface : rappels d'arrosage et journal", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let page: Page;
  let bob: Page;
  const errors: string[] = [];
  const card = (p: Page, name: string) => p.locator("li", { has: p.getByText(name, { exact: true }) }).first();
  const journalSelect = () => page.locator("section", { hasText: "Journal d'entretien" }).locator("select");

  before(async () => {
    s = await TestServer.start({ aiDelayMs: 500 });
    browser = await launch();
    ({ page } = await newPage(browser, errors));
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("mise en place : premier compte, invitation à activer les notifications, deux plantes avec fiche", async () => {
    await page.goto(s.url + "/setup");
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByLabel("E-mail").fill("alice@plantes.test");
    await page.getByLabel(/Mot de passe/).fill("motdepasse-1234");
    await page.getByLabel(/Clé d'installation/).fill(KEY);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    assert.ok(await shown(page.getByText(/Active les notifications/)), "invitation à activer les notifications");
    for (const name of ["Calathea", "Pothos"]) {
      await page.getByRole("link", { name: /Plantes/ }).click();
      await page.getByRole("link", { name: "+ Ajouter" }).click();
      await page.getByLabel("Nom", { exact: true }).fill(name);
      await page.getByRole("button", { name: "Ajouter la plante" }).click();
      await page.waitForURL(/\/plants\/[a-f0-9]+$/);
      await page.getByText(/Tous les\s+7 jours/).waitFor({ timeout: 20_000 });
    }
  });

  it("plantes neuves : rien à arroser aujourd'hui", async () => {
    await page.getByRole("link", { name: /Aujourd'hui/ }).click();
    await page.getByText("Rien à arroser aujourd'hui").waitFor();
    await shot(page, "20-aujourdhui-vide");
  });

  it("plantes en retard : liste « À arroser · 2 », chacune « en retard de N jours »", async () => {
    s.db((db) => db.prepare("delete from care_events").run()); // efface le « dernier arrosage : aujourd'hui » choisi à la création
    s.db((db) => db.prepare("update plants set created_at = ?").run(Date.now() - 20 * DAY));
    await page.reload();
    await page.getByText(/À arroser · 2/).waitFor();
    assert.ok(await countIs(page.getByText(/en retard de \d+ jours?/), 2), "deux plantes en retard");
    await shot(page, "21-aujourdhui-a-arroser");
  });

  it("arrosée, annulation dans le bandeau, puis « encore humide »", async () => {
    await card(page, "Calathea").getByRole("button", { name: /Arrosée/ }).click();
    await page.getByText(/Calathea : arrosée/).waitFor();
    assert.ok(await shown(page.getByText(/À arroser · 1/)), "la Calathea a quitté la liste");
    await page.getByRole("button", { name: "Annuler", exact: true }).first().click();
    await page.getByText(/À arroser · 2/).waitFor();
    await card(page, "Calathea").getByRole("button", { name: /Arrosée/ }).click();
    await card(page, "Pothos").getByRole("button", { name: "Encore humide" }).click();
    await page.getByText("Rien à arroser aujourd'hui").waitFor();
    assert.ok(await shown(page.getByText(/Pothos : rappel repoussé|Dans les 7 prochains jours/)), "confirmation affichée");
    await shot(page, "22-apres-actions");
  });

  it("fiche d'une plante : arrosage repoussé, journal, note vide impossible, note et engrais ajoutés puis annulés", async () => {
    await page.getByRole("link", { name: /Plantes/ }).click();
    assert.ok(await shown(page.getByText("Pothos")), "la liste est chargée");
    assert.ok(await countIs(page.getByText("💧 À arroser"), 0), "aucun badge dans la liste");
    await page.getByText("Pothos").click();
    await page.getByText(/repoussé : encore humide/).waitFor();
    assert.ok(await shown(page.getByText("🌫️ Encore humide")), "l'action figure dans le journal");

    await journalSelect().selectOption("note");
    assert.ok(await shown(page.getByPlaceholder("Ta note (obligatoire)")));
    assert.ok(await page.getByRole("button", { name: "Ajouter au journal" }).isDisabled(), "une note vide ne peut pas être ajoutée");
    await page.getByPlaceholder("Ta note (obligatoire)").fill("Feuille jaunie à gauche");
    await page.getByRole("button", { name: "Ajouter au journal" }).click();
    await page.getByText("Feuille jaunie à gauche").waitFor();
    assert.ok(await shown(page.getByText(/Alice/)), "signée « Alice »");

    await journalSelect().selectOption("fertilized");
    await page.getByPlaceholder(/Précision/).fill("Demi-dose");
    await page.getByRole("button", { name: "Ajouter au journal" }).click();
    await page.getByText("Demi-dose").waitFor();
    assert.ok(await shown(page.locator("li", { has: page.getByText("Demi-dose") }).getByText("🧪 Engrais")), "engrais avec sa précision");
    await shot(page, "23-journal");

    await page.locator("li", { has: page.getByText("Feuille jaunie à gauche") }).getByRole("button", { name: "Annuler" }).click();
    await page.getByText("Feuille jaunie à gauche").waitFor({ state: "detached" });
  });

  it("annuler un arrosage depuis le journal : la plante est de nouveau à arroser, avec son badge dans la liste", async () => {
    await page.getByRole("link", { name: /Plantes/ }).click();
    await page.getByText("Calathea").click();
    await page.getByText(/Prochain arrosage/).waitFor();
    await page.locator("li", { has: page.getByText("💧 Arrosée") }).first().getByRole("button", { name: "Annuler" }).click();
    await page.getByText(/À arroser : en retard/).waitFor();
    await page.getByRole("link", { name: /Plantes/ }).click();
    await page.getByText("💧 À arroser").waitFor();
    assert.ok(await countIs(page.getByText("💧 À arroser"), 1), "un seul badge : la Calathea");
    await shot(page, "24-liste-badge");
  });

  it("foyer partagé : Bob voit la même plante, l'arrose, et Alice voit qu'il n'y a plus rien à arroser", async () => {
    await page.getByRole("link", { name: /Réglages/ }).click();
    await page.getByRole("button", { name: /Inviter quelqu'un/ }).click();
    const link = await page.locator("input[readonly]").inputValue();
    ({ page: bob } = await newPage(browser, errors));
    await bob.goto(link);
    await bob.getByLabel("Prénom").fill("Bob");
    await bob.getByLabel("E-mail").fill("bob@plantes.test");
    await bob.getByLabel(/Mot de passe/).fill("motdepasse-5678");
    await bob.getByRole("button", { name: "Créer mon compte" }).click();
    await bob.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await bob.getByText(/À arroser · 1/).waitFor();
    assert.ok(await shown(bob.getByText("Calathea")), "Bob voit la même plante à arroser");
    await card(bob, "Calathea").getByRole("button", { name: /Arrosée/ }).click();
    await bob.getByText("Rien à arroser aujourd'hui").waitFor();

    await page.getByRole("link", { name: /Aujourd'hui/ }).click();
    await page.getByText("Rien à arroser aujourd'hui").waitFor();
    await page.getByRole("link", { name: /Plantes/ }).click();
    await page.getByText("Calathea").click();
    await page.getByText(/Bob/).first().waitFor(); // le journal indique que c'est Bob
  });

  it("réglages : le rappel de test dit qu'aucun appareil n'est abonné, puis envoie le vrai contenu", async () => {
    await page.getByRole("link", { name: /Réglages/ }).click();
    await page.getByRole("button", { name: "Tester le vrai rappel" }).click();
    await page.getByText(/Aucun appareil abonné pour toi/).waitFor();

    const aliceId = s.db((db) => (db.prepare("select id from user where email='alice@plantes.test'").get() as { id: string }).id);
    s.db((db) => db.prepare("insert into push_subscriptions(endpoint,p256dh,auth,user_id,created_at) values(?,?,?,?,?)").run("https://push.test/alice", "p", "a", aliceId, 1));
    s.db((db) => db.prepare("update plants set created_at = ? where name = 'Pothos'").run(Date.now() - 40 * DAY));
    s.db((db) => db.prepare("delete from care_events where plant_id in (select id from plants where name='Pothos')").run());
    await page.getByRole("button", { name: "Tester le vrai rappel" }).click();
    await page.getByText(/Rappel envoyé à 1 appareil \(1 plante à arroser/).waitFor();
    const sent = s.pushes();
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.title, /1 plante à arroser/);
    assert.equal(sent[0].payload.body, "Pothos");
    await shot(page, "25-reglages");
  });

  it("dernier arrosage choisi à la création, et rattrapage « oublié de cocher »", async () => {
    s.db((db) => db.prepare("delete from care_events where plant_id in (select id from plants where name='Pothos')").run());
    const addPlant = async (name: string, choice: string) => {
      await page.goto(s.url + "/plants/new");
      await page.getByLabel("Nom", { exact: true }).fill(name);
      await page.getByLabel("Dernier arrosage").selectOption({ label: choice });
      await page.getByRole("button", { name: "Ajouter la plante" }).click();
      await page.waitForURL(/\/plants\/[a-f0-9]+$/);
      await page.getByText(/Tous les\s+7 jours/).waitFor({ timeout: 20_000 });
    };
    await addPlant("Ficus", "Il y a environ une semaine");
    assert.ok(await shown(page.getByText("💧 Arrosée")), "un arrosage figure dans le journal du Ficus");
    assert.ok(await shown(page.getByText(/Prochain arrosage|À arroser/)), "état d'arrosage déduit");
    await shot(page, "26-ficus-semaine");
    await page.locator("label", { hasText: "Oublié de cocher" }).locator("select").selectOption({ label: "Hier" });
    await page.waitForFunction(() => [...document.querySelectorAll("li")].filter((l) => l.textContent?.includes("💧 Arrosée")).length >= 2);

    await addPlant("Cactus", "Il y a plus de deux semaines (ou je ne sais pas)");
    assert.ok(await shown(page.getByText(/À arroser :/)), "le Cactus est à arroser tout de suite");
    await page.getByRole("link", { name: /Aujourd'hui/ }).click();
    await page.getByText(/À arroser · /).waitFor();
    assert.ok(await shown(page.locator("li", { has: page.getByText("Cactus", { exact: true }) }).getByRole("button", { name: /Arrosée/ })), "le Cactus a son bouton « Arrosée »");
    await shot(page, "27-aujourdhui-cactus");
  });

  it("aucune erreur JavaScript ni violation de sécurité dans la console", () => {
    assert.deepEqual(errors, []);
  });
});
