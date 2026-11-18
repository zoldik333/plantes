import { Icon } from "../../components/Icon";
import { Card, Pill } from "../../components/ui";
import { fullDate, ROTATE_COMMAND, useAiStatus } from "../../lib/ai-status";

/** Marche à suivre pour renouveler le jeton Claude. Visible seulement pour la personne qui administre le serveur. */
export function ClaudeTokenCard() {
  const ai = useAiStatus();
  if (!ai?.isOwner) return null;

  const days = ai.daysLeft;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="sparkle" className="text-leaf" />
          Jeton Claude
        </span>
      }
    >
      <p className="flex items-center gap-2 text-body-sm text-ink">
        État :
        {ai.status === "ok" ? (
          <Pill tone="success" icon="check">
            Fonctionne
          </Pill>
        ) : (
          <Pill tone="danger" icon="alert">
            Problème détecté
          </Pill>
        )}
      </p>
      <p className="text-body-sm text-ink">
        {ai.tokenExpiresAt && days !== null
          ? days < 0
            ? `Expiré depuis le ${fullDate(ai.tokenExpiresAt)}.`
            : `Expire le ${fullDate(ai.tokenExpiresAt)} (${days === 0 ? "aujourd'hui" : days === 1 ? "demain" : `dans ${days} jours`}).`
          : "Date d'expiration inconnue : renseigne CLAUDE_TOKEN_CREATED sur le serveur."}
      </p>
      <p className="text-body-sm text-ink-muted">Le jeton est valable un an. Pour le renouveler :</p>
      <ol className="list-decimal space-y-2 pl-5 text-body-sm text-ink">
        <li>
          Sur ton Mac, dans le dossier du projet, lance{" "}
          <code className="rounded-sm bg-surface-sunken px-1.5 py-0.5 select-all break-all">{ROTATE_COMMAND}</code>
        </li>
        <li>Le navigateur s'ouvre pour te reconnecter à Claude : copie le jeton affiché.</li>
        <li>Colle-le dans le terminal (rien ne s'affiche) : le script met à jour le serveur et vérifie que tout marche.</li>
      </ol>
    </Card>
  );
}
