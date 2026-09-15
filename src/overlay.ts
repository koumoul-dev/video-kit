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
//   await setCaption(page, '…')
//   await showOutro(page, { title: 'datafair.cloud' })
//
// Tant qu'un carton recouvre l'appli (intro ou fin), l'overlay pose la classe
// `demo-cover` sur <html> : human.ts s'en sert pour masquer le curseur factice.
//
// Charte : dégradé relevé sur l'OG datafair.cloud (bandeau secondaire #81D4FA
// puis #0A2F5E → #1976D2), police Nunito embarquée en base64 (assets/charte) et
// logo Koumoul blanc — aucun asset réseau, pour que le carton soit complet dès
// la première frame.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { CHARTE_DIR } from './paths.ts'

export interface OverlayCard {
  badge?: string
  title: string
  subtitle?: string
  footer?: string
  site?: string
}

export interface OverlayAssets {
  logo?: string
  fontsCss?: string
}

export interface OverlayOptions {
  intro?: OverlayCard
  assets?: OverlayAssets
  // décale les sous-titres sur la gauche quand un panneau latéral occupe la
  // droite de l'écran (ex. tiroir de 420 px de l'application carto)
  caption?: { right?: number }
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
  const logo = readFileSync(resolve(CHARTE_DIR, 'logo-slogan-white.png')).toString('base64')
  return { fontsCss, logo: `data:image/png;base64,${logo}` }
}

