# Authentification du navigateur d'enregistrement

Le tournage se fait sur `https://koumoul.com/data-fair` (département de test)
connecté en administrateur, ou sur une application locale selon le scénario.

## Proxy NHI (automatique)

Le kit lit la configuration du navigateur MCP :

1. `~/.config/opencode/playwright-mcp.json` (`browser.launchOptions.proxy`) ;
2. sinon `~/.config/nhi-proxy/<site>/config.json` (préférence `koumoul.com`,
   certificat auto-signé : `--ignore-certificate-errors`).

`ensureProxyAuth` récolte les `Set-Cookie` d'une requête `curl` à travers le
proxy (qui échange une assertion contre une session simple-directory) et les
écrit dans `<videos-dir>/.auth/state.json`. Le proxy ne renouvelle sa session
qu'après un temps d'inactivité : le kit réessaie toutes les 15 s (12 tentatives).
**Ne plus naviguer (MCP compris) pendant ~2 min** avant de lancer le tournage.

À la fin du tournage, la session est rafraîchie via
`/simple-directory/api/auth/keepalive` et ré-exportée.

## Variantes

| Option | Effet |
| --- | --- |
| `--state <fichier>` | cookies de session explicites (storage state Playwright) |
| `--no-state` | aucun cookie : le proxy injecte côté serveur, mais le SPA reste anonyme |
| `--profile` | profil persistant le plus récent du navigateur MCP (fermer le navigateur MCP avant : profil verrouillé) |
| `auth:import <fichier>` | convertit un storage state récolté depuis le navigateur MCP (`playwright_browser_run_code_unsafe`) en `<videos-dir>/.auth/state.json` |

Variables d'environnement : `NHI_PROXY_SERVER` (proxy explicite),
`RECORD_NO_PROXY=1` (aucun proxy), `MCP_PROFILE` (profil persistant),
`VIDEO_KIT_PYTHON` (interpréteur Python de la voix).

## Règles

- Ne **jamais committer** `.auth/`, un cookie, un token ou un `.env`.
- Ne jamais afficher un secret à l'écran : vérifier le contenu des formulaires
  et des jeux de données avant montage.
- L'échange NHI est temporaire : relancer si le proxy répond encore une session
  fraîche (`session NHI du proxy encore fraîche, nouvelle tentative…`).
