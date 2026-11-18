import { Hono } from "hono";
import { getAiStatus } from "../ai-status.js";
import { requireMember, type AuthEnv } from "../session.js";

export const aiRoutes = new Hono<AuthEnv>();
aiRoutes.use("*", requireMember);

/** État de l'IA (jeton Claude) : ok ou problème, date d'expiration estimée, rôle de la personne. */
aiRoutes.get("/status", (c) => c.json(getAiStatus(c.get("user").id, new Date())));
