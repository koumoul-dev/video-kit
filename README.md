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
└── out/             # WebM, timeline, MP4, SRT (gitignoré)
```

## Installation

```bash
npm i -D @koumoul/video-kit @playwright/test
# voix : Python + edge-tts / kokoro / soundfile dans un venv du projet
python3 -m venv .venv && .venv/bin/pip install edge-tts kokoro soundfile
```

Prérequis : Node ≥ 22.18, `ffmpeg` et `ffprobe`, Google Chrome.

## Commandes

```bash
npx koumoul-video record --video <slug> --preset <voix|muet|social>          # tournage
npx koumoul-video record --video <slug> --preset muet --mux --burn           # + montage
npx koumoul-video mux --video <slug> [--offset 1.2] [--burn]                 # montage seul
npx koumoul-video tts --video <slug> [--force|--bakeoff|--bakeoff-prononciation]
npx koumoul-video clean --video <slug> [--id <dataset-id>]
npx koumoul-video auth:import <fichier>
```

Options : `--videos-dir` (défaut `videos`), `--size`, `--url`, `--headed`,
`--no-tts`, `--state`/`--no-state`/`--profile`, `--caption-right`. Voir
`npx koumoul-video help`.

## Formats

| Preset | Taille | Narration | Cas d'usage |
| --- | --- | --- | --- |
| `voix` | 1920×1080 | edge-tts / kokoro, SRT mot à mot | cours, tutoriels |
| `muet` | 1920×1080 | aucune, sous-titres ancrés sur la scène | démos d'atelier |
| `social` | 1280×720 | aucune, sous-titres incrustés par le scénario | formats courts |

Sans `script.md`, le kit bascule en **format court** : le scénario exporte son
accroche (`export const intro`), pilote les sous-titres (`setCaption`) et la
carte de fin (`showOutro`) ; le préambule de chargement est coupé par analyse de
luminance au montage.

## API de scénario

```ts
import {
  clickLocator, clickHuman, dragHuman, typeHuman, replaceTextHuman,
  fillLocatorHuman, setTimeScale, sleep,
  setCaption, hideIntro, showOutro,
  type ScenarioContext
} from '@koumoul/video-kit'

export default async ({ page, beat, idle, log }: ScenarioContext) => {
  await beat('beat-00', async () => { /* carton affiché par le kit */ })
  await beat('beat-01', async () => {
    idle.begin()      // attente LLM compressée ×6 au montage
    // …
    idle.end()
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

`assets/charte/` embarque la police Nunito (OFL) et le logo Koumoul blanc ;
`assets/synth_*.py` portent la synthèse vocale.

## Licence

MIT.
