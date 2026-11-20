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
