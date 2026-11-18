#!/bin/sh
# Renouvellement du jeton Claude, côté serveur (node1) : à lancer depuis ~/plantes.
# Le jeton est lu sur l'ENTRÉE STANDARD (jamais en argument ni dans l'environnement : il apparaîtrait dans `ps`).
# Usage normal : via ./scripts/rotate-token.sh sur le Mac. À la main : printf '%s' "$JETON" | sh scripts/apply-token.sh
# Variable de test : PLANTES_ATTENTE_SAIN (secondes d'attente de l'état « healthy », 60 par défaut).
set -eu

# Tout le corps est dans une fonction : un `git pull` peut remplacer ce fichier pendant son exécution.
main() {
  cd "$(dirname "$0")/.."
  ENV=.env
  SAUVEGARDE=.env.avant-jeton
  tmp=""
  trap '[ -z "$tmp" ] || rm -f "$tmp"' EXIT
  umask 077

  # 1) Lecture et validation du format. On ne répète JAMAIS le contenu reçu.
  jeton=$(cat | tr -d ' \t\r\n')
  if ! printf '%s' "$jeton" | grep -Eq '^sk-ant-oat01-[A-Za-z0-9_-]{20,}$'; then
    echo "✗ Jeton refusé : format invalide (attendu : sk-ant-oat01- suivi d'au moins 20 caractères). Rien n'a été modifié." >&2
    exit 1
  fi

  # 2) .env présent, puis sauvegarde (droits 600).
  if [ ! -f "$ENV" ]; then
    echo "✗ Fichier $ENV introuvable dans $(pwd) : rien n'a été modifié." >&2
    exit 1
  fi
  cp "$ENV" "$SAUVEGARDE"
  chmod 600 "$SAUVEGARDE"

  # 3) Réécriture atomique de .env (aucun outil qui recevrait le jeton en argument).
  jour=$(date +%F)
  tmp=$(mktemp "$ENV.XXXXXX")
  vu_jeton=0
  vu_date=0
  while IFS= read -r ligne || [ -n "$ligne" ]; do
    case $ligne in
      CLAUDE_CODE_OAUTH_TOKEN=*) printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$jeton"; vu_jeton=1 ;;
      CLAUDE_TOKEN_CREATED=*) printf 'CLAUDE_TOKEN_CREATED=%s\n' "$jour"; vu_date=1 ;;
      *) printf '%s\n' "$ligne" ;;
    esac
  done < "$ENV" > "$tmp"
  [ "$vu_jeton" = 1 ] || printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$jeton" >> "$tmp"
  [ "$vu_date" = 1 ] || printf 'CLAUDE_TOKEN_CREATED=%s\n' "$jour" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV"
  tmp=""
  unset jeton

  # 4) Recréation du conteneur avec le nouvel environnement, puis attente de l'état sain.
  if ! docker compose up -d app > /dev/null 2>&1; then
    echo "✗ Le conteneur n'a pas pu être recréé." >&2
    restaurer
  fi
  if ! attendre_sain; then
    echo "✗ Le conteneur n'est pas devenu sain à temps." >&2
    restaurer
  fi

  # 5) Vérification : une vraie fiche minimale générée avec le nouveau jeton.
  code=0
  sortie=$(docker compose exec -T app ./node_modules/.bin/tsx src/ai-ping.ts 2>&1) || code=$?
  if [ "$code" = 0 ]; then
    rm -f "$SAUVEGARDE"
    echo "✓ Jeton renouvelé : les fiches fonctionnent. Prochain renouvellement avant le $(un_an_plus_tard)"
    return 0
  fi
  if [ "$code" = 2 ]; then
    echo "✗ Le nouveau jeton est refusé (invalide ou expiré)" >&2
  else
    echo "✗ La vérification a échoué (code $code)" >&2
  fi
  [ -z "$sortie" ] || printf '%s\n' "$sortie" | sed 's/^/    /' >&2
  restaurer
}

un_an_plus_tard() {
  date -d '+1 year' +%F 2> /dev/null || date -v+1y +%F
}

attendre_sain() {
  i=0
  max=${PLANTES_ATTENTE_SAIN:-60}
  while [ "$i" -lt "$max" ]; do
    statut=$(docker compose ps app --format '{{.Status}}' 2> /dev/null || true)
    case $statut in
      *unhealthy*) ;;
      *healthy*) return 0 ;;
    esac
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# Remet l'ancien .env (identique, droits 600) et l'ancien conteneur ; termine avec le code 1.
restaurer() {
  tmp=$(mktemp "$ENV.XXXXXX")
  cp "$SAUVEGARDE" "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV"
  tmp=""
  rm -f "$SAUVEGARDE"
  if docker compose up -d app > /dev/null 2>&1; then
    echo "L'ancien jeton a été remis et le conteneur recréé avec." >&2
  else
    echo "L'ancien jeton a été remis dans .env, mais le conteneur n'a pas pu être recréé : lancer « docker compose up -d app »." >&2
  fi
  exit 1
}

main "$@"
