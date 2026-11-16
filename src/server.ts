import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { AiProviderError, createAiProvider, type ImageMediaType } from "./ai/index.js";
import { PushService } from "./push.js";

const PORT = Number(process.env.PORT ?? 3000);
const ACCESS_KEY = process.env.POC_ACCESS_KEY;
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const MAX_PHOTO_BYTES = 3.5 * 1024 * 1024;

if (!ACCESS_KEY || ACCESS_KEY.length < 12) {
  throw new Error("POC_ACCESS_KEY manquante ou trop courte (12 caractères minimum).");
}

const ai = createAiProvider();
const push = new PushService(`${DATA_DIR}/subscriptions.json`);
const app = new Hono();

// L'URL du tunnel est publique : on protège l'API par une clé partagée.
app.use("/api/*", async (c, next) => {
  if (c.req.header("x-access-key") !== ACCESS_KEY) return c.json({ error: "Clé d'accès invalide" }, 401);
  await next();
});

app.get("/api/push/public-key", (c) => c.json({ publicKey: push.publicKey }));

app.post("/api/push/subscribe", async (c) => {
  const sub = await c.req.json();
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return c.json({ error: "Abonnement invalide" }, 400);
  }
  const total = await push.subscribe(sub);
  return c.json({ ok: true, total });
});

app.post("/api/push/test", async (c) => {
  const { delaySeconds = 10 } = await c.req.json().catch(() => ({}));
  const delay = Math.min(Math.max(Number(delaySeconds) || 0, 0), 120);
  setTimeout(() => {
    push
      .sendToAll({
        title: "💧 3 plantes à arroser",
        body: "Calathea, Asparagus, Begonia — test de notification du POC",
        url: "/",
      })
      .then((r) => console.log(`[push] envoyé ${r.sent}/${r.total}`))
      .catch((err) => console.error("[push]", err));
  }, delay * 1000);
  return c.json({ ok: true, delaySeconds: delay });
});

app.post("/api/care-sheet", async (c) => {
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

// Pas de cache navigateur : la PWA iOS garderait sinon d'anciennes versions des fichiers.
app.use("/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-cache");
});
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`POC plantes prêt sur http://localhost:${info.port} (IA : ${ai.name})`);
});
