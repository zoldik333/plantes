import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { AiProviderError, createAiProvider, type ImageMediaType } from "./ai/index.js";
import { APP_URL, auth } from "./auth.js";
import { scheduleBackups } from "./db/backup.js";
import { DATA_DIR, db } from "./db/instance.js";
import { PushService } from "./push.js";
import { accountRoutes } from "./routes/account.js";
import { requireMember, type AuthEnv } from "./session.js";

const PORT = Number(process.env.PORT ?? 3000);
/** Sert uniquement à créer le tout premier compte (clé d'installation). */
const ACCESS_KEY = process.env.POC_ACCESS_KEY;
/** Build du front (apps/web/dist), relatif au dossier de travail apps/api. */
const WEB_DIR = process.env.WEB_DIR ?? "../web/dist";
const MAX_PHOTO_BYTES = 3.5 * 1024 * 1024;

if (!ACCESS_KEY || ACCESS_KEY.length < 12) {
  throw new Error("POC_ACCESS_KEY manquante ou trop courte (12 caractères minimum).");
}

const ai = createAiProvider();
scheduleBackups(db, DATA_DIR);
const push = new PushService(db, `${DATA_DIR}/subscriptions.json`);
const app = new Hono<AuthEnv>();

// Les requêtes qui modifient des données doivent venir de notre propre origine (défense CSRF en plus de SameSite).
const appOrigin = new URL(APP_URL).origin;
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && origin && origin !== appOrigin) {
    return c.json({ error: "Origine refusée" }, 403);
  }
  await next();
});

// Better Auth : l'inscription passe uniquement par /api/signup (invitation obligatoire).
app.all("/api/auth/sign-up/*", (c) => c.json({ error: "Inscription sur invitation uniquement" }, 404));
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api", accountRoutes(ACCESS_KEY));

app.get("/api/push/public-key", requireMember, (c) => c.json({ publicKey: push.publicKey }));

app.post("/api/push/subscribe", requireMember, async (c) => {
  const sub = await c.req.json();
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return c.json({ error: "Abonnement invalide" }, 400);
  }
  const total = await push.subscribe(sub, c.get("user").id);
  return c.json({ ok: true, total });
});

app.post("/api/push/test", requireMember, async (c) => {
  const { delaySeconds = 10 } = await c.req.json().catch(() => ({}));
  const delay = Math.min(Math.max(Number(delaySeconds) || 0, 0), 120);
  setTimeout(() => {
    push
      .sendToAll({
        title: "💧 3 plantes à arroser",
        body: "Calathea, Asparagus, Begonia — test de notification",
        url: "/",
      })
      .then((r) => console.log(`[push] envoyé ${r.sent}/${r.total}`))
      .catch((err) => console.error("[push]", err));
  }, delay * 1000);
  return c.json({ ok: true, delaySeconds: delay });
});

app.post("/api/care-sheet", requireMember, async (c) => {
  const body = await c.req.parseBody();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const photo = body.photo instanceof File && body.photo.size > 0 ? body.photo : undefined;
  if (!name) return c.json({ error: "Nom de plante manquant" }, 400);
  if (photo) {
    if (photo.size > MAX_PHOTO_BYTES) return c.json({ error: "Photo trop lourde (max 3,5 Mo)" }, 413);
    const allowed: ImageMediaType[] = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(photo.type as ImageMediaType)) {
      return c.json({ error: `Format non pris en charge : ${photo.type}` }, 415);
    }
  }

  try {
    const result = await ai.generateCareSheet({
      plantName: name,
      photo: photo && { data: Buffer.from(await photo.arrayBuffer()), mediaType: photo.type as ImageMediaType },
    });
    console.log(`[ai] fiche « ${name} » en ${result.durationMs} ms`);
    return c.json(result);
  } catch (err) {
    console.error("[ai]", err);
    const details = err instanceof AiProviderError ? err.details : undefined;
    return c.json({ error: (err as Error).message, details }, 502);
  }
});

app.get("/health", (c) => c.json({ ok: true, ai: ai.name }));

// Une route /api inconnue ne doit pas tomber sur la page d'accueil du front.
app.all("/api/*", (c) => c.json({ error: "Introuvable" }, 404));

// Front : fichiers de build (assets au nom haché → cache long), index.html jamais mis en cache
// (la PWA iOS garderait sinon d'anciennes versions). Repli sur index.html pour les routes du front.
app.use("/*", async (c, next) => {
  await next();
  c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
});
app.use("/*", serveStatic({ root: WEB_DIR }));
app.get("*", serveStatic({ root: WEB_DIR, path: "index.html" }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Plantes prêt sur http://localhost:${info.port} (IA : ${ai.name})`);
});
