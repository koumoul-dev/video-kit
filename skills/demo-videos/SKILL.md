---
name: demo-videos
description: Produire les vidéos de démonstration Koumoul / Data Fair avec @koumoul/video-kit — scénario Playwright scripté, cartons d'intro/fin à la charte, curseur factice, synthèse vocale ou mode muet, sous-titres incrustés, montage MP4/SRT et nettoyage des données de démo. Utiliser ce skill dès qu'il est question de filmer une application ou un service (vidéo produit, démo commerciale, tutoriel, cours, format court pour les réseaux sociaux), d'écrire un `script.md` / `scenario.ts`, de tourner avec Playwright, de voix off (edge-tts, kokoro), de sous-titres, de cartons de début/fin, de charte graphique Koumoul, ou de nettoyer les jeux de données créés pendant un tournage — même sans le mot « vidéo » explicite.
---

# Vidéos de démonstration Koumoul / Data Fair

Le kit `@koumoul/video-kit` mutualise la production des vidéos des projets
Koumoul (`pilotage`, `documentation`, applications `data-fair`) : cartons à la
charte, curseur factice, scénarios Playwright, narration, sous-titres, montage
MP4/SRT.

Dépôt et skill : <https://github.com/koumoul-dev/video-kit>.

## Prérequis

- Node ≥ 22.18 (exécution TypeScript native des scénarios).
- `ffmpeg` et `ffprobe` dans le PATH.
- `@playwright/test` dans le projet consommateur (+ navigateur Chrome installé).
- Voix uniquement : Python avec `edge-tts`, `kokoro`, `soundfile` dans un venv
  du projet (`.venv`), détecté automatiquement.

```bash
npm i -D @koumoul/video-kit @playwright/test
```

Tant que le paquet n'est pas publié sur npm, l'installer depuis un tarball
(`npm pack` dans le dépôt puis `npm i -D ./koumoul-video-kit-0.1.0.tgz`) ou en
`file:../video-kit`.

## Choisir le format

| Format | Cas d'usage | `script.md` | Narration | Carton |
| --- | --- | --- | --- | --- |
| `voix` | cours, tutoriels (docs.koumoul.com) | oui, `fournisseur: edge` ou `kokoro` | voix de synthèse + sous-titres SRT | carton au beat 0, fin au dernier beat |
| `muet` | démos d'atelier présentées avec des slides | oui, `fournisseur: muet` | aucune piste audio, sous-titres ancrés sur la scène | idem |
| `social` | formats courts (~30 s, réseaux sociaux) | non | aucune | intro dès la première frame, sous-titres incrustés par le scénario |

Tailles par défaut : 1920×1080 (`voix`, `muet`), 1280×720 (`social`, format qui
garde la disposition desktop et reste lisible dans un fil).

## Structure d'une vidéo

```
<videos-dir>/                 # videos/ par défaut, produits/videos chez pilotage
├── .auth/state.json          # session navigateur (gitignoré, jamais commité)
└── <slug>/
    ├── script.md             # source de vérité : front matter + beats
    ├── scenario.ts           # actions Playwright, une fonction par beat
    ├── assets/               # fichiers de démo (CSV…), gitignorés si volumineux
    └── out/                  # artefacts générés (WebM, timeline, MP4, SRT) : gitignoré
```

`out/` et `.auth/` ne sont **jamais commités** ; les MP4 finaux restent dans
`out/` et se copient hors du dépôt pour diffusion. Les scénarios, `script.md` et
les assets légers sont versionnés.

## Cycle complet

1. **Écrire `script.md`** : front matter (`titre`, `fournisseur`, `carton_*`) puis
   un `### beat-NN — Titre` par scène, avec la narration en citation `>` et la
   mise en scène en dessous. Voir [references/scenarios.md](references/scenarios.md).
2. **Écrire `scenario.ts`** : une fonction par beat, dans l'ordre, avec les
   helpers du kit (curseur humain, cartons, sous-titres). L'API est décrite dans
   [references/scenarios.md](references/scenarios.md).
3. **Authentifier** le navigateur d'enregistrement (proxy NHI automatique) :
   [references/auth.md](references/auth.md).
4. **Tourner** ; les attentes longues (LLM, traitements) sont marquées `idle`
   pour être compressées au montage :
   ```bash
   npx koumoul-video record --video <slug> --preset <voix|muet|social> --headed   # mise au point
   npx koumoul-video record --video <slug> --preset <voix|muet|social> --mux
   npx koumoul-video tts --video <slug>                    # synthèse seule
   npx koumoul-video tts --video <slug> --bakeoff          # comparer les voix
   npx koumoul-video mux --video <slug> --burn             # variante sous-titrée
   npx koumoul-video clean --video <slug>                  # supprime la démo distante
   ```
   `--videos-dir produits/videos` pour les dépôts qui n'utilisent pas `videos/`.
5. **Monter et vérifier** : durée, piste audio, synchro des sous-titres,
   aucune donnée sensible à l'écran ; supprimer les données de démonstration.
   Détails dans [references/pipeline.md](references/pipeline.md).

## Charte et recommandations de production

Elles sont détaillées dans [references/charte.md](references/charte.md) ;
l'essentiel :

- **Cartons** à la charte Koumoul / Data Fair : dégradé `#0A2F5E → #1976D2`,
  bandeau `#81D4FA`, police Nunito embarquée, logo Koumoul blanc, aucun asset
  réseau (complet dès la première frame). L'intro est opaque, affichée ≥ 2,6 s et
  sert de repère de calage au montage.
- **Pas de curseur factice sur les cartons** de début / fin : l'overlay pose
  `demo-cover` sur `<html>`, le curseur disparaît (il n'a de sens que sur
  l'interface). Jamais de curseur système à l'écran.
- **Sous-titres** : 2 lignes maximum, ~40 caractères par ligne, coupures à la
  ponctuation, incrustés (autoplay sans son), SRT conservé pour la version voix.
- **Attentes** : `idle.begin()` (×6 réponses du LLM, ×10 traitements techniques) ;
  le montage compresse les segments et raccourcit la vidéo sans perdre le rythme.
- **Toujours vérifier** après montage : `ffprobe` (durée, absence de piste audio
  en muet), extraction d'images (synchro), et supprimer le JDD / l'application de
  démonstration créés par le tournage.
- Ne jamais committer de secret, cookie, `out/`, `.auth/`, ni MP4.

## Références

- [references/charte.md](references/charte.md) — charte graphique, cartons, sous-titres, formats.
- [references/scenarios.md](references/scenarios.md) — `script.md`, API de scénario, helpers, attentes.
- [references/pipeline.md](references/pipeline.md) — synthèse, tournage, timeline, montage, vérifications.
- [references/auth.md](references/auth.md) — proxy NHI, cookies, variantes.
- [references/pieges.md](references/pieges.md) — pièges rencontrés (CSP, LLM, ordre des beats…).
- [templates/](templates/) — `script.md`, `scenario.ts`, snippets `package.json` / `.gitignore`.
