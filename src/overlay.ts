// Habillage vidéo injecté dans la page : cartons d'introduction / de fin à la
// charte Koumoul / Data Fair et sous-titres incrustés.
//
// L'overlay est un élément DOM fixe, sans capture de pointeur, injecté dès la
// création du document : une carte d'intro posée à l'installation est visible
// dès la première frame (elle recouvre le préambule de chargement) et sert de
// point d'accroche à la détection du début de vidéo. Le reste est piloté par le
// scénario :
//
//   await showIntro(page, { badge: '…', title: '…', subtitle: '…' })
//   await hideIntro(page)
//   await setCaption(page, '…')            // ou say(page, '…', actions)
//   await showOutro(page)                  // reprend le carton d'intro
//   await showOutro(page, { title: 'Toutes vos données au même endroit' })
//
// Tant qu'un carton recouvre l'appli (intro ou fin), l'overlay pose la classe
// `demo-cover` sur <html> : human.ts s'en sert pour masquer le curseur factice.
//
// Un seul gabarit de carte (`cardHtml`) sert l'intro, la fin et les panneaux du
// montage (`panels.ts`) : mêmes zones (badge et trait, titre, sous-titre, puis
// logo et site en bas), mêmes tailles. Les tailles suivent la hauteur de
// l'écran (vh, sans plafond en px) : un carton 1080p a les proportions d'un
// carton 720p.
//
// Charte : couleurs du thème par défaut de data-fair
// (`@data-fair/lib-common-types/theme` : primary #1976D2, secondary #81D4FA,
// surface-inverse #424242 pour les sous-titres, on-background #1F2937 de
// datafair.cloud) ; sortent du thème le haut du dégradé (#0B3E8C, blue-darken-4
// #0D47A1 assombri de 13 % pour la profondeur) et le marine #0A2F5E des
// sous-titres `plain` (rendu des teasers de Nicolas, plus lisible). Police Nunito embarquée en base64 et logo officiel Koumoul blanc
// en SVG (dépôt communication, `logos/svg/logo-slogan-white.svg`) — aucun asset
// réseau, pour que le carton soit complet dès la première frame.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { sleep } from './human.ts'
import { CHARTE_DIR } from './paths.ts'

export interface OverlayCard {
  badge?: string
  title: string
  subtitle?: string
  footer?: string
  // site affiché sous le logo ; sur la carte de fin, repris de l'intro s'il
  // n'est pas fourni (chaîne vide pour l'omettre)
  site?: string
}

export interface OverlayAssets {
  logo?: string
  fontsCss?: string
}

export interface OverlayOptions {
  // carton visible dès la première frame (format court)
  intro?: OverlayCard
  // carton de fin par défaut (`showOutro(page)` sans carton) et source du site
  // des cartes de fin qui n'en donnent pas : le carton d'intro, passé à
  // l'installation car l'overlay est réinstallé à chaque navigation
  outro?: OverlayCard
  assets?: OverlayAssets
  caption?: {
    // décale les sous-titres sur la gauche quand un panneau latéral occupe la
    // droite de l'écran (ex. tiroir de 420 px de l'application carto)
    right?: number
    // `box` : bandeau sombre (défaut) ; `plain` : texte foncé sans bandeau,
    // pour les schémas sur fond clair
    style?: 'box' | 'plain'
  }
}

// graisses de la charte utilisées par l'habillage : titre 700, badge 600,
// sous-titre 400
const FONT_WEIGHTS = [400, 600, 700]

// Charge la police Nunito (sous-ensemble latin, accents français compris) et le
// logo Koumoul blanc en data URI : le carton doit être complet dès la première
// frame, sans dépendre du réseau.
export function loadOverlayAssets (): OverlayAssets {
  const fontsCss = FONT_WEIGHTS.map((weight) => {
    const file = readFileSync(resolve(CHARTE_DIR, `nunito-latin-${weight}-normal.woff2`)).toString('base64')
    return `@font-face { font-family: 'Nunito'; font-style: normal; font-weight: ${weight}; font-display: block; src: url(data:font/woff2;base64,${file}) format('woff2'); }`
  }).join('\n')
  const logo = readFileSync(resolve(CHARTE_DIR, 'logo-slogan-white.svg')).toString('base64')
  return { fontsCss, logo: `data:image/svg+xml;base64,${logo}` }
}

