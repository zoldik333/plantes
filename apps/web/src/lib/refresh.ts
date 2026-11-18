/**
 * Rafraîchissement global : chaque donnée affichée (liste de plantes, foyer, journal…) s'y abonne, et le geste
 * « tirer pour actualiser » les recharge toutes en une fois, sans recharger la page.
 */
type Listener = () => void | Promise<void>;
const listeners = new Set<Listener>();

/** S'abonne ; renvoie la fonction de désabonnement. */
export function onRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Recharge toutes les données abonnées. Une erreur sur l'une n'empêche pas les autres. */
export async function refreshAll(): Promise<void> {
  await Promise.allSettled([...listeners].map((l) => l()));
}
