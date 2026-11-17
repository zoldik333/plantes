import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Jeton aléatoire (256 bits) à mettre dans un lien. Seul son hash est stocké en base. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(): string {
  return randomBytes(16).toString("hex");
}

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
