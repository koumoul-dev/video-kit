# AGENTS.md — @koumoul/video-kit

Point d'entrée pour une session de travail sur ce dépôt. Le plan en cours est
dans [PLAN.md](./PLAN.md) ; le skill destiné aux dépôts consommateurs est dans
[`skills/demo-videos/`](./skills/demo-videos/SKILL.md).

## Structure

| Chemin | Contenu |
| --- | --- |
| `src/` | kit TypeScript : CLI `koumoul-video`, recorder, capture horodatée, mux, synthèse, overlay charte, curseur, auth, nettoyage |
| `assets/` | charte embarquée (logo officiel Koumoul en SVG, Nunito 400/600/700, TTF 600 pour libass) et `synth_*.py` |
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
- Les dépôts consommateurs : `pilotage` (`^0.3.2`), `documentation` et
  `app-edit-map` (`^0.2.0`) ; après une nouvelle version, y faire
  `npm install @koumoul/video-kit@latest -D` puis commit.
- **Publier uniquement depuis un commit poussé** (`git status -sb` propre, à jour
  avec `origin/main`) : la 0.3.2 avait été publiée depuis une copie locale et le
  dépôt était resté en retard sur npm.
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
