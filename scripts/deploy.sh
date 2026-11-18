#!/bin/sh
# Déploiement sur node1 : appelé par cron toutes les 2 minutes.
# Met à jour compose.yaml / Caddyfile (git), tire la nouvelle image et ne redémarre que ce qui change.
# Silencieux quand rien ne change (sinon le journal grossit de ~100 Ko par jour) ; bavard sur un changement ou une erreur.
set -eu

# Tout le corps est dans une fonction : le shell la lit en entier avant de l'exécuter, donc le `git pull` qu'elle fait
# (qui peut remplacer ce fichier) ne perturbe pas l'exécution en cours.
main() {
  cd "$(dirname "$0")/.."
  LOG="$HOME/plantes-deploy.log"
  log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

  # Journal plafonné à 1 Mo (on garde les 500 dernières lignes ; réécrit sur place : cron garde le fichier ouvert).
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1048576 ]; then
    tail -n 500 "$LOG" > "$LOG.tmp" && cat "$LOG.tmp" > "$LOG"
    rm -f "$LOG.tmp"
  fi

  before=$(git rev-parse HEAD)
  git pull --quiet --ff-only
  after=$(git rev-parse HEAD)

  docker compose pull --quiet app
  if ! out=$(docker compose up -d --remove-orphans 2>&1); then
    log "ÉCHEC du déploiement"
    echo "$out"
    exit 1
  fi

  # Compose dit « Running » quand rien ne change ; tout autre message signale un changement.
  if echo "$out" | grep -qE "Recreate|Created|Started|Pulled|Building|Removed"; then
    log "déploiement $(git rev-parse --short "$before") → $(git rev-parse --short "$after")"
    echo "$out"
  fi
  docker image prune -f > /dev/null
}

main "$@"
