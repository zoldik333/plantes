# POC Plantes — test de faisabilité

Vérifie les deux risques du projet avant de construire la V1 :

1. **Fiche IA** : Claude Agent SDK + abonnement Pro, photo + nom → fiche JSON structurée
2. **Push iOS** : notification Web Push reçue par la PWA installée sur iPhone

## 1. Récupérer le token de ton abonnement Claude

Sur un poste avec navigateur (ton PC, pas forcément le serveur) :

```bash
curl -fsSL https://claude.ai/install.sh | bash   # si Claude Code n'est pas installé
claude setup-token
```

Copie le token affiché. **Ne définis jamais `ANTHROPIC_API_KEY`** dans `.env` : elle prendrait le dessus et facturerait l'API.

## 2. Configurer sur le serveur Debian

```bash
cp .env.example .env
docker compose build
docker compose run --rm app npm run vapid   # copie les 2 lignes dans .env
openssl rand -hex 16                         # → POC_ACCESS_KEY dans .env
```

Complète `.env` : `CLAUDE_CODE_OAUTH_TOKEN`, `VAPID_*`, `VAPID_SUBJECT` (un vrai `mailto:`), `POC_ACCESS_KEY`.

## 3. Test 1 en ligne de commande (sans iPhone)

```bash
# Avec une photo JPEG < 3,5 Mo copiée dans ./data
docker compose run --rm app npm run test:ai -- data/calathea.jpg "Calathea sanderiana"
```

Attendu : la ligne `[ai] init: … auth=…` (doit indiquer une auth par abonnement, pas une clé API), puis la fiche JSON et la durée.

## 4. Lancer le serveur + le tunnel

```bash
docker compose up -d
docker compose logs tunnel | grep trycloudflare   # → https://xxxx.trycloudflare.com
```

## 5. Sur l'iPhone

1. Ouvre l'URL `trycloudflare` dans **Safari**
2. Partager → **Sur l'écran d'accueil**, puis ouvre « Plantes » depuis l'écran d'accueil
3. Saisis la clé d'accès → Enregistrer
4. **Activer les notifications** → Autoriser
5. **M'envoyer une notif dans 10 s** → verrouille le téléphone
6. Test 1 : nom + photo prise avec l'appareil → **Générer la fiche**

## Grille de résultats

| Test | Critère de succès | Résultat |
|---|---|---|
| Auth abonnement | `auth=` n'indique pas de clé API | |
| Fiche CLI | JSON valide, durée < 40 s | |
| Fiche iPhone | Photo prise depuis la PWA, fiche affichée | |
| Push écran verrouillé | Notif reçue en ≤ 30 s | |
| Push app fermée | Notif reçue après avoir tué l'app | |
| Clic sur la notif | Ouvre l'app | |

## Si ça coince

- **`Native CLI binary … not found`** : le binaire optionnel n'a pas été installé ; refaire `docker compose build --no-cache`.
- **`Aucune sortie structurée reçue`** : relancer avec `AI_DEBUG=1` et me copier la ligne `[ai] init` (liste des outils).
- **Le bouton notifications dit « non disponible »** : l'app est ouverte dans Safari et non depuis l'écran d'accueil, ou iOS < 16.4.
- **Push `403`/`BadJwtToken` dans les logs** : `VAPID_SUBJECT` invalide.

L'URL `trycloudflare` change à chaque redémarrage du tunnel : il faudra réinstaller la PWA. Ce sera réglé avec ton domaine dans la V1.
