# App plantes — contexte pour Claude Code

Reprise d'une session claude.ai (16 novembre 2026). Le périmètre complet est aussi dans le Projet claude.ai « App plantes » (`claude/perimetre-et-stack.md`).

## Le projet
PWA perso pour gérer les plantes d'intérieur d'un foyer de 2-3 personnes. Pas d'app native (pas de licence Apple Developer). Objectif : **coût zéro**.

## Décisions prises
- **IA** : Claude Agent SDK authentifié par l'abonnement Claude Pro (`CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`), jamais `ANTHROPIC_API_KEY`. Usage foyer uniquement.
- **Fournisseur IA interchangeable** : tout passe par l'interface `AiProvider` (`src/ai/provider.ts`). La politique d'usage Agent SDK + abonnement a changé plusieurs fois en 2026.
- **Hébergement** : serveur maison Debian, sans GPU, Docker. Accès SSH via Tailscale. Exposition via Caddy (HTTPS Let's Encrypt) sur `plantes.tvermorel.fr`, IP publique statique (décision du 17/11/2026, remplace Cloudflare Tunnel : le domaine est chez OVH).
- **Stack V1** : monorepo pnpm (`apps/web`, `apps/api`, `packages/shared`), React + Vite + vite-plugin-pwa, Hono (Node 22), SQLite + Drizzle, Better Auth (e-mail/mot de passe + passkeys), Zod partagé, Web Push (VAPID) avec planificateur côté serveur, photos sur volume + redimensionnement.
- **Conventions** : TypeScript partout, clés de code en anglais, contenu et UI en français.

## Périmètre
- **V1** : foyer partagé (invitation par lien, plantes appartenant au foyer) ; ajout de plante = **nom saisi + photo** → fiche générée par l'IA, modifiable ; pièces/emplacements ; rappels d'arrosage adaptatifs (intervalles été/hiver, « arrosé » / « encore humide », notifs regroupées par jour, un membre coche → les autres ne sont plus relancés) ; journal d'entretien.
- **V2** : diagnostic santé par photo + photo de contrôle à J+7, chat par plante, timeline photo.
- **Bonus** : raccourci iOS appelant l'API.
- **Écarté** : widget (impossible en PWA), gamification, réseau social, capteurs.

## État du POC (ce dossier)
**Validé en local le 17 novembre 2026** (Mac, Node 26, tunnel `trycloudflare` via Docker) :
- `npm install` + `typecheck` OK. `SDKUserMessage` et `tools: []` + `outputFormat` passent ; `StructuredOutput` reste disponible.
- Fiche IA OK sur 3 photos, auth par abonnement (`apiKeySource=none`, pas de clé API). `settingSources: []` ajouté pour que le SDK ne charge pas la config/MCP du poste.
- Web Push reçu sur iPhone depuis la PWA installée.
- Fiche volontairement courte et sans jargon (schéma `src/ai/schema.ts`, ton dans `prompts.ts`) ; **la photo est facultative** (nom seul accepté) ; pas de champ toxicité.

Déployé et validé sur le serveur Debian (`node1`, `zoldik333@192.168.1.10`, Debian 13, 3,7 Go de RAM) le 17 novembre 2026 : fiche IA et Web Push OK depuis l'iPhone.
- Code dans `~/plantes`, cloné depuis `git@github.com:zoldik333/plantes.git` (privé) avec une **deploy key** en lecture seule (`~/.ssh/plantes_deploy`, alias SSH `github-plantes`).
- Lancement : `cd ~/plantes && git pull && docker compose up -d --build`. Le `.env` du serveur est copié à la main (jamais dans git).
- Données dans le volume nommé `plantes-data` (un bind `./data` ne marche pas : uid hôte 1001 ≠ uid conteneur 1000).
- **Exposition** : `https://plantes.tvermorel.fr`, via **Caddy** (service `caddy` du Compose, certificat Let's Encrypt automatique, volume `caddy-data` à conserver). Plus de tunnel Cloudflare. IP publique statique `82.67.218.121`, ports 80/443 (TCP) et 443 (UDP) redirigés par la box vers `192.168.1.10` (réserver cette IP en DHCP).
- DNS : le domaine `tvermorel.fr` est chez OVH, zone DNS OVH (DNSSEC désactivé). Avant le 17/11/2026 il était délégué à des serveurs AWS Route 53 vides (SERVFAIL). Enregistrement `A plantes → 82.67.218.121`.
- L'API exige une session (cookie Better Auth) ; `POC_ACCESS_KEY` ne sert plus qu'à créer le premier compte. L'IP du foyer est exposée directement.

Pas encore fait :
- Test Web Push écran verrouillé + app fermée de façon explicite, et cas `nameMatchesPhoto: false`.

Pièges rencontrés :
- Le serveur ne lit pas `.env` seul (c'est `compose`) : en local, `npx tsx --env-file=.env src/server.ts`.
- La PWA iOS garde d'anciennes versions : le serveur envoie `Cache-Control: no-cache` ; après un changement de schéma, fermer la PWA complètement.
- Le token vit dans `.env` (ignoré par git), jamais dans `.env.example`.

## Socle V1 (en cours)
- **Monorepo pnpm** : `apps/api` (Hono), `packages/shared` (`@plantes/shared`, schéma Zod de la fiche). Le code du POC est dans `apps/api/src` (l'interface `AiProvider` : `apps/api/src/ai/provider.ts`). pnpm n'est pas installé sur le Mac : `npx -y pnpm@10 …`.
- **CI/CD** : GitHub Actions (typecheck, puis image `ghcr.io/zoldik333/plantes:latest`). `node1` exécute `scripts/deploy.sh` par cron toutes les 2 min (`git pull`, `compose pull`, `up -d`), journal `~/plantes-deploy.log`. `docker login ghcr.io` fait sur `node1` avec un jeton `read:packages`.
- **Base** : SQLite (`better-sqlite3`, WAL) + Drizzle. Fichier `DATA_DIR/plantes.db`, migrations dans `apps/api/drizzle` appliquées au démarrage. Nouvelle migration : modifier `src/db/schema.ts`, puis `pnpm --filter @plantes/api exec drizzle-kit generate --name <nom>`. Ne pas autoriser `better-sqlite3` dans `onlyBuiltDependencies` : il embarque ses binaires, sinon `node-gyp` est lancé et échoue (pas de compilateur dans l'image).
- **Sauvegardes** : copie quotidienne cohérente dans `DATA_DIR/backups` (14 gardées), **sur le même volume** : ne protège pas d'une panne du disque de `node1`. Copie hors machine à prévoir.

- **Auth (étape 3)** : Better Auth 1.7 (`apps/api/src/auth.ts`) + plugin passkey, tables dans `db/auth-schema.ts` (généré par `npx auth@latest generate`, ne pas éditer). `APP_URL` et `BETTER_AUTH_SECRET` obligatoires en production ; le rpID des passkeys vient de `APP_URL`.
  - **Inscription fermée** : `/api/auth/sign-up/*` est bloqué ; seul `POST /api/signup` crée un compte, avec un jeton d'invitation. Le tout premier compte (crée le foyer) exige `POC_ACCESS_KEY` (clé d'installation, plus une clé d'API).
  - **Un foyer par personne** (`household_members.user_id` clé primaire). Tout membre peut inviter (lien `/join/<jeton>`, 7 jours, usage unique). Jetons stockés hachés (SHA-256).
  - **Pas de mail** : « mot de passe oublié » = un autre membre génère un lien `/reset/<jeton>` (24 h, usage unique, révoque les sessions). Les passkeys servent aussi de secours.
  - Garde-fous : contrôle de l'en-tête `Origin` sur les écritures, limiteur par IP sur signup / invitation / reset (`X-Forwarded-For` de Caddy), limiteur intégré de Better Auth.
- **Front** : `apps/web` (React 19, Vite, Tailwind 4, wouter), servi par l'API depuis `apps/web/dist` (même origine). `pnpm dev` : API sur :3000 et Vite sur :5173 avec proxy `/api`. Le service worker (`public/sw.js`) ne gère que le push, pas de cache hors ligne ; `vite-plugin-pwa` reste à ajouter.
- Test local sans navigateur : `curl` sur le flux complet (23 vérifications) ; les passkeys, elles, ne se testent que dans un vrai navigateur/appareil.

- **Pièces, plantes, photos (étape 4)** : tables `rooms`, `plants` (fiche d'entretien en JSON, validée par `CareSheet` de `@plantes/shared`), `plant_photos`. Routes `/api/rooms`, `/api/plants`, `/api/photos/:id`, toutes derrière `requireMember` et **filtrées par `householdId`** (un id d'un autre foyer = 404) ; test d'accès croisé entre deux foyers (39 vérifications). Supprimer une pièce laisse ses plantes « sans pièce » ; supprimer une plante supprime ses fichiers.
  - Photos : ré-encodées par `sharp` (`apps/api/src/lib/photos.ts`) : rotation EXIF appliquée, **EXIF/GPS supprimés**, 1600 px + vignette 400 px, JPEG. Stockées dans `DATA_DIR/photos/<foyer>/<id>.jpg` et `.thumb.jpg`, servies uniquement avec session (`Cache-Control: private`). Limite 8 Mo, 20 photos par plante, 300 plantes, 50 pièces par foyer. `sharp` n'a pas besoin d'être dans `onlyBuiltDependencies` (binaires fournis).
  - **Sauvegardes : la base seule est sauvegardée, pas `photos/`** (à couvrir avec la copie hors machine).
  - Front : onglets Plantes / Pièces / Réglages (`components/Shell.tsx`), liste filtrable par pièce, fiche plante (photos, nom, pièce, suppression).
- **Génération de fiche par l'IA (étape 5)** : rattachée à la **plante** (créée d'abord, avec sa photo ; la fiche arrive ensuite), pas à une requête qui attend. Table `care_sheet_jobs` (une ligne par plante, supprimée quand la fiche est enregistrée), file dans `apps/api/src/care-sheet-queue.ts` : **1 génération à la fois**, limite de 5 actives par foyer, délai max 3 min par appel (`AI_TIMEOUT_MS`), les générations « en cours » repartent au redémarrage du serveur. `POST /api/plants/:id/care-sheet` lance ou relance (idempotent) ; l'état (`job`: pending/running/error + `ahead`) est dans la liste et la fiche des plantes ; le front interroge toutes les 3-4 s tant qu'une génération est active. Fiche modifiable (`CareSheetEditor`) et régénérable (avec confirmation : écrase les modifications). L'ancienne route synchrone `/api/care-sheet` n'existe plus.
  - `AI_PROVIDER=fake` (+ `AI_FAKE_DELAY_MS`) : fournisseur factice pour tester la file sans consommer l'abonnement (un nom contenant « ECHEC » échoue). Ne jamais le mettre en production.
- **Tests** : les contrôles automatiques (curl pour l'API et la file, Playwright + Chrome pour l'interface et les passkeys avec authentificateur virtuel) ont été écrits dans le scratchpad de session et ne sont **pas versionnés**. Ce qui reste à vérifier à la main (iPhone, IA réelle, exploitation) est dans `TESTS-MANUELS.md`.

## Prochaines étapes
1. Étape 3 : passkeys validées sur l'iPhone en production (confirmé par Théo le 17/11/2026).
2. Étape 6 : rappels d'arrosage (intervalles été/hiver de `careSheet.watering`, « Arrosé » / « Encore humide », une notification par jour et par personne, un membre coche → les autres ne sont plus relancés) et journal d'entretien. Les abonnements push sont déjà liés à `user_id` ; `sendToAll` est à remplacer par un envoi ciblé par foyer. Étape 7 : interface au fil des étapes.
3. Dérouler `TESTS-MANUELS.md` (notamment notification écran verrouillé, photos HEIC et portrait, qualité des fiches).
4. À durcir : limite de débit sur l'API (Caddy), sauvegarde hors machine (base **et** `photos/`).

## Façon de travailler avec Théo
- Pas de formules creuses ni de paragraphe d'introduction : commencer par l'essentiel.
- Tenir sa position quand il conteste, sauf s'il apporte une information nouvelle.
- Réponses en français.
