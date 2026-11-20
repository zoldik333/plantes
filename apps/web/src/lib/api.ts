import { setOffline } from "./offline";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Appel à l'API de l'app (cookie de session inclus). Lève ApiError avec le message du serveur. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: { ...(json !== undefined && { "content-type": "application/json" }), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // Réseau injoignable (statut 0). Pas de file d'attente d'écriture : l'action échoue, l'utilisateur recommencera en ligne.
    setOffline(true);
    throw new ApiError("Pas de connexion : impossible pour l'instant, réessaie une fois en ligne.", 0);
  }
  // Réponse relue du cache par le service worker = on est hors ligne (ou le réseau est trop lent) ; sinon le réseau répond.
  setOffline(res.headers.get("x-from-cache") === "1");
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(body.error ?? body.message ?? `Erreur ${res.status}`, res.status);
  return body as T;
}
