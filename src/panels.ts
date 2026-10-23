// Panneaux de chapitre insérés au montage entre les fragments vidéo.
//
// Un panneau est une carte plein écran à la charte (mêmes styles que les cartons
// d'intro/fin, cf. `habillageCss` dans overlay.ts) : eyebrow (numéroté par
// défaut, libellé libre via `panneaux_badge`), titre, texte de lecture et site.
// Il est rendu en PNG par un Chromium headless puis
// encodé en segment MP4 muet par `mux.ts` (une frame tenue pendant le temps de
// lecture du texte). Utilisé par l'habillage `panneaux` : les citations des
// beats deviennent des panneaux, les beats sans citation des fragments.

import { chromium } from '@playwright/test'
import { cardHtml, habillageCss, loadOverlayAssets, type OverlayAssets } from './overlay.ts'
import { MUET_WORDS_PER_SECOND } from './tts.ts'

// durée plancher d'un panneau : le temps de repérer le chapitre dans une boucle
export const PANEL_MIN_DUR = 3

export interface PanelSpec {
  title: string
  text?: string
  badge?: string
  site?: string
  footer?: string
}

// Temps de lecture du panneau : même débit que l'estimation muette (~2,6 mots/s),
// jamais moins de `PANEL_MIN_DUR`.
export function panelDuration (text: string): number {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
  return Math.max(PANEL_MIN_DUR, Math.round((words / MUET_WORDS_PER_SECOND) * 10) / 10)
}

// Eyebrow d'un panneau : numérotation `01 / 09` par défaut, libellé libre si le
// front matter du script fournit `panneaux_badge` (ex. « Data Fair »).
export function panelBadge (label: string | undefined, index: number, total: number): string {
  const custom = label?.trim()
  if (custom) return custom
  return `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
}

// Document autonome : police, logo et styles embarqués, aucun asset réseau.
// Même gabarit que les cartons d'intro et de fin (`cardHtml`), sans animation.
// Exporté pour les tests (rendu déterministe, sans navigateur).
export function panelHtml (panel: PanelSpec, assets: OverlayAssets): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; }
    ${habillageCss(assets.fontsCss)}
    #__demo-overlay .demo-title, #__demo-overlay .demo-subtitle { opacity: 1; transform: none; transition: none; }
  </style></head><body>
    <div id="__demo-overlay">
      ${cardHtml({ badge: panel.badge, title: panel.title, subtitle: panel.text, footer: panel.footer, site: panel.site }, 'id="__demo-panel"', assets.logo)}
    </div>
  </body></html>`
}

// Rend le panneau en PNG à la taille de la vidéo. Chromium headless est déjà une
// dépendance du kit (`@playwright/test`) : mêmes polices et mêmes couleurs que
// les cartons, sans outil de rendu supplémentaire.
export async function renderPanelPng (panel: PanelSpec, size: { width: number, height: number }, outPng: string): Promise<void> {
  const assets = loadOverlayAssets()
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] })
  try {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 })
    await page.setContent(panelHtml(panel, assets), { waitUntil: 'load' })
    // charge explicitement chaque graisse : `document.fonts.ready` peut se
    // résoudre avant que la mise en page ait réclamé la police (rendu en repli)
    await page.evaluate(() => Promise.all([...document.fonts].map(font => font.load())).then(() => undefined))
    await page.screenshot({ path: outPng })
  } finally {
    await browser.close()
  }
}
