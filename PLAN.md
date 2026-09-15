# Plan — validation du kit et suite

État au 15/09/2026 :

- `@koumoul/video-kit@0.2.0` publié (npm public, scope `@koumoul`).
- `pilotage`, `documentation` et `app-edit-map` dépendent de `^0.2.0` ; plus
  aucun `file:../video-kit` (le dépôt voisin n'est plus nécessaire).
- Build, lint, typecheck et tests passent ; l'import des scénarios TS et le
  montage ont été validés localement (A/B du mux pilotage : SRT identique).
- Reste à valider chaque format en **tournage réel** : c'est l'objet de la
  priorité 1.

Règle : si un problème vient du kit, **corriger ici et publier une nouvelle
version**, ne pas adapter le kit localement dans les dépôts consommateurs.

## 1. Tournages de validation (priorité)

Les commandes de contrôle après montage (communes) :

```bash
ffprobe -v error -show_entries stream=codec_type -of default=nw=1 out/<video>.mp4
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 out/<video>.mp4
ffmpeg -ss 42 -i out/<video>.st.mp4 -frames:v 1 /tmp/frame.png
```

### pilotage — atelier muet (1920×1080, idle ×6/×10)

```bash
cd ../pilotage
npm run video:record -- --video agents-back-office --mux --burn
npm run video:clean -- --video agents-back-office
```

Pré-requis : ne plus naviguer ~2 min avant (proxy NHI), cf.
`skills/demo-videos/references/auth.md`.

- [ ] démarrage sur le carton (flash blanc → carte), carton complet dès la
      première frame (Nunito + logo Koumoul)
- [ ] aucun curseur factice sur les cartons d'intro / de fin
- [ ] attentes LLM compressées, durée totale cohérente (~5 min)
- [ ] sous-titres ~2 lignes, synchro vérifiée par extraction d'images
- [ ] aucune piste audio ; `.st.mp4` produit
- [ ] `video:clean` supprime bien le JDD et l'application de démo

### documentation — cours avec voix (1920×1080, SRT mot à mot)

```bash
cd ../documentation
python3 -m venv .venv && .venv/bin/pip install edge-tts kokoro soundfile   # si absent
npm run record -- --mux --burn
npm run clean -- --video import-fichier
```

- [ ] voix `fr-FR-RemyMultilingualNeural`, synchro mot à mot
- [ ] « Data Fair » prononcé « Data Fère » (`prononciations` du front matter)
- [ ] outro avec badge « Documentation Koumoul » et `docs.koumoul.com`
- [ ] SRT 2 lignes max, `.st.mp4` produit

### app-edit-map — format court social (1280×720, sous-titres incrustés)

```bash
cd ../app-edit-map
npm run dev            # dans un autre terminal : dev-server + app sur http://localhost:21632
npm run record         # setup JDD + tournage + montage (--mux)
```

Pré-requis : `.env` rempli, JDD de démo seedable dans le département `test`.

- [ ] intro visible dès la première frame (pas de page de chargement)
- [ ] curseur masqué pendant l'intro et la carte de fin
- [ ] sous-titres décalés du tiroir de droite (`--caption-right 420`)
- [ ] log « Préambule de chargement coupé » (~1,5 s) et MP4 dans
      `videos/cyclables/out/` (jamais `tests/output`)
- [ ] `npm run record` enchaîne bien setup → tournage → montage MP4
      (`record:demo --mux`, corrigé le 15/09)

### Après chaque tournage

- [ ] vérifier qu'aucune donnée sensible / personnelle n'est à l'écran
- [ ] copier les MP4 hors du dépôt pour diffusion (jamais commités)
- [ ] si un correctif est nécessaire : PR/commit ici, version suivante
      (`npm version patch`), `npm publish`, puis mise à jour des consommateurs

## 2. Skill pour agents

- [ ] `npx skills add koumoul-dev/video-kit` (global ou dans chaque dépôt)
- [ ] optionnel : committer `.agents/skills/demo-videos` + `skills-lock.json`
      dans les dépôts consommateurs (comme `slidev-theme`)

## 3. Optionnel / dettes

- [ ] workflow GitHub Actions : `quality` sur push/PR et `npm publish` sur tag
- [ ] tag git `v0.2.0` (et tags suivants)
- [ ] supprimer les artefacts legacy locaux d'app-edit-map
      (`videos/cyclables.{webm,mp4}`, gitignorés)
- [ ] migration d'autres dépôts vidéo si de nouveaux cas d'usage apparaissent
      (le skill et le paquet sont génériques hors assets de charte)

## Notes

- Node ≥ 22.18 requis (exécution TypeScript native des scénarios) ; validé sur
  Node 24. Sur un poste en Node 22, vérifier `node -v` avant tournage.
- Le runtime du kit nécessite `ffmpeg`/`ffprobe` ; la voix nécessite le venv.
- Le skill est inclus dans le tarball npm (`files: skills`) mais s'installe via
  GitHub (`npx skills add koumoul-dev/video-kit`).
- Les vidéos finales (`.mp4`, `.st.mp4`) restent dans les `out/` gitignorés des
  dépôts consommateurs.
