# Tests manuels

Ce que les tests automatiques **ne peuvent pas** vérifier : le matériel (iPhone), le réseau réel, l'IA réelle dans la durée, le temps qui passe. À faire sur `https://plantes.tvermorel.fr`, de préférence avec l'app installée sur l'écran d'accueil de l'iPhone.

Cocher une case = testé et conforme. En cas d'écart, noter le message exact et l'heure (les journaux du serveur : `ssh zoldik333@192.168.1.10 'cd ~/plantes && docker compose logs app --since 30m'`).

## Reste à faire

Cases non cochées, en attente d'une date ou d'une configuration :

- Lien expiré : En attente : lien de 7 jours / 24 h réels
- Renouvellement du certificat : En attente : date future (janvier 2027)
- Restauration d'une sauvegarde : En attente : sauvegardes volontairement reportées
- Sauvegarde des photos : En attente : sauvegardes volontairement reportées
- Place disque : En attente : quelques mois d'usage
- Alerte de disparition : En attente : `HEARTBEAT_URL` pas encore configurée sur node1
- Rotation des journaux : En attente : quelques semaines
- Token expiré : Sera traité par la nouvelle gestion du jeton
- Ports exposés : En attente : test IPv6 depuis la 4G à confirmer
- Changement de saison : En attente : 1er avril 2027
- Changement d'heure : En attente : 28/03/2027

## Ce qui est déjà vérifié automatiquement (inutile de le refaire à la main)

`pnpm test` (109 tests) et `pnpm test:ui` (22 tests, dans Chrome), exécutés par la CI à chaque push. Ils couvrent :

