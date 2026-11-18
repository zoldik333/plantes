/**
 * État de l'IA (génération des fiches) vu par l'application : sert à prévenir quand le jeton Claude
 * (`claude setup-token`, valable un an, non renouvelable sans navigateur) approche de son expiration ou ne marche plus.
 */
export type AiProblem = "auth" | "account";

export interface AiStatus {
  /** « problem » : l'IA ne répond plus à cause du jeton ou du compte (voir `problem`). Les autres échecs (limite d'usage, surcharge) ne changent pas l'état. */
  status: "ok" | "problem";
  /** « auth » : jeton invalide, expiré ou révoqué ; « account » : compte suspendu ou souci de facturation. */
  problem: AiProblem | null;
  /** Début du problème (ISO), ou null. */
  since: string | null;
  /** Date d'expiration estimée du jeton (ISO) : création + 365 jours. Null si CLAUDE_TOKEN_CREATED n'est pas renseignée. */
  tokenExpiresAt: string | null;
  /** Jours restants avant l'expiration (négatif si dépassée), ou null. */
  daysLeft: number | null;
  /** La personne connectée administre le serveur (membre le plus ancien de son foyer) : seule à voir la procédure de renouvellement. */
  isOwner: boolean;
}
