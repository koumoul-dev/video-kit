# Plan — validation du kit et suite

## 0.3.0 — habillage panneaux (18/09/2026)

- `habillage: panneaux` : les citations de `script.md` deviennent des **panneaux
  pleine page** (rendus Chromium headless à la charte, `src/panels.ts`), insérés
  au montage avant chaque fragment ; `mark()` au tournage note la fin du
  chargement (`contentT0`), le mux coupe le chargement (marque, repli sur
  détection d'écran blanc) ; ni SRT ni `.st.mp4` dans ce mode (nettoyage des
  artefacts d'un tournage précédent).
- Correction du calage des morceaux : le mux distingue désormais le temps source
  (`bSource`, découpes ffmpeg) du temps de sortie (timeMapper / sous-titres) ;
  l'ancien mélange décalait les découpes du lag de capture (~1 s).
- Correction de l'overlay : la CSS charte était référencée dans le script d'init
  sérialisé (fonction absente côté page) → l'overlay ne s'installait plus ; la
  CSS est maintenant calculée côté Node et passée en argument.
- Validation : `salon-data-ia-nantes` (8 panneaux, 11 chargements coupés,
  3 min 04, aucune piste audio, contrôle visuel des panneaux et fragments).
- **Pas encore publiée sur npm** (jeton npm absent le 18/09/2026) : lancer
  `npm publish`, puis les consommateurs (`pilotage` attend `^0.3.0`).

État au 15/09/2026, **pause avant déplacement** :

- `@koumoul/video-kit@0.2.0` publié (npm public, tag `v0.2.0` poussé) ;
  `pilotage`, `documentation` et `app-edit-map` dépendent de `^0.2.0`.
- **pilotage** : re-tournage `agents-back-office` (12 beats) réussi le 15/09 ;
  WebM 30:07 de temps mur, montage `mp4` **complet** (8:08, 488,7 s, aucune
  piste audio, 45 cues SRT, carton complet à la 1re frame, carton de fin OK).
  `.st.mp4` **partiel** (4:53) : la commande a été interrompue pendant
  l'incrustation des sous-titres. JDD et application de démo **pas encore
  nettoyés**.
- **pilotage / scénario** : correction non commitée (attente de `finalizedAt`
  via l'API avant rechargement, puis rechargement jusqu'à présence des sections
  `#structure` / `#exploration`). La page rechargée juste après la finalisation
  pouvait en effet être servie avec un état incohérent (sections absentes), ce
  qui a fait échouer le premier tournage au beat-04.
- **documentation** : pré-requis toujours absents (pas de `.venv`, pas de
  `.auth/state.json`).
- **app-edit-map** : `.env` OK ; artefacts legacy toujours présents.
- Infra : pas de workflow CI, pas de `.agents/skills` dans les consommateurs.

Règle : si un problème vient du kit, **corriger ici et publier une nouvelle
version**, ne pas adapter le kit localement dans les dépôts consommateurs. Les
problèmes de scénario se corrigent, eux, dans le dépôt consommateur.

## 1. Tournages de validation (priorité)

Commandes de contrôle après montage (communes) :

```bash
ffprobe -v error -show_entries stream=codec_type -of default=nw=1 out/<video>.mp4
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 out/<video>.mp4
ffmpeg -ss 42 -i out/<video>.st.mp4 -frames:v 1 /tmp/frame.png
```

### pilotage — atelier muet (1920×1080, idle ×6/×10) — à finir

Tournage du 15/09 : `1d23ufu607xopkh7ihtjp1e1` (JDD), `wJeeOCn8OyhVqjq2Qc6js`
(application) — encore présents, à supprimer par `video:clean`.

```bash
cd ../pilotage
npm run video:mux -- --video agents-back-office --burn   # .st.mp4 partiel à régénérer
npm run video:clean -- --video agents-back-office
```

- [x] démarrage sur le carton (flash blanc → carte), carton complet dès la
      première frame (Nunito + logo Koumoul)
- [x] aucun curseur factice sur les cartons d'intro / de fin
- [x] attentes LLM compressées, SRT produit
- [ ] `.st.mp4` complet (incrustation interrompue à 4:53/8:08) + synchro
      vérifiée par extraction d'images (carton, beats, carton de fin)
- [ ] sous-titres ~2 lignes : 3 débordements signalés au mux (beat-00 17,3 s >
      16,1 s, beat-08 11,8 s > 11,1 s, beat-11 14,6 s > 11,5 s) — vérifier le
      rendu des dernières cues
- [x] aucune piste audio (`mp4` et `st.mp4` : vidéo seule)
- [ ] durée : ~8:08 (cible du front matter « ~5 min » dépassée, surtout par
      beat-09 : 17 min de temps mur compressées) — décider si on raccourcit le
      scénario ou si on ajuste la cible
- [ ] `video:clean` supprime bien le JDD et l'application de démo
- [ ] committer la correction du scénario (`scenario.ts`, +28/−3, non commitée)
- [ ] vérifier qu'aucune donnée sensible / personnelle n'est à l'écran

### documentation — cours avec voix (1920×1080, SRT mot à mot)

```bash
cd ../documentation
python3 -m venv .venv && .venv/bin/pip install edge-tts kokoro soundfile   # si absent
npm run record -- --mux --burn
npm run clean -- --video import-fichier
```

Pré-requis : venv à créer, authentification NHI à récupérer (`.auth/state.json`
absent), ne plus naviguer ~2 min avant (proxy NHI).

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

- [ ] copier les MP4 hors du dépôt pour diffusion (jamais commités) — pour
      l'instant les MP4 restent dans `out/` (gitignoré), à la demande
- [ ] si un correctif est nécessaire : PR/commit ici, version suivante
      (`npm version patch`), `npm publish`, puis mise à jour des consommateurs

## 2. Skill pour agents

- [ ] `npx skills add koumoul-dev/video-kit` (global ou dans chaque dépôt)
- [ ] optionnel : committer `.agents/skills/demo-videos` + `skills-lock.json`
      dans les dépôts consommateurs (comme `slidev-theme`)

## 3. Optionnel / dettes

- [ ] workflow GitHub Actions : `quality` sur push/PR et `npm publish` sur tag
- [ ] documenter dans `skills/demo-videos/references/pieges.md` le piège
      « page servie avec un état périmé juste après la finalisation d'un JDD »
      (sections Structure / Exploration absentes) et le repli utilisé
- [ ] option kit : `mux --burn-only` (ou équivalent) pour réincruster les
      sous-titres sans réencoder tous les morceaux après une interruption
- [ ] supprimer les artefacts legacy locaux d'app-edit-map
      (`videos/cyclables.{webm,mp4}`, gitignorés)
- [ ] migration d'autres dépôts vidéo si de nouveaux cas d'usage apparaissent
      (le skill et le paquet sont génériques hors assets de charte)

## Notes

- Node ≥ 22.18 requis (exécution TypeScript native des scénarios) ; validé sur
  Node 24. Vérifier `node -v` avant tournage.
- Le runtime du kit nécessite `ffmpeg`/`ffprobe` ; la voix nécessite le venv.
- Le skill est inclus dans le tarball npm (`files: skills`) mais s'installe via
  GitHub (`npx skills add koumoul-dev/video-kit`).
- Les vidéos finales (`.mp4`, `.st.mp4`) restent dans les `out/` gitignorés des
  dépôts consommateurs.
- Sur le tournage du 15/09, le mux a détecté le carton à 1,12 s (attendu 0,72 s,
  échelle 0,9991, offset 0,40 s) : à contrôler à l'image au moment des vérifs.
