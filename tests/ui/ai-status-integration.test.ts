// Jeton Claude, de bout en bout (rien n'est simulé côté réseau) : IA factice qui refuse l'authentification, vrai état
// serveur, vraies notifications, deux comptes dans deux navigateurs. Les tests de `ai-status.test.ts` simulent l'API ;
// celui-ci vérifie que l'interface lit bien ce que le serveur renvoie réellement.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, launch, newPage, shown } from "./helpers.js";

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

describe("interface : jeton Claude de bout en bout", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let alice: Page;
  let bob: Page;
  const errors: string[] = [];
  const alert = (p: Page, re: RegExp) => p.locator("[role=alert], [role=status]", { hasText: re });

  const addPlant = async (p: Page, name: string) => {
    await p.goto(s.url + "/plants/new");
    await p.getByLabel("Nom", { exact: true }).fill(name);
    await p.getByRole("button", { name: "Ajouter la plante" }).click();
    await p.waitForURL(/\/plants\/[a-f0-9]+$/);
  };

  before(async () => {
    // Jeton créé il y a 340 jours : il expire dans 25 jours.
    s = await TestServer.start({ aiDelayMs: 200, env: { CLAUDE_TOKEN_CREATED: ymd(new Date(Date.now() - 340 * DAY)) } });
    browser = await launch();
    ({ page: alice } = await newPage(browser, errors));
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

    // Un appareil abonné par personne : on vérifiera qui reçoit quoi.
    s.db((db) => {
      const ids = db.prepare("select id, email from user").all() as { id: string; email: string }[];
      for (const u of ids) db.prepare("insert into push_subscriptions(endpoint,p256dh,auth,user_id,created_at) values(?,?,?,?,?)").run(`https://push.test/${u.email.split("@")[0]}`, "p", "a", u.id, 1);
    });
    s.clearPushes();
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("jeton qui expire dans 25 jours : bandeau orange pour le propriétaire seulement, carte dans ses Réglages", async () => {
    await alice.goto(s.url + "/");
    assert.ok(await shown(alert(alice, /Le jeton Claude expire dans 2[45] jours/)), "le propriétaire est prévenu");
    await bob.goto(s.url + "/");
    await bob.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await bob.waitForTimeout(800);
    assert.equal(await alert(bob, /jeton Claude/).count(), 0, "l'autre membre n'est pas importuné");
    await alice.goto(s.url + "/settings");
    assert.ok(await shown(alice.getByText("Jeton Claude", { exact: true })));
  });

  it("jeton refusé par l'IA : message clair sur la plante, bandeau rouge pour les deux, la commande seulement pour le propriétaire", async () => {
    await addPlant(alice, "AUTHFAIL test");
    assert.ok(await shown(alice.getByText(/Le jeton Claude n'est plus valide/)), "le message d'erreur est en français et sans jargon");

    await alice.goto(s.url + "/");
    assert.ok(await shown(alert(alice, /La génération des fiches est arrêtée : le jeton Claude est invalide ou expiré/)));
    assert.ok(await shown(alice.getByText("./scripts/rotate-token.sh").first()), "le propriétaire voit la commande");

    await bob.goto(s.url + "/");
    assert.ok(await shown(alert(bob, /La génération des fiches est arrêtée/)), "l'autre membre est prévenu aussi");
    assert.ok(await shown(bob.getByText(/Préviens la personne qui administre l'appli/)));
    assert.equal(await bob.getByText("./scripts/rotate-token.sh").count(), 0, "mais sans la commande");
    await bob.goto(s.url + "/settings");
    await bob.getByText(/Connecté en tant que/).waitFor();
    assert.equal(await bob.getByText("Jeton Claude", { exact: true }).count(), 0, "et sans la carte du jeton");

    await alice.goto(s.url + "/settings");
    assert.ok(await shown(alice.getByText(/Problème détecté/)), "la carte du propriétaire indique le problème");
  });

  it("la notification part au propriétaire seulement, et une seule fois", async () => {
    const sent = s.pushes();
    assert.ok(sent.length >= 1, "une notification est partie");
    assert.deepEqual([...new Set(sent.map((m) => m.endpoint.split("/").pop()))], ["alice"], "jamais à Bob");
    assert.equal(sent.filter((m) => /jeton/i.test(m.payload.title + m.payload.body)).length, 1, "une seule fois à la transition");
  });

  it("une génération réussie remet tout en ordre : le bandeau rouge disparaît, l'état redevient « ok »", async () => {
    await addPlant(alice, "Pothos");
    await alice.getByText(/Tous les\s+7 jours/).waitFor({ timeout: 20_000 });
    await alice.goto(s.url + "/");
    assert.ok(await shown(alert(alice, /Le jeton Claude expire/)), "il ne reste que l'avertissement d'expiration");
    await alice.waitForTimeout(500);
    assert.equal(await alert(alice, /génération des fiches est arrêtée/).count(), 0, "plus de bandeau rouge");
    await bob.goto(s.url + "/");
    await bob.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await bob.waitForTimeout(800);
    assert.equal(await alert(bob, /génération des fiches/).count(), 0, "ni pour Bob");
    assert.ok(s.pushes().some((m) => /fonctionnent de nouveau/i.test(m.payload.title + m.payload.body) && m.endpoint.endsWith("alice")), "le propriétaire est prévenu du rétablissement");
  });

  it("aucune erreur JavaScript ni violation de sécurité dans la console", () => {
    assert.deepEqual(errors, []);
  });
});
