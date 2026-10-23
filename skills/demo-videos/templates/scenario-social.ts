// Scénario d'un format court (~30 s, réseaux sociaux), sans script.md :
// carte d'intro dès la première frame, sous-titres incrustés au fil des
// actions, carte de fin. La détection du début de vidéo se fait par luminance.

import { clickLocator, fillLocatorHuman, hideIntro, say, setCaption, showOutro, setTimeScale, sleep, type ScenarioContext } from '@koumoul/video-kit'

// accroche posée dès la création du document : visible à la première frame ;
// la carte de fin reprend son site
export const intro = {
  badge: 'Data Fair · démonstration',
  title: 'Titre de la vidéo',
  subtitle: 'La promesse en une ligne',
  site: 'datafair.cloud'
}

export default async ({ page, log }: ScenarioContext) => {
  setTimeScale(0.5)
  await page.waitForResponse(r => r.url().includes('format=pbf') && r.status() === 200, { timeout: 30_000 })
  await page.locator('[data-test-id=mode-point]').waitFor({ state: 'visible', timeout: 30_000 })
  await hideIntro(page)
  await sleep(200)

  log('première action')
  // sous-titre tenu jusqu'à son temps de lecture, actions comprises
  await say(page, 'Sous-titre de la première action', () => clickLocator(page, page.locator('[data-test-id=mode-point]')))

  log('saisie')
  await say(page, 'Changez aussi les attributs', () => fillLocatorHuman(page, page.getByLabel('Couleur'), '#00838F'))

  await setCaption(page, null)
  // même gabarit que l'intro : phrase d'appel en titre, site repris de l'intro
  await showOutro(page, { title: 'Éditez vos cartes sans SIG' })
  await sleep(1800)
}
