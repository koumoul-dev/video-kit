// Curseur factice et gestes « humains » pour les vidéos de démonstration.
//
// Playwright n'enregistre jamais le curseur du système : sans overlay, la vidéo
// montre des actions qui se déclenchent toutes seules. Le curseur est donc un
// élément DOM injecté dans la page, déplacé par de vrais événements souris (ceux
// que Playwright émet), avec une onde à chaque clic. Les déplacements suivent
// une courbe de Bézier avec un léger bruit, les frappes sont ralenties et
// irrégulières.
//
// Tant qu'un carton de l'overlay recouvre l'appli (intro ou fin), la classe
// `demo-cover` posée sur <html> masque le curseur : il n'a de sens que sur
// l'interface.

import type { BrowserContext, Locator, Page } from '@playwright/test'

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const rand = (min: number, max: number) => min + Math.random() * (max - min)

// facteur appliqué aux temps morts des gestes (pas aux trajectoires) : un
// scénario de 15 s peut rester lisible sans changer les courbes de déplacement
let timeScale = 1

export function setTimeScale (scale: number) {
  timeScale = scale
}

const pause = (ms: number) => sleep(Math.max(1, ms * timeScale))
const wait = (min: number, max: number) => pause(rand(min, max))

export async function installCursor (context: BrowserContext) {
  await context.addInitScript(() => {
    const install = () => {
      if (document.getElementById('__demo-cursor')) return
      // Feuille de style constructible : non soumise à la CSP `style-src`
      // (contrairement à un <style> inline ou à l'attribut style).
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(`
        #__demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; will-change: transform; opacity: 1; transition: opacity .25s ease; }
        #__demo-cursor svg { display: block; transition: transform .08s ease-out; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
        #__demo-cursor.pressed svg { transform: scale(.82); }
        .demo-ripple { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border: 2px solid rgba(25, 118, 210, .95); border-radius: 50%; pointer-events: none; z-index: 2147483646; }
        /* sur un carton de l'overlay, le curseur factice n'a pas de sens */
        html.demo-cover #__demo-cursor { opacity: 0; }
        html.demo-cover .demo-ripple { display: none; }
        html, body, * { cursor: none !important; }
      `)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      const cursor = document.createElement('div')
      cursor.id = '__demo-cursor'
      cursor.innerHTML = '<svg width="25" height="25" viewBox="0 0 25 25"><path d="M3 1.5 L3 19.5 L8 14.9 L10.9 21.5 L14.2 20 L11.4 13.6 L18 13.6 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/></svg>'
      document.body.appendChild(cursor)
      const place = (x: number, y: number) => {
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`
      }
      window.addEventListener('mousemove', (e) => place(e.clientX, e.clientY), true)
      window.addEventListener('mousedown', (e) => {
        place(e.clientX, e.clientY)
        cursor.classList.add('pressed')
        const ripple = document.createElement('div')
        ripple.className = 'demo-ripple'
        ripple.style.left = `${e.clientX}px`
        ripple.style.top = `${e.clientY}px`
        document.body.appendChild(ripple)
        ripple.animate(
          [{ transform: 'scale(.35)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }],
          { duration: 550, easing: 'ease-out' }
        ).onfinish = () => ripple.remove()
      }, true)
      window.addEventListener('mouseup', () => cursor.classList.remove('pressed'), true)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
    else install()
  })
}

const positions = new WeakMap<Page, { x: number, y: number }>()

function positionOf (page: Page) {
  let pos = positions.get(page)
  if (!pos) {
    const viewport = page.viewportSize()
    pos = { x: (viewport?.width ?? 1280) / 2, y: (viewport?.height ?? 720) / 2 }
    positions.set(page, pos)
  }
  return pos
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export async function moveMouseHuman (page: Page, x: number, y: number, opts: { duration?: number } = {}) {
  const from = positionOf(page)
  const dx = x - from.x
  const dy = y - from.y
  const dist = Math.hypot(dx, dy)
  if (dist < 3) {
    await page.mouse.move(x, y)
    positions.set(page, { x, y })
    return
  }
  const duration = opts.duration ?? rand(380, 780)
  const bend = Math.min(dist * rand(0.08, 0.22), 110) * (Math.random() < 0.5 ? -1 : 1)
  const nx = -dy / dist
  const ny = dx / dist
  const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend }
  const c2 = { x: from.x + dx * 0.7 + nx * bend * 0.5, y: from.y + dy * 0.7 + ny * bend * 0.5 }
  const steps = Math.max(9, Math.round(dist / 24))
  const frame = duration / steps
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps)
    const mt = 1 - t
    const px = mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * x
    const py = mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * y
    await page.mouse.move(px + rand(-0.8, 0.8), py + rand(-0.8, 0.8))
    await pause(Math.max(4, frame + rand(-4, 6)))
  }
  await page.mouse.move(x, y)
  positions.set(page, { x, y })
}

export async function clickHuman (page: Page, x: number, y: number, opts: { button?: 'left' | 'right', delay?: number, duration?: number } = {}) {
  await moveMouseHuman(page, x, y, { duration: opts.duration })
  await pause(opts.delay ?? rand(90, 190))
  await page.mouse.down({ button: opts.button ?? 'left' })
  await wait(60, 130)
  await page.mouse.up({ button: opts.button ?? 'left' })
}

export async function dblclickHuman (page: Page, x: number, y: number) {
  await moveMouseHuman(page, x, y)
  await wait(120, 220)
  await page.mouse.dblclick(x, y, { delay: rand(55, 95) })
  positions.set(page, { x, y })
}

// approche le curseur factice de l'élément puis laisse Playwright cliquer
// (auto-attente d'actionnabilité : l'élément peut être recouvert, absent…)
export async function clickLocator (page: Page, locator: Locator, opts: { button?: 'left' | 'right', duration?: number } = {}) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (box) {
    await moveMouseHuman(page, box.x + box.width / 2, box.y + box.height / 2, { duration: opts.duration })
    await wait(80, 180)
  }
  await locator.click({ button: opts.button, delay: rand(60, 130) })
}

export async function dragHuman (page: Page, from: { x: number, y: number }, to: { x: number, y: number }, opts: { duration?: number } = {}) {
  await moveMouseHuman(page, from.x, from.y)
  await wait(110, 220)
  await page.mouse.down()
  await wait(80, 160)
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  // peu de pas : chaque pas d'un drag sur la carte coûte un rendu complet,
  // au-delà de quelques pas le geste n'apporte rien visuellement
  const steps = Math.max(6, Math.round(dist / 10))
  const duration = opts.duration ?? rand(500, 900)
  const frame = duration / steps
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps)
    const px = from.x + (to.x - from.x) * t
    const py = from.y + (to.y - from.y) * t
    await page.mouse.move(px + rand(-1, 1), py + rand(-1, 1))
    await pause(Math.max(5, frame + rand(-4, 6)))
  }
  await page.mouse.move(to.x, to.y)
  await wait(110, 200)
  await page.mouse.up()
  positions.set(page, { x: to.x, y: to.y })
}

export async function wheelHuman (page: Page, x: number, y: number, deltaY: number, times = 1) {
  await moveMouseHuman(page, x, y)
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, deltaY)
    await wait(90, 180)
  }
}

export async function typeHuman (page: Page, text: string) {
  for (const char of text) {
    await page.keyboard.type(char)
    await wait(45, 115)
    if (Math.random() < 0.07) await wait(200, 420)
  }
}

export async function replaceTextHuman (page: Page, locator: Locator, text: string) {
  await clickLocator(page, locator)
  await wait(120, 200)
  await page.keyboard.press('ControlOrMeta+a')
  await wait(80, 160)
  await page.keyboard.press('Backspace')
  await wait(80, 160)
  await typeHuman(page, text)
  await wait(120, 220)
}

// valeur posée d'un coup (champs avec sélecteur : couleur, date, nombre)
export async function fillLocatorHuman (page: Page, locator: Locator, text: string, opts: { duration?: number } = {}) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (box) await moveMouseHuman(page, box.x + box.width / 2, box.y + box.height / 2, { duration: opts.duration })
  await locator.fill(text)
  await wait(150, 250)
}
