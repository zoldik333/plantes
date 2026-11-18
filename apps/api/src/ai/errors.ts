/** Famille d'échec d'une génération, déduite des signaux renvoyés par le SDK. */
export type AiErrorCode = "auth" | "account" | "usage_limit" | "overloaded" | "timeout" | "other";

export interface FailureSignals {
  /** Champs `error` des messages assistant et des `api_retry`. */
  assistantErrors: string[];
  /** Textes des messages assistant et du résultat. */
  texts: string[];
  exceptionMessage?: string;
  timedOut?: boolean;
}

const AUTH_TEXT =
  /OAuth (access )?token (is invalid|has expired|revoked)|Login expired|Not logged in|Invalid authentication credentials|Failed to authenticate|Please run \/login/i;
const USAGE_TEXT = /session limit|(?<!not your )usage limit|\b(weekly|5-hour|hourly|opus) limit/i; // « (not your usage limit) » accompagne la surcharge
const OVERLOAD_TEXT = /temporarily limiting requests/i;

/**
 * Classe un échec. Priorité : auth > account > surcharge (texte) > usage_limit > overloaded > timeout.
 * Une erreur générique (« exited with code 1 ») sans signal d'authentification donne « other », jamais « auth ».
 */
export function classifyAiFailure({ assistantErrors, texts, exceptionMessage, timedOut }: FailureSignals): AiErrorCode {
  const errors = new Set(assistantErrors);
  const all = [...texts, ...(exceptionMessage ? [exceptionMessage] : [])];
  const has = (re: RegExp) => all.some((t) => re.test(t));
  const any = (...names: string[]) => names.some((n) => errors.has(n));

  if (any("authentication_failed") || has(AUTH_TEXT)) return "auth";
  if (any("account_on_hold", "billing_error", "oauth_org_not_allowed")) return "account";
  if (has(OVERLOAD_TEXT)) return "overloaded"; // prime sur rate_limit : « (not your usage limit) »
  if (any("rate_limit") || has(USAGE_TEXT)) return "usage_limit";
  if (any("overloaded", "server_error")) return "overloaded";
  if (timedOut) return "timeout";
  return "other";
}

const MESSAGES: Record<AiErrorCode, string> = {
  auth: "Le jeton Claude n'est plus valide : il doit être renouvelé sur le serveur.",
  account: "Le compte Claude est suspendu ou a un souci de facturation.",
  usage_limit: "La limite d'usage de l'abonnement Claude est atteinte : réessaie plus tard.",
  overloaded: "Claude est surchargé : réessaie dans quelques minutes.",
  timeout: "Délai dépassé : l'IA n'a pas répondu à temps",
  other: "Échec de la génération : réessaie dans un moment.",
};

/** Message affiché à l'utilisateur (en français) pour un code d'échec. */
export const messageFor = (code: AiErrorCode): string => MESSAGES[code];

/** Masque les jetons d'accès (sk-ant-…) dans un texte avant de le journaliser ou de le stocker. */
export const redactSecrets = (text: string): string => text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-…");
