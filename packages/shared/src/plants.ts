import { z } from "zod";
import { CareSheet } from "./care-sheet.js";

export const RoomInput = z.object({
  name: z.string().trim().min(1, "Donne un nom à la pièce").max(40),
});
export type RoomInput = z.infer<typeof RoomInput>;

export const PlantInput = z.object({
  name: z.string().trim().min(1, "Donne un nom à la plante").max(80),
  /** Pièce du foyer ; absent ou null = pas de pièce. */
  roomId: z.string().max(64).nullable().optional(),
  careSheet: CareSheet.nullable().optional(),
});
export type PlantInput = z.infer<typeof PlantInput>;

/** Mise à jour partielle : seuls les champs présents sont modifiés. */
export const PlantUpdate = PlantInput.partial();
export type PlantUpdate = z.infer<typeof PlantUpdate>;

export interface Room {
  id: string;
  name: string;
  plantCount: number;
}

export const CARE_EVENT_TYPES = ["watered", "still_wet", "fertilized", "repotted", "note"] as const;
export type CareEventType = (typeof CARE_EVENT_TYPES)[number];

/**
 * Une action du journal d'entretien. La note n'est obligatoire que pour le type « note ».
 * `daysAgo` date un arrosage passé (oublié, ou antérieur à l'ajout de la plante) : 0 à 60 jours.
 */
export const EventInput = z
  .object({
    type: z.enum(CARE_EVENT_TYPES),
    note: z.string().trim().max(500).optional(),
    daysAgo: z.number().int().min(0).max(60).optional(),
  })
  .refine((e) => e.type !== "note" || !!e.note, { message: "Écris ta note", path: ["note"] })
  .refine((e) => e.daysAgo === undefined || e.type === "watered", { message: "Seul un arrosage peut être daté dans le passé", path: ["daysAgo"] });
export type EventInput = z.infer<typeof EventInput>;

export interface CareEvent {
  id: string;
  type: CareEventType;
  note: string | null;
  /** Prénom de la personne ; null si son compte a été supprimé. */
  userName: string | null;
  createdAt: string;
}

/** Où en est l'arrosage d'une plante (calculé à partir du journal, jamais stocké). */
export interface WaterStatus {
  /** Intervalle de la saison en cours (jours). */
  intervalDays: number;
  lastWateredAt: string | null;
  /** Jour prévu, au format AAAA-MM-JJ (fuseau Europe/Paris). */
  dueDate: string;
  /** Négatif ou nul : à arroser (en retard si négatif). */
  daysUntil: number;
  /** Repoussé par « encore humide ». */
  snoozed: boolean;
}

export type SheetJobStatus = "pending" | "running" | "error";

/** Génération de fiche par l'IA, rattachée à une plante. Absente quand rien n'est en cours. */
export interface SheetJob {
  status: SheetJobStatus;
  /** Message affiché si la génération a échoué. */
  error: string | null;
  /** En attente : nombre de générations (de tout le serveur) qui passent avant celle-ci. */
  ahead: number;
}

export interface PlantSummary {
  id: string;
  name: string;
  roomId: string | null;
  /** Dernière photo (vignette), si la plante en a. */
  coverPhotoId: string | null;
  hasSheet: boolean;
  job: SheetJob | null;
  /** Null tant que la plante n'a pas de fiche (pas d'intervalle, donc pas de rappel). */
  water: WaterStatus | null;
  createdAt: string;
}

export interface TodayResponse {
  /** Date du jour (AAAA-MM-JJ, Europe/Paris). */
  date: string;
  /** À arroser aujourd'hui ou en retard, les plus en retard d'abord. */
  due: PlantSummary[];
  /** À arroser dans les 7 prochains jours. */
  upcoming: PlantSummary[];
  /** Plantes sans fiche : aucun rappel pour elles. */
  withoutSheet: number;
}

export interface PlantDetail extends PlantSummary {
  careSheet: CareSheet | null;
  photoIds: string[];
}
