import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { jpeg } from "../helpers/fixtures.js";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);

export const chromePath = CANDIDATES.find((p) => existsSync(p));
export const WEB_DIST = resolve(import.meta.dirname, "../../apps/web/dist/index.html");

/** Raison pour laquelle les tests d'interface ne peuvent pas tourner (undefined = ils peuvent). */
export const cannotRun = !chromePath
  ? "Chrome introuvable (définir CHROME_PATH)"
  : !existsSync(WEB_DIST)
    ? "front non construit (pnpm --filter @plantes/web build)"
    : undefined;

/** Écran d'iPhone : c'est le format d'usage réel de l'application. */
export const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR" };

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: chromePath, headless: true });
}

/**
 * Ouvre une page qui accepte les boîtes de dialogue (confirmations) et recense les erreurs :
 * erreurs JavaScript, et tout ce que la console signale (dont les violations de la politique de sécurité CSP).
 */
export async function newPage(browser: Browser, errors: string[]): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(MOBILE);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/401|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("dialog", (d) => void d.accept());
  // UI_CPU_THROTTLE=4 : processeur du navigateur 4 fois plus lent, pour faire apparaître les courses dans les tests.
  const throttle = Number(process.env.UI_CPU_THROTTLE);
  if (throttle > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  return { ctx, page };
}

/** Captures d'écran facultatives (SHOTS_DIR=… pour les regarder). */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

export const photoFile = async () => ({ name: "plante.jpg", mimeType: "image/jpeg", buffer: await jpeg() });

const WAIT_MS = 10_000;

/**
 * Vrai dès que l'élément devient visible (attend jusqu'à 10 s). À utiliser à la place de `isVisible()`, qui répond
 * à l'instant même : juste après une navigation, les données n'ont pas encore été chargées (course, surtout en CI).
 */
export const shown = (loc: Locator, timeout = WAIT_MS): Promise<boolean> => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

/** Vrai dès que l'élément a disparu (ou n'existe pas). */
export const gone = (loc: Locator, timeout = WAIT_MS): Promise<boolean> => loc.first().waitFor({ state: "hidden", timeout }).then(() => true, () => false);

/** Vrai dès que le nombre d'éléments vaut `n` (attend jusqu'à 10 s). */
export async function countIs(loc: Locator, n: number, timeout = WAIT_MS): Promise<boolean> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await loc.count()) === n) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return (await loc.count()) === n;
}

/** Vrai dès qu'au moins une image correspondant au sélecteur est réellement chargée (largeur naturelle non nulle). */
export const imageLoaded = (page: Page, selector: string): Promise<boolean> =>
  page
    .waitForFunction((sel) => [...document.querySelectorAll<HTMLImageElement>(sel)].some((i) => i.naturalWidth > 0), selector, { timeout: WAIT_MS })
    .then(() => true, () => false);