// Grain fixe (bruit blanc à ~3 % d'opacité) posé sur le dégradé : sans lui,
// l'encodage H.264 (et le réencodage des réseaux sociaux) découpe le dégradé
// en bandes visibles. Le motif est déterministe : il ne scintille pas d'une
// image à l'autre et ne coûte presque rien en débit.
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .06 0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>"
)}")`

// Feuille de style de l'habillage (cartons et panneaux), partagée entre
// l'overlay injecté dans les pages et le rendu des panneaux au montage
// (`panels.ts`) : cartons et panneaux restent ainsi identiques à la charte.
export function habillageCss (fontsCss = ''): string {
  return `${fontsCss}
        #__demo-overlay, #__demo-overlay * { box-sizing: border-box; }
        #__demo-overlay {
          --demo-from: #0B3E8C; --demo-to: #1976D2; --demo-accent: #81D4FA;
          --demo-caption-bg: rgba(66, 66, 66, .88); --demo-ink: #0A2F5E;
          position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
          font-family: 'Nunito', 'DejaVu Sans', system-ui, sans-serif;
        }
        #__demo-overlay .demo-card {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 2.4vh; text-align: center;
          padding: 8vh 6vw 20vh;
          background: ${GRAIN}, linear-gradient(180deg, var(--demo-from) 0%, var(--demo-to) 100%);
          color: #fff;
        }
        #__demo-intro { transition: opacity .38s ease; }
        #__demo-intro.demo-hidden { opacity: 0; }
        #__demo-outro { opacity: 0; visibility: hidden; transition: opacity .45s ease, visibility .45s; }
        #__demo-outro.demo-visible { opacity: 1; visibility: visible; }
        #__demo-overlay .demo-head { display: flex; flex-direction: column; align-items: center; gap: 2vh; }
        #__demo-overlay .demo-badge {
          font-size: 3.4vh; font-weight: 600; letter-spacing: .22em;
          text-transform: uppercase; color: var(--demo-accent);
        }
        #__demo-overlay .demo-accent { width: 10.5vh; height: .8vh; border-radius: .4vh; background: var(--demo-accent); }
        #__demo-overlay .demo-title {
          margin: .6vh 0 0; max-width: 86vw; font-size: 10.6vh; font-weight: 700;
          line-height: 1.08; letter-spacing: -.01em; text-wrap: balance;
          opacity: 0; transform: translateY(2.2vh);
          transition: opacity .5s ease, transform .5s cubic-bezier(.2, .7, .2, 1);
        }
        #__demo-overlay .demo-subtitle {
          margin: 0; max-width: 78vw; font-size: 4.9vh; font-weight: 400; line-height: 1.3;
          color: rgba(255, 255, 255, .88); text-wrap: balance;
          opacity: 0; transform: translateY(2.2vh);
          transition: opacity .5s ease .14s, transform .5s cubic-bezier(.2, .7, .2, 1) .14s;
        }
        #__demo-overlay .demo-footer { font-size: 2.8vh; color: rgba(255, 255, 255, .8); }
        #__demo-overlay .demo-in { opacity: 1; transform: none; }
        #__demo-overlay .demo-brand {
          position: absolute; left: 0; right: 0; bottom: 5.5vh;
          display: flex; flex-direction: column; align-items: center; gap: 1.2vh;
        }
        #__demo-overlay .demo-logo { height: 7.4vh; width: auto; }
        #__demo-overlay .demo-logo:not([src]) { display: none; }
        #__demo-overlay .demo-site { font-size: 2.8vh; font-weight: 600; letter-spacing: .03em; color: rgba(255, 255, 255, .85); }
        #__demo-overlay .demo-badge:empty, #__demo-overlay .demo-title:empty, #__demo-overlay .demo-subtitle:empty,
        #__demo-overlay .demo-footer:empty, #__demo-overlay .demo-site:empty { display: none; }
        #__demo-caption {
          position: fixed; left: calc((100% - var(--demo-caption-right, 0px)) / 2);
          bottom: 15vh; transform: translateX(-50%); width: max-content;
          max-width: min(81vw, calc(100% - var(--demo-caption-right, 0px) - 6vw));
        }
        #__demo-caption .caption-box {
          opacity: 0; padding: 2.2vh 4.7vh; border-radius: 2.2vh;
          background: var(--demo-caption-bg); color: #fff; font-size: 5.3vh;
          font-weight: 600; line-height: 1.25; text-wrap: balance;
          box-shadow: 0 1.1vh 3.6vh rgba(0, 0, 0, .38);
          transition: opacity .2s ease;
        }
        #__demo-caption.demo-plain { width: calc(100% - 7.5vw); max-width: none; text-align: center; }
        #__demo-caption.demo-plain .caption-box {
          padding: 0; background: none; box-shadow: none; color: var(--demo-ink);
          font-weight: 700; text-shadow: 0 .3vh 1.7vh rgba(248, 251, 254, .95);
        }
        #__demo-caption.demo-visible .caption-box { opacity: 1; }
      `
}

