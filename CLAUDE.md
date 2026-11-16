# App plantes — contexte pour Claude Code

Reprise d'une session claude.ai (16 novembre 2026). Le périmètre complet est aussi dans le Projet claude.ai « App plantes » (`claude/perimetre-et-stack.md`).

## Le projet
PWA perso pour gérer les plantes d'intérieur d'un foyer de 2-3 personnes. Pas d'app native (pas de licence Apple Developer). Objectif : **coût zéro**.

## Décisions prises
- **IA** : Claude Agent SDK authentifié par l'abonnement Claude Pro (`CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`), jamais `ANTHROPIC_API_KEY`. Usage foyer uniquement.
- **Fournisseur IA interchangeable** : tout passe par l'interface `AiProvider` (`src/ai/provider.ts`). La politique d'usage Agent SDK + abonnement a changé plusieurs fois en 2026.
- **Hébergement** : serveur maison Debian, sans GPU, Docker. Accès SSH via Tailscale. Exposition via Cloudflare Tunnel + domaine perso (V1) ; `trycloudflare` pour le POC.
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
- L'URL `trycloudflare` change à chaque redémarrage du conteneur `tunnel` → PWA à réinstaller.

Pas encore fait :
- Test Web Push écran verrouillé + app fermée de façon explicite, et cas `nameMatchesPhoto: false`.

Pièges rencontrés :
- Le serveur ne lit pas `.env` seul (c'est `compose`) : en local, `npx tsx --env-file=.env src/server.ts`.
- La PWA iOS garde d'anciennes versions : le serveur envoie `Cache-Control: no-cache` ; après un changement de schéma, fermer la PWA complètement.
- Le token vit dans `.env` (ignoré par git), jamais dans `.env.example`.

## Prochaines étapes
1. Question ouverte : sous-domaine choisi et domaine déjà géré par Cloudflare ou non (supprime la réinstallation de la PWA à chaque redémarrage du tunnel).
2. Puis socle V1 : monorepo, Compose, tunnel sur le domaine, CI GitHub Actions → GHCR.

## Façon de travailler avec Théo
- Pas de formules creuses ni de paragraphe d'introduction : commencer par l'essentiel.
- Tenir sa position quand il conteste, sauf s'il apporte une information nouvelle.
- Réponses en français.
