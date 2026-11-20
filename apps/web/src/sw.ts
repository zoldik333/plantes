// Service worker : coque de l'app précachée, données et photos déjà vues lisibles hors ligne, notifications push.
// Publié sous /sw.js (même URL et même portée « / » que l'ancien : les abonnements push de l'iPhone y sont liés).
import { cleanupOutdatedCaches, matchPrecache, precache } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };

const DATA_CACHE = "plantes-data-v1";
const PHOTO_CACHE = "plantes-photos-v1";
const NETWORK_TIMEOUT_MS = 3000;
const MAX_DATA_ENTRIES = 150;
const MAX_PHOTO_ENTRIES = 300;
const PHOTO_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
/** En-têtes ajoutés par ce SW : réponse servie depuis le cache (l'app affiche « Hors connexion »), date de mise en cache. */
const FROM_CACHE = "x-from-cache";
const CACHED_AT = "x-cached-at";

// ---- Mise à jour : un nouveau SW prend la main tout de suite (l'app propose alors de recharger) ----
precache(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ---- Confidentialité : les caches de données ne survivent ni à la déconnexion, ni à une session refusée, ni à un changement de compte ----
const clearPrivateCaches = () => Promise.all([caches.delete(DATA_CACHE), caches.delete(PHOTO_CACHE)]);

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_CACHES") event.waitUntil(clearPrivateCaches());
});

/** Réponse relue du cache, marquée comme telle. */
function marked(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set(FROM_CACHE, "1");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Ajoute la date de mise en cache, puis borne le nombre d'entrées (les plus anciennes partent d'abord). */
async function put(cacheName: string, request: Request, res: Response, max: number): Promise<void> {
  const headers = new Headers(res.headers);
  headers.set(CACHED_AT, String(Date.now()));
  const cache = await caches.open(cacheName);
  await cache.put(request, new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers }));
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | "timeout"> =>
  Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

/** Pas de session valide : plus rien de privé ne doit rester sur l'appareil. */
const isDenied = (res: Response) => res.status === 401 || res.status === 403;

/** Réseau d'abord (délai court), repli sur le cache ; la requête lente continue en tâche de fond et met le cache à jour. */
async function networkFirst(event: FetchEvent, cacheName: string, max: number, cacheable: (res: Response) => boolean): Promise<Response> {
  const { request } = event;
  const net = fetch(request).then(async (res) => {
    if (isDenied(res)) await clearPrivateCaches();
    else if (res.ok && cacheable(res)) await put(cacheName, request, res.clone(), max);
    return res;
  });
  event.waitUntil(net.catch(() => {}));
  try {
    const first = await withTimeout(net, NETWORK_TIMEOUT_MS);
    if (first !== "timeout") return first;
  } catch {
    /* hors ligne : repli ci-dessous */
  }
  const cached = await (await caches.open(cacheName)).match(request);
  if (cached) return marked(cached);
  return net; // rien en cache : on attend le réseau (ou l'erreur, que l'app présente en français)
}

/** Cache d'abord (photos : elles ne changent pas), borné en nombre et en âge. */
async function photoCacheFirst(event: FetchEvent): Promise<Response> {
  const { request } = event;
  const cache = await caches.open(PHOTO_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    const age = Date.now() - Number(cached.headers.get(CACHED_AT) ?? 0);
    if (age < PHOTO_MAX_AGE_MS) return cached;
    await cache.delete(request);
  }
  const res = await fetch(request);
  if (isDenied(res)) await clearPrivateCaches();
  else if (res.ok) event.waitUntil(put(PHOTO_CACHE, request, res.clone(), MAX_PHOTO_ENTRIES));
  return res;
}

/** Jamais en cache : authentification, abonnements push, rappels, routes publiques (état d'installation, jetons d'invitation). */
const NEVER_CACHE = /^\/api\/(auth|push|reminders|setup|invitations)(\/|$)/;
/** Réponses qui changent de compte ou de session : le cache privé est vidé une fois la réponse reçue. */
const ACCOUNT_CHANGE = /^\/api\/(auth\/(sign-in|sign-out|sign-up)|signup|reset)/;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method !== "GET") {
    // Les écritures ne sont jamais interceptées, sauf pour vider le cache quand le compte change.
    if (ACCOUNT_CHANGE.test(url.pathname)) {
      event.respondWith(fetch(request).then(async (res) => (await clearPrivateCaches(), res)));
    }
    return;
  }

  if (url.pathname.startsWith("/api/photos/")) {
    event.respondWith(photoCacheFirst(event));
  } else if (url.pathname.startsWith("/api/")) {
    if (NEVER_CACHE.test(url.pathname)) return;
    // Seulement du JSON : jamais un flux (chat en direct) ni autre chose.
    event.respondWith(networkFirst(event, DATA_CACHE, MAX_DATA_ENTRIES, (r) => (r.headers.get("content-type") ?? "").includes("application/json")));
  } else if (request.mode === "navigate") {
    // Page : réseau d'abord (jamais d'index.html périmé en ligne), repli sur la coque précachée.
    event.respondWith(
      (async () => {
        try {
          const res = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
          if (res !== "timeout") return res;
        } catch {
          /* hors ligne */
        }
        return (await matchPrecache("/index.html")) ?? fetch(request);
      })(),
    );
  } else {
    // Scripts, styles, polices, icônes de la coque : précache (noms hachés, donc jamais périmés).
    event.respondWith(matchPrecache(request).then((hit) => hit ?? fetch(request)));
  }
});

// ---- Notifications push (inchangé) ----
self.addEventListener("push", (event) => {
  let data = { title: "Plantes", body: "Notification", url: "/" };
  try {
    data = { ...data, ...event.data!.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  // iOS révoque l'abonnement si un push n'affiche pas de notification : on en affiche toujours une.
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => new URL(w.url).pathname === url);
      return existing ? existing.focus() : self.clients.openWindow(url);
    }),
  );
});
