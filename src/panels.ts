// Panneaux de chapitre insérés au montage entre les fragments vidéo.
//
// Un panneau est une carte plein écran à la charte (mêmes styles que les cartons
// d'intro/fin, cf. `habillageCss` dans overlay.ts) : eyebrow numéroté, titre,
// texte de lecture et site. Il est rendu en PNG par un Chromium headless puis
// encodé en segment MP4 muet par `mux.ts` (une frame tenue pendant le temps de
// lecture du texte). Utilisé par l'habillage `panneaux` : les citations des
// beats deviennent des panneaux, les beats sans citation des fragments.

import { chromium } from '@playwright/test'
import { habillageCss, loadOverlayAssets, type OverlayAssets } from './overlay.ts'
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

function escapeHtml (value: string | undefined): string {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Document autonome : police, logo et styles embarqués, aucun asset réseau.
// Exporté pour les tests (rendu déterministe, sans navigateur).
export function panelHtml (panel: PanelSpec, assets: OverlayAssets): string {
  const logo = assets.logo ? `<img class="demo-logo" alt="Koumoul" src="${assets.logo}">` : ''
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; }
    ${habillageCss(assets.fontsCss)}
    #__demo-overlay .demo-title, #__demo-overlay .demo-subtitle { transition: none; }
  </style></head><body>
    <div id="__demo-overlay">
      <div class="demo-card">
        <div class="demo-accent"></div>
        <div class="demo-badge">${escapeHtml(panel.badge)}</div>
        <h1 class="demo-title demo-in">${escapeHtml(panel.title)}</h1>
        <p class="demo-subtitle demo-in">${escapeHtml(panel.text)}</p>
        <div class="demo-footer">${escapeHtml(panel.footer)}</div>
        <div class="demo-site">${escapeHtml(panel.site)}</div>
        ${logo}
      </div>
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
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await page.screenshot({ path: outPng })
  } finally {
    await browser.close()
  }
}
