# Authentification du navigateur d'enregistrement

Le tournage se fait sur `https://koumoul.com/data-fair` (ou un autre site de la
plateforme) sous une identité non humaine (NHI), ou sur une page locale
(`file://`, schémas animés) sans session.

## Proxy NHI

`@data-fair/nhi-proxy` injecte la session de la NHI dans les réponses : le kit
lance Chromium derrière le proxy, et le navigateur reçoit la session en cookies
ordinaires dès la première navigation. C'est la recette « script Playwright
autonome » du skill `data-fair-browse` : aucun cookie à récolter ni à stocker,
aucune attente avant le tournage. Le proxy re-signe l'hôte cible avec sa propre
autorité de certification, d'où `ignoreHTTPSErrors` sur le contexte.

```bash
npx @data-fair/nhi-proxy serve --profile "<profil>"   # dans un autre terminal
npx koumoul-video record --video <slug> --preset muet --mux
```

Le kit trouve le serveur du proxy, par ordre de priorité :

1. `NHI_PROXY_SERVER` (ex. `http://127.0.0.1:7335`) ;
2. le navigateur MCP d'opencode (`~/.config/opencode/playwright-mcp.json`,
   `browser.launchOptions.proxy`) ;
3. un profil nhi-proxy local : `NHI_PROXY_PROFILE=<profil>`, sinon le profil
   de `https://koumoul.com`, sinon le premier profil configuré
   (`npx @data-fair/nhi-proxy profiles`).

`RECORD_NO_PROXY=1` désactive le proxy (chargement anonyme). Une page locale
`file://` n'a pas besoin de session : le proxy n'y change rien.

Le contexte est aussi lancé avec `bypassCSP` : la CSP des services (`font-src`)
bloquerait sinon la police Nunito embarquée en `data:` des cartons, qui
s'afficheraient dans une police de repli.

## Variantes

| Option | Effet |
| --- | --- |
| `--state <fichier>` | cookies de session explicites (storage state Playwright), en plus du proxy : site hors plateforme, session humaine de test |
| `clean --url <url>` | back-office sur lequel supprimer les ressources de démo (défaut `https://koumoul.com/data-fair/`), avec la session du proxy |

## Règles

- Ne **jamais committer** un cookie, un token ou un `.env`.
- Ne jamais afficher un secret à l'écran : vérifier le contenu des formulaires
  et des jeux de données avant montage.
- Un seul proxy par profil et par machine : chaque échange de session est
  compté par le limiteur de simple-directory (`502` du proxy = attendre 60 s,
  voir `data-fair-browse`).
