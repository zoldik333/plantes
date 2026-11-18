import { fullDate, ROTATE_COMMAND, useAiStatus } from "../lib/ai-status";

/** Bandeau d'alerte sur le jeton Claude : rouge si la génération est arrêtée, orange si le jeton expire bientôt (propriétaire seulement). */
export function AiStatusBanner() {
  const ai = useAiStatus();
  if (!ai) return null;

  if (ai.status === "problem") {
    const cause =
      ai.problem === "account" ? "le compte Claude est suspendu ou a un souci de facturation" : "le jeton Claude est invalide ou expiré";
    return (
      <div role="alert" className="rounded-xl bg-red-100 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-300 break-words">
        La génération des fiches est arrêtée : {cause}.{" "}
        {ai.isOwner ? (
          <>
            Renouvelle-le depuis ton Mac avec <code className="rounded bg-white/70 px-1">{ROTATE_COMMAND}</code> (la marche à suivre est dans Réglages).
          </>
        ) : (
          "Préviens la personne qui administre l'appli."
        )}
      </div>
    );
  }

  if (!ai.isOwner || ai.daysLeft === null || ai.daysLeft > 30 || !ai.tokenExpiresAt) return null;
  const date = fullDate(ai.tokenExpiresAt);
  const n = ai.daysLeft;
  const text =
    n < 0
      ? `Le jeton Claude a expiré le ${date}. Renouvelle-le (la marche à suivre est dans Réglages).`
      : `Le jeton Claude expire ${n === 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`} (le ${date}). Pense à le renouveler.`;
  return (
    <div role="status" className="rounded-xl bg-orange-100 px-3 py-2 text-sm font-medium text-orange-900 ring-1 ring-orange-300 break-words">
      {text}
    </div>
  );
}
