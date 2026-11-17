import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { db } from "./db/instance.js";
import * as schema from "./db/schema.js";

/** URL publique de l'app (https://plantes.tvermorel.fr en prod). Le rpID des passkeys en découle. */
export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET manquante : `openssl rand -base64 32`.");
}

export const auth = betterAuth({
  baseURL: APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  // L'inscription publique est fermée côté Hono (voir routes/signup) : seule une invitation permet de créer un compte.
  emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  plugins: [passkey({ rpID: new URL(APP_URL).hostname, rpName: "Plantes", origin: APP_URL })],
  // Derrière Caddy : l'IP du client est dans X-Forwarded-For (limitation de débit de Better Auth).
  advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
});
