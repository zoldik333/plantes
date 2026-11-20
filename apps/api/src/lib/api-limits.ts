import type { MiddlewareHandler } from "hono";
import { envInt, rateLimit } from "./rate-limit.js";

const MIN = 60_000;
const TEN_MIN = 10 * MIN;

/**
 * Plafonds par IP (valeurs par défaut généreuses pour un foyer de 2-3 personnes : l'app sonde toutes les 3-4 s
 * pendant une génération et toutes les 30 s, soit ~20 requêtes/min par appareil ; une liste de 300 plantes
 * charge ~300 vignettes d'un coup). Surchargeables par l'environnement (tests) ; valeur invalide = défaut.
 *  - RATE_LIMIT_GLOBAL_MAX / RATE_LIMIT_GLOBAL_WINDOW_MS : tout /api sauf les images (défaut 600 par minute)
 *  - RATE_LIMIT_AUTH_MAX / RATE_LIMIT_AUTH_WINDOW_MS : écritures /api/auth/* (défaut 30 par 10 min)
 */
const globalLimit = rateLimit(envInt("RATE_LIMIT_GLOBAL_MAX", 600, 1, 1_000_000), envInt("RATE_LIMIT_GLOBAL_WINDOW_MS", MIN, 100, 3_600_000), {
  message: "Trop de requêtes, réessaie dans un instant.",
});

/** Lecture des images (session obligatoire, cache privé) : seau à part, sinon une grande liste épuiserait le global. */
const imagesLimit = rateLimit(3000, MIN, { message: "Trop de requêtes, réessaie dans un instant." });

/** Connexion (mot de passe, passkey) : anti force brute. Complète le limiteur intégré de Better Auth (3 requêtes / 10 s
 *  sur la connexion, actif en production) : les deux se cumulent sans se contredire, celui-ci est plus lâche mais plus long. */
const authLimit = rateLimit(envInt("RATE_LIMIT_AUTH_MAX", 30, 1, 100_000), envInt("RATE_LIMIT_AUTH_WINDOW_MS", TEN_MIN, 100, 86_400_000), {
  message: "Trop de tentatives de connexion, réessaie dans quelques minutes.",
});

/** Envoi de photo (sharp, disque) et génération de fiche (abonnement IA) : coûteux. */
const uploadLimit = rateLimit(60, TEN_MIN, { message: "Trop de photos envoyées, réessaie dans quelques minutes." });
const careSheetLimit = rateLimit(30, TEN_MIN, { message: "Trop de générations de fiche, réessaie dans quelques minutes." });

/*
 * Déjà limités ailleurs, non dédoublés ici : /api/signup, /api/reset-password, /api/invitations/:token (routes/account.ts).
 * Hors de ce middleware par construction : /health et les fichiers statiques du front (montés hors de /api).
 */

/** À monter sur `/api/*` : global (sauf images) + seaux stricts selon la route. */
export const apiRateLimits: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;
  const method = c.req.method;
  const isImage = method === "GET" && path.startsWith("/api/photos/");
  const chain: MiddlewareHandler[] = [isImage ? imagesLimit : globalLimit];
  if (method === "POST") {
    if (path.startsWith("/api/auth/") && path !== "/api/auth/sign-out") chain.push(authLimit);
    else if (/^\/api\/plants\/[^/]+\/photos$/.test(path)) chain.push(uploadLimit);
    else if (/^\/api\/plants\/[^/]+\/care-sheet$/.test(path)) chain.push(careSheetLimit);
  }
  // Chaque seau est un middleware : on les enchaîne avec un `next` neutre ; le premier qui répond (429) gagne.
  for (const mw of chain) {
    const res = await mw(c, async () => {});
    if (res) return res;
  }
  await next();
};
