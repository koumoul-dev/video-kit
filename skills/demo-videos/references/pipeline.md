# Pipeline de production

```
script.md ──► tts (voix|muet) ──► recorder (Playwright) ──► timeline.json
                                        │                        │
                                        ▼                        ▼
                                      out/*.webm ──────────► mux ──► out/*.mp4 + .srt (+ .st.mp4)
```

## 1. Synthèse (`koumoul-video tts`)

- `fournisseur: edge` (edge-tts, cloud, voix `fr-FR-*`) ou `kokoro` (local, GPU,
  `ff_siwis`), ou `muet` (aucune synthèse).
- Cache par beat : hash texte parlé + voix (`out/audio/<beat>.json`). Une
  modification de la narration ne resynthétise que les beats concernés.
- `--force` resynthétise tout (incrémenter `AUDIO_SCHEMA` dans `tts.ts` en cas
  de changement de format des timings).
- `--bakeoff` génère des extraits comparatifs dans `out/voix/`, à figer dans le
  front matter (`fournisseur`, `voix`).

## 2. Tournage (`koumoul-video record`)

1. `recorder.ts` importe `scenario.ts`, installe le curseur puis l'overlay
   (cartons et sous-titres), et ouvre Chrome avec le proxy NHI.
2. Le scénario joue son prélude (hors timeline), puis chaque `beat(id, actions)` :
   - beat 0 : carton d'intro, `cardT0` enregistré ;
   - beat 1 : masquage du carton ;
   - la durée de la scène est au moins celle de la narration (+ 0,7 s) ; en
     habillage `panneaux`, seuls les cartons d'ouverture et de fin gardent cette
     durée, les fragments ne durent que leurs actions ;
   - `mark()` (contexte scénario) note le début du contenu utile du fragment
     (`contentT0` dans la timeline) : le montage coupe le chargement jusque-là.
3. Les attentes marquées `idle.begin(factor)` sont notées dans la timeline
   (facteur ×6 par défaut, ×10 pour les traitements techniques).
4. Le WebM brut est écrit dans `out/<video>.webm`, la timeline dans
   `out/<video>.timeline.json` (largeur, hauteur, cardT0, beats, idles).

Options utiles : `--headed` (mise au point), `--url <url>` (page ouverte avant
le scénario), `--no-tts` (réutilise l'audio), `--profile`, `--state`, `--no-state`
(voir [auth.md](auth.md)).

## 3. Montage (`koumoul-video mux`)

- **Recalage** : détection du passage blanc → carton (changement de scène),
  coupe de l'amorce ; sans carton (format court), détection du premier rendu par
  luminance (`signalstats` sur une zone centrale).
- **Sous-titres** : découpage en cues de 2 lignes (~40 caractères), calées mot à
  mot (voix) ou ancrées sur la scène (muet, ~13 caractères/s).
- **Habillage panneaux** (`habillage: panneaux`, muet) : chaque citation devient
  un panneau pleine page rendu par Chromium headless (durée = temps de lecture,
  ~2,6 mots/s), inséré avant son fragment ; le chargement au début de chaque
  fragment est coupé (marque `contentT0` du tournage, sinon détection d'un écran
  blanc) ; ni SRT ni `.st.mp4`.
- **Compression des attentes** : le temps mur → temps vidéo est une application
  affine par morceaux ; les segments sont encodés **morceau par morceau** puis
  assemblés par le concat demuxer (un graphe unique bufferise tout le 1080p en
  mémoire et se fait tuer au-delà de quelques minutes).
- **Sorties** : `out/<video>.mp4` (H.264, + AAC en voix), `out/<video>.srt`,
  `out/<video>.st.mp4` avec `--burn` (sous-titres incrustés sur bandeau sombre).
- `--offset <s>` force le calage quand la détection échoue.

## 4. Nettoyage (`koumoul-video clean`)

Le scénario note les identifiants créés dans `out/created-dataset.json` et
`out/created-application.json` ; `clean` les supprime du département de test via
l'API. Supprimer aussi le JDD quand le scénario a échoué en cours de route
(`--id <identifiant>`).

## 5. Vérifications après montage

```bash
ffprobe -v error -show_entries stream=codec_type -of default=nw=1 out/<video>.st.mp4  # vidéo seule en muet
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 out/<video>.mp4  # durée
ffmpeg -ss 42 -i out/<video>.st.mp4 -frames:v 1 /tmp/frame.png                        # synchro SRT
```

Contrôler : durée totale, absence de piste audio en mode muet, synchro des
sous-titres, aucune donnée sensible ou personnelle à l'écran, et suppression du
jeu de données / de l'application de démonstration.

## Intégration dans un dépôt

```json
{
  "scripts": {
    "video:record": "koumoul-video record --videos-dir produits/videos --preset muet",
    "video:mux": "koumoul-video mux --videos-dir produits/videos",
    "video:clean": "koumoul-video clean --videos-dir produits/videos"
  },
  "devDependencies": {
    "@koumoul/video-kit": "^0.1.0",
    "@playwright/test": "^1.62.1"
  }
}
```

`.gitignore` :

```gitignore
videos/**/out/
videos/**/raw/
videos/.auth/
# formats courts : envisager videos/*.webm et videos/*.mp4
```
