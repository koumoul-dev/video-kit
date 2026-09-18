# Scripts et scénarios

## `script.md` — source de vérité

Front matter YAML (clés `clé: valeur`, pas de valeurs imbriquées) :

```yaml
---
video: agents-back-office
titre: L'assistant IA en back-office
atelier: L'IA au service des données ouvertes
cible: ~5 min
fournisseur: muet                    # edge | kokoro | muet
habillage: panneaux                  # optionnel : panneaux entre fragments (muet)
environnement: https://koumoul.com/data-fair — département test
carton_eyebrow: Atelier — L'IA au service des données ouvertes
carton_sous_titre: Data Fair — démonstration
carton_site: koumoul.com
voix: fr-FR-DeniseNeural             # mode voix
voix_bakeoff: edge:fr-FR-DeniseNeural, edge:fr-FR-HenriNeural, kokoro:ff_siwis
prononciations: Data Fair=Data Fère   # synthèse seulement, pas le SRT
---
```

Puis un `### beat-NN — Titre` par scène :

```markdown
### beat-01 — Créer et importer le jeu de données

> Créons un jeu de données depuis cet export CSV : Data Fair détecte le
> contenu, nous validons le brouillon.

Depuis l'accueil : « Créer un nouveau jeu de données », carte « Fichier ».
L'analyse du fichier est marquée `idle` (compressée ×10).
```

La citation `>` est la narration ; le reste est la mise en scène (pour
l'humain). L'ordre des beats est **imposé au tournage** : rejouer un beat dans le
désordre lève une erreur. En mode muet, la durée d'une scène est estimée d'après
le nombre de mots (~2,6 mots/s, minimum 1,8 s) ; en voix, elle suit l'audio réel.

## `scenario.ts` — API

```ts
import {
  clickHuman, clickLocator, dragHuman, fillLocatorHuman, replaceTextHuman,
  setTimeScale, sleep, typeHuman,
  setCaption, hideIntro, showOutro,
  type ScenarioContext
} from '@koumoul/video-kit'

export default async ({ page, beat, idle, log }: ScenarioContext) => {
  // prélude hors timeline : chargement, login, attente de l'accueil
  await page.goto('https://koumoul.com/data-fair/', { waitUntil: 'domcontentloaded' })
  await page.getByText('Créer un nouveau jeu de données').waitFor()

  await beat('beat-00', async () => {
    // carton de titre affiché par le kit
  })

  await beat('beat-01', async () => {
    await clickLocator(page, page.getByText('Créer un nouveau jeu de données'))
    // …
    idle.begin()          // réponse du LLM : compressée ×6 au montage
    await waitAnswer()
    idle.end()
    idle.begin(10)        // traitement technique : compressée ×10
    await waitFinalized()
    idle.end()
  })

  await beat('beat-11', async () => {
    await showOutro(page, {
      title: 'L’IA au service des données ouvertes',
      subtitle: 'L’assistant IA en back-office',
      badge: 'Atelier', site: 'koumoul.com'
    })
  })
}
```

Le contexte expose `page`, `beat`, `idle`, `log`, `video`, `videosDir`.

### Helpers du curseur

| Helper | Usage |
| --- | --- |
| `clickLocator(page, locator)` | clic sur un élément après approche du curseur (actionnabilité Playwright) |
| `clickHuman(page, x, y)` | clic à des coordonnées écran (carte, canevas) |
| `dragHuman(page, from, to)` | glisser (peu de pas : rendu des cartes) |
| `typeHuman` / `replaceTextHuman` / `fillLocatorHuman` | frappe ralentie / remplacement / valeur posée (sélecteurs, dates) |
| `setTimeScale(s)` | accélère les temps morts (0,5 pour un format court) |
| `sleep(ms)` | pause dans un beat (la narration attend déjà la durée de scène) |

### Cartons et sous-titres

- En mode à beats, le kit affiche le carton d'intro au beat 0 et le masque au
  beat 1 (`hideIntro`) ; le scénario affiche la carte de fin (`showOutro`).
- En format court (sans `script.md`), le scénario exporte `intro`, appelle
  `hideIntro(page)` quand l'application est prête, `setCaption(page, '…')` /
  `setCaption(page, null)` et `showOutro(page, { site: 'datafair.cloud' })`.
- Ne pas utiliser `page.goto` après `hideIntro` quand `intro` est exportée : la
  carte ne doit pas réapparaître. En mode à beats, naviguer pendant le carton
  (beat 0) perdrait le repère de calage.

## Habillage panneaux (`habillage: panneaux`)

Voir `templates/script-panneaux.md` pour un squelette complet.

Boucle sans sous-titres : les citations deviennent des panneaux pleine page
insérés au montage avant chaque section, et le chargement de chaque fragment est
coupé.

- un beat **avec citation** ouvre un panneau ; les beats **sans citation** qui
  suivent sont des fragments du panneau ;
- les scènes intermédiaires ne sont plus calées sur la durée estimée de la
  narration (seuls le carton d'ouverture et le carton de fin gardent la leur) :
  la citation est un texte de panneau court, pas une narration ;
- après l'attente de rendu d'un fragment, appeler `mark()` : le montage coupe
  `[t0, marque]`. Sans marque, la détection automatique coupe un écran blanc de
  chargement, mais pas une ancienne page qui reste affichée pendant la
  navigation (passer explicitement par `mark()` dans ce cas) ;
- `fournisseur: muet` obligatoire (le kit refuse une piste audio) ; ni SRT ni
  `.st.mp4` ne sont produits.

```ts
export default async ({ page, beat, mark }: ScenarioContext) => {
  await beat('beat-03', async () => {        // ouvre le panneau « Portail open data »
    await page.goto(`${HOME}dataset/${DATASET}/table`)
    await page.locator('[data-action-id="check-data-quality"]').last().waitFor()
    await mark()                             // fin du chargement : le clip démarre ici
    await sleep(2_500)
    await wheelHuman(page, 960, 600, 420, 3)
  })

  await beat('beat-04', async () => {        // fragment du même panneau
    await wheelHuman(page, 960, 600, -420, 2)
  })
}
```

## Format court sans `script.md`

Voir `templates/scenario-social.ts` : aucune scène, aucune narration ; les
sous-titres sont incrustés au fil du scénario, la détection du début de vidéo se
fait par luminance (pas de carton repère). C'est le format d'`app-edit-map`.

## Écrire la narration

- Écrire pour être **parlé** : phrases courtes, pas de lecture du markdown, pas
  de listes.
- Une scène = une idée ; la mise en scène doit tenir dans la durée de la
  narration (prévoir les attentes `idle` pour les traitements longs).
- Les termes mal prononcés se corrigent dans `prononciations` après écoute du
  bake-off (`koumoul-video tts --video <slug> --bakeoff-prononciation`) ; le SRT
  garde la graphie d'origine.
