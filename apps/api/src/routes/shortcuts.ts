import { Hono } from "hono";
import type { AuthEnv } from "../session.js";

/** Socle : routeur vide, déjà monté dans server.ts. L'agent responsable le remplit (voir le plan de découpage). */
export const shortcutRoutes = new Hono<AuthEnv>();