| Sujet | Détail |
|---|---|
| Comptes | premier compte protégé par la clé, inscription fermée, invitation à usage unique et expirante, e-mail déjà pris, origine étrangère refusée, limiteur d'inscription, mot de passe oublié (lien à usage unique, sessions révoquées) |
| Pièces, plantes, photos | isolation entre deux foyers sur toutes les routes, EXIF/GPS supprimés, rotation, limites de taille, fichiers supprimés avec la plante |
| Fiche par l'IA (IA factice) | ordre de la file, une génération à la fois, erreur puis relance, suppression en cours, limite de 5 par foyer, **reprise après `kill -9`** |
| Arrosage et rappels | saisons, « encore humide », annulation, arrosage daté, créneaux 9 h / 18 h, relance seulement si nécessaire, pas de doublon (même avec deux exécutions simultanées), rattrapage, heure d'été et d'hiver, aucun message vers un autre foyer ni vers un abonnement sans compte |
| Interface (Chrome, écran d'iPhone) | parcours complet des comptes aux rappels, **passkeys (authentificateur virtuel)**, foyer partagé, aucune erreur de console |

**Pas couvert, donc à faire à la main** : l'iPhone réel, les vraies notifications, l'IA réelle (qualité des fiches), le serveur `node1`.

---

## A. Installation et notifications (iPhone)

- [x] **Installer la PWA** : Safari, ouvrir l'URL, Partager, « Sur l'écran d'accueil », ouvrir depuis l'icône. *Attendu : l'app s'ouvre sans barre Safari, avec l'icône verte.*
- [x] **Autorisation des notifications** : Réglages (onglet de l'app), « Activer les notifications », accepter. *Attendu : « Notifications activées (N appareil·s abonné·s) ».*
- [x] **Notification, écran verrouillé, app fermée** *(jamais fait explicitement)* : « M'envoyer une notification dans 10 s », puis **fermer l'app** (balayer vers le haut) et **verrouiller** l'iPhone. *Attendu : la notification « 💧 3 plantes à arroser » arrive sur l'écran verrouillé en environ 10 s.*
- [x] **Toucher la notification** : *Attendu : l'app s'ouvre (ou revient au premier plan).*
- [x] **Mode Concentration / Ne pas déranger** : activer, relancer un test. *Attendu : pas de notification sonore, mais elle apparaît dans le centre de notifications à la sortie du mode.*
- [x] **Deux appareils** : activer sur un second téléphone du foyer. *Attendu : « 2 appareils abonnés », les deux reçoivent le test.*
- [x] **Après plusieurs jours** : l'abonnement iOS peut disparaître. Relancer un test 3 à 4 jours plus tard sans rouvrir l'app. *Attendu : notification reçue ; sinon noter au bout de combien de temps (important pour l'étape 6).*
- [x] **La page se charge normalement avec la politique de sécurité stricte (CSP)** : depuis l'écran d'accueil de l'iPhone, parcourir Aujourd'hui, Plantes, une fiche avec photo, Pièces, Réglages. *Attendu : aucun écran blanc, images visibles, boutons réactifs. Les tests Chrome le garantissent, mais pas Safari/iOS.*
- [x] **Mise à jour de la PWA** : après un déploiement, fermer complètement l'app et la rouvrir. *Attendu : la nouvelle version s'affiche (pas d'écran blanc, pas d'ancienne interface).*

## B. Comptes et connexion

- [x] **Passkey sur iPhone, en PWA installée** *(validé le 17/11/2026, à refaire après toute modification de `APP_URL` ou du domaine)* : Réglages, « Ajouter une passkey », puis Déconnexion, puis « Se connecter avec une passkey » (Face ID). *Attendu : connexion sans mot de passe.*
- [x] **Passkey sur un ordinateur** (Safari ou Chrome, avec le trousseau iCloud) : même parcours. *Attendu : connexion réussie.*
- [x] **Retrait d'une passkey** : « Retirer ». *Attendu : elle disparaît de la liste ; elle n'ouvre plus la connexion.*
- [x] **Gestionnaire de mots de passe** : à l'inscription et à la connexion, le trousseau propose d'enregistrer / remplir. *Attendu : champs reconnus (e-mail, mot de passe).*
- [x] **Session longue** : rester connecté plusieurs jours, rouvrir l'app. *Attendu : toujours connecté (session de 30 jours) ; sinon noter après combien de temps.*
- [x] **Mot de passe oublié, de bout en bout sur de vrais appareils** : sur le téléphone A, Réglages, « Mot de passe oublié » pour le membre B, envoyer le lien (Messages/AirDrop). Sur B, ouvrir le lien, choisir un mot de passe. *Attendu : B est déconnecté partout, peut se reconnecter ; le lien ne marche plus une seconde fois.*
- [ ] **Lien expiré** : un lien d'invitation de plus de 7 jours (ou de réinitialisation de plus de 24 h) doit afficher « invalide, expirée ou déjà utilisée ». *(À constater naturellement, ou en attendant.)* *En attente : lien de 7 jours / 24 h réels.*
- [x] **Partage de lien** : le bouton « Partager » ouvre la feuille de partage iOS ; « Copier » met bien le lien dans le presse-papiers.

## C. Plantes et photos (iPhone)

- [x] **Photo prise avec l'appareil photo** (« Prendre une photo ») en **portrait** : *Attendu : la photo s'affiche à l'endroit dans la fiche ET dans la vignette de la liste.*
- [x] **Photo de la photothèque au format HEIC** (photos récentes de l'iPhone) : *Attendu : acceptée, affichée correctement. Si « Impossible de lire la photo » : noter, c'est le redimensionnement du navigateur qui échoue sur le HEIC.*
- [x] **Photo très lourde** (panorama, photo de 10 Mo ou plus) : *Attendu : acceptée (réduite avant l'envoi) ou message clair ; pas d'écran figé.*
- [x] **Plusieurs photos sur une plante** : en ajouter 3, changer la photo affichée, retirer l'une d'elles. *Attendu : la couverture dans la liste est la plus récente.*
- [x] **Confidentialité** : la photo n'a **pas** de géolocalisation. Télécharger l'image depuis le navigateur d'un ordinateur (clic droit, enregistrer) et vérifier ses métadonnées (Lieu absent).
- [x] **Accès direct à une photo sans être connecté** : copier l'adresse d'une image (`/api/photos/…`), l'ouvrir dans une fenêtre de navigation privée. *Attendu : refusé, pas d'image.*
- [x] **Beaucoup de plantes** : en créer 30 à 40. *Attendu : la liste reste fluide, les vignettes se chargent au fil du défilement.*
- [x] **Filtre par pièce** : une pièce sans plante affiche « Aucune plante dans cette pièce ».
- [x] **Suppression d'une pièce qui contient des plantes** : le message annonce qu'elles passent « sans pièce » ; après suppression, elles apparaissent bien dans « Sans pièce ».
- [x] **Deux personnes en même temps** : A ajoute une plante pendant que B regarde la liste. *Attendu : B la voit après un rechargement (pas de temps réel prévu).*
- [x] **Confort tactile** : boutons assez grands, rien de coupé sous la barre d'accueil de l'iPhone, clavier qui ne masque pas le champ saisi.

## D. Fiche d'entretien par l'IA (la vraie)

- [x] **Nom seul, plante courante** (« Pothos ») : *Attendu : fiche en 15 à 30 s, plausible, sans jargon, intervalles d'arrosage cohérents.*
- [x] **Nom ambigu** (« Ficus », « Palmier ») : *Attendu : une espèce d'intérieur courante, pas d'erreur.*
- [x] **Nom fantaisiste** (« Bidule 3000 ») : *Attendu : une fiche générique ou un échec propre, jamais un écran cassé.*
- [x] **Photo qui ne correspond pas au nom** : *Attendu : bandeau « ⚠️ La photo ne semble pas correspondre : … » avec la plante identifiée.*
- [x] **Qualité sur tes vraies plantes** : générer la fiche de 5 plantes que tu connais bien. *Attendu : conseils justes et utiles. Noter toute information fausse ou dangereuse (arrosage, lumière).*
- [x] **Lisibilité pour un non-jardinier** : faire lire une fiche à quelqu'un du foyer. *Attendu : compréhensible sans aide, ni trop longue.*
- [x] **Quitter l'app pendant la génération** : lancer, fermer l'app tout de suite, la rouvrir 1 minute plus tard. *Attendu : la fiche est prête.*
- [x] **Plusieurs ajouts d'affilée** : ajouter 4 plantes en moins d'une minute. *Attendu : « en attente (N avant elle) » puis « en cours », puis prêtes une par une ; aucune ne reste bloquée.*
- [x] **Modifier la fiche** : changer l'arrosage, enregistrer, rouvrir l'app. *Attendu : modification conservée.*
- [x] **Régénérer** : *Attendu : avertissement que la fiche actuelle (et tes modifications) sera remplacée ; après acceptation, nouvelle fiche.*
- [x] **Échec de l'IA** *(à provoquer : voir « Pannes » ci-dessous)* : *Attendu : message d'erreur lisible et bouton « Réessayer ».*
- [x] **Limite de 5 générations simultanées** : lancer rapidement 6 générations (6 plantes) : *Attendu : un message « Déjà 5 fiches en cours » pour la dernière.*
- [x] **Consommation de l'abonnement** : après une journée d'usage normal, vérifier que l'abonnement Claude n'atteint pas ses limites (et qu'aucune facturation API n'apparaît).

## E. Serveur et exploitation (`node1`)

- [x] **Déploiement automatique** : pousser un petit changement visible sur `main`. *Attendu : en ligne en 4 à 6 minutes (CI, puis cron).*
- [x] **Redémarrage de la machine** : redémarrer `node1`. *Attendu : l'app revient seule (HTTPS, passkeys, données), sans intervention. Vérifier `docker compose ps`.*
- [x] **Coupure de courant / box** : après un redémarrage de la box, le site est de nouveau joignable depuis l'extérieur (redirections de ports conservées, IP `192.168.1.10` réservée en DHCP).
- [ ] **Renouvellement du certificat** : le certificat Let's Encrypt expire le 14/02/2027 et se renouvelle seul. Vérifier début janvier 2027 : `echo | openssl s_client -connect plantes.tvermorel.fr:443 2>/dev/null | openssl x509 -noout -enddate`. *En attente : date future (janvier 2027).*
- [ ] **Restauration d'une sauvegarde** *(jamais testée sur `node1`)* : dans un dossier à part, copier `plantes-AAAA-MM-JJ.db` depuis le volume, l'ouvrir avec `sqlite3` et compter les plantes. *Attendu : données cohérentes (`PRAGMA integrity_check` = ok).* *En attente : sauvegardes volontairement reportées.*
- [ ] **Sauvegarde des photos** : le dossier `photos/` n'est **pas** inclus dans les sauvegardes quotidiennes. À décider : copie hors machine. *En attente : sauvegardes volontairement reportées.*
- [ ] **Place disque** : après quelques mois, `docker system df` et la taille du volume `plantes-data`. *En attente : quelques mois d'usage.*
- [x] **Journal du déploiement** : `~/plantes-deploy.log` ne grossit pas anormalement (pas de rotation prévue).
- [x] **Mémoire** : pendant une génération, `free -h` sur `node1` (3,7 Go au total, d'autres services y tournent). *Attendu : pas de swap excessif ni de conteneur tué (`docker ps` après).*

### Surveillance et exploitation (nouveautés)

- [ ] **Alerte de disparition** : créer un « check » sur healthchecks.io (période 10 min, délai de grâce 10 min, alerte par e-mail), copier son URL dans `HEARTBEAT_URL` du `.env` de `node1`, relancer (`docker compose up -d`). *Attendu : le check passe au vert en moins de 5 minutes.* Puis `docker compose stop app` : *attendu : e-mail d'alerte au bout d'environ 20 minutes.* Relancer ensuite. *En attente : `HEARTBEAT_URL` pas encore configurée sur node1.*
- [x] **En-têtes de sécurité en production** : `curl -sI https://plantes.tvermorel.fr/ | grep -iE "strict-transport|content-security|x-frame|x-content-type"`. *Attendu : les quatre présents.* (Attention : HSTS est mémorisé un an par les navigateurs.)
- [ ] **Rotation des journaux** : après quelques semaines, `docker inspect plantes-app-1 --format '{{.HostConfig.LogConfig}}'` indique `max-size:10m max-file:3`, et `~/plantes-deploy.log` ne dépasse pas 1 Mo. *En attente : quelques semaines.*
- [x] **Mise à jour du SDK Claude** : il est figé. Pour le mettre à jour : changer la version dans `apps/api/package.json`, `pnpm install`, `pnpm test`, puis **une vraie génération** (`pnpm test:ai`) avant de pousser.

### Pannes à provoquer (pour voir que l'app réagit proprement)

- [x] **IA indisponible** : renommer temporairement `CLAUDE_CODE_OAUTH_TOKEN` dans le `.env` de `node1`, relancer (`docker compose up -d`), demander une fiche. *Attendu : erreur lisible + « Réessayer ». Remettre le token ensuite.*
- [ ] **Token expiré** : le jeton `claude setup-token` a une durée de vie ; noter la date de création et prévoir son renouvellement. *Sera traité par la nouvelle gestion du jeton.*
- [x] **Serveur redémarré pendant une génération** : `docker compose restart app` pendant « Claude prépare la fiche… ». *Attendu : la génération reprend et aboutit (testé automatiquement, à constater en vrai).*
- [x] **Perte de réseau sur l'iPhone** : couper le Wi-Fi/4G, ouvrir l'app. *Attendu : message d'erreur, pas d'écran blanc ; tout revient au retour du réseau (pas de mode hors ligne prévu).*

## F. Sécurité (regard extérieur)

- [x] **Depuis un autre réseau (4G), sans compte** : l'URL ne montre que l'écran de connexion ; aucune donnée sans connexion.
- [x] **Inscription sauvage** : sur `/login`, aucun moyen de créer un compte sans invitation (après la création du premier compte, « Créer le premier compte » n'est plus proposé).
- [x] **Tentatives répétées** : 5 mauvais mots de passe en quelques secondes. *Attendu : à partir de la 4e, message « Trop de tentatives, réessaie dans un moment » (limiteur de Better Auth, 3 connexions par 10 s). Vérifier aussi qu'un utilisateur normal n'est jamais bloqué en se trompant une fois.*
- [x] **Lien d'invitation transmis** : vérifier qu'après usage il est mort, et que l'invitation affiche bien le prénom de la personne qui invite (contre l'hameçonnage).
- [x] **Révocation** : changer un mot de passe via lien de réinitialisation et vérifier que l'ancien appareil est déconnecté.
- [ ] **Ports exposés** : depuis l'extérieur, seuls 80 et 443 répondent (`nmap -p 1-1000 82.67.218.121` depuis un autre réseau). Le port 3000 de l'app et SSH ne doivent pas être joignables. *En attente : test IPv6 depuis la 4G à confirmer.*

## G. Rappels d'arrosage et journal (étape 6)

*Les rappels réels dépendent de l'heure : le premier test utile se fait le lendemain matin.*

- [x] **« Tester le vrai rappel »** (Réglages) sur l'iPhone, écran verrouillé. *Attendu : notification « 🧪 Test : 💧 N plantes à arroser » avec les noms des plantes ; si rien n'est à arroser : « Rien à arroser ».*
- [x] **Premier rappel réel à 9 h** : s'arranger pour qu'une plante soit à arroser (voir « Provoquer un rappel » ci-dessous), ne pas ouvrir l'app, attendre 9 h. *Attendu : une seule notification regroupant toutes les plantes, avec le bon nombre au bon accord (« 1 plante » / « 3 plantes »).*
- [x] **Toucher la notification** : *Attendu : l'app s'ouvre sur « Aujourd'hui » avec la liste à jour (pas l'ancienne).*
- [x] **Relance de 18 h** : si la plante n'a pas été arrosée, une notification « Toujours à arroser : … » arrive à 18 h ; **si elle a été cochée dans la journée, aucune notification à 18 h.**
- [x] **Un membre coche, l'autre n'est plus relancé** *(deux téléphones)* : A coche une plante à 14 h. *Attendu : B ne reçoit pas de relance à 18 h pour cette plante, et voit « Rien à arroser » en ouvrant l'app.*
- [x] **Au plus une notification par créneau et par personne** : sur 2 jours, compter les notifications reçues. *Attendu : 1 à 9 h, 1 à 18 h seulement s'il reste des plantes ; jamais de doublon.*
- [x] **Dernier arrosage à l'ajout d'une plante** : ajouter une plante réellement arrosée il y a une semaine, en choisissant « Il y a environ une semaine ». *Attendu : un arrosage daté d'il y a 7 jours dans son journal, et un rappel qui arrive au bon moment (pas un intervalle complet plus tard). Avec « plus de deux semaines (ou je ne sais pas) » : la plante est à arroser tout de suite.*
- [x] **« Oublié de cocher ? Arrosée plus tôt »** (fiche d'une plante) : choisir « Hier ». *Attendu : l'arrosage apparaît à sa vraie date dans le journal, et l'échéance est recalculée.*
- [x] **Abonnement sans compte supprimé** (une seule fois, au premier démarrage après la mise à jour) : le journal du serveur contient `[push] 1 abonnement(s) sans compte supprimé(s)`, et tes notifications fonctionnent toujours (« M'envoyer une notification dans 10 s »).
- [x] **« Encore humide »** : le rappel est repoussé de 2 à 7 jours (un quart de l'intervalle). *À juger sur un mois : est-ce trop court ou trop long ? Les valeurs se règlent dans `apps/api/src/lib/watering.ts` (`postponeDays`).*
- [x] **Annuler une erreur de clic** : cocher « Arrosée » par erreur, appuyer sur « Annuler » dans le bandeau (10 s), puis le refaire plus tard depuis le journal de la plante. *Attendu : la plante redevient à arroser.*
- [x] **Intervalles du rythme** : comparer le rythme proposé par l'IA avec ton expérience sur 5 plantes. Corriger dans la fiche (« Modifier ») : *Attendu : le prochain arrosage est recalculé tout de suite.*
- [ ] **Changement de saison** : le 1er avril et le 1er octobre, l'intervalle bascule (été 7 j / hiver 12 j par exemple). *À constater : les échéances sautent d'un coup ; est-ce gênant ?* *En attente : 1er avril 2027.*
- [ ] **Changement d'heure** (dimanche 28/03/2027 et dimanche 31/10/2027) : *Attendu : le rappel part toujours à 9 h, heure de Paris, ni 8 h ni 10 h.* *En attente : 28/03/2027.*
- [x] **Fuseau de l'appareil** : en voyage ou avec un autre fuseau sur le téléphone, les heures du journal s'affichent en heure locale et les rappels restent à l'heure de Paris.
- [x] **Serveur éteint à 9 h** : arrêter l'app avant 9 h (`docker compose stop app`), la relancer à 10 h. *Attendu : le rappel part au redémarrage (rattrapage jusqu'à 3 h après le créneau). Relancée à 12 h 30 : pas de rappel tardif.*
- [x] **Redémarrage dans la journée** : `docker compose restart app` après le rappel de 9 h. *Attendu : pas de second rappel.*
- [x] **Retour dans l'app** : après avoir arrosé sur un téléphone, rouvrir l'app sur l'autre. *Attendu : la liste est à jour (rechargement au retour au premier plan).*
- [x] **Lisibilité de « Aujourd'hui »** avec 15 plantes en retard : liste fluide, boutons assez grands pour le pouce, pas de clic accidentel.
- [x] **Journal** : ajouter engrais, rempotage et une note avec accents et emoji. *Attendu : affichés tels quels, signés du bon prénom, supprimables avec « Annuler ».*
- [x] **Désabonnement** : retirer l'autorisation de notification dans les réglages d'iOS, attendre un rappel. *Attendu : pas d'erreur côté serveur ; l'abonnement est retiré au premier rejet (journal : `[push] échec (410)`).*

### Provoquer un rappel sans attendre

Les plantes neuves ne sont à arroser qu'au bout d'un intervalle. Pour tester vite, sur `node1` :

```
cd ~/plantes
docker compose exec app node -e "
const D=require('/app/apps/api/node_modules/better-sqlite3');
const db=new D('/app/data/plantes.db');
// rend la plante « Calathea » à arroser (créée il y a 30 jours, journal d'arrosage effacé)
db.prepare(\"update plants set created_at=? where name=?\").run(Date.now()-30*864e5,'Calathea');
db.prepare(\"delete from care_events where plant_id in (select id from plants where name=?)\").run('Calathea');
"
```

*(à adapter au nom de la plante ; ne touche qu'à cette plante. Sinon, utiliser « Tester le vrai rappel », qui n'attend pas l'heure.)*

## H. Ce qui ne sera testable qu'aux étapes suivantes

- Diagnostic santé par photo, chat par plante, timeline photo (V2).
- Raccourci iOS appelant l'API (bonus).
