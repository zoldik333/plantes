import type { MiddlewareHandler } from "hono";

/** IP du client : Caddy remplace X-Forwarded-For par l'IP réelle, on prend donc la première valeur. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** Limiteur en mémoire (fenêtre fixe, par IP) pour les routes publiques sensibles. */
export function rateLimit(max: number, windowMs: number): MiddlewareHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    const now = Date.now();
    const ip = clientIp(c.req.raw.headers);
    let h = hits.get(ip);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(ip, h);
    }
    h.count++;
    if (hits.size > 1000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    if (h.count > max) {
      c.header("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return c.json({ error: "Trop de tentatives, réessaie dans quelques minutes." }, 429);
    }
    await next();
  };
}
