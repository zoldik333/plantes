import { Card } from "../../components/ui";
import { fullDate, ROTATE_COMMAND, useAiStatus } from "../../lib/ai-status";

/** Marche à suivre pour renouveler le jeton Claude. Visible seulement pour la personne qui administre le serveur. */
export function ClaudeTokenCard() {
  const ai = useAiStatus();
  if (!ai?.isOwner) return null;

  const days = ai.daysLeft;
  return (
    <Card title="🔑 Jeton Claude">
      <p className="text-sm text-stone-700">
        État : <strong>{ai.status === "ok" ? "Fonctionne" : "Problème détecté"}</strong>
      </p>
      <p className="text-sm text-stone-700">
        {ai.tokenExpiresAt && days !== null
          ? days < 0
            ? `Expiré depuis le ${fullDate(ai.tokenExpiresAt)}.`
            : `Expire le ${fullDate(ai.tokenExpiresAt)} (${days === 0 ? "aujourd'hui" : days === 1 ? "demain" : `dans ${days} jours`}).`
          : "Date d'expiration inconnue : renseigne CLAUDE_TOKEN_CREATED sur le serveur."}
      </p>
      <p className="text-sm text-stone-700">Le jeton est valable un an. Pour le renouveler :</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-700">
        <li>
          Sur ton Mac, dans le dossier du projet, lance{" "}
          <code className="select-all rounded bg-stone-100 px-1.5 py-0.5 break-all">{ROTATE_COMMAND}</code>
        </li>
        <li>Le navigateur s'ouvre pour te reconnecter à Claude : copie le jeton affiché.</li>
        <li>Colle-le dans le terminal (rien ne s'affiche) : le script met à jour le serveur et vérifie que tout marche.</li>
      </ol>
    </Card>
  );
}
