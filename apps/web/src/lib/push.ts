import { api } from "./api";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Demande la permission, abonne cet appareil et enregistre l'abonnement. Renvoie le nombre d'appareils abonnés. */
export async function enablePush(): Promise<number> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Notifications indisponibles ici. Sur iPhone : ouvre l'app depuis l'écran d'accueil (iOS 16.4 minimum).");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(`Permission refusée (${permission}). Réglages, Notifications, Plantes.`);
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>("/api/push/public-key");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  const { total } = await api<{ total: number }>("/api/push/subscribe", { method: "POST", json: sub.toJSON() });
  return total;
}

export const sendTestPush = () => api("/api/push/test", { method: "POST", json: { delaySeconds: 10 } });
