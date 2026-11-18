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
  createdAt: string;
}

export interface PlantDetail extends PlantSummary {
  careSheet: CareSheet | null;
  photoIds: string[];
}
