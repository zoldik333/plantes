import { z } from "zod";

export const ApiTokenInput = z.object({
  name: z.string().trim().min(1, "Donne un nom au jeton").max(40),
});
export type ApiTokenInput = z.infer<typeof ApiTokenInput>;

export interface ApiTokenSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Réponse à la création : `token` n'est montré qu'une fois (seul son hash est stocké). */
export interface ApiTokenCreated extends ApiTokenSummary {
  token: string;
}

/** Plante telle que la voit le raccourci : liste simple, sans photo. */
export interface ShortcutPlant {
  id: string;
  name: string;
  room: string | null;
}

export interface ShortcutDuePlant extends ShortcutPlant {
  /** Jours de retard (0 = à arroser aujourd'hui). */
  daysLate: number;
}

export interface ShortcutUpcomingPlant extends ShortcutPlant {
  daysUntil: number;
}

/** Réponse de GET /api/shortcuts/today. `text` est prêt à être lu par Siri. */
export interface ShortcutToday {
  date: string;
  text: string;
  due: ShortcutDuePlant[];
  upcoming: ShortcutUpcomingPlant[];
}

/**
 * Corps de POST /api/shortcuts/water : exactement un de `plant` (nom ou id), `plants` (liste) ou `all: "due"`
 * (toutes les plantes à arroser aujourd'hui ou en retard). `daysAgo` date l'arrosage dans le passé (0 à 60).
 */
export const ShortcutWaterInput = z
  .object({
    plant: z.string().trim().min(1).max(200).optional(),
    plants: z.array(z.string().trim().min(1).max(200)).min(1).max(20).optional(),
    all: z.literal("due").optional(),
    daysAgo: z.number().int().min(0).max(60).optional(),
  })
  .refine((b) => [b.plant, b.plants, b.all].filter((v) => v !== undefined).length === 1, {
    message: "Indique une seule de ces clés : plant, plants ou all",
  });
export type ShortcutWaterInput = z.infer<typeof ShortcutWaterInput>;

export interface ShortcutWaterResponse {
  watered: { id: string; name: string; nextInDays: number | null }[];
  text: string;
}
