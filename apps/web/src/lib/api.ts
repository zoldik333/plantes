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
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined && { "content-type": "application/json" }), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(body.error ?? body.message ?? `Erreur ${res.status}`, res.status);
  return body as T;
}
