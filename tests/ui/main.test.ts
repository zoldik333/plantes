// Interface dans un vrai Chrome (écran d'iPhone) : comptes, pièces, plantes, fiche IA, invitation, passkeys.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, countIs, gone, imageLoaded, launch, newPage, photoFile, shot, shown } from "./helpers.js";

describe("interface : parcours complet", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let ctx: BrowserContext;
  let page: Page;
  let bob: Page;
  const errors: string[] = [];
  let inviteLink = "";

  before(async () => {
    s = await TestServer.start({ aiDelayMs: 4000 });
    browser = await launch();
    ({ ctx, page } = await newPage(browser, errors));
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("premier compte : le lien d'installation est proposé, une mauvaise clé est refusée avec un message", async () => {
    await page.goto(s.url + "/");
    await page.waitForURL("**/login");
    assert.ok(await shown(page.getByText("Créer le premier compte")));
    await shot(page, "01-login");
    await page.getByText("Créer le premier compte").click();
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByLabel("E-mail").fill("alice@plantes.test");
    await page.getByLabel(/Mot de passe/).fill("motdepasse-1234");
    await page.getByLabel(/Clé d'installation/).fill("mauvaise-cle-12345");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByText("Clé d'installation invalide").waitFor();
  });

  it("avec la bonne clé : arrivée sur « Aujourd'hui », sans plante", async () => {
    await page.getByLabel(/Clé d'installation/).fill(KEY);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    assert.ok(await shown(page.getByText("Tu n'as pas encore de plante")), "invitation à ajouter une première plante");
    await shot(page, "02-home-vide");
  });

  it("pièces : création et renommage", async () => {
    await page.getByRole("link", { name: /Pièces/ }).click();
    await page.getByLabel("Nouvelle pièce").fill("Salon");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await page.getByText("0 plante").waitFor();
    await page.getByLabel("Nouvelle pièce").fill("Cuisine");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await page.getByText("Cuisine").waitFor();
    await page.getByRole("button", { name: "Renommer" }).first().click(); // tri par nom : Cuisine avant Salon
    await page.getByLabel("Nom", { exact: true }).fill("Cuisine ouverte");
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByText("Cuisine ouverte").waitFor();
    await shot(page, "03-pieces");
  });

  it("ajout d'une plante avec photo : aperçu, suivi de génération, fiche affichée sans recharger", async () => {
    await page.getByRole("link", { name: /Plantes/ }).click();
    await page.getByRole("link", { name: "+ Ajouter" }).click();
    await page.getByLabel("Nom", { exact: true }).fill("Ma Calathea");
    await page.getByLabel("Pièce").selectOption({ label: "Salon" });
    await page.locator('input[type="file"]').setInputFiles(await photoFile());
    await page.getByAltText("Aperçu").waitFor();
    await shot(page, "04-ajout");
    await page.getByRole("button", { name: "Ajouter la plante" }).click();
    await page.waitForURL(/\/plants\/[a-f0-9]+$/);
    assert.ok(await shown(page.getByText(/Claude prépare la fiche|en attente de génération/)), "suivi affiché pendant l'attente");
    await page.getByText("Photo reçue").waitFor({ timeout: 20_000 }); // la photo a été transmise à l'IA
    assert.ok(await imageLoaded(page, "img"), "photo principale chargée (route protégée)");
    await shot(page, "06-fiche");
  });

  it("modification de la fiche : valeur valide enregistrée, valeur invalide refusée avec un message", async () => {
    await page.getByRole("button", { name: /Modifier/ }).click();
    await page.getByLabel("Été (jours)").fill("3");
    await shot(page, "07-edition");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByText(/Tous les\s+3 jours/).waitFor();
    await page.getByRole("button", { name: /Modifier/ }).click();
    await page.getByLabel("Été (jours)").fill("0");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    assert.ok(await shown(page.getByText(/entre 1 et 60 jours/)), "message pour une valeur invalide");
    await page.locator("section", { hasText: "Modifier la fiche" }).getByRole("button", { name: "Annuler" }).click();
  });

  it("liste : vignette, filtre par pièce, régénération qui remplace la fiche modifiée", async () => {
    await page.getByRole("link", { name: /Plantes/ }).click();
    await page.getByText("Ma Calathea").waitFor();
    assert.ok(await imageLoaded(page, "ul img"), "vignette chargée");
    await page.getByRole("button", { name: /Salon · 1/ }).click();
    assert.ok(await shown(page.getByText("Ma Calathea")), "la plante est dans sa pièce");
    await page.getByRole("button", { name: /Cuisine ouverte · 0/ }).click();
    assert.ok(await gone(page.getByText("Ma Calathea")), "la plante n'est pas dans cette pièce");
    assert.ok(await shown(page.getByText("Aucune plante dans cette pièce")), "message pour une pièce vide");
    await shot(page, "08-liste");
    await page.getByRole("button", { name: "Toutes" }).click();
    await page.getByText("Ma Calathea").click();
    await page.getByRole("button", { name: /Régénérer/ }).click();
    await page.getByText(/Claude prépare la fiche|en attente de génération/).first().waitFor();
    await page.getByText(/Tous les\s+7 jours/).waitFor({ timeout: 20_000 });
  });

  it("suppression d'une plante", async () => {
    await page.getByRole("button", { name: "Supprimer cette plante" }).click();
    await page.getByText("Aucune plante pour l'instant").waitFor();
  });

  it("invitation : le lien nomme la personne qui invite, Bob crée son compte, le lien est à usage unique", async () => {
    await page.getByRole("link", { name: /Réglages/ }).click();
    await page.getByRole("button", { name: /Inviter quelqu'un/ }).click();
    inviteLink = await page.locator("input[readonly]").inputValue();
    assert.ok(inviteLink.startsWith(s.url + "/join/"));
    await shot(page, "09-reglages");

    ({ page: bob } = await newPage(browser, errors));
    await bob.goto(inviteLink);
    await bob.getByText(/t'invite à rejoindre/).waitFor();
    assert.ok(await shown(bob.getByText(/Alice t'invite/)), "nomme la personne qui invite");
    await shot(bob, "10-invitation");
    await bob.getByLabel("Prénom").fill("Bob");
    await bob.getByLabel("E-mail").fill("bob@plantes.test");
    await bob.getByLabel(/Mot de passe/).fill("motdepasse-5678");
    await bob.getByRole("button", { name: "Créer mon compte" }).click();
    await bob.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await bob.goto(inviteLink);
    await bob.getByText(/invalide, expirée ou déjà utilisée/).waitFor();
    await bob.goto(s.url + "/settings");
    await bob.getByText("Alice").first().waitFor();
    assert.ok(await shown(bob.getByText("Bob")), "Bob voit les deux membres du foyer");
  });

  it("passkey (authentificateur virtuel) : création, puis connexion sans mot de passe", async () => {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await page.goto(s.url + "/settings");
    await page.getByRole("button", { name: /Ajouter une passkey/ }).click();
    await page.getByText(/Ajoutée le/).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Déconnexion" }).click();
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: /passkey/ }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor({ timeout: 10_000 });
  });

  it("connexion par e-mail : mauvais mot de passe (message clair), puis le bon", async () => {
    await page.goto(s.url + "/settings");
    await page.getByRole("button", { name: "Déconnexion" }).click();
    await page.waitForURL("**/login");
    await page.getByLabel("E-mail").fill("alice@plantes.test");
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await page.getByText("E-mail ou mot de passe incorrect.").waitFor();
    await page.getByLabel("Mot de passe").fill("motdepasse-1234");
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
  });

  it("mot de passe oublié : lien généré pour Bob, nouveau mot de passe, session de Bob révoquée", async () => {
    await page.goto(s.url + "/settings");
    await page.getByRole("button", { name: "Mot de passe oublié" }).click();
    const resetLink = await page.locator("input[readonly]").first().inputValue();
    assert.ok(resetLink.startsWith(s.url + "/reset/"));
    const { page: p3 } = await newPage(browser, errors);
    await p3.goto(resetLink);
    await p3.getByLabel(/Nouveau mot de passe/).fill("nouveau-mdp-9999");
    await p3.getByRole("button", { name: "Enregistrer" }).click();
    await p3.getByText(/Mot de passe changé/).waitFor();
    await bob.goto(s.url + "/");
    await bob.waitForURL("**/login");
  });

  it("aucune erreur JavaScript ni violation de sécurité dans la console", () => {
    assert.deepEqual(errors, []);
  });
});
