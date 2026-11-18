// Bandeaux et carte « Jeton Claude » : l'API /api/ai/status est simulée (interceptée) pour jouer chaque scénario dans un vrai Chrome.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { countIs, cannotRun, launch, newPage, shot, shown } from "./helpers.js";

const CMD = "./scripts/rotate-token.sh";
const base = { status: "ok", problem: null, since: null, tokenExpiresAt: "2026-11-30T12:00:00.000Z", daysLeft: 12, isOwner: true };

describe("interface : état du jeton Claude", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let page: Page;
  let plantUrl = "";
  const errors: string[] = [];

  const mock = async (body: object | null) => {
    await page.unroute("**/api/ai/status");
    await page.route("**/api/ai/status", (route) =>
      body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, json: { error: "not found" } }),
    );
  };
  /** Ouvre une page en attendant la réponse de /api/ai/status (et un instant pour le rendu). */
  const visit = async (path: string, ready: string | RegExp) => {
    const answered = page.waitForResponse("**/api/ai/status");
    await page.goto(s.url + path);
    await answered;
    await page.getByText(ready).first().waitFor();
    await page.waitForTimeout(300);
  };
  const banner = (re: RegExp) => page.locator("[role=alert], [role=status]", { hasText: re });
  const PAGES: [string, () => string, string | RegExp][] = [
    ["Aujourd'hui", () => "/", "Aujourd'hui"],
    ["Réglages", () => "/settings", /Connecté en tant que/],
    ["fiche d'une plante", () => plantUrl, /Tous les\s+7 jours/],
  ];

  before(async () => {
    s = await TestServer.start({ aiDelayMs: 300 });
    browser = await launch();
    ({ page } = await newPage(browser, errors));
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("mise en place : un compte et une plante avec fiche", async () => {
    await page.goto(s.url + "/setup");
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByLabel("E-mail").fill("alice@plantes.test");
    await page.getByLabel(/Mot de passe/).fill("motdepasse-1234");
    await page.getByLabel(/Clé d'installation/).fill(KEY);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await page.getByRole("link", { name: /Plantes/ }).click();
    await page.getByRole("link", { name: "Ajouter", exact: true }).click();
    await page.getByLabel("Nom", { exact: true }).fill("Pothos");
    await page.getByRole("button", { name: "Ajouter la plante" }).click();
    await page.waitForURL(/\/plants\/[a-f0-9]+$/);
    plantUrl = new URL(page.url()).pathname;
    await page.getByText(/Tous les\s+7 jours/).waitFor({ timeout: 20_000 });
  });

  it("propriétaire, jeton qui expire dans 12 jours : bandeau orange partout + carte avec la commande dans Réglages", async () => {
    await mock(base);
    for (const [name, path, ready] of PAGES) {
      await visit(path(), ready);
      assert.ok(await shown(banner(/expire dans 12 jours \(le 30 novembre 2026\)\. Pense à le renouveler/)), `bandeau orange sur ${name}`);
      assert.ok(await countIs(banner(/arrêtée/), 0), `pas de bandeau rouge sur ${name}`);
    }
    await visit("/settings", /Connecté en tant que/);
    const card = page.locator("section", { hasText: "Jeton Claude" });
    assert.ok(await shown(card.getByText("Fonctionne")));
    assert.ok(await shown(card.getByText(/30 novembre 2026 \(dans 12 jours\)/)));
    assert.ok(await shown(card.getByText(/valable un an/)));
    assert.ok(await shown(card.locator("code.select-all", { hasText: CMD })), "commande sélectionnable");
    assert.equal(await card.locator("ol > li").count(), 3);
    await shot(page, "30-jeton-expire");
  });

  it("propriétaire, jeton refusé : bandeau rouge avec la commande, carte « Problème détecté »", async () => {
    await mock({ ...base, status: "problem", problem: "auth", since: "2026-11-18T08:00:00.000Z" });
    for (const [name, path, ready] of PAGES) {
      await visit(path(), ready);
      const b = banner(/jeton Claude est invalide ou expiré/);
      assert.ok(await shown(b), `bandeau rouge sur ${name}`);
      assert.ok(await shown(b.locator("code", { hasText: CMD })), `commande dans le bandeau de ${name}`);
      assert.ok(await shown(b.getByText(/marche à suivre est dans Réglages/)));
    }
    await visit("/settings", /Connecté en tant que/);
    assert.ok(await shown(page.getByText("Problème détecté")));
    await shot(page, "31-jeton-probleme");
  });

  it("compte Claude suspendu : texte « compte »", async () => {
    await mock({ ...base, status: "problem", problem: "account" });
    await visit("/", "Aujourd'hui");
    assert.ok(await shown(banner(/compte Claude est suspendu ou a un souci de facturation/)));
    assert.ok(await countIs(banner(/invalide ou expiré/), 0));
  });

  it("personne qui n'administre pas : bandeau rouge sans commande, pas de carte ; pas de bandeau d'expiration", async () => {
    await mock({ ...base, status: "problem", problem: "auth", isOwner: false });
    for (const [name, path, ready] of PAGES) {
      await visit(path(), ready);
      const b = banner(/jeton Claude est invalide ou expiré/);
      assert.ok(await shown(b), `bandeau rouge sur ${name}`);
      assert.ok(await shown(b.getByText("Préviens la personne qui administre l'appli.")));
      assert.ok(await countIs(page.getByText(CMD), 0), `aucune commande sur ${name}`);
      assert.ok(await countIs(page.getByText(/Réglages\)/), 0));
    }
    await visit("/settings", /Connecté en tant que/);
    assert.ok(await countIs(page.getByText("🔑 Jeton Claude"), 0), "pas de carte");
    await mock({ ...base, isOwner: false });
    for (const [name, path, ready] of PAGES) {
      await visit(path(), ready);
      assert.ok(await countIs(page.locator("[role=alert], [role=status]"), 0), `aucun bandeau d'expiration sur ${name}`);
    }
    await visit("/settings", /Connecté en tant que/);
    assert.ok(await countIs(page.getByText("🔑 Jeton Claude"), 0), "pas de carte");
  });

  it("jeton valable encore 200 jours : aucun bandeau, mais la carte est là pour le propriétaire", async () => {
    await mock({ ...base, daysLeft: 200, tokenExpiresAt: "2027-06-06T12:00:00.000Z" });
    for (const [name, path, ready] of PAGES) {
      await visit(path(), ready);
      assert.ok(await countIs(page.locator("[role=alert], [role=status]"), 0), `aucun bandeau sur ${name}`);
    }
    await visit("/settings", /Connecté en tant que/);
    assert.ok(await shown(page.getByText("🔑 Jeton Claude")));
    assert.ok(await shown(page.getByText(/6 juin 2027 \(dans 200 jours\)/)));
  });

  it("jeton déjà expiré, expire demain, expire aujourd'hui", async () => {
    await mock({ ...base, daysLeft: -3, tokenExpiresAt: "2026-11-15T12:00:00.000Z" });
    await visit("/", "Aujourd'hui");
    assert.ok(await shown(banner(/Le jeton Claude a expiré le 15 novembre 2026/)));
    await mock({ ...base, daysLeft: 1, tokenExpiresAt: "2026-11-19T12:00:00.000Z" });
    await visit("/", "Aujourd'hui");
    assert.ok(await shown(banner(/expire demain \(le 19 novembre 2026\)/)));
    await mock({ ...base, daysLeft: 0, tokenExpiresAt: "2026-11-18T12:00:00.000Z" });
    await visit("/", "Aujourd'hui");
    assert.ok(await shown(banner(/expire aujourd'hui \(le 18 novembre 2026\)/)));
  });

  it("date d'expiration inconnue : la carte le dit, pas de bandeau", async () => {
    await mock({ ...base, tokenExpiresAt: null, daysLeft: null });
    await visit("/settings", /Connecté en tant que/);
    assert.ok(await shown(page.getByText(/Date d'expiration inconnue : renseigne CLAUDE_TOKEN_CREATED sur le serveur/)));
    assert.ok(await countIs(page.locator("[role=alert], [role=status]"), 0));
  });

  it("route absente (404) : ni bandeau, ni carte, ni erreur", async () => {
    await mock(null);
    for (const [name, path, ready] of PAGES) {
      await visit(path(), ready);
      assert.ok(await countIs(page.locator("[role=alert], [role=status]"), 0), `aucun bandeau sur ${name}`);
      assert.ok(await countIs(page.getByText(/jeton Claude/i), 0), `rien sur le jeton sur ${name}`);
    }
    assert.ok(await countIs(page.getByText("🔑 Jeton Claude"), 0));
  });

  it("aucune erreur JavaScript ni violation de sécurité dans la console", () => {
    assert.deepEqual(errors, []);
  });
});
