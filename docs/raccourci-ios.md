# Raccourcis iOS pour « Plantes »

Trois raccourcis à construire à la main dans l'app **Raccourcis** d'iOS : « J'ai arrosé une plante », « Qu'est-ce que j'arrose aujourd'hui ? » et « J'ai tout arrosé ». Chacun peut être lancé par Siri, un bouton de l'écran d'accueil ou une automatisation.

Limite : on ne peut pas fournir de fichier `.shortcut` prêt à importer. Apple n'accepte que des fichiers signés par ses services, donc chaque raccourci se construit à la main (5 minutes).

L'adresse du serveur est `https://plantes.tvermorel.fr`.

## 1. Créer un jeton

1. Dans l'app Plantes : **Réglages**, carte **Raccourci iOS**.
2. Donne un nom (par exemple « iPhone ») puis **Créer un jeton**.
3. Copie le jeton affiché (il commence par `plt_`). **Il ne sera plus jamais affiché** : seule une empreinte est conservée sur le serveur.
4. Colle-le dans une note ou, mieux, directement dans le raccourci (étape suivante).

Le jeton donne accès à l'arrosage de tout le foyer et à rien d'autre : il ne peut ni créer d'autres jetons, ni lire les photos, ni modifier les fiches. Maximum 5 jetons par personne.

## 2. « Qu'est-ce que j'arrose aujourd'hui ? »

1. Raccourcis, **+** (nouveau raccourci), nomme-le « Qu'est-ce que j'arrose aujourd'hui ».
2. Action **Obtenir le contenu de l'URL** :
   - URL : `https://plantes.tvermorel.fr/api/shortcuts/today`
   - Méthode : GET
   - Afficher plus, **En-têtes**, ajouter : clé `Authorization`, valeur `Bearer plt_…` (le mot Bearer, une espace, puis ton jeton).
3. Action **Obtenir la valeur du dictionnaire** : clé `text`, depuis « Contenu de l'URL ».
4. Action **Énoncer le texte** (ou **Afficher la notification**) sur cette valeur.

Siri dira par exemple « 3 plantes à arroser : Monstera, Ficus, Pothos. » ou « Rien à arroser aujourd'hui. ».

## 3. « J'ai arrosé <plante> »

1. Nouveau raccourci, nommé « J'ai arrosé une plante ».
2. Action **Obtenir le contenu de l'URL** sur `https://plantes.tvermorel.fr/api/shortcuts/plants` (GET, même en-tête `Authorization`).
3. Action **Choisir dans la liste** : choisis le champ `name` de chaque élément (Raccourcis propose « Obtenir les noms » : ajoute l'action **Obtenir la valeur du dictionnaire** avec la clé `name` sur le résultat, qui s'applique à chaque élément de la liste).
4. Action **Obtenir le contenu de l'URL** :
   - URL : `https://plantes.tvermorel.fr/api/shortcuts/water`
   - Méthode : **POST**
   - En-tête `Authorization` : `Bearer plt_…`
   - Corps de la requête : **JSON**, un champ `plant` de type Texte, valeur = « Élément choisi ».
   - Option : un champ `daysAgo` de type Nombre (0 à 60) pour un arrosage fait il y a quelques jours.
5. **Obtenir la valeur du dictionnaire** (clé `text`) puis **Énoncer le texte**.

Variante vocale : remplace l'étape 2 et 3 par **Demander une entrée** (type Texte, question « Quelle plante ? ») ; Siri peut aussi la dicter. Le nom est reconnu sans tenir compte des majuscules ni des accents, et une partie du nom suffit (« monstera » trouve « Monstera deliciosa »).

Réponses possibles :
- 200 : « Monstera arrosée. Prochain arrosage dans 7 jours. »
- 409 : plusieurs plantes correspondent ; la liste des candidats est dans `candidates`, le texte à lire dans `text`. Rien n'est enregistré.
- 404 : aucune plante ; `suggestion` propose le nom le plus proche s'il y en a un.

## 4. « J'ai tout arrosé »

Comme le raccourci précédent, avec une seule action **Obtenir le contenu de l'URL** :
- URL `https://plantes.tvermorel.fr/api/shortcuts/water`, méthode POST, en-tête `Authorization`.
- Corps JSON : champ `all` de type Texte, valeur `due`.

Toutes les plantes à arroser aujourd'hui ou en retard sont marquées arrosées (100 au plus). Puis **Obtenir la valeur du dictionnaire** (`text`) et **Énoncer le texte** : « 3 plantes arrosées : Monstera, Ficus, Pothos. » ou « Rien à arroser aujourd'hui. ».

Pour arroser plusieurs plantes précises : champ `plants` de type Liste (20 au plus).

## 5. Lancer un raccourci

- Siri : « Dis Siri, qu'est-ce que j'arrose aujourd'hui ».
- Écran d'accueil : dans le raccourci, bouton de partage, **Sur l'écran d'accueil**.
- Automatisation : onglet Automatisation (par exemple chaque matin à 9 h, « Qu'est-ce que j'arrose aujourd'hui »).

## 6. Jeton perdu ou téléphone perdu

Dans l'app : **Réglages**, carte **Raccourci iOS**, **Révoquer** à côté du jeton. L'effet est immédiat : le jeton est refusé à la requête suivante. Crée-en ensuite un nouveau et remplace-le dans tes raccourcis.

## Exemples avec curl

```sh
TOKEN=plt_…            # le jeton copié dans l'app
URL=https://plantes.tvermorel.fr

# Liste des plantes
curl -s -H "Authorization: Bearer $TOKEN" $URL/api/shortcuts/plants

# Ce qu'il y a à arroser
curl -s -H "Authorization: Bearer $TOKEN" $URL/api/shortcuts/today

# J'ai arrosé la Monstera (aujourd'hui)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"plant":"monstera"}' $URL/api/shortcuts/water

# Arrosée il y a 3 jours
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"plant":"monstera","daysAgo":3}' $URL/api/shortcuts/water

# J'ai tout arrosé
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"all":"due"}' $URL/api/shortcuts/water
```

## Sécurité

- Le jeton ne se passe que dans l'en-tête `Authorization`, jamais dans l'adresse.
- Une réponse 401 est identique que le jeton soit absent, faux ou révoqué.
- Débit limité (120 requêtes par minute et par adresse).
