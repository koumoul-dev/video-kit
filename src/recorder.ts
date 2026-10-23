// Enregistre la vidéo : scénario Playwright, curseur humain, cartons à la
// charte, synthèse vocale éventuelle et timeline pour le montage.
//
// Deux modes :
//  - avec `script.md` : les scènes (beats) suivent la durée réelle de la
//    narration (voix) ou une durée estimée (muet) ; le carton de titre est joué
//    au beat 0 et masqué au beat 1 ; `mux.ts` recale la vidéo sur le carton ;
//  - sans `script.md` (format court) : le scénario pilote tout (intro exportée,
//    sous-titres incrustés via `setCaption`, carte de fin) ; `mux.ts` coupe le
//    préambule de chargement par analyse de luminance.
//
// L'authentification se fait par le proxy NHI : Chromium est lancé derrière le
// proxy et reçoit la session en cookies (voir auth.ts et
// `skills/demo-videos/references/auth.md`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Page } from '@playwright/test'
import { proxyServer } from './auth.ts'
import { startCapture } from './capture.ts'
import { installCursor, sleep } from './human.ts'
import { hideIntro, installOverlay, loadOverlayAssets, showIntro, type OverlayCard, type OverlayOptions } from './overlay.ts'
import { parseScript, type Script } from './script.ts'
import { prepareNarration, type NarratedBeat } from './tts.ts'
import { IDLE_FACTOR, type Timeline, type TimelineBeat, type TimelineIdle } from './timeline.ts'

const GAP_AFTER_NARRATION = 0.7

// Pages dont le texte s'affiche dans une police de repli : police en erreur
// (`document.fonts`) ou corps de page resté dans la police par défaut du
// navigateur (feuille de thème non chargée). Les iframes vides ou masquées
// (tiroir de l'assistant fermé…) sont ignorées : seul ce qui est filmé compte.
async function fontIssues (page: Page): Promise<string[]> {
  const issues: string[] = []
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      // un tiroir fermé reste « visible » au sens de Playwright, mais hors de
      // la fenêtre : on vérifie que l'iframe recoupe ce qui est filmé
      const box = await frame.frameElement().then(element => element.boundingBox()).catch(() => null)
      const viewport = page.viewportSize()
      if (!box || !viewport || box.width < 2 || box.height < 2 ||
        box.x + box.width <= 0 || box.y + box.height <= 0 || box.x >= viewport.width || box.y >= viewport.height) continue
    }
    const found = await frame.evaluate(() => {
      if (!document.body || !document.body.innerText.trim()) return undefined
      const failed = [...document.fonts].filter(font => font.status === 'error').map(font => font.family.replaceAll('"', ''))
      return { failed: [...new Set(failed)], family: getComputedStyle(document.body).fontFamily }
    }).catch(() => undefined)
    if (!found) continue
    const where = frame.url().slice(0, 120)
    if (found.failed.length) issues.push(`police non chargée (${found.failed.join(', ')}) — ${where}`)
    if (/^\s*("?Times New Roman"?|serif)\s*(,|$)/i.test(found.family)) issues.push(`texte en police par défaut du navigateur (${found.family}) — ${where}`)
  }
  return issues
}

export interface BeatRunner {
  (id: string, actions: (page: Page) => Promise<void>): Promise<void>
}

export interface IdleMarker {
  begin: (factor?: number) => void
  end: () => void
}

export interface ScenarioContext {
  page: Page
  beat: BeatRunner
  idle: IdleMarker
  // marque le début du contenu utile du beat (page rendue, fin du chargement) :
  // le montage en habillage panneaux coupe [t0, contentT0]. À appeler après
  // l'attente de rendu du fragment, quand le chargement laisse l'ancienne page
  // affichée (pas d'écran blanc à détecter).
  mark: () => Promise<void>
  log: (message: string) => void
  video: string
  videosDir: string
}

export interface RecordOptions {
  video: string
  videosDir: string
  // taille de la fenêtre en pixels CSS : fixe la mise en page (breakpoints)
  size?: string
  // densité de pixels : la vidéo fait `size × scale` (1280x720 × 1,5 = 1080p,
  // × 3 = 4K) avec la mise en page de `size`, texte plus net
  scale?: number
  headed?: boolean
  mux?: boolean
  burn?: boolean
  noTts?: boolean
  // cookies de session explicites (storage state Playwright), en plus du proxy
  state?: string
  url?: string
  // décale les sous-titres incrustés du format court (panneau latéral à droite)
  captionRight?: number
  intro?: OverlayCard
}

function loadNarratedBeats (script: Script, audioDir: string): NarratedBeat[] {
  return script.beats.map((beat) => {
    const audioPath = resolve(audioDir, `${beat.id}.mp3`)
    if (!existsSync(audioPath)) throw new Error(`Audio manquant pour ${beat.id} : relancez sans --no-tts.`)
    const meta = JSON.parse(readFileSync(resolve(audioDir, `${beat.id}.json`), 'utf8')) as { duration: number, words?: NarratedBeat['words'] }
    return { ...beat, audioPath, duration: meta.duration, words: meta.words }
  })
}

