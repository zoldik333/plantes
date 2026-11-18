# Renouvellement du jeton Claude

## Pourquoi

L'IA de l'appli utilise le jeton `CLAUDE_CODE_OAUTH_TOKEN` (abonnement Claude Pro), obtenu avec `claude setup-token`. Il est valable **1 an**. Aucun renouvellement n'est possible sans navigateur (connexion à ton compte Claude) : il n'y a donc rien à automatiser, seulement à faire une fois par an, en 2 minutes.

## Quand

L'appli connaît la date de création du jeton (`CLAUDE_TOKEN_CREATED`) et prévient à **30, 14, 7, 3 et 1 jours** de l'expiration, par notification et par bandeau. Mieux vaut renouveler dès le premier avertissement.

## Comment

Depuis la racine du dépôt, sur le Mac :

```sh
./scripts/rotate-token.sh
```

Le script :

1. propose de lancer `claude setup-token` (navigateur ; le jeton ne s'affiche qu'une fois) ;
2. te demande de coller le jeton (saisie masquée) et vérifie son format avant toute connexion ;
3. l'envoie à `node1` par SSH, sur l'entrée standard (jamais en argument, donc invisible dans la liste des processus) ;
4. sur `node1`, `scripts/apply-token.sh` sauvegarde `.env` (`.env.avant-jeton`), remplace `CLAUDE_CODE_OAUTH_TOKEN`, met `CLAUDE_TOKEN_CREATED` à la date du jour, recrée le conteneur `app`, attend qu'il soit sain, puis génère une vraie fiche minimale pour vérifier que le jeton fonctionne ;
5. en cas de succès, la sauvegarde (qui contient l'ancien jeton) est supprimée et la prochaine date limite est affichée.

Options : `--also-local` met aussi à jour le `.env` du Mac (développement) ; `--stdin` lit le jeton sur l'entrée standard (automatisation). Variables : `PLANTES_SSH` (défaut `zoldik333@192.168.1.10`), `PLANTES_SSH_OPTS` (défaut `-o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/node1`), `PLANTES_DIR` (défaut `plantes`).

## Vérifier à tout moment

```sh
ssh zoldik333@192.168.1.10 'cd ~/plantes && docker compose exec -T app ./node_modules/.bin/tsx src/ai-ping.ts'
```

Code de sortie : 0 = ça marche, 2 = jeton invalide ou expiré, 3 = autre échec, 4 = problème de compte.

## Si ça échoue

Pour un refus (code 2) ou un problème de compte (code 4), le script remet **automatiquement l'ancien jeton** (`.env` identique à l'original, droits 600) et recrée le conteneur avec : l'appli reste dans l'état d'avant. Le message indique la cause :

- « Le nouveau jeton est refusé » : relancer `claude setup-token` et recommencer (vérifier d'avoir copié le jeton en entier) ;
- « La vérification a échoué (code 4) » : problème de compte, l'ancien jeton est remis ; vérifier que l'abonnement Claude Pro est actif, puis recommencer ;
- « ⚠ Jeton remplacé mais non vérifié » (code 3 : limite d'usage, surcharge ou délai) : **le nouveau jeton est conservé**, la sauvegarde est supprimée et le script sort avec le code 3. Choix voulu : on ne sait pas si le nouveau jeton est mauvais, et l'ancien est peut-être déjà mort ; le restaurer risquerait de remettre un jeton inutilisable. Relancer plus tard la vérification (`docker compose exec -T app ./node_modules/.bin/tsx src/ai-ping.ts`) ;
- « Le conteneur n'est pas devenu sain » : regarder `docker compose logs app` sur `node1`.

Si `apply-token.sh` est interrompu (Ctrl-C, coupure SSH, TERM) après le remplacement de `.env`, l'ancien `.env` est remis et le fichier temporaire (qui contient le jeton) supprimé. `.env*` est ignoré par git (sauf `.env.example`). `rotate-token.sh` refuse un `PLANTES_DIR` hors `[A-Za-z0-9._/-]` ou contenant `..`, et un `PLANTES_SSH` qui commence par `-` ou contient un espace.

## À faire une première fois à la main

`CLAUDE_TOKEN_CREATED` doit être renseignée une première fois à la main, car le script ne peut pas deviner la date du jeton actuel. Sur `node1`, ajouter dans `~/plantes/.env` :

```
CLAUDE_TOKEN_CREATED=2026-11-16
```

(estimation de la date de création du jeton actuel), puis `docker compose up -d app`. Dès le prochain renouvellement, le script la tient à jour.
