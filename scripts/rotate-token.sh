#!/bin/sh
# Renouvellement du jeton Claude, côté Mac : à lancer depuis la racine du dépôt.
#   ./scripts/rotate-token.sh [--stdin] [--also-local]
# --stdin       lit le jeton sur l'entrée standard (tests, automatisation) au lieu de le demander
# --also-local  met aussi à jour le .env local (développement sur le Mac)
# Variables : PLANTES_SSH (zoldik333@192.168.1.10), PLANTES_SSH_OPTS, PLANTES_DIR (plantes, relatif à ~ sur node1).
set -eu

main() {
  cd "$(dirname "$0")/.."
  umask 077
  lecture_stdin=0
  local_aussi=0
  for arg in "$@"; do
    case $arg in
      --stdin) lecture_stdin=1 ;;
      --also-local) local_aussi=1 ;;
      *) echo "Usage : $0 [--stdin] [--also-local]" >&2; exit 2 ;;
    esac
  done
  ssh_hote=${PLANTES_SSH:-zoldik333@192.168.1.10}
  ssh_opts=${PLANTES_SSH_OPTS-"-o BatchMode=yes -o IdentitiesOnly=yes -i $HOME/.ssh/node1"}
  dossier=${PLANTES_DIR:-plantes}
  tmp=""
  trap '[ -z "$tmp" ] || rm -f "$tmp"; unset jeton' EXIT

  if [ "$lecture_stdin" = 1 ]; then
    jeton=$(cat | tr -d ' \t\r\n')
  else
    cat <<'TXT'
Renouvellement du jeton Claude (valable 1 an) :
  1. « claude setup-token » ouvre le navigateur et affiche un jeton, une seule fois ;
  2. collez-le ici (rien ne s'affiche) ;
  3. il est envoyé à node1 par SSH, installé dans .env, puis vérifié avec une vraie fiche ;
  4. en cas d'échec, l'ancien jeton est remis automatiquement.
TXT
    if ! command -v claude > /dev/null 2>&1; then
      echo "✗ La commande « claude » est introuvable. Installez Claude Code (npm install -g @anthropic-ai/claude-code, ou https://claude.com/claude-code), puis relancez ce script." >&2
      exit 1
    fi
    printf 'Lancer « claude setup-token » maintenant ? [O/n] ' >&2
    read -r reponse || reponse=n
    case $reponse in
      n | N | non | Non) ;;
      *) claude setup-token ;;
    esac
    printf 'Collez le jeton (saisie masquée) : ' >&2
    read -rs jeton || jeton=""
    echo >&2
    jeton=$(printf '%s' "$jeton" | tr -d ' \t\r\n')
  fi

  # Validation AVANT toute connexion. Le contenu reçu n'est jamais répété.
  if ! printf '%s' "$jeton" | grep -Eq '^sk-ant-oat01-[A-Za-z0-9_-]{20,}$'; then
    echo "✗ Jeton refusé : format invalide (attendu : sk-ant-oat01- suivi d'au moins 20 caractères). Aucune connexion faite." >&2
    exit 1
  fi

  echo "Envoi du jeton à $ssh_hote…" >&2
  code=0
  # $ssh_opts doit être découpé en mots (volontairement sans guillemets).
  printf '%s' "$jeton" | ssh $ssh_opts "$ssh_hote" "cd ~/$dossier && sh scripts/apply-token.sh" || code=$?

  if [ "$code" = 0 ] && [ "$local_aussi" = 1 ]; then
    maj_env_local
  fi
  unset jeton
  return "$code"
}

# Même méthode atomique que sur node1 : le jeton ne passe jamais en argument.
maj_env_local() {
  if [ ! -f .env ]; then
    echo "⚠ Pas de .env local : développement local non mis à jour." >&2
    return 0
  fi
  jour=$(date +%F)
  tmp=$(mktemp .env.XXXXXX)
  vu_jeton=0
  vu_date=0
  while IFS= read -r ligne || [ -n "$ligne" ]; do
    case $ligne in
      CLAUDE_CODE_OAUTH_TOKEN=*) printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$jeton"; vu_jeton=1 ;;
      CLAUDE_TOKEN_CREATED=*) printf 'CLAUDE_TOKEN_CREATED=%s\n' "$jour"; vu_date=1 ;;
      *) printf '%s\n' "$ligne" ;;
    esac
  done < .env > "$tmp"
  [ "$vu_jeton" = 1 ] || printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$jeton" >> "$tmp"
  [ "$vu_date" = 1 ] || printf 'CLAUDE_TOKEN_CREATED=%s\n' "$jour" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
  tmp=""
  echo "✓ .env local mis à jour." >&2
}

main "$@"
