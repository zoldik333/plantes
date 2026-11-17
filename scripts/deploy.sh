#!/bin/sh
# Déploiement sur node1 : appelé par un timer systemd (toutes les 2 min).
# Met à jour compose.yaml / Caddyfile (git), tire la nouvelle image et ne redémarre que ce qui change.
set -eu
cd "$(dirname "$0")/.."
git pull --quiet --ff-only
docker compose pull --quiet app
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
