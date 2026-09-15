// Scénario d'un format court (~30 s, réseaux sociaux), sans script.md :
// carte d'intro dès la première frame, sous-titres incrustés au fil des
// actions, carte de fin. La détection du début de vidéo se fait par luminance.

import { clickLocator, fillLocatorHuman, hideIntro, setCaption, showOutro, setTimeScale, sleep, type ScenarioContext } from '@koumoul/video-kit'

// accroche posée dès la création du document : visible à la première frame
export const intro = {
  badge: 'Data Fair · démonstration',
  title: 'Titre de la vidéo',
  subtitle: 'La promesse en une ligne'
}

export default async ({ page, log }: ScenarioContext) => {
  setTimeScale(0.5)
  await page.waitForResponse(r => r.url().includes('format=pbf') && r.status() === 200, { timeout: 30_000 })
  await page.locator('[data-test-id=mode-point]').waitFor({ state: 'visible', timeout: 30_000 })
  await hideIntro(page)
  await sleep(200)

  log('première action')
  await setCaption(page, 'Sous-titre de la première action')
  await clickLocator(page, page.locator('[data-test-id=mode-point]'))
  await sleep(300)

  log('saisie')
  await setCaption(page, 'Changez aussi les attributs')
  await fillLocatorHuman(page, page.getByLabel('Couleur'), '#00838F')

  await setCaption(page, null)
  await showOutro(page, { badge: 'Data Fair', title: 'datafair.cloud', site: 'koumoul.com' })
  await sleep(1800)
}
