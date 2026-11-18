import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { ai } from "./ai/instance.js";
import { initAiStatus } from "./ai-status.js";
import { APP_URL, auth } from "./auth.js";
import { startQueue } from "./care-sheet-queue.js";
import { scheduleBackups } from "./db/backup.js";
import { DATA_DIR, db } from "./db/instance.js";
import { PushService } from "./push.js";
import { aiRoutes } from "./routes/ai.js";
import { accountRoutes } from "./routes/account.js";
import { photosRoutes, plantsRoutes } from "./routes/plants.js";
import { roomsRoutes } from "./routes/rooms.js";
import { todayRoutes } from "./routes/today.js";
import { sendReminderTest, startReminderScheduler } from "./reminders.js";
import { requireMember, type AuthEnv } from "./session.js";

const PORT = Number(process.env.PORT ?? 3000);
/** Sert uniquement à créer le tout premier compte (clé d'installation). */
const ACCESS_KEY = process.env.POC_ACCESS_KEY;
/** Build du front (apps/web/dist), relatif au dossier de travail apps/api. */
const WEB_DIR = process.env.WEB_DIR ?? "../web/dist";

if (!ACCESS_KEY || ACCESS_KEY.length < 12) {
  throw new Error("POC_ACCESS_KEY manquante ou trop courte (12 caractères minimum).");
}

scheduleBackups(db, DATA_DIR);
const push = new PushService(db);
initAiStatus(push);
startQueue();
startReminderScheduler(push);
const app = new Hono<AuthEnv>();

// En-têtes de sécurité sur toutes les réponses. Le front n'a ni script ni style en ligne, ni ressource externe :
// la politique CSP peut donc être stricte (blob: pour l'aperçu d'une photo choisie, avant envoi).
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: "max-age=31536000", // sans includeSubDomains : le domaine a d'autres usages possibles
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
    // Pas de Cross-Origin-Resource-Policy : iOS récupère le manifeste et les icônes hors d'une page web.
    crossOriginResourcePolicy: false,
  }),
);

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
app.route("/api/rooms", roomsRoutes);
app.route("/api/plants", plantsRoutes);
app.route("/api/photos", photosRoutes);
app.route("/api/today", todayRoutes);
app.route("/api/ai", aiRoutes);

app.get("/api/push/public-key", requireMember, (c) => c.json({ publicKey: push.publicKey }));

app.post("/api/push/subscribe", requireMember, async (c) => {
  const sub = await c.req.json();
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return c.json({ error: "Abonnement invalide" }, 400);
  }
  const total = await push.subscribe(sub, c.get("user").id);
  return c.json({ ok: true, total });
});

/** Notification de test avec un contenu quelconque, vers les seuls appareils de la personne connectée. */
app.post("/api/push/test", requireMember, async (c) => {
  const { delaySeconds = 10 } = await c.req.json().catch(() => ({}));
  const delay = Math.min(Math.max(Number(delaySeconds) || 0, 0), 120);
  const userId = c.get("user").id;
  setTimeout(() => {
    push
      .sendToUsers([userId], { title: "🌿 Notification de test", body: "Si tu lis ceci, les notifications fonctionnent.", url: "/" })
      .then((r) => console.log(`[push] test envoyé ${r.sent}/${r.total}`))
      .catch((err) => console.error("[push]", err));
  }, delay * 1000);
  return c.json({ ok: true, delaySeconds: delay });
});

/** Envoie tout de suite le vrai rappel d'arrosage, uniquement aux appareils de la personne connectée. */
app.post("/api/reminders/test", requireMember, async (c) => {
  const res = await sendReminderTest(push, c.get("user").id, c.get("householdId"));
  return c.json(res);
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
