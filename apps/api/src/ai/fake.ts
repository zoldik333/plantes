import { AiProviderError, type AiProvider, type CareSheetResult, type ChatContext, type ChatResult, type Photo } from "./provider.js";
import type { CareSheet } from "@plantes/shared";
import { messageFor, type AiErrorCode } from "./errors.js";

/** Mots du nom qui simulent un échec précis. */
const SIMULATED: [string, AiErrorCode][] = [
  ["AUTHFAIL", "auth"],
  ["ACCOUNTFAIL", "account"],
  ["LIMITE", "usage_limit"],
  ["SURCHARGE", "overloaded"],
];

/**
 * Fournisseur de test (AI_PROVIDER=fake) : fiche fixe après un délai ; un nom contenant « ECHEC » échoue,
 * et AUTHFAIL / ACCOUNTFAIL / LIMITE / SURCHARGE simulent les échecs correspondants.
 */
export class FakeProvider implements AiProvider {
  readonly name = "fake";
  constructor(private readonly delayMs: number) {}

  async generateCareSheet({ plantName, photo }: { plantName: string; photo?: Photo }): Promise<CareSheetResult> {
    const started = Date.now();
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (plantName.includes("ECHEC")) throw new AiProviderError("Échec simulé");
    for (const [word, code] of SIMULATED) {
      if (plantName.includes(word)) throw new AiProviderError(messageFor(code), undefined, code);
    }
    const sheet: CareSheet = {
      commonName: plantName,
      scientificName: "Plantus testus",
      nameMatchesPhoto: true,
      observedCondition: photo ? `Photo reçue (${photo.data.length} octets)` : undefined,
      difficulty: "facile",
      light: { need: "mi-ombre", details: "Près d'une fenêtre." },
      watering: { intervalDaysSummer: 7, intervalDaysWinter: 12, method: "Enfonce un doigt dans la terre.", signs: "Feuilles molles." },
      tips: ["Conseil de test."],
      extras: { humidity: "h", temperature: "t", fertilizer: "f", repotting: "r", substrate: "s" },
    };
    return { sheet, provider: this.name, durationMs: Date.now() - started };
  }

  /**
   * Réponse déterministe qui reprend des éléments du contexte reçu (nom, dernier événement, historique, photo,
   * arrosage) : les tests prouvent ainsi que le serveur transmet bien le contexte. Mêmes mots-clés d'échec que pour les fiches,
   * cherchés dans la question.
   */
  async chat({ context, message, userName }: { context: ChatContext; message: string; userName: string }): Promise<ChatResult> {
    const started = Date.now();
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (message.includes("ECHEC")) throw new AiProviderError("Échec simulé");
    for (const [word, code] of SIMULATED) {
      if (message.includes(word)) throw new AiProviderError(messageFor(code), undefined, code);
    }
    const last = context.events.at(-1);
    const parts = [
      `Plante : ${context.plantName}.`,
      `Pièce : ${context.roomName ?? "aucune"}.`,
      `Aujourd'hui : ${context.today} (${context.season}).`,
      `Journal : ${context.events.length} événement(s), dernier : ${last ? `${last.type} le ${last.date}${last.note ? ` (${last.note})` : ""}` : "aucun"}.`,
      `Historique : ${context.history.length} message(s).`,
      `Arrosage : ${context.water ? `prévu le ${context.water.dueDate}${context.water.snoozed ? " (repoussé)" : ""}` : "inconnu"}.`,
      `Fiche : ${context.careSheet ? `oui (${context.careSheet.commonName})` : "non"}${context.careSheet?.observedCondition ? `, état : ${context.careSheet.observedCondition}` : ""}.`,
      `Photo : ${context.photo ? `${context.photo.data.length} octets` : "aucune"}.`,
      `${userName} demande : ${message}`,
    ];
    return { text: parts.join("\n"), provider: this.name, durationMs: Date.now() - started };
  }
}
