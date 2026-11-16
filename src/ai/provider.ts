import type { CareSheet } from "./schema.js";

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

/**
 * Contrat que tout fournisseur IA doit respecter.
 * Changer de fournisseur = écrire une nouvelle classe qui implémente cette interface.
 * V2 ajoutera diagnose() et chat().
 */
export interface AiProvider {
  readonly name: string;
  generateCareSheet(input: { plantName: string; photo?: Photo }): Promise<CareSheetResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
