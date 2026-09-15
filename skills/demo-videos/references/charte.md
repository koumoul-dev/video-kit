# Charte et habillage

L'habillage est fourni par `@koumoul/video-kit` (`src/overlay.ts`,
`assets/charte/`) : aucun style à réécrire dans les scénarios. Cette page décrit
le rendu attendu et les règles à respecter quand on adapte un scénario.

## Couleurs et typographie

| Rôle | Valeur |
| --- | --- |
| Fond de carton | dégradé vertical `#0A2F5E` (haut) → `#1976D2` (bas) |
| Bandeau supérieur + accent | `#81D4FA` |
| Texte de carton | blanc, badge en `#81D4FA` |
| Sous-titres incrustés | texte blanc sur `#424242` translucide (`rgba(66,66,66,.86)`) |
| Police | Nunito 400 / 600 / 700, sous-ensemble latin embarqué en base64 |
| Logo | Koumoul blanc « La donnée accessible » (`logo-slogan-white.png`) |

Les tailles de police sont exprimées en `vw` (titre ≈ 6,1 vw plafonné à 78 px,
sous-titre ≈ 2,8 vw, badge ≈ 2 vw) : le même habillage tient en 720p comme en
1080p.

## Cartons d'introduction et de fin

- **Opaque dès la première frame** : le texte est posé sans dépendre du réseau
  (police et logo embarqués), ce qui couvre le préambule de chargement et évite
  une frame blanche.
- **Intro ≥ 2,6 s** (`hideIntro` applique `minVisibleMs` par défaut), le temps de
  lire le titre ; l'affichage est suivi d'un fondu de ~380 ms.
- **Repère de calage** : le montage recale le t = 0 sur le passage écran blanc →
  carton (changement de scène), puis coupe l'amorce (chargement, flash blanc).
  Ne pas supprimer ce flash quand le mode à beats est utilisé.
- **Fin** : carte affichée par-dessus l'écran final, avec le site (`datafair.cloud`,
  `koumoul.com`…) ; le curseur est masqué comme sur l'intro.

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
  subtitle: 'Ajouter un point, corriger un tracé, changer une couleur — en direct'
}
```

## Curseur factice

Playwright ne filme jamais le curseur système : le kit injecte une flèche
blanche à liseré sombre, déplacée par les vrais événements souris, avec une onde
bleue à chaque clic. Les gestes sont humanisés (courbes de Bézier, frappes
ralenties, drags en quelques pas pour ne pas surcharger le rendu des cartes).

- **Sur un carton (intro ou fin), le curseur est masqué** via la classe
  `demo-cover` posée sur `<html>` : un curseur qui flotte au-dessus d'un écran
  de titre n'a aucun sens. Ne pas le réafficher pendant un carton.
- `setTimeScale(0.5)` compresse les temps morts des gestes sans toucher aux
  trajectoires, utile pour les formats courts.
- `installCursor` masque aussi le curseur système (`cursor: none !important`).

## Sous-titres

Deux mécanismes, selon le format :

- **mode voix / muet** : `mux` génère un `.srt` et une variante incrustée
  `.st.mp4` (`--burn`). Les cues font **2 lignes maximum**, ~40 caractères par
  ligne, coupées de préférence à une fin de phrase ; en voix elles sont calées
  mot à mot, en muet ancrées sur la durée réelle de la scène (~13 caractères/s,
  minimum 1,2 s).
- **format court** : sous-titres incrustés au fil du scénario via
  `setCaption(page, text)` (fond `#424242` translucide, bas centre). Décaler la
  zone avec `--caption-right 420` quand un panneau latéral occupe la droite
  (application carto).

Le texte affiché est celui de `script.md` ; les corrections de prononciation ne
s'appliquent qu'à la synthèse (`pronunciations`), jamais au SRT.

## Formats d'enregistrement

- **1920×1080** : cours et démos d'atelier (projection, plein écran).
- **1280×720** : formats courts — plus petit format qui conserve la disposition
  desktop (panneau latéral visible) et reste lisible dans un fil social.
- `deviceScaleFactor: 1`, locale `fr-FR`, timezone `Europe/Paris` : ne pas
  modifier, les vidéos sont produites en français.
