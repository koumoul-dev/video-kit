# Intégrer le kit dans un dépôt

## Dépendances

```bash
npm i -D @koumoul/video-kit @playwright/test
# voix : dans un venv du dépôt
python3 -m venv .venv && .venv/bin/pip install edge-tts kokoro soundfile
```

## Scripts `package.json`

```json
{
  "scripts": {
    "video:record": "koumoul-video record --videos-dir produits/videos --preset muet",
    "video:mux": "koumoul-video mux --videos-dir produits/videos",
    "video:clean": "koumoul-video clean --videos-dir produits/videos",
    "tts": "koumoul-video tts --video import-fichier",
    "tts:bakeoff": "koumoul-video tts --video import-fichier --bakeoff",
    "auth:import": "koumoul-video auth:import"
  }
}
```

Adapter `--videos-dir` (`videos` par défaut) et le preset (`voix`, `muet`,
`social`). Le format court nécessite `--preset social` et `--url <url>`.

## `.gitignore`

```gitignore
# artefacts d'enregistrement (audio, timeline, MP4, SRT) et sessions navigateur
<videos-dir>/**/out/
<videos-dir>/**/raw/
<videos-dir>/.auth/

# format court à la racine du dossier vidéos
<videos-dir>/*.webm
<videos-dir>/*.mp4
```

Pour un dépôt dont le dossier `videos/` contient aussi les scénarios et le kit,
ne pas l'ignorer en bloc : n'ignorer que les artefacts ci-dessus.

## Arborescence cible

```
<videos-dir>/
├── .auth/                    # session NHI (gitignoré)
├── <slug-1>/
│   ├── script.md
│   ├── scenario.ts
│   ├── assets/
│   └── out/                  # gitignoré
└── <slug-2>/
    └── scenario.ts           # format court sans script.md
```

## README du dépôt

Documenter : le format retenu, les commandes (`record`, `mux`, `clean`), la
gestuelle de tournage (fermer le navigateur MCP, attendre ~2 min avant le
proxy NHI), la politique de sortie (`out/` jamais commité, MP4 copiés hors du
dépôt) et les données de démonstration à nettoyer.
