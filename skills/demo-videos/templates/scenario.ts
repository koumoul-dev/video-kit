// Scénario de la vidéo « <slug> » — mode à beats (script.md).
// Les actions sont groupées par beat ; le kit attend la durée de la narration
// avant de passer au beat suivant. Les attentes longues sont marquées via `idle`.
//
// Helpers disponibles : clickLocator, clickHuman, dragHuman, typeHuman,
// replaceTextHuman, fillLocatorHuman, setTimeScale, sleep (curseur) ;
// setCaption, hideIntro, showOutro (habillage).

import { clickLocator, showOutro, type ScenarioContext } from '@koumoul/video-kit'

const HOME = 'https://koumoul.com/data-fair/'

export default async ({ page, beat, idle, log }: ScenarioContext) => {
  // prélude hors timeline : chargement de l'accueil (session NHI du proxy)
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.getByText('Créer un nouveau jeu de données').waitFor({ timeout: 30_000 })
  log('accueil de l’organisation chargé')

  await beat('beat-00', async () => {
    // carton de titre affiché par le kit
  })

  await beat('beat-01', async () => {
    await clickLocator(page, page.getByText('Créer un nouveau jeu de données'))
    // … actions de la scène …
    idle.begin()
    // attente d'une réponse du LLM (compressée ×6 au montage)
    idle.end()
  })

  // … un beat par scène de script.md, dans l'ordre …

  await beat('beat-02', async () => {
    await showOutro(page, { title: 'Titre de la vidéo', subtitle: 'Data Fair — démonstration', site: 'koumoul.com' })
  })
}
