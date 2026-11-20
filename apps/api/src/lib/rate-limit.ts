import type { Context, MiddlewareHandler } from "hono";

/**
 * IPv6 : 8 groupes de 16 bits. Retourne null si l'adresse est invalide.
 * Gère « :: » et la forme IPv4 incorporée (::ffff:1.2.3.4).
 */
function parseIpv6(s: string): number[] | null {
  let addr = s;
  const v4 = addr.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = [v4[2], v4[3], v4[4], v4[5]].map(Number);
    if (o.some((n) => n > 255)) return null;
    addr = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;
  const groups = [...head, ...Array(halves.length === 2 ? 8 - head.length - tail.length : 0).fill("0"), ...tail];
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return out.length === 8 && out.every((n) => !Number.isNaN(n)) ? out : null;
}

/**
 * Clé de limitation d'une adresse : IPv4 telle quelle, IPv4-mappée (::ffff:a.b.c.d) ramenée en IPv4,
 * IPv6 regroupée par préfixe /64 (une machine en possède 2^64 : par adresse, la limite serait contournable).
 * Adresse absente → « local » ; adresse illisible → un seau commun « invalid » (mémoire bornée).
 */
export function normalizeIp(raw: string | null | undefined): string {
  let ip = (raw ?? "").trim().toLowerCase();
  if (!ip) return "local";
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]")); // [::1]:1234
  ip = ip.split("%")[0]; // zone IPv6 (fe80::1%en0)
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/);
  if (v4) return v4.slice(1, 5).every((n) => Number(n) <= 255) ? v4.slice(1, 5).map(Number).join(".") : "invalid";
  const g = ip.includes(":") ? parseIpv6(ip) : null;
  if (!g) return "invalid";
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  return `v6:${g.slice(0, 4).map((n) => n.toString(16)).join(":")}::/64`;
}

/**
 * IP du client. Confiance dans X-Forwarded-For : en production, tout le trafic passe par Caddy, qui REMPLACE
 * l'en-tête par l'adresse réelle du client (comportement par défaut de `reverse_proxy` pour un client non
 * approuvé) ; le port 3000 de l'app n'est publié que sur 127.0.0.1. On prend donc la première valeur.
 * Si l'app devenait joignable sans Caddy, cet en-tête serait falsifiable et les limites contournables.
 */
export function clientIp(headers: Headers): string {
  return normalizeIp(headers.get("x-forwarded-for")?.split(",")[0]);
}

export interface HitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Secondes avant la fin de la fenêtre (au moins 1). */
  retryAfter: number;
}

/** Plafond du nombre de clés suivies par seau : un balayage d'adresses ne peut pas faire grossir la mémoire. */
const MAX_KEYS = 5000;
const SWEEP_MS = 60_000;

const registry = new Set<Limiter>();
let sweeper: NodeJS.Timeout | undefined;

/** Un seul minuteur pour tous les seaux ; unref() : il n'empêche jamais l'arrêt du process. */
function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    for (const l of registry) l.sweep();
  }, SWEEP_MS);
  sweeper.unref();
}

/** Compteur à fenêtre fixe par clé (O(1) en mémoire par clé, Retry-After exact). Horloge injectable pour les tests. */
export class Limiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();
  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    registry.add(this);
    ensureSweeper();
  }

  get size(): number {
    return this.hits.size;
  }

  hit(key: string): HitResult {
    const now = this.now();
    let h = this.hits.get(key);
    if (!h || h.reset <= now) {
      if (!h && this.hits.size >= MAX_KEYS) {
        this.sweep();
        // Toujours plein de fenêtres actives : on évince la plus ancienne (Map = ordre d'insertion).
        if (this.hits.size >= MAX_KEYS) this.hits.delete(this.hits.keys().next().value!);
      }
      this.hits.delete(key); // réinsérée en fin : l'ordre reste celui des débuts de fenêtre
      h = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, h);
    }
    const retryAfter = Math.max(1, Math.ceil((h.reset - now) / 1000));
    if (h.count >= this.max) return { ok: false, limit: this.max, remaining: 0, retryAfter };
    h.count++;
    return { ok: true, limit: this.max, remaining: this.max - h.count, retryAfter };
  }

  /** Supprime les fenêtres expirées. */
  sweep(): void {
    const now = this.now();
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}

export interface RateLimitOptions {
  /** Clé de seau ; défaut : IP du client (IPv6 en /64). */
  key?: (c: Context) => string;
  /** Message d'erreur du 429 (français). */
  message?: string;
  /** Horloge (tests). */
  now?: () => number;
}

/** Entier lu dans l'environnement ; valeur absente, invalide ou hors bornes → défaut (jamais dangereux). */
export function envInt(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return def;
  const n = Number(raw);
  return n >= min && n <= max ? n : def;
}

/**
 * Middleware : limite de débit en mémoire (par IP par défaut).
 * Réponse 429 : `{ error }` + Retry-After ; RateLimit-Limit / -Remaining / -Reset sur toutes les réponses.
 */
export function rateLimit(max: number, windowMs: number, opts: RateLimitOptions = {}): MiddlewareHandler {
  const limiter = new Limiter(max, windowMs, opts.now);
  const message = opts.message ?? "Trop de tentatives, réessaie dans quelques minutes.";
  return async (c, next) => {
    const r = limiter.hit(opts.key ? opts.key(c) : clientIp(c.req.raw.headers));
    c.header("RateLimit-Limit", String(r.limit));
    c.header("RateLimit-Remaining", String(r.remaining));
    c.header("RateLimit-Reset", String(r.retryAfter));
    if (!r.ok) {
      c.header("Retry-After", String(r.retryAfter));
      return c.json({ error: message }, 429);
    }
    await next();
  };
}
