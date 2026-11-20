import { useSyncExternalStore } from "react";
import { refreshAll } from "./refresh";

/**
 * Hors connexion : état global (hors React) alimenté par `api()` (réponse servie du cache par le service worker,
 * ou échec réseau) et par les événements online/offline du navigateur. Repasse en ligne dès qu'une réponse
 * arrive du réseau ; l'événement « online » recharge alors les données affichées.
 */
let offline = typeof navigator !== "undefined" && navigator.onLine === false;
let updateReady = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Tant qu'on est hors ligne, on retente régulièrement (l'événement « online » manque parfois, ou une réponse tardive du cache arrive après lui). */
const RETRY_MS = 5000;
let retry: ReturnType<typeof setInterval> | undefined;

export function setOffline(value: boolean): void {
  if (offline === value) return;
  offline = value;
  clearInterval(retry);
  if (offline) retry = setInterval(() => void refreshAll(), RETRY_MS);
  emit();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const useOffline = () => useSyncExternalStore(subscribe, () => offline);
export const useUpdateReady = () => useSyncExternalStore(subscribe, () => updateReady);

/** Vide les caches privés (données, photos) : à la déconnexion et quand la session n'est plus valide. */
export async function clearOfflineData(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHES" });
    if ("caches" in window) {
      await Promise.all((await caches.keys()).filter((k) => k.startsWith("plantes-data") || k.startsWith("plantes-photos")).map((k) => caches.delete(k)));
    }
  } catch {
    /* sans cache disponible, rien à vider */
  }
}

/** Enregistre le service worker (production seulement : en développement, pas de cache qui masque les changements). */
export function registerServiceWorker(): void {
  window.addEventListener("offline", () => setOffline(true));
  window.addEventListener("online", () => {
    setOffline(false);
    void refreshAll();
  });
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  // Un nouveau SW qui prend la main alors qu'un ancien contrôlait la page = nouvelle version : on propose de recharger.
  // (Au tout premier chargement il n'y avait pas de contrôleur : rien à signaler.)
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) {
      updateReady = true;
      emit();
    }
    hadController = true;
  });
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      // Recherche d'une nouvelle version à chaque retour au premier plan (la PWA iOS reste ouverte des jours).
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg?.update().catch(() => {});
      });
    })
    .catch((err) => console.error("service worker", err));
}