export async function record (opts: RecordOptions) {
  const { video: videoName, videosDir } = opts
  const size = opts.size ?? '1920x1080'
  const [width, height] = size.split('x').map(Number)
  if (!width || !height) throw new Error(`Taille invalide : ${size}`)
  const scale = opts.scale ?? 1
  if (!(scale >= 1 && scale <= 4)) throw new Error(`Échelle invalide : ${opts.scale} (entre 1 et 4)`)
  const videoSize = { width: Math.round(width * scale / 2) * 2, height: Math.round(height * scale / 2) * 2 }

  const videoDir = resolve(videosDir, videoName)
  const outDir = resolve(videoDir, 'out')
  if (!existsSync(videoDir)) throw new Error(`Dossier vidéo introuvable : ${videoDir}`)
  mkdirSync(outDir, { recursive: true })

  // script.md est la source de vérité de la narration ; il est optionnel pour
  // les formats courts pilotés entièrement par le scénario (sous-titres
  // incrustés à l'écran, pas de SRT).
  const scriptPath = resolve(videoDir, 'script.md')
  const script = existsSync(scriptPath) ? parseScript(scriptPath) : undefined
  const scenarioPath = resolve(videoDir, 'scenario.ts')
  if (!existsSync(scenarioPath)) throw new Error(`Scénario introuvable : ${scenarioPath}`)

  // scénario importé avant le navigateur : l'`intro` éventuelle doit être
  // installée dès la création du document (texte visible à la première frame)
  const scenario = await import(pathToFileURL(scenarioPath).href) as {
    default: (ctx: ScenarioContext) => Promise<void>
    intro?: OverlayCard
    // style des sous-titres incrustés (`export const caption = { style: 'plain' }`)
    caption?: OverlayOptions['caption']
  }

  const introCard: OverlayCard | undefined = opts.intro ?? scenario.intro ?? (script
    ? {
        title: script.frontMatter.titre ?? videoName,
        badge: script.frontMatter.carton_eyebrow,
        subtitle: script.frontMatter.carton_sous_titre,
        site: script.frontMatter.carton_site
      }
    : undefined)

  const startedAt = Date.now()
  const log = (message: string) => console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`)

  const audioDir = resolve(outDir, 'audio')
  const narration = script ? (opts.noTts ? loadNarratedBeats(script, audioDir) : prepareNarration(script)) : []
  const beatIndex = new Map(narration.map((b, i) => [b.id, i]))
  // habillage panneaux : les citations deviennent des panneaux insérés au
  // montage, les beats sans citation des fragments ; les scènes intermédiaires
  // ne sont plus calées sur la durée estimée de la narration.
  const isPanelMode = script?.frontMatter.habillage === 'panneaux'
  const sizeLabel = `${width}x${height}${scale !== 1 ? ` × ${scale} = ${videoSize.width}x${videoSize.height}` : ''}${opts.headed ? ', headed' : ''}`
  console.log(script
    ? `Vidéo « ${videoName} » (${sizeLabel}) — ${script.beats.length} beats${isPanelMode ? ', habillage panneaux' : ''}`
    : `Vidéo « ${videoName} » (${sizeLabel}) — format court sans script.md`)

  const proxy = proxyServer()
  if (proxy) log(`proxy NHI : ${proxy}`)
  else if (!opts.state) console.warn('Aucun proxy NHI configuré : le chargement sera anonyme (voir auth.md).')

  // `--force-color-profile=srgb` : rendu des couleurs stable d'une machine à
  // l'autre (captures de cartes et de graphiques)
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !opts.headed,
    proxy: proxy ? { server: proxy } : undefined,
    // le screencast de Chrome headless n'est en haute densité qu'avec ce
    // drapeau, en plus du deviceScaleFactor du contexte
    args: ['--force-color-profile=srgb', ...(scale !== 1 ? [`--force-device-scale-factor=${scale}`] : [])]
  })
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    // le proxy re-signe l'hôte cible avec sa propre autorité de certification
    ignoreHTTPSErrors: !!proxy,
    // la CSP des services (font-src) bloque la Nunito embarquée en data: des
    // cartons : sans cela, intro et fin s'affichent dans une police de repli
    bypassCSP: true,
    storageState: opts.state
  })

  await installCursor(context)
  await installOverlay(context, {
    intro: script ? undefined : introCard,
    outro: introCard,
    assets: loadOverlayAssets(),
    caption: { right: opts.captionRight ?? scenario.caption?.right, style: scenario.caption?.style }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const rawPath = resolve(outDir, `${videoName}.raw.mkv`)
  const capture = await startCapture(page, rawPath, videoSize)

  // garde-fou des polices, relevé toutes les 3 s : une police manquante passe
  // inaperçue au tournage et se voit sur toute la vidéo
  const fontWarnings = new Set<string>()
  const fontTimer = setInterval(() => {
    fontIssues(page).then((issues) => {
      for (const issue of issues) {
        if (fontWarnings.has(issue)) continue
        fontWarnings.add(issue)
        log(`⚠ ${issue}`)
      }
    }).catch(() => {})
  }, 3000)

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (msg.text().includes('GL Driver Message') || msg.text().includes('WebGL')) return
    log(`console:error ${msg.text().slice(0, 300)}`)
  })
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? ''
    if (failure.includes('ERR_ABORTED')) return
    log(`échec réseau ${req.method()} ${req.url().slice(0, 160)} ${failure}`)
  })

  let originWall = Date.now()
  let videoStartWall: number | undefined
  let cardT0 = 0
  const timelineBeats: TimelineBeat[] = []
  const idles: TimelineIdle[] = []
  let idleStart: number | undefined
  let idleFactor = IDLE_FACTOR

  // Marquage des attentes (réponses du LLM, traitements longs) pour permettre un
  // raccourci au montage (mux.ts compresse ces segments, facteur par attente).
  const idle: IdleMarker = {
    begin: (factor) => {
      if (idleStart === undefined) {
        idleStart = (Date.now() - originWall) / 1000
        idleFactor = factor ?? IDLE_FACTOR
      }
    },
    end: () => {
      if (idleStart === undefined) return
      idles.push({
        t0: Math.round(idleStart * 1000) / 1000,
        t1: Math.round(((Date.now() - originWall) / 1000) * 1000) / 1000,
        factor: idleFactor
      })
      idleStart = undefined
    }
  }

  const completed: string[] = []
  let markWall: number | undefined
  const mark = async () => {
    markWall = (Date.now() - originWall) / 1000
  }

  const beat: BeatRunner = async (id, actions) => {
    if (!script) throw new Error(`Aucun script.md dans ${videoDir} : ce scénario doit piloter ses propres scènes.`)
    const index = beatIndex.get(id)
    if (index === undefined) throw new Error(`Beat inconnu dans script.md : ${id}`)
    if (completed.length && completed[completed.length - 1] !== narration[index - 1]?.id) {
      throw new Error(`Beats joués dans le désordre : ${completed[completed.length - 1]} puis ${id}`)
    }
    const current = narration[index]
    if (index === 0) {
      originWall = Date.now()
      // les attentes du prélude (import du décor…) sont coupées avec lui : sans
      // cette remise à zéro, horodatées sur l'ancienne origine, elles
      // retombaient sur les premiers beats et les compressaient
      idles.length = 0
      idleStart = undefined
      await showIntro(page, introCard!)
      cardT0 = (Date.now() - originWall) / 1000
    } else if (index === 1) {
      await hideIntro(page)
    }
    markWall = undefined
    const t0 = (Date.now() - originWall) / 1000
    await actions(page)
    // en habillage panneaux, le texte du beat vit sur le panneau : seul le
    // carton d'ouverture (index 0) et le carton de fin gardent sa durée
    const padToNarration = !isPanelMode || index === 0 || index === narration.length - 1
    const minEnd = t0 + (padToNarration ? current.duration : 0) + GAP_AFTER_NARRATION
    const wait = minEnd - (Date.now() - originWall) / 1000
    if (wait > 0) await sleep(wait * 1000)
    const t1 = (Date.now() - originWall) / 1000
    timelineBeats.push({
      id,
      t0: Math.round(t0 * 1000) / 1000,
      t1: Math.round(t1 * 1000) / 1000,
      audioStart: Math.round(t0 * 1000) / 1000,
      audioDur: current.duration,
      contentT0: markWall !== undefined ? Math.round(markWall * 1000) / 1000 : undefined
    })
    completed.push(id)
    const marked = markWall !== undefined ? `, contenu à +${(markWall - t0).toFixed(1)}s` : ''
    log(`${id} — ${(t1 - t0).toFixed(1)}s (narration ${current.duration.toFixed(1)}s${marked})`)
  }

  try {
    if (opts.url) await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await scenario.default({ page, beat, idle, mark, log, video: videoName, videosDir })
    await sleep(800)
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    clearInterval(fontTimer)
    idle.end()
    videoStartWall = await capture.stop()
    await browser.close()
  }

  if (videoStartWall === undefined || !existsSync(rawPath)) {
    throw new Error('Aucune vidéo produite.')
  }
  const timeline: Timeline = {
    video: videoName,
    width,
    height,
    scale,
    originWall,
    videoStartWall,
    cardT0,
    beats: timelineBeats,
    idles
  }
  writeFileSync(resolve(outDir, `${videoName}.timeline.json`), JSON.stringify(timeline, null, 2) + '\n')
  log(`Vidéo brute : ${rawPath}`)
  if (fontWarnings.size) {
    console.warn(`⚠ ${fontWarnings.size} avertissement(s) de police : relire les passages concernés avant diffusion.`)
    for (const warning of fontWarnings) console.warn(`  - ${warning}`)
  }

  if (opts.mux && !process.exitCode) {
    const { mux } = await import('./mux.ts')
    await mux(videoName, videosDir, { burn: opts.burn })
  }
}
