import type { AiStatus } from "@plantes/shared";
import { useFetch, useFocusReload } from "./fetch";

/** État du jeton Claude. `undefined` tant que l'on ne sait pas, ou si l'appel échoue : la fonction est facultative, rien ne s'affiche. */
export function useAiStatus(): AiStatus | undefined {
  const { data, reload } = useFetch<AiStatus>("/api/ai/status");
  useFocusReload(reload);
  return data;
}

export const ROTATE_COMMAND = "./scripts/rotate-token.sh";

/** « 30 novembre 2026 » à partir d'une date ISO. */
export function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
