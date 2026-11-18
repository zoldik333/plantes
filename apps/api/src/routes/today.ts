import { Hono } from "hono";
import type { TodayResponse } from "@plantes/shared";
import { parisDate } from "../lib/time.js";
import { requireMember, type AuthEnv } from "../session.js";
import { listSummaries } from "./plants.js";

export const todayRoutes = new Hono<AuthEnv>();
todayRoutes.use("*", requireMember);

/** Page d'accueil : ce qu'il y a à arroser aujourd'hui, et ce qui arrive. */
todayRoutes.get("/", (c) => {
  const now = new Date();
  const all = listSummaries(c.get("householdId"), now);
  const byDue = (a: { water: { daysUntil: number } | null }, b: { water: { daysUntil: number } | null }) => (a.water?.daysUntil ?? 0) - (b.water?.daysUntil ?? 0);
  const body: TodayResponse = {
    date: parisDate(now),
    due: all.filter((p) => p.water && p.water.daysUntil <= 0).sort(byDue),
    upcoming: all.filter((p) => p.water && p.water.daysUntil >= 1 && p.water.daysUntil <= 7).sort(byDue),
    withoutSheet: all.filter((p) => !p.hasSheet).length,
  };
  return c.json(body);
});
