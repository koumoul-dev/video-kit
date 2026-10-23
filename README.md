# @koumoul/video-kit

Production des vidéos de démonstration Koumoul / Data Fair : scénarios
Playwright scriptés, cartons d'intro et de fin à la charte, curseur factice,
synthèse vocale (ou mode muet), sous-titres incrustés, montage MP4/SRT.

Le kit est piloté par un fichier `script.md` (source de vérité de la narration)
et un `scenario.ts` (actions Playwright, une fonction par scène) :

```
<videos-dir>/<slug>/
├── script.md        # front matter + beats (narration « > » + mise en scène)
├── scenario.ts      # actions Playwright
├── assets/          # fichiers de démonstration
└── out/             # vidéo brute, timeline, MP4, SRT (gitignoré)
```

## Installation

```bash
npm i -D @koumoul/video-kit @playwright/test
# voix : Python + edge-tts / kokoro / soundfile dans un venv du projet
python3 -m venv .venv && .venv/bin/pip install edge-tts kokoro soundfile
```

Prérequis : Node ≥ 22.18, `@playwright/test` ≥ 1.59, `ffmpeg` et `ffprobe`
(libass pour `--burn`), Google Chrome.

La vidéo est capturée image par image (screencast Playwright horodaté, encodé
en H.264 quasi sans perte) puis montée en H.264 `-crf 18` : pas de
`recordVideo`, dont l'encodage VP8 à 1 Mbit/s dégradait le texte et les
mouvements. L'horodatage des images donne un calage exact du montage.

## Commandes

```bash
npx koumoul-video record --video <slug> --preset <voix|muet|social>          # tournage
npx koumoul-video record --video <slug> --preset muet --mux --burn           # + montage
npx koumoul-video mux --video <slug> [--burn]                                # montage seul
npx koumoul-video tts --video <slug> [--force|--bakeoff|--bakeoff-prononciation]
npx koumoul-video clean --video <slug> [--id <dataset-id>] [--url <back-office>]
```

Options : `--videos-dir` (défaut `videos`), `--size`, `--url`, `--headed`,
`--no-tts`, `--state`, `--caption-right`. Voir `npx koumoul-video help`.

La session vient du proxy NHI (`npx @data-fair/nhi-proxy serve --profile
<profil>`) : Chromium est lancé derrière lui et reçoit les cookies dès la
première navigation. Choix du proxy : `NHI_PROXY_SERVER`, navigateur MCP
d'opencode, ou profil nhi-proxy (`NHI_PROXY_PROFILE`) ; `RECORD_NO_PROXY=1` pour
un chargement anonyme.

## Formats

| Preset | Taille | Narration | Cas d'usage |
| --- | --- | --- | --- |
| `voix` | 1920×1080 | edge-tts / kokoro, SRT mot à mot | cours, tutoriels |
| `muet` | 1920×1080 | aucune, sous-titres ancrés sur la scène | démos d'atelier |
| `social` | 1280×720 | aucune, sous-titres incrustés par le scénario | formats courts |

`--scale <n>` multiplie la définition sans changer la mise en page : `--preset
social --scale 1.5` donne une vidéo 1920×1080 avec l'interface d'une fenêtre
1280×720 (texte 1,5 fois plus net) ; `--scale 3` donne de la 4K.

Variante de `muet` : `habillage: panneaux` dans le front matter — les citations
deviennent des **panneaux pleine page** insérés au montage entre les fragments,
le chargement de chaque fragment est coupé (marque `mark()` du scénario), et
aucun sous-titre n'est produit. Réservé au muet.

Sans `script.md`, le kit bascule en **format court** : le scénario exporte son
accroche (`export const intro`), pilote les sous-titres (`setCaption`) et la
carte de fin (`showOutro`) ; le préambule de chargement est coupé par analyse de
luminance au montage.

## API de scénario

```ts
import {
  clickLocator, clickHuman, dragHuman, typeHuman, replaceTextHuman,
  fillLocatorHuman, setTimeScale, sleep,
  setCaption, say, hideIntro, showOutro,
  type ScenarioContext
} from '@koumoul/video-kit'

export default async ({ page, beat, idle, mark, log }: ScenarioContext) => {
  await beat('beat-00', async () => { /* carton affiché par le kit */ })
  await beat('beat-01', async () => {
    idle.begin()      // attente LLM compressée ×6 au montage
    // …
    idle.end()
    await mark()      // fin du chargement (habillage panneaux)
  })
}
```

## Skill pour agents

Le dépôt embarque un skill de codage (`skills/demo-videos`) : workflow complet,
charte et pièges. Installation dans un projet :

```bash
npx skills add koumoul-dev/video-kit
```

## Développement

```bash
npm install
npm run build       # dist/ (tsc)
npm test            # node --test (découpage des cues, compression des attentes)
npm run lint
npm run typecheck
npm run quality     # lint + typecheck + tests
```

`assets/charte/` embarque la police Nunito (OFL, woff2 pour les cartons, TTF
pour l'incrustation libass) et le logo officiel Koumoul blanc en SVG (dépôt
`communication`, `logos/svg/logo-slogan-white.svg`) ; `assets/synth_*.py` portent
la synthèse vocale. Les couleurs sont celles du thème par défaut de data-fair.

## Licence

MIT.
