# AGENTS.md — @koumoul/video-kit

Point d'entrée pour une session de travail sur ce dépôt. Le plan en cours est
dans [PLAN.md](./PLAN.md) ; le skill destiné aux dépôts consommateurs est dans
[`skills/demo-videos/`](./skills/demo-videos/SKILL.md).

## Structure

| Chemin | Contenu |
| --- | --- |
| `src/` | kit TypeScript : CLI `koumoul-video`, recorder, mux, synthèse, overlay charte, curseur, auth, nettoyage |
| `assets/` | charte embarquée (logo Koumoul, Nunito 400/600/700) et `synth_*.py` |
| `bin/koumoul-video.mjs` | entrée du binaire → `dist/cli.js` |
| `skills/demo-videos/` | skill agent : charte, pipeline, scénarios, auth, pièges, templates |
| `tests/` | tests `node --test` des fonctions pures du pipeline |

## Commandes

```bash
npm install
npm run build          # tsc → dist/ (aussi prepublishOnly)
npm run quality        # lint + typecheck + tests
node bin/koumoul-video.mjs help
```

## Publication

- Version dans `package.json`, `publishConfig.access: public`, `prepublishOnly`
  construit `dist/`.
- `npm publish`, puis `git tag vX.Y.Z && git push origin vX.Y.Z`.
- Le packument npm peut répondre 404 pendant ~2 min après un publish (le
  tarball répond déjà 200) : attendre, ne pas republier.
- Les dépôts consommateurs (`pilotage`, `documentation`, `app-edit-map`) sont sur
  `^0.2.0` ; après une nouvelle version, y faire `npm install @koumoul/video-kit@latest -D`
  (ou `npm update`) puis commit.
- Pour tester un correctif non publié dans un dépôt consommateur : `npm pack` ici,
  puis `npm i -D <chemin>/koumoul-video-kit-X.Y.Z.tgz` dans le dépôt (ne pas
  committer cette dépendance tarball).

## Conventions

- Tout est en français (code, commentaires, docs, commits).
- Commits conventionnels : `feat:`, `fix:`, `docs:`, `chore:`…
- Ne jamais committer `dist/`, `node_modules/`, `*.tgz`.
- Aucun secret dans le dépôt : l'auth navigateur vit dans `<videos-dir>/.auth/`
  des projets consommateurs.
- Toute évolution du comportement ou des options du CLI doit être répercutée
  dans `skills/demo-videos/` (SKILL.md et `references/`), qui est la
  documentation de référence pour les utilisateurs et les agents.