function escapeHtml (value: string | undefined): string {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Typographie française : espace insécable avant « : ; ! ? » et à l'intérieur
// des guillemets, pour qu'aucune ligne ne commence par un signe isolé
// (« étanches / : chaque équipe »). Appliquée à tout texte affiché par le kit.
export function frenchSpacing (text: string): string {
  return text.replace(/[ \u00a0\u202f]+([:;!?»])/g, '\u00a0$1').replace(/«[ \u00a0\u202f]+/g, '«\u00a0')
}

const frenchCard = <T extends Partial<OverlayCard>> (card: T): T =>
  Object.fromEntries(Object.entries(card).map(([key, value]) => [key, typeof value === 'string' ? frenchSpacing(value) : value])) as T

// Gabarit unique des cartons (intro, fin, panneaux). Les champs vides sont
// masqués par la feuille (`:empty`) : la mise en page ne dépend pas des champs
// renseignés, le logo et le site restent toujours au même endroit.
export function cardHtml (card: Partial<OverlayCard>, attrs: string, logo?: string): string {
  card = frenchCard(card)
  return `<div ${attrs} class="demo-card">
          <div class="demo-head"><div class="demo-badge">${escapeHtml(card.badge)}</div><div class="demo-accent"></div></div>
          <h1 class="demo-title">${escapeHtml(card.title)}</h1>
          <p class="demo-subtitle">${escapeHtml(card.subtitle)}</p>
          <div class="demo-footer">${escapeHtml(card.footer)}</div>
          <div class="demo-brand"><img class="demo-logo" alt="Koumoul"${logo ? ` src="${logo}"` : ''}><div class="demo-site">${escapeHtml(card.site)}</div></div>
        </div>`
}

// Le script d'init est sérialisé et exécuté dans la page : tout ce qu'il utilise
// doit être passé en argument (CSS et gabarits calculés côté Node).
type OverlayInitOptions = Pick<OverlayOptions, 'intro' | 'outro'> & { css: string, html: string, captionRight: number, captionStyle: string }

export async function installOverlay (context: BrowserContext, options: OverlayOptions = {}) {
  const logo = options.assets?.logo
  const initOptions: OverlayInitOptions = {
    intro: options.intro && frenchCard(options.intro),
    outro: (options.outro ?? options.intro) && frenchCard((options.outro ?? options.intro)!),
    css: habillageCss(options.assets?.fontsCss),
    html: `${cardHtml({}, 'id="__demo-intro"', logo)}${cardHtml({}, 'id="__demo-outro"', logo)}<div id="__demo-caption"><div class="caption-box"></div></div>`,
    captionRight: options.caption?.right ?? 0,
    captionStyle: options.caption?.style ?? 'box'
  }
  await context.addInitScript((opts: OverlayInitOptions) => {
    const { intro, outro, css, html, captionRight, captionStyle } = opts
    const setup = () => {
      if (document.getElementById('__demo-overlay')) return true
      const host = document.documentElement
      if (!host) return false

      // Feuille constructible : non soumise à la CSP `style-src`.
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      host.style.setProperty('--demo-caption-right', `${captionRight}px`)

      const root = document.createElement('div')
      root.id = '__demo-overlay'
      root.innerHTML = html
      host.appendChild(root)

      const introEl = root.querySelector<HTMLElement>('#__demo-intro')!
      const outroEl = root.querySelector<HTMLElement>('#__demo-outro')!
      const caption = root.querySelector<HTMLElement>('#__demo-caption')!
      const captionBox = caption.querySelector<HTMLElement>('.caption-box')!
      caption.classList.toggle('demo-plain', captionStyle === 'plain')

      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      const setCover = (on: boolean) => document.documentElement.classList.toggle('demo-cover', on)

      const fill = (card: HTMLElement, value: OverlayCard) => {
        for (const field of ['badge', 'title', 'subtitle', 'footer', 'site'] as const) {
          card.querySelector<HTMLElement>(`.demo-${field}`)!.textContent = value[field] ?? ''
        }
      }
      const animateIn = (card: HTMLElement) => requestAnimationFrame(() => {
        card.querySelectorAll('.demo-title, .demo-subtitle').forEach(node => node.classList.add('demo-in'))
      })

      let introShownAt = performance.now()

      const api = {
        async showIntro (value: OverlayCard) {
          sessionStorage.removeItem('__demo-intro-hidden')
          setCover(true)
          introEl.classList.remove('demo-hidden')
          fill(introEl, value)
          introEl.style.display = ''
          animateIn(introEl)
          introShownAt = performance.now()
        },
        async hideIntro (value: { minVisibleMs?: number, fadeMs?: number } = {}) {
          sessionStorage.setItem('__demo-intro-hidden', '1')
          const remaining = (value.minVisibleMs ?? 2600) - (performance.now() - introShownAt)
          if (remaining > 0) await wait(remaining)
          setCover(false)
          introEl.classList.add('demo-hidden')
          await wait(value.fadeMs ?? 380)
          introEl.style.display = 'none'
        },
        setCaption (text: string | null) {
          if (!text) {
            caption.classList.remove('demo-visible')
            captionBox.textContent = ''
            return
          }
          captionBox.textContent = text
          caption.classList.add('demo-visible')
          captionBox.animate(
            [{ opacity: 0, transform: 'translateY(1.4vh)' }, { opacity: 1, transform: 'none' }],
            { duration: 240, easing: 'cubic-bezier(.2, .7, .2, 1)' }
          )
        },
        async showOutro (value?: OverlayCard) {
          const card = value ?? outro
          if (!card) throw new Error('showOutro : aucun carton (ni carton fourni, ni carton d\'intro).')
          outroEl.querySelectorAll('.demo-title, .demo-subtitle').forEach(node => node.classList.remove('demo-in'))
          fill(outroEl, { ...card, site: card.site ?? outro?.site })
          outroEl.classList.add('demo-visible')
          animateIn(outroEl)
          setCover(true)
        }
      }
      ;(window as any).__demoOverlay = api

      if (intro && sessionStorage.getItem('__demo-intro-hidden') !== '1') {
        // texte présent dès la première frame (accroche et point d'accroche de
        // la détection de début) : pas d'animation
        introEl.classList.remove('demo-hidden')
        fill(introEl, intro)
        introEl.querySelectorAll('.demo-title, .demo-subtitle').forEach(node => node.classList.add('demo-in'))
        introShownAt = performance.now()
        setCover(true)
      } else {
        introEl.style.display = 'none'
      }
      return true
    }
    if (!setup()) {
      const observer = new MutationObserver(() => {
        if (setup()) observer.disconnect()
      })
      observer.observe(document, { childList: true })
    }
  }, initOptions)
}

export async function showIntro (page: Page, card: OverlayCard) {
  await page.evaluate(c => (window as any).__demoOverlay?.showIntro(c), frenchCard(card))
}

export async function hideIntro (page: Page, opts: { minVisibleMs?: number, fadeMs?: number } = {}) {
  await page.evaluate(o => (window as any).__demoOverlay?.hideIntro(o), opts)
}

export async function setCaption (page: Page, text: string | null) {
  await page.evaluate(t => (window as any).__demoOverlay?.setCaption(t), text && frenchSpacing(text))
}

// Carte de fin : même gabarit que l'intro ; sans carton, reprend l'intro à
// l'identique (le site manquant est toujours repris de l'intro).
export async function showOutro (page: Page, card?: OverlayCard) {
  await page.evaluate(c => (window as any).__demoOverlay?.showOutro(c), card && frenchCard(card))
}

// Temps de lecture d'un sous-titre : `cps` caractères par seconde, jamais moins
// de `minHold` ms. Exporté pour les tests.
export function captionHold (text: string, opts: { cps?: number, minHold?: number } = {}): number {
  return Math.max(opts.minHold ?? 2200, (text.length * 1000) / (opts.cps ?? 12))
}

// Pose un sous-titre, joue `actions` pendant qu'il est affiché, puis le tient
// jusqu'à son temps de lecture : la lecture est un plancher, les actions (ou
// animations) ne sont jamais coupées. Formats courts surtout.
export async function say (page: Page, text: string, actions?: () => Promise<unknown>, opts: { cps?: number, minHold?: number } = {}) {
  await setCaption(page, text)
  const t0 = Date.now()
  if (actions) await actions()
  const left = captionHold(text, opts) - (Date.now() - t0)
  if (left > 0) await sleep(left)
}
