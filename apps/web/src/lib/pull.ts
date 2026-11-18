/** Logique du geste « tirer pour actualiser » (sans DOM : testable seule). */

/** Distance tirée (en px, après résistance) à partir de laquelle le relâchement déclenche l'actualisation. */
export const PULL_THRESHOLD = 60;
/** Distance maximale affichée : au-delà, le doigt continue sans que l'indicateur ne descende plus. */
export const PULL_MAX = 100;

/** Résistance : le doigt parcourt deux fois la distance affichée (le geste « colle » moins au doigt, comme sur iOS). */
export const pullDistance = (fingerDy: number): number => Math.min(PULL_MAX, Math.max(0, fingerDy) * 0.5);

export const shouldRefresh = (pull: number): boolean => pull >= PULL_THRESHOLD;

export type PullMode = "idle" | "pulling" | "ready" | "refreshing";

export const LABELS: Record<PullMode, string> = {
  idle: "",
  pulling: "Tire pour actualiser",
  ready: "Relâche pour actualiser",
  refreshing: "Actualisation…",
};

/**
 * Le geste est-il le nôtre ? Seulement un doigt, depuis le haut de la page, hors d'un champ de saisie, et plutôt
 * vertical que horizontal (les listes de pièces défilent horizontalement).
 */
export function isOurGesture(o: { touches: number; scrollY: number; startsInField: boolean; dx: number; dy: number }): boolean {
  return o.touches === 1 && o.scrollY <= 0 && !o.startsInField && o.dy > 0 && Math.abs(o.dy) > Math.abs(o.dx);
}
