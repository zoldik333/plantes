import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
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
