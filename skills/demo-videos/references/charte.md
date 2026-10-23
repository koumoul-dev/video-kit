# Charte et habillage

L'habillage est fourni par `@koumoul/video-kit` (`src/overlay.ts`,
`assets/charte/`) : aucun style à réécrire dans les scénarios. Cette page décrit
le rendu attendu et les règles à respecter quand on adapte un scénario.

## Couleurs et typographie

Les couleurs sont celles du thème par défaut de data-fair
(`@data-fair/lib-common-types/theme`), complétées par celles du portail
datafair.cloud pour le texte sur fond clair. Ne pas en inventer d'autres, y
compris dans les schémas animés maison des formats courts.

| Rôle | Valeur |
| --- | --- |
| Fond de carton | dégradé vertical `#0B3E8C` (haut) → `#1976D2` (primary, bas), grain fixe ~3 % ; le haut est blue-darken-4 `#0D47A1` assombri de 13 %, seule couleur hors thème, pour la profondeur |
| Trait d'accent et badge | `#81D4FA` (secondary) |
| Texte de carton | blanc |
| Sous-titres incrustés | texte blanc sur `#424242` (surface-inverse) translucide |
| Sous-titres `plain` | texte marine `#0A2F5E` en gras, halo clair, sans bandeau, pleine largeur (rendu des teasers de Nicolas) |
| Fond clair des schémas | `#F8FBFE` (background de datafair.cloud) |
| Police | Nunito 400 / 600 / 700, sous-ensemble latin embarqué en base64 ; TTF 600 pour l'incrustation `.st.mp4` |
| Logo | Koumoul blanc « La donnée accessible », SVG officiel (`logo-slogan-white.svg`) |

Le logo vient du jeu officiel du dépôt `communication`
(`logos/svg/logo-slogan-white.svg`, texte vectorisé). Le remplacer par une
nouvelle version de ce fichier, jamais par un PNG exporté d'ailleurs.

Les tailles sont exprimées en `vh` (titre 10,6 vh, sous-titre 4,9 vh, badge
3,4 vh, logo 7,4 vh, site 2,8 vh), sans plafond en pixels : un carton 1080p a
exactement les proportions d'un carton 720p.

Le grain évite que l'encodage H.264, puis le réencodage des réseaux sociaux,
découpe le dégradé en bandes. Il est fixe (pas de scintillement) et invisible à
l'œil nu.

## Un seul gabarit de carte

Intro, fin et panneaux du montage partagent le même gabarit (`cardHtml`) :

```
            BADGE (facultatif)
                ───            trait d'accent, toujours présent
          Titre sur une ou
             deux lignes
      Sous-titre (facultatif)

             [logo Koumoul]    toujours en bas, au même endroit
              site.exemple     sous le logo
```

Un champ vide est masqué sans déplacer le reste : le trait, le logo et le site
ne bougent pas d'un carton à l'autre. Le site va dans le champ `site`, jamais
dans `subtitle`.

## Cartons d'introduction et de fin

- **Opaque dès la première frame** : le texte est posé sans dépendre du réseau
  (police et logo embarqués), ce qui couvre le préambule de chargement et évite
  une frame blanche.
- **Intro ≥ 2,6 s** (`hideIntro` applique `minVisibleMs` par défaut), le temps de
  lire le titre ; l'affichage est suivi d'un fondu de ~380 ms.
- **Calage** : la vidéo brute est horodatée image par image ; le montage coupe
  l'amorce (chargement) à l'instant où le carton est peint, sans détection.
- **Fin** : même gabarit que l'intro, posé par-dessus l'écran final.
  `showOutro(page)` sans carton reprend l'intro à l'identique (le plus simple
  pour une vidéo de démonstration) ; avec un carton, la phrase d'appel va en
  titre et le site est repris de l'intro (`carton_site`, ou `site` de l'`intro`
  exportée) s'il n'est pas fourni ; passer `site: ''` pour l'omettre. Pas de
  pied de carton du type « démonstration Koumoul » : le logo suffit. Le curseur est masqué comme sur
  l'intro.

Le carton reprend le front matter de `script.md` :

```yaml
titre: L'assistant IA en back-office
carton_eyebrow: Atelier — L'IA au service des données ouvertes
carton_sous_titre: Data Fair — démonstration
carton_site: koumoul.com
```

Pour un format court (sans `script.md`), le scénario exporte son accroche :

```ts
export const intro = {
  badge: 'Data Fair · démonstration',
  title: 'Éditez vos données cartographiques sans SIG',
  subtitle: 'Ajouter un point, corriger un tracé, changer une couleur — en direct',
  site: 'datafair.cloud'
}
```

## Panneaux de chapitre (habillage `panneaux`)

Variante sans sous-titres (`habillage: panneaux` dans `script.md`, réservée au
mode muet) : le montage fabrique des panneaux pleine page (`src/panels.ts`) et
les insère entre les fragments vidéo ; le texte de lecture vient des citations
de `script.md`, le titre du beat devient le titre du panneau.

