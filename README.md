# Plantes

PWA pour gérer les plantes d'intérieur d'un foyer de 2 ou 3 personnes : fiche d'entretien générée par l'IA, pièces, rappels d'arrosage partagés, journal d'entretien. Hébergée à la maison, coût zéro. Contexte, décisions et état d'avancement : [`CLAUDE.md`](CLAUDE.md).

## Structure

| Dossier | Rôle |
|---|---|
| `apps/api` | API (Hono, Node 22), SQLite + Drizzle, Better Auth, Web Push, file de génération IA |
| `apps/web` | Application (React 19, Vite, Tailwind 4), servie par l'API |
| `packages/shared` | Schémas Zod partagés (fiche d'entretien, plantes, journal) |
| `tests` | Tests automatiques (API, logique, interface dans Chrome) |

## Développement

```bash
corepack enable            # ou : npx pnpm@10 <commande>
pnpm install
cp .env.example .env       # puis renseigner les variables (voir les commentaires du fichier)
pnpm vapid                 # génère les clés VAPID (notifications) à copier dans .env
pnpm dev                   # API sur :3000
pnpm --filter @plantes/web dev   # front sur :5173, proxy vers l'API
```

Le serveur ne lit pas `.env` seul : `npx tsx --env-file=.env apps/api/src/server.ts` depuis `apps/api`, ou Docker Compose.

## Tests

```bash
pnpm typecheck     # types de tous les paquets
pnpm test          # API, file de génération, rappels, logique d'arrosage : ~30 s, sans réseau, IA factice
pnpm test:ui       # interface dans un vrai Chrome (écran d'iPhone) ; CHROME_PATH si Chrome est ailleurs
```

Les tests lancent un vrai serveur sur un port libre avec une base temporaire. `AI_PROVIDER=fake` remplace l'IA et `PUSH_DRY_RUN_FILE` remplace l'envoi des notifications : **un test ne consomme jamais l'abonnement Claude ni ne notifie personne**. Ce que les tests ne peuvent pas vérifier (iPhone, IA réelle, exploitation) est dans [`TESTS-MANUELS.md`](TESTS-MANUELS.md).

Test avec la vraie IA (consomme l'abonnement, à lancer à la main) : `pnpm test:ai -- <photo.jpg> "<nom>"` depuis un `.env` complet.

## Déploiement

Un push sur `main` déclenche la CI (types, tests, tests d'interface). Si tout est vert, l'image est publiée sur GHCR ; `node1` la récupère par `scripts/deploy.sh` (cron, toutes les 2 minutes). Détails dans `CLAUDE.md`.
