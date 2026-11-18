// « Tirer pour actualiser » et rafraîchissement du foyer : deux comptes dans deux navigateurs, gestes tactiles réels.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Locator, Page } from "playwright-core";
import { KEY, TestServer } from "../helpers/server.js";
import { cannotRun, countIs, gone, launch, newPage, shot, shown } from "./helpers.js";

type Pt = { x: number; y: number };

/** Glissement tactile (vrais événements touchstart/touchmove/touchend, comme un doigt sur l'écran). */
async function swipe(page: Page, from: Pt, to: Pt, steps = 14): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const pullDown = (page: Page, x = 195, y = 160, dy = 260) => swipe(page, { x, y }, { x, y: y + dy });
const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

describe("interface : tirer pour actualiser et foyer à jour", { skip: cannotRun }, () => {
  let s: TestServer;
  let browser: Browser;
  let alice: Page;
  const errors: string[] = [];
  const hits = { me: 0, rooms: 0 };
  const members = (p: Page) => p.locator("section", { hasText: "Mon foyer" }).locator("li");
  const join = async (name: string, email: string, link: string): Promise<Page> => {
    const { page } = await newPage(browser, errors);
    await page.goto(link);
    await page.getByLabel("Prénom").fill(name);
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel(/Mot de passe/).fill("motdepasse-5678");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    return page;
  };
  /** Crée une invitation et renvoie son lien. Attend que le lien affiché CHANGE : juste après le clic, l'ancien est encore à l'écran. */
  const inviteLink = async (): Promise<string> => {
    const field = alice.locator("input[readonly]").last();
    const before = (await field.count()) ? await field.inputValue() : "";
    await alice.getByRole("button", { name: /Inviter quelqu'un/ }).click();
    await alice.waitForFunction((old) => {
      const inputs = [...document.querySelectorAll<HTMLInputElement>("input[readonly]")];
      const last = inputs[inputs.length - 1];
      return !!last && last.value !== old && last.value.includes("/join/");
    }, before);
    return field.inputValue();
  };

  before(async () => {
    s = await TestServer.start();
    browser = await launch();
    ({ page: alice } = await newPage(browser, errors));
    alice.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (p === "/api/me") hits.me++;
      if (p === "/api/rooms") hits.rooms++;
    });
    await alice.goto(s.url + "/setup");
    await alice.getByLabel("Prénom").fill("Alice");
    await alice.getByLabel("E-mail").fill("alice@plantes.test");
    await alice.getByLabel(/Mot de passe/).fill("motdepasse-1234");
    await alice.getByLabel(/Clé d'installation/).fill(KEY);
    await alice.getByRole("button", { name: "Créer mon compte" }).click();
    await alice.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await alice.goto(s.url + "/settings");
    await shown(members(alice).first());
  });
  after(async () => {
    await browser?.close();
    await s?.cleanup();
  });

  it("au départ, le foyer ne contient qu'Alice", async () => {
    assert.ok(await countIs(members(alice), 1));
  });

  it("tirer vers le bas : le nouveau membre apparaît sans relancer l'application", async () => {
    const link = await inviteLink();
    await join("Bob", "bob@plantes.test", link);
    await pullDown(alice);
    assert.ok(await shown(alice.getByText("Actualisation…")), "l'indicateur s'affiche pendant le rechargement");
    assert.ok(await countIs(members(alice), 2), "Bob est dans « Mon foyer »");
    assert.ok(await shown(members(alice).filter({ hasText: "Bob" })));
    assert.ok(await gone(alice.getByText("Actualisation…")), "l'indicateur disparaît ensuite");
    await shot(alice, "30-foyer-actualise");
  });

  it("des gestes qui ne sont PAS « tirer pour actualiser » ne rechargent rien", async () => {
    await settle();
    hits.me = 0;
    await swipe(alice, { x: 195, y: 160 }, { x: 195, y: 200 }); // trop court (80 px de doigt = 40 affichés)
    await swipe(alice, { x: 100, y: 160 }, { x: 330, y: 260 }); // plutôt horizontal
    await swipe(alice, { x: 195, y: 400 }, { x: 195, y: 160 }); // vers le haut
    await settle();
    assert.equal(hits.me, 0, "aucune requête : ni geste court, ni horizontal, ni vers le haut");
  });

  it("page défilée : tirer ne recharge pas (on fait défiler, c'est tout)", async () => {
    await alice.evaluate(() => window.scrollTo(0, 400));
    assert.ok((await alice.evaluate(() => window.scrollY)) > 0, "la page est bien défilée");
    hits.me = 0;
    await pullDown(alice);
    await settle();
    assert.equal(hits.me, 0);
    await alice.evaluate(() => window.scrollTo(0, 0));
  });

  it("depuis un champ de saisie : pas d'actualisation", async () => {
    await alice.goto(s.url + "/rooms");
    const field: Locator = alice.getByLabel("Nouvelle pièce");
    await shown(field);
    const box = (await field.boundingBox())!;
    await settle();
    hits.rooms = 0;
    await pullDown(alice, box.x + box.width / 2, box.y + box.height / 2);
    await settle();
    assert.equal(hits.rooms, 0);
  });

  it("témoin positif : le même geste depuis le haut, hors champ, recharge bien (le compteur fonctionne)", async () => {
    await alice.goto(s.url + "/rooms");
    await shown(alice.getByLabel("Nouvelle pièce"));
    await settle();
    hits.rooms = 0;
    await pullDown(alice, 195, 60);
    await settle();
    assert.ok(hits.rooms >= 1, `la liste des pièces a été rechargée (${hits.rooms} requête)`);
  });

  it("revenir au premier plan relit le foyer, sans geste", async () => {
    await alice.goto(s.url + "/settings");
    assert.ok(await countIs(members(alice), 2));
    const link = await inviteLink();
    await join("Camille", "camille@plantes.test", link);
    await alice.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    assert.ok(await countIs(members(alice), 3), "Camille apparaît");
  });

  it("l'app ouverte relit seule le foyer toutes les 30 secondes", async () => {
    const { page: p } = await newPage(browser, errors);
    await p.clock.install();
    await p.goto(s.url + "/login");
    await p.getByLabel("E-mail").fill("alice@plantes.test");
    await p.getByLabel("Mot de passe").fill("motdepasse-1234");
    await p.getByRole("button", { name: "Se connecter", exact: true }).click();
    await p.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
    await p.goto(s.url + "/settings");
    assert.ok(await countIs(members(p), 3));
    const link = await inviteLink(); // nouvelle invitation depuis la première page
    await join("Dominique", "dominique@plantes.test", link);
    await p.clock.runFor(31_000);
    assert.ok(await countIs(members(p), 4), "Dominique apparaît sans aucune action");
  });

  it("aucune erreur JavaScript ni violation de sécurité dans la console", () => {
    assert.deepEqual(errors, []);
  });
});
