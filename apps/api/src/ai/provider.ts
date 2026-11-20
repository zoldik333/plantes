import type { CareEventType, CareSheet, WaterStatus } from "@plantes/shared";
import type { AiErrorCode } from "./errors.js";

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface Photo {
  data: Buffer;
  mediaType: ImageMediaType;
}

export interface CareSheetResult {
  sheet: CareSheet;
  provider: string;
  durationMs: number;
}

/** Tout ce que l'IA sait d'une plante pour répondre à une question. Construit côté serveur, jamais fourni par le client. */
export interface ChatContext {
  plantName: string;
  roomName: string | null;
  careSheet: CareSheet | null;
  water: WaterStatus | null;
  /** Date du jour (AAAA-MM-JJ, Europe/Paris) et saison. */
  today: string;
  season: "summer" | "winter";
  /** Journal récent, du plus ancien au plus récent. `date` = AAAA-MM-JJ (Paris). */
  events: { type: CareEventType; note: string | null; userName: string | null; date: string }[];
  /** Conversation précédente (sans la question en cours), du plus ancien au plus récent. */
  history: { role: "user" | "assistant"; content: string; userName: string | null }[];
  /** Dernière photo de la plante, si elle existe. */
  photo?: Photo;
}

export interface ChatResult {
  text: string;
  provider: string;
  durationMs: number;
}

/**
 * Contrat que tout fournisseur IA doit respecter.
 * Changer de fournisseur = écrire une nouvelle classe qui implémente cette interface.
 * V2 ajoute chat() (et diagnose()).
 */
export interface AiProvider {
  readonly name: string;
  generateCareSheet(input: { plantName: string; photo?: Photo }): Promise<CareSheetResult>;
  /** Réponse en texte brut (français) à une question sur une plante ; `userName` = la personne qui la pose. */
  chat(input: { context: ChatContext; message: string; userName: string }): Promise<ChatResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
    readonly code: AiErrorCode = "other",
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
