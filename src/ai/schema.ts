import { z } from "zod";

/** Fiche d'entretien générée par l'IA. Clés en anglais (code), contenu en français. */
export const CareSheet = z.object({
  commonName: z.string().describe("Nom commun en français"),
  scientificName: z.string().describe("Nom scientifique (genre espèce, cultivar si visible)"),
  nameMatchesPhoto: z
    .boolean()
    .describe("true si la photo correspond plausiblement au nom saisi par l'utilisateur"),
  identificationNote: z
    .string()
    .optional()
    .describe("Si la photo ne correspond pas au nom saisi : quelle plante semble visible"),
  observedCondition: z
    .string()
    .optional()
    .describe("État actuel de la plante d'après la photo, 1 phrase de 15 mots maximum. Absent s'il n'y a pas de photo"),
  difficulty: z.enum(["facile", "moyenne", "difficile"]),
  light: z.object({
    need: z.enum(["ombre", "mi-ombre", "lumiere-indirecte-vive", "soleil-direct"]),
    details: z.string().describe("Où la poser chez soi, 1 phrase de 15 mots maximum"),
  }),
  watering: z.object({
    intervalDaysSummer: z.number().int().min(1).max(60),
    intervalDaysWinter: z.number().int().min(1).max(90),
    method: z.string().describe("Comment savoir quand arroser, 1 phrase de 15 mots maximum"),
    signs: z
      .string()
      .describe("Signes d'un mauvais arrosage (trop / pas assez), 1 phrase de 20 mots maximum"),
  }),
  tips: z.array(z.string()).max(3).describe("3 conseils maximum, 12 mots chacun, les plus utiles d'abord"),
  extras: z
    .object({
      humidity: z.string(),
      temperature: z.string(),
      fertilizer: z.string(),
      repotting: z.string(),
      substrate: z.string(),
    })
    .describe("Infos complémentaires : 1 courte phrase (10 mots maximum) chacune"),
});

export type CareSheet = z.infer<typeof CareSheet>;

/** JSON Schema draft-07 attendu par l'Agent SDK. */
export const careSheetJsonSchema = z.toJSONSchema(CareSheet, { target: "draft-7" }) as Record<
  string,
  unknown
>;
