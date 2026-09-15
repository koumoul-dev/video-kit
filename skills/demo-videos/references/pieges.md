# Pièges et parades

Retours d'expérience des tournages `pilotage`, `documentation` et
`app-edit-map`.

## Scénario

- **Cliquer sur un `VColorInput` ouvre son menu** (scrim bloquant) : utiliser
  `fillLocatorHuman` (valeur posée d'un coup).
- **`Escape` sur un tiroir Vuetify** peut laisser un `v-overlay__scrim` orphelin :
  fermer par le bouton dédié.
- **Champ date VJSF** : format local (`jj/mm/aaaa`), commité au blur seulement —
  prévoir `Tab`/blur avant de lire la valeur.
- **`getByLabel('Mise en service')` matche aussi l'icône du calendrier** :
  `.first()` ou un sélecteur plus précis.
- **Snackbars** : elles recouvrent les actions et suspendent la fermeture du
  tiroir ; les fermer comme un utilisateur (bouton de la snackbar) avant l'étape
  suivante.
- **SPA non rafraîchie** après un import : la validation du brouillon n'apparaît
  qu'après rechargement (boucler les `page.reload()`).
- **L'agent LLM** : ne pas envoyer de message tant que le précédent n'est pas
  terminé (caret de streaming disparu, sous-agent non `text-warning`, bouton
  « Arrêter » revenu, sur une fenêtre de silence). Un envoi trop tôt provoque des
  erreurs 400/409.
- **Consentement des traces** : demandé par conversation, il bloque la barre du
  tiroir — l'accepter avant la saisie et après l'envoi.
- **Recherche serveur absente** (ex. combobox Concept en 404) : remplacer par un
  contrôle API après enregistrement, avec repli explicite.
- **Ce qui dépend d'un état déjà servi** (groupes de schéma, tuiles) : recharger
  la page avant de filmer, et vérifier l'état final (une capture d'écran de
  contrôle avant montage coûte moins cher qu'un re-tournage).

## Tournage

- **Ordre des beats imposé** : un `beat()` hors séquence lève une erreur ;
  regrouper les actions dans le beat concerné, pas dans le prélude.
- **Marquer les attentes longues** : `idle.begin()` (LLM, ×6) et
  `idle.begin(10)` (analyse de fichier, finalisation). Sans cela la vidéo traîne
  et le montage ne peut pas compresser.
- **La sortie ne doit pas aller dans `tests/output`** : Playwright vide ce dossier
  à chaque lancement de tests. Le kit écrit dans `<videos-dir>/<slug>/out/`.
- **Ne pas supprimer le flash blanc de l'intro** en mode à beats : c'est le
  repère de calage du t=0 au montage.
- **Formulaire ou aperçu non rafraîchi** après une action : attendre la réponse
  réseau ou un polling court avec plafond, plutôt qu'un `sleep` long (le temps
  mort se voit à l'écran).
- **Formats courts** : `setTimeScale(0.5)` et des attentes plafonnées
  (ex. 3,5 s pour la mise à jour des tuiles) donnent un rythme lisible ; ne pas
  attendre une finalisation distante qui dépasse la durée de la vidéo.

## Habillage et CSP

- Data Fair applique une CSP `style-src` stricte : le kit utilise des **feuilles
  de style constructibles** (`document.adoptedStyleSheets`), pas de `<style>` ni
  d'attribut `style` pour les règles. Ne pas casser ce mécanisme en ajoutant du
  CSS inline dynamique.
- Les cartons embarquent police et logo en base64 : le contenu de la première
  frame ne doit dépendre d'aucune requête réseau.

## Sécurité et données

- **Aucun secret à l'écran** : token, clé d'API, cookie, données personnelles.
  Inspecter la vidéo avant diffusion.
- **Nettoyer la démo distante** après tournage (`clean`), y compris en cas
  d'échec partiel (`--id`).
- **Ne jamais committer** `out/`, `.auth/`, les MP4, les CSV volumineux : ils
  restent locaux et se copient hors du dépôt pour diffusion.

## Environnement

- Node ≥ 22.18 requis (exécution TypeScript des scénarios sans build).
- `ffmpeg` / `ffprobe` requis pour la synthèse, le montage et les vérifications.
- Voix : installer `edge-tts`, `kokoro`, `soundfile` dans `.venv` à la racine du
  projet ; le kit cherche `.venv/bin/python` dans le dossier des vidéos et ses
  parents, sinon `python3`.