export async function installOverlay (context: BrowserContext, options: OverlayOptions = {}) {
  await context.addInitScript((opts: OverlayOptions) => {
    const { intro, assets } = opts
    const captionRight = opts.caption?.right ?? 0
    const setup = () => {
      if (document.getElementById('__demo-overlay')) return true
      const host = document.documentElement
      if (!host) return false

      // Feuille constructible : non soumise à la CSP `style-src`.
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(`${assets?.fontsCss ?? ''}
        #__demo-overlay, #__demo-overlay * { box-sizing: border-box; }
        #__demo-overlay {
          position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
          font-family: 'Nunito', 'DejaVu Sans', system-ui, sans-serif;
        }
        #__demo-overlay .demo-card {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 16px; text-align: center;
          padding: 0 48px;
          border-top: 10px solid #81D4FA;
          background: linear-gradient(180deg, #0A2F5E 0%, #1976D2 100%);
          color: #fff;
        }
        #__demo-intro { transition: opacity .38s ease; }
        #__demo-intro.demo-hidden { opacity: 0; }
        #__demo-outro { opacity: 0; visibility: hidden; transition: opacity .45s ease, visibility .45s; }
        #__demo-outro.demo-visible { opacity: 1; visibility: visible; }
        #__demo-flash { position: fixed; inset: 0; z-index: 2147483644; background: #ffffff; }
        #__demo-overlay .demo-accent { width: 76px; height: 6px; border-radius: 3px; background: #81D4FA; }
        #__demo-overlay .demo-badge {
          font-size: min(2vw, 26px); font-weight: 600; letter-spacing: .22em;
          text-transform: uppercase; color: #81D4FA;
        }
        #__demo-overlay .demo-title {
          margin: 6px 0 0; max-width: 1320px; font-size: min(6.1vw, 78px); font-weight: 700;
          line-height: 1.08; letter-spacing: -.01em; text-wrap: balance;
          opacity: 0; transform: translateY(16px);
          transition: opacity .5s ease, transform .5s cubic-bezier(.2, .7, .2, 1);
        }
        #__demo-overlay .demo-subtitle {
          margin: 0; max-width: 1080px; font-size: min(2.8vw, 36px); font-weight: 400;
          color: rgba(255, 255, 255, .85); text-wrap: balance;
          opacity: 0; transform: translateY(16px);
          transition: opacity .5s ease .14s, transform .5s cubic-bezier(.2, .7, .2, 1) .14s;
        }
        #__demo-overlay .demo-footer { font-size: min(1.5vw, 19px); color: rgba(255, 255, 255, .75); }
        #__demo-overlay .demo-site { position: absolute; bottom: 28px; font-size: 16px; color: rgba(255, 255, 255, .6); }
        #__demo-overlay .demo-in { opacity: 1; transform: none; }
        #__demo-overlay .demo-logo {
          position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%);
          height: 52px; width: auto;
        }
        #__demo-outro .demo-logo { position: static; transform: none; margin-top: 6px; }
        #__demo-caption {
          position: fixed; left: calc((100% - var(--demo-caption-right, 0px)) / 2);
          bottom: 108px; transform: translateX(-50%); width: max-content;
          max-width: min(1040px, calc(100% - var(--demo-caption-right, 0px) - 80px));
        }
        #__demo-caption .caption-box {
          opacity: 0; padding: 16px 34px; border-radius: 16px;
          background: rgba(66, 66, 66, .86); color: #fff; font-size: min(3vw, 38px);
          font-weight: 600; line-height: 1.25; text-wrap: balance;
          box-shadow: 0 8px 26px rgba(0, 0, 0, .38);
          transition: opacity .2s ease;
        }
        #__demo-caption.demo-visible .caption-box { opacity: 1; }
      `)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      host.style.setProperty('--demo-caption-right', `${captionRight}px`)

      const root = document.createElement('div')
      root.id = '__demo-overlay'
      root.innerHTML = `
        <div id="__demo-intro" class="demo-card">
          <div class="demo-accent"></div>
          <div class="demo-badge"></div>
          <h1 class="demo-title"></h1>
          <p class="demo-subtitle"></p>
          <div class="demo-footer"></div>
          <div class="demo-site"></div>
          <img class="demo-logo" alt="Koumoul">
        </div>
        <div id="__demo-outro" class="demo-card">
          <div class="demo-accent"></div>
          <div class="demo-badge"></div>
          <h1 class="demo-title"></h1>
          <p class="demo-subtitle"></p>
          <div class="demo-footer"></div>
          <div class="demo-site"></div>
          <img class="demo-logo" alt="Koumoul">
        </div>
        <div id="__demo-caption"><div class="caption-box"></div></div>
      `
      host.appendChild(root)

      const introEl = root.querySelector<HTMLElement>('#__demo-intro')!
      const outroEl = root.querySelector<HTMLElement>('#__demo-outro')!
      const caption = root.querySelector<HTMLElement>('#__demo-caption')!
      const captionBox = caption.querySelector<HTMLElement>('.caption-box')!

      root.querySelectorAll<HTMLImageElement>('.demo-logo').forEach((img) => {
        if (assets?.logo) img.src = assets.logo
        else img.style.display = 'none'
      })

      const fields = (card: HTMLElement) => ({
        badge: card.querySelector<HTMLElement>('.demo-badge')!,
        title: card.querySelector<HTMLElement>('.demo-title')!,
        subtitle: card.querySelector<HTMLElement>('.demo-subtitle')!,
        footer: card.querySelector<HTMLElement>('.demo-footer')!,
        site: card.querySelector<HTMLElement>('.demo-site')!
      })

      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      const setCover = (on: boolean) => document.documentElement.classList.toggle('demo-cover', on)

      const fill = (card: HTMLElement, opts: OverlayCard) => {
        const el = fields(card)
        const set = (node: HTMLElement, value: string | undefined) => {
          node.textContent = value ?? ''
          node.style.display = value ? '' : 'none'
        }
        set(el.badge, opts.badge)
        set(el.title, opts.title)
        set(el.subtitle, opts.subtitle)
        set(el.footer, opts.footer)
        set(el.site, opts.site)
      }

      let introShownAt = performance.now()
      let flash: HTMLElement | undefined
      const showFlash = async (ms: number) => {
        if (!ms) return
        if (!flash) {
          flash = document.createElement('div')
          flash.id = '__demo-flash'
          host.appendChild(flash)
        }
        await wait(ms)
        flash.remove()
        flash = undefined
      }

      const showCard = async (card: HTMLElement, opts: OverlayCard, withFlash: boolean) => {
        await showFlash(withFlash ? 700 : 0)
        fill(card, opts)
        card.style.display = ''
        // le temps d'afficher la carte, puis l'animation d'entrée du texte
        requestAnimationFrame(() => {
          card.querySelectorAll('.demo-title, .demo-subtitle').forEach(node => node.classList.add('demo-in'))
        })
        return performance.now()
      }

      const api = {
        async showIntro (opts: OverlayCard) {
          sessionStorage.removeItem('__demo-intro-hidden')
          setCover(true)
          introEl.classList.remove('demo-hidden')
          introShownAt = await showCard(introEl, opts, true)
        },
        async hideIntro (opts: { minVisibleMs?: number, fadeMs?: number } = {}) {
          sessionStorage.setItem('__demo-intro-hidden', '1')
          const remaining = (opts.minVisibleMs ?? 2600) - (performance.now() - introShownAt)
          if (remaining > 0) await wait(remaining)
          setCover(false)
          introEl.classList.add('demo-hidden')
          await wait(opts.fadeMs ?? 380)
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
            [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
            { duration: 240, easing: 'cubic-bezier(.2, .7, .2, 1)' }
          )
        },
        async showOutro (opts: OverlayCard) {
          outroEl.querySelectorAll('.demo-title, .demo-subtitle').forEach(node => node.classList.remove('demo-in'))
          fill(outroEl, opts)
          outroEl.classList.add('demo-visible')
          requestAnimationFrame(() => {
            outroEl.querySelectorAll('.demo-title, .demo-subtitle').forEach(node => node.classList.add('demo-in'))
          })
          setCover(true)
        }
      }
      ;(window as any).__demoOverlay = api

      if (intro && sessionStorage.getItem('__demo-intro-hidden') !== '1') {
        // texte présent dès la première frame (accroche et point d'accroche de
        // la détection de début) : pas d'animation, pas de flash
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
  }, options)
}

export async function showIntro (page: Page, card: OverlayCard) {
  await page.evaluate(c => (window as any).__demoOverlay?.showIntro(c), card)
}

export async function hideIntro (page: Page, opts: { minVisibleMs?: number, fadeMs?: number } = {}) {
  await page.evaluate(o => (window as any).__demoOverlay?.hideIntro(o), opts)
}

export async function setCaption (page: Page, text: string | null) {
  await page.evaluate(t => (window as any).__demoOverlay?.setCaption(t), text)
}

export async function showOutro (page: Page, card: OverlayCard) {
  await page.evaluate(c => (window as any).__demoOverlay?.showOutro(c), card)
}
