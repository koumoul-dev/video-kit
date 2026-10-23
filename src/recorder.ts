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

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { ensureProxyAuth, mcpLaunchOptions } from './auth.ts'
import { startCapture } from './capture.ts'
import { installCursor, sleep } from './human.ts'
import { hideIntro, installOverlay, loadOverlayAssets, showIntro, type OverlayCard, type OverlayOptions } from './overlay.ts'
import { parseScript, type Script } from './script.ts'
import { prepareNarration, type NarratedBeat } from './tts.ts'
import { IDLE_FACTOR, type Timeline, type TimelineBeat, type TimelineIdle } from './timeline.ts'

const GAP_AFTER_NARRATION = 0.7

// Pages dont le texte s'affiche dans une police de repli : police en erreur
// (`document.fonts`) ou corps de page resté dans la police par défaut du
// navigateur (feuille de thème non chargée). Les iframes vides sont ignorées.
async function fontIssues (page: Page): Promise<string[]> {
  const issues: string[] = []
  for (const frame of page.frames()) {
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
  if (!existsSync(videoDir)) throw new Error(`Dossier vidéo introuvable : ${videoDir}`)
  mkdirSync(outDir, { recursive: true })
  // ancien brut WebM (kit < 0.4) : le montage le prendrait pour celui-ci
  rmSync(resolve(outDir, `${videoName}.webm`), { force: true })

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
  console.log(script
    ? `Vidéo « ${videoName} » (${width}x${height}${opts.headed ? ', headed' : ''}) — ${script.beats.length} beats${isPanelMode ? ', habillage panneaux' : ''}`
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
  // `--no-state` et les pages locales (`file://`, schémas animés) se passent de
  // session : pas de récolte par le proxy NHI
  const needsSession = !opts.noState && !opts.url?.startsWith('file:')
  if (needsSession && !useState && !opts.profile) {
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
      storageState: useState
    })
  }

  await installCursor(browser)
  await installOverlay(browser, {
    intro: script ? undefined : introCard,
    site: introCard?.site,
    assets: loadOverlayAssets(),
    caption: { right: opts.captionRight ?? scenario.caption?.right, style: scenario.caption?.style }
  })
  const page = browser.pages()[0] ?? await browser.newPage()
  page.setDefaultTimeout(20_000)
  const rawPath = resolve(outDir, `${videoName}.raw.mkv`)
  const capture = await startCapture(page, rawPath, { width, height })

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
    videoStartWall = await capture.stop()
    await browser.close()
    await ownedBrowser?.close()
  }

  if (videoStartWall === undefined || !existsSync(rawPath)) {
    throw new Error('Aucune vidéo produite.')
  }
  const timeline: Timeline = {
    video: videoName,
    width,
    height,
    originWall,
    videoStartWall,
    cardT0,
    endWall: (Date.now() - originWall) / 1000,
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
    await mux(videoName, videosDir, { offset: opts.offset, burn: opts.burn })
  }
}
