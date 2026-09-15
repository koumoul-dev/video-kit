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
// L'authentification se fait par le proxy NHI (session de test) : voir auth.ts
// et `skills/demo-videos/references/auth.md`.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { ensureProxyAuth, mcpLaunchOptions } from './auth.ts'
import { installCursor, sleep } from './human.ts'
import { hideIntro, installOverlay, loadOverlayAssets, showIntro, type OverlayCard } from './overlay.ts'
import { parseScript, type Script } from './script.ts'
import { prepareNarration, type NarratedBeat } from './tts.ts'
import { IDLE_FACTOR, type Timeline, type TimelineBeat, type TimelineIdle } from './timeline.ts'

const GAP_AFTER_NARRATION = 0.7

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
  log: (message: string) => void
  video: string
  videosDir: string
}

export interface RecordOptions {
  video: string
  videosDir: string
  size?: string
  headed?: boolean
  mux?: boolean
  burn?: boolean
  offset?: number
  noTts?: boolean
  state?: string
  noState?: boolean
  profile?: boolean
  url?: string
  // décale les sous-titres incrustés du format court (panneau latéral à droite)
  captionRight?: number
  intro?: OverlayCard
}

// Profil persistant le plus récent du navigateur MCP (session connectée).
function findMcpProfile (): string {
  if (process.env.MCP_PROFILE) return process.env.MCP_PROFILE
  const base = resolve(homedir(), '.cache/ms-playwright-mcp')
  if (!existsSync(base)) throw new Error(`Profil MCP introuvable (${base}) : renseignez MCP_PROFILE.`)
  const candidates = readdirSync(base)
    .filter(name => name.startsWith('mcp-chrome-'))
    .map(name => ({ path: resolve(base, name), mtime: statSync(resolve(base, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (!candidates.length) throw new Error(`Aucun profil dans ${base} : renseignez MCP_PROFILE.`)
  return candidates[0].path
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

  const videoDir = resolve(videosDir, videoName)
  const outDir = resolve(videoDir, 'out')
  const rawDir = resolve(outDir, 'raw')
  if (!existsSync(videoDir)) throw new Error(`Dossier vidéo introuvable : ${videoDir}`)
  mkdirSync(rawDir, { recursive: true })
  for (const file of readdirSync(rawDir)) rmSync(resolve(rawDir, file), { recursive: true, force: true })

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
  console.log(script
    ? `Vidéo « ${videoName} » (${width}x${height}${opts.headed ? ', headed' : ''}) — ${script.beats.length} beats`
    : `Vidéo « ${videoName} » (${width}x${height}${opts.headed ? ', headed' : ''}) — format court sans script.md`)

  // Authentification :
  //  - par défaut, session NHI récoltée automatiquement via le proxy du
  //    navigateur MCP (`nhi-proxy`), puis injectée comme cookies ;
  //  - `state` : cookies fournis explicitement ;
  //  - `noState` : aucun cookie (le proxy injecte côté serveur, mais le SPA
  //    restera anonyme faute de document.cookie) ;
  //  - `profile` : profil persistant du navigateur MCP (expérimental).
  let useState = opts.noState ? undefined : opts.state
  const launchOptions = mcpLaunchOptions()
  const chromeArgs = { channel: 'chrome' as const, headless: !opts.headed }
  if (!useState && !opts.profile) {
    useState = resolve(videosDir, '.auth/state.json')
    await ensureProxyAuth(useState, { log })
  }
  if (!opts.profile && !launchOptions.proxy && !useState) {
    console.warn('Aucun proxy NHI configuré : le chargement sera anonyme (voir auth.md).')
  }

  let browser: BrowserContext
  let ownedBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  // `--force-color-profile=srgb` : rendu des couleurs stable d'une machine à
  // l'autre (captures de cartes et de graphiques)
  if (opts.profile) {
    browser = await chromium.launchPersistentContext(findMcpProfile(), {
      ...chromeArgs,
      viewport: { width, height },
      deviceScaleFactor: 1,
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      recordVideo: { dir: rawDir, size: { width, height } },
      ...launchOptions,
      args: ['--force-color-profile=srgb', ...(launchOptions.args ?? [])]
    })
  } else {
    ownedBrowser = await chromium.launch({
      ...chromeArgs,
      proxy: launchOptions.proxy,
      args: ['--force-color-profile=srgb', ...(launchOptions.args ?? [])]
    })
    browser = await ownedBrowser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      recordVideo: { dir: rawDir, size: { width, height } },
      storageState: useState
    })
  }

  await installCursor(browser)
  await installOverlay(browser, {
    intro: script ? undefined : introCard,
    assets: loadOverlayAssets(),
    caption: { right: opts.captionRight }
  })
  const page = browser.pages()[0] ?? await browser.newPage()
  page.setDefaultTimeout(20_000)

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
      await showIntro(page, introCard!)
      cardT0 = (Date.now() - originWall) / 1000
    } else if (index === 1) {
      await hideIntro(page)
    }
    const t0 = (Date.now() - originWall) / 1000
    await actions(page)
    const minEnd = t0 + current.duration + GAP_AFTER_NARRATION
    const wait = minEnd - (Date.now() - originWall) / 1000
    if (wait > 0) await sleep(wait * 1000)
    const t1 = (Date.now() - originWall) / 1000
    timelineBeats.push({ id, t0: Math.round(t0 * 1000) / 1000, t1: Math.round(t1 * 1000) / 1000, audioStart: Math.round(t0 * 1000) / 1000, audioDur: current.duration })
    completed.push(id)
    log(`${id} — ${(t1 - t0).toFixed(1)}s (narration ${current.duration.toFixed(1)}s)`)
  }

  try {
    if (opts.url) await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await scenario.default({ page, beat, idle, log, video: videoName, videosDir })
    await sleep(800)
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    idle.end()
    // prolonge la session depuis la page (pile réseau du navigateur, qui gère le
    // certificat du proxy) puis ré-exporte les cookies rafraîchis
    if (useState && !opts.profile) {
      try {
        await page.evaluate(() => fetch('/simple-directory/api/auth/keepalive', { method: 'POST' }).then(r => r.status))
        await browser.storageState({ path: useState })
        log(`cookies rafraîchis -> ${useState}`)
      } catch {
        log('rafraîchissement des cookies impossible (session expirée ?)')
      }
    }
    await browser.close()
    await ownedBrowser?.close()
  }

  const webmPath = resolve(outDir, `${videoName}.webm`)
  const recorded = await page.video()?.path()
  if (!recorded || !existsSync(recorded)) {
    throw new Error('Aucune vidéo produite.')
  }
  renameSync(recorded, webmPath)
  const timeline: Timeline = {
    video: videoName,
    width,
    height,
    originWall,
    cardT0,
    endWall: (Date.now() - originWall) / 1000,
    beats: timelineBeats,
    idles
  }
  writeFileSync(resolve(outDir, `${videoName}.timeline.json`), JSON.stringify(timeline, null, 2) + '\n')
  log(`WebM : ${webmPath}`)

  if (opts.mux && !process.exitCode) {
    const { mux } = await import('./mux.ts')
    await mux(videoName, videosDir, { offset: opts.offset, burn: opts.burn })
  }
}
