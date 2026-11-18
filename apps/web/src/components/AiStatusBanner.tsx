import { fullDate, ROTATE_COMMAND, useAiStatus } from "../lib/ai-status";
import { Icon } from "./Icon";

const banner = "flex gap-3 rounded-md px-4 py-3 text-body-sm font-medium break-words";

/** Bandeau d'alerte sur le jeton Claude : danger si la génération est arrêtée, avertissement si le jeton expire bientôt (propriétaire seulement). */
export function AiStatusBanner() {
  const ai = useAiStatus();
  if (!ai) return null;

  if (ai.status === "problem") {
    const cause =
      ai.problem === "account" ? "le compte Claude est suspendu ou a un souci de facturation" : "le jeton Claude est invalide ou expiré";
    return (
      <div role="alert" className={`${banner} bg-danger-soft text-danger`}>
        <Icon name="alert" className="mt-0.5" />
        <p className="min-w-0">
          La génération des fiches est arrêtée : {cause}.{" "}
          {ai.isOwner ? (
            <>
              Renouvelle-le depuis ton Mac avec <code className="rounded-sm bg-surface/60 px-1.5">{ROTATE_COMMAND}</code> (la marche à suivre est
              dans Réglages).
            </>
          ) : (
            "Préviens la personne qui administre l'appli."
          )}
        </p>
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
    <div role="status" className={`${banner} bg-warning-soft text-warning`}>
      <Icon name="clock" className="mt-0.5" />
      <p className="min-w-0">{text}</p>
    </div>
  );
}