- **Même gabarit que les cartons** (voir plus haut), site `carton_site` ;
- eyebrow : numérotation `01 / 05` par défaut, remplaçable par un libellé de
  front matter (`panneaux_badge: Data Fair`, ex. marque ou événement) ; titre,
  texte de 1 à 2 phrases (viser ~100 à 150 caractères, c'est un panneau, pas une
  page) ;
- **durée = temps de lecture** (~2,6 mots/s, plancher 3 s) ;
- rendu PNG par Chromium headless **sans animation** (transitions neutralisées,
  chaque graisse de Nunito chargée avant la capture) : l'image est déterministe,
  le panneau est encodé en segment muet à la cadence de la vidéo puis recollé au
  concat demuxer ;
- le chargement de chaque fragment est coupé (marque `mark()` du scénario, repli
  par détection d'écran blanc) : le panneau remplace l'écran d'attente.

## Curseur factice

Playwright ne filme jamais le curseur système : le kit injecte une flèche
blanche à liseré sombre, déplacée par les vrais événements souris, avec une onde
bleue à chaque clic. Les gestes sont humanisés (courbes de Bézier, frappes
ralenties, drags en quelques pas pour ne pas surcharger le rendu des cartes).

- **Caché tant que la souris n'a pas bougé** : pas de flèche dans le coin haut
  gauche à l'ouverture d'une page, ni pendant un schéma animé sans interaction.
- **Replacé après une navigation** à sa dernière position (celle de la souris
  Playwright), au lieu de repartir du coin.
- **Effacé après 3 s d'immobilité**, réaffiché au mouvement suivant : un curseur
  garé sur le contenu pendant une longue scène gêne la lecture. Pour pointer
  durablement un élément, le désigner par un sous-titre ou bouger légèrement.
- **Sur un carton (intro ou fin), le curseur est masqué** via la classe
  `demo-cover` posée sur `<html>` : un curseur qui flotte au-dessus d'un écran
  de titre n'a aucun sens. Ne pas le réafficher pendant un carton.
- `setTimeScale(0.5)` compresse les temps morts des gestes sans toucher aux
  trajectoires, utile pour les formats courts.
- `installCursor` masque aussi le curseur système (`cursor: none !important`).

## Polices

Le tournage relève toutes les 3 s les pages (et iframes) dont le texte s'affiche
dans une police de repli : police en erreur dans `document.fonts`, ou corps de
page resté en « Times New Roman » (feuille de thème non chargée, aperçu de page
de portail par exemple). Chaque cas est journalisé (`⚠ police …`) et récapitulé
en fin de tournage : relire ces passages, et refaire la prise si le défaut est à
l'écran.

## Sous-titres

Deux mécanismes, selon le format :

- **mode voix / muet** : `mux` génère un `.srt` et une variante incrustée
  `.st.mp4` (`--burn`, Nunito SemiBold sur bandeau `#424242`). Les cues font
  **2 lignes maximum**, ~40 caractères par ligne, coupées de préférence à une
  fin de phrase ; en voix elles sont calées mot à mot, en muet ancrées sur la
  durée réelle de la scène (~13 caractères/s, minimum 1,2 s).
- **format court** : sous-titres incrustés au fil du scénario via
  `setCaption(page, text)` ou `say(page, text, actions)` (bas centre). Décaler la
  zone avec `--caption-right 420` quand un panneau latéral occupe la droite
  (application carto). Sur un schéma à fond clair, `export const caption =
  { style: 'plain' }` dans le scénario remplace le bandeau par un texte foncé.

Le texte affiché est celui de `script.md` ; les corrections de prononciation ne
s'appliquent qu'à la synthèse (`pronunciations`), jamais au SRT.

## Formats d'enregistrement

Deux réglages indépendants :

- **la fenêtre** (`--size`, pixels CSS) fixe la mise en page et donc la taille
  de l'interface à l'écran ;
- **la densité** (`--scale`) multiplie les pixels sans changer la mise en page :
  la vidéo fait `fenêtre × densité`. Le kit lance Chrome avec
  `--force-device-scale-factor` en plus du `deviceScaleFactor` du contexte
  (sans le drapeau, le screencast headless reste en pixels CSS).

| Usage | Fenêtre | Densité | Vidéo |
| --- | --- | --- | --- |
| LinkedIn, pages Fonctionnalités, schémas animés | 1280×720 | 1,5 | 1920×1080 |
| Boucle de stand (lisible à 2-3 m) | 1280×720 | 1,5 (3 pour la 4K) | 1080p (ou 2160p) |
| Cours et démos projetés | 1920×1080 | 1 | 1920×1080 |

- 1280×720 garde la disposition desktop (au-dessus du seuil `lg` de Vuetify,
  1145 px) avec une interface lisible de loin ; en 1920×1080 de fenêtre,
  l'interface paraît plus petite.
- La 4K (`--scale 3`) fonctionne mais coûte cher : ~3 Go de RAM au pic, tournage
  et montage ~3 fois plus longs, moins d'images distinctes par seconde dans les
  mouvements. À réserver à une boucle de stand sur un écran 4K.
- Locale `fr-FR`, timezone `Europe/Paris` : ne pas modifier, les vidéos sont
  produites en français.
