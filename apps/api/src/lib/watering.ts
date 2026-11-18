import { and, eq, max, sql } from "drizzle-orm";
import type { WaterStatus } from "@plantes/shared";
import { db } from "../db/instance.js";
import { careEvents, plants } from "../db/schema.js";
import { addDays, diffDays, parisDate, seasonOf } from "./time.js";

/** « Encore humide » repousse le rappel d'un quart de l'intervalle : au moins 2 jours, au plus 7. */
export const postponeDays = (intervalDays: number) => Math.min(7, Math.max(2, Math.ceil(intervalDays / 4)));

interface WaterInput {
  createdAt: Date;
  lastWateredAt: Date | null;
  lastStillWetAt: Date | null;
  summerDays: number;
  winterDays: number;
}

/**
 * Calcul pur de l'état d'arrosage. Rien n'est stocké : tout vient du journal, donc annuler une action
 * (la supprimer du journal) recalcule un état cohérent, et tous les membres voient la même chose.
 * Une plante jamais arrosée compte depuis sa création.
 */
export function computeWater(input: WaterInput, now: Date): WaterStatus {
  const today = parisDate(now);
  const intervalDays = seasonOf(today) === "summer" ? input.summerDays : input.winterDays;
  let dueDate = addDays(parisDate(input.lastWateredAt ?? input.createdAt), intervalDays);
  let snoozed = false;

  const wet = input.lastStillWetAt;
  // Seul un « encore humide » postérieur au dernier arrosage compte.
  if (wet && (!input.lastWateredAt || wet > input.lastWateredAt)) {
    const until = addDays(parisDate(wet), postponeDays(intervalDays));
    if (until > dueDate) {
      dueDate = until;
      snoozed = true;
    }
  }
  return { intervalDays, lastWateredAt: input.lastWateredAt?.toISOString() ?? null, dueDate, daysUntil: diffDays(today, dueDate), snoozed };
}

const toDate = (v: unknown): Date | null => (v == null ? null : new Date(Number(v)));

/** État d'arrosage de toutes les plantes d'un foyer qui ont une fiche (sans fiche : pas d'intervalle, pas de rappel). */
export function waterStatuses(householdId: string, now = new Date()): Map<string, WaterStatus> {
  const rows = db
    .select({
      id: plants.id,
      createdAt: plants.createdAt,
      summer: sql<number | null>`json_extract(${plants.careSheet}, '$.watering.intervalDaysSummer')`,
      winter: sql<number | null>`json_extract(${plants.careSheet}, '$.watering.intervalDaysWinter')`,
    })
    .from(plants)
    .where(eq(plants.householdId, householdId))
    .all();

  const lastOf = (type: "watered" | "still_wet") =>
    new Map(
      db
        .select({ plantId: careEvents.plantId, at: max(careEvents.createdAt) })
        .from(careEvents)
        .where(and(eq(careEvents.householdId, householdId), eq(careEvents.type, type)))
        .groupBy(careEvents.plantId)
        .all()
        .map((r) => [r.plantId, toDate(r.at)] as const),
    );
  const watered = lastOf("watered");
  const stillWet = lastOf("still_wet");

  const out = new Map<string, WaterStatus>();
  for (const r of rows) {
    if (r.summer == null || r.winter == null) continue;
    out.set(
      r.id,
      computeWater(
        { createdAt: r.createdAt, lastWateredAt: watered.get(r.id) ?? null, lastStillWetAt: stillWet.get(r.id) ?? null, summerDays: r.summer, winterDays: r.winter },
        now,
      ),
    );
  }
  return out;
}
