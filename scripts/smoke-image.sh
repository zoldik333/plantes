#!/bin/sh
# Démarre une image Plantes avec une configuration jetable et vérifie qu'elle fonctionne vraiment :
# serveur, migrations, front embarqué, en-têtes de sécurité, modules natifs, utilisateur non-root, pas de chaîne de construction.
# Usage : scripts/smoke-image.sh <image> [port]
set -eu
IMAGE=${1:?usage: smoke-image.sh <image> [port]}
PORT=${2:-3999}
NAME="plantes-smoke-$$"
trap 'docker rm -f "$NAME" > /dev/null 2>&1 || true' EXIT
fail() { echo "ÉCHEC : $*"; docker logs "$NAME" 2>&1 | tail -15; exit 1; }
ok() { echo "  ✓ $*"; }

KEYS=$(docker run --rm "$IMAGE" ./node_modules/.bin/tsx src/gen-vapid.ts)
PUB=$(echo "$KEYS" | sed -n 's/^VAPID_PUBLIC_KEY=//p')
PRIV=$(echo "$KEYS" | sed -n 's/^VAPID_PRIVATE_KEY=//p')

docker run -d --name "$NAME" -p "127.0.0.1:$PORT:3000" \
  -e POC_ACCESS_KEY=cle-de-test-pour-le-smoke-test -e "APP_URL=http://localhost:$PORT" \
  -e BETTER_AUTH_SECRET=secret-de-test-pour-le-smoke-test-xxxxxxxx \
  -e "VAPID_PUBLIC_KEY=$PUB" -e "VAPID_PRIVATE_KEY=$PRIV" "$IMAGE" > /dev/null

for i in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/health" > /dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$PORT/health" > /dev/null || fail "le serveur ne répond pas"
ok "le serveur démarre et répond (/health)"

curl -sf "http://127.0.0.1:$PORT/api/setup" | grep -q needsBootstrap || fail "base ou migrations"
ok "base créée et migrations appliquées (/api/setup)"

curl -sf "http://127.0.0.1:$PORT/login" | grep -q "<title>Plantes" || fail "front embarqué absent"
ok "le front est embarqué et servi"

curl -sI "http://127.0.0.1:$PORT/" | grep -qi "^content-security-policy:" || fail "en-têtes de sécurité absents"
ok "en-têtes de sécurité présents"

docker exec "$NAME" node -e "require('sharp'); require('better-sqlite3'); console.log('modules natifs ok')" | grep -q ok || fail "modules natifs (sharp, better-sqlite3)"
ok "modules natifs chargés (sharp, better-sqlite3)"

[ "$(docker exec "$NAME" id -u)" != 0 ] || fail "le serveur tourne en root"
ok "le serveur ne tourne pas en root"

# Les binaires du serveur sont dans apps/api/node_modules/.bin : on vérifie d'abord que ce dossier existe et contient tsx
# (sinon l'absence des autres outils ne prouverait rien), puis qu'aucun outil de construction n'y est, ni côté web.
docker exec "$NAME" test -x /app/apps/api/node_modules/.bin/tsx || fail "tsx absent : le contrôle suivant serait sans valeur"
for dev in vite tailwindcss tsc drizzle-kit; do
  ! docker exec "$NAME" test -e "/app/apps/api/node_modules/.bin/$dev" || fail "outil de construction présent dans l'image : $dev"
done
! docker exec "$NAME" test -d /app/apps/web/node_modules || fail "apps/web/node_modules présent dans l'image (outils du front)"
ok "aucun outil de construction accessible dans l'image (vite, tailwindcss, tsc, drizzle-kit ; pas de node_modules côté web)"

echo "image saine : $IMAGE"
