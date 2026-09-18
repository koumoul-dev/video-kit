// Assemble la piste de narration et la vidéo.
//
// Le t=0 de la vidéo est recalé sur le carton de titre (détection du changement
// de scène blanc → bleu), puis chaque narration est placée à son horodatage
// (timeline écrite par recorder.ts), mise à l'échelle sur la durée réelle du
// WebM. Produit out/<video>.mp4 (H.264/AAC) et out/<video>.srt ; `--burn` produit
// en plus out/<video>.st.mp4 avec les sous-titres incrustés (bandeau sombre).
//
// Les sous-titres sont découpés en cues de 2 lignes maximum. Mode voix : calés
// mot à mot sur la narration (timings edge-tts). Mode muet : ancrés sur la durée
// réelle de chaque scène à l'écran (après compression des attentes), durée
// naturelle de lecture, trous acceptés quand la scène dépasse le texte.
//
// Sans `script.md` (format court piloté par le scénario, captures incrustées) :
// le préambule est coupé par analyse de luminance et aucune piste de sous-titres
// n'est produite.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { panelDuration, renderPanelPng, type PanelSpec } from './panels.ts'
import { parsePronunciations, parseScript, speakText, wordCore, type PronunciationRule } from './script.ts'
import { ffprobeDuration, type WordTiming } from './tts.ts'
import { IDLE_FACTOR, type Timeline } from './timeline.ts'

const CUE_LINE_WIDTH = 40
const CUE_MAX_CHARS = CUE_LINE_WIDTH * 2
const CUE_MIN_DUR = 0.9
const CUE_LEAD_IN = 0.08
const CUE_LINGER = 0.45
const CUE_GAP = 0.06
// mode muet : débit de lecture naturel (~13 caractères/s) et durée plancher
const SILENT_CPS = 13
const SILENT_CUE_MIN_DUR = 1.2

const WEAK_BREAK_WORDS = new Set([
  'et', 'ou', 'mais', 'puis', 'que', 'qui', 'où', 'avec', 'pour', 'dans', 'sur', 'sous',
  'vers', 'chez', 'par', 'donc', 'or', 'ni', 'car', 'lorsque', 'quand', 'si', 'afin', 'comme'
])

export interface MuxOptions { offset?: number, burn?: boolean }

interface Cue {
  start: number
  end: number
  text: string
}

// Détecte le passage écran blanc → carton : premier changement de scène suivi
// d'une longue période statique (le carton reste affiché pendant la narration).
function detectCardTime (webm: string): number | undefined {
  const res = spawnSync('ffmpeg', [
    '-loglevel', 'error',
    '-i', webm,
    '-vf', "select='gt(scene,0.25)',metadata=print:file=-",
    '-an', '-f', 'null', '-'
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const changes: number[] = []
  for (const match of res.stdout.matchAll(/pts_time:([\d.]+)/g)) changes.push(Number.parseFloat(match[1]))
  if (!changes.length) return undefined
  for (let i = 0; i < changes.length; i++) {
    const next = changes[i + 1]
    if (next === undefined || next - changes[i] > 4) return changes[i]
  }
  return changes[changes.length - 1]
}

function videoSize (video: string): { width: number, height: number } {
  const res = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video], { encoding: 'utf8' })
  const [width, height] = res.stdout.trim().split(',').map(Number)
  return { width: Number.isFinite(width) ? width : 1280, height: Number.isFinite(height) ? height : 720 }
}

// Détecte le premier rendu (première frame avec du contraste dans une zone
// centrale, hors barres d'outils) à partir de `from` : utilisé pour le préambule
// du format court, et pour couper le chargement au début de chaque fragment en
// habillage panneaux. `-ss` en entrée recale les pts sur 0 : on rajoute `from`.
// Exporté pour les tests.
export function detectContentStart (video: string, width: number, height: number, from = 0, duration = 4): number | undefined {
  const cropWidth = Math.round(width * 0.6 / 2) * 2
  const cropHeight = Math.round(height * 0.5 / 2) * 2
  const crop = `${cropWidth}:${cropHeight}:${Math.round((width - cropWidth) / 4) * 2}:${Math.round((height - cropHeight) / 4) * 2}`
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    ...(from > 0 ? ['-ss', from.toFixed(3)] : []),
    '-i', video,
    '-t', duration.toFixed(3),
    '-vf', `crop=${crop},signalstats,metadata=print:file=-`,
    '-f', 'null', '-'
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const frames = result.stdout?.matchAll(/pts_time:([\d.]+)[\s\S]*?YMIN=(\d+)[\s\S]*?YMAX=(\d+)/g) ?? []
  for (const frame of frames) {
    if (Number(frame[3]) - Number(frame[2]) > 40) return Math.max(0, from + Number(frame[1]) - 0.1)
  }
  return undefined
}

// Coupe le préambule de chargement d'un format court sans carton repère.
function detectStart (video: string, width: number, height: number): number {
  return detectContentStart(video, width, height, 0, 4) ?? 0
}

// Fin du chargement d'un fragment (habillage panneaux) : la page précédente
// reste affichée le temps de la navigation, puis un écran blanc couvre le
// chargement jusqu'au premier rendu. On cherche le premier passage blanc →
// contenu des premières secondes du beat (run blanc d'au moins 0,3 s démarré
// dans les 8 s) et on rend l'heure du premier rendu. Sans run blanc (fragment
// sans navigation, page qui se peint directement), aucun trim n'est décidé.
export function detectLoadingEnd (video: string, width: number, height: number, from: number, window: number): number | undefined {
  const cropWidth = Math.round(width * 0.6 / 2) * 2
  const cropHeight = Math.round(height * 0.5 / 2) * 2
  const crop = `${cropWidth}:${cropHeight}:${Math.round((width - cropWidth) / 4) * 2}:${Math.round((height - cropHeight) / 4) * 2}`
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', from.toFixed(3), '-i', video,
    '-t', window.toFixed(3),
    '-vf', `crop=${crop},signalstats,metadata=print:file=-`,
    '-f', 'null', '-'
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const frames: Array<{ time: number, blank: boolean }> = []
  for (const match of result.stdout?.matchAll(/pts_time:([\d.]+)[\s\S]*?YMIN=(\d+)[\s\S]*?YMAX=(\d+)/g) ?? []) {
    frames.push({ time: Number(match[1]), blank: Number(match[3]) - Number(match[2]) <= 40 })
  }
  const detected = findLoadingEnd(frames)
  return detected !== undefined ? from + detected : undefined
}

// Premier rendu après un écran blanc de chargement : run blanc d'au moins 0,3 s
// démarré dans les 8 premières secondes. Exporté pour les tests.
export function findLoadingEnd (frames: Array<{ time: number, blank: boolean }>): number | undefined {
  const MIN_BLANK = 0.3
  const MAX_LOAD_OFFSET = 8
  let runStart: number | undefined
  for (const frame of frames) {
    if (frame.blank) {
      runStart ??= frame.time
      continue
    }
    if (runStart !== undefined) {
      if (frame.time - runStart >= MIN_BLANK && runStart <= MAX_LOAD_OFFSET) return frame.time
      runStart = undefined
    }
  }
  return undefined
}

// Cadence de la vidéo source : les segments de panneaux sont encodés à la même
// cadence pour que le concat demuxer les recolle sans rééchantillonnage.
function videoFps (video: string): number {
  const res = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', video], { encoding: 'utf8' })
  const [num, den] = res.stdout.trim().split('/').map(Number)
  const fps = den ? num / den : num
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : 25
}

function srtTime (seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rest = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`
}

function hasWord (tokens: string[], start: number, end: number): boolean {
  for (let i = start; i <= end; i++) if (wordCore(tokens[i])) return true
  return false
}

// Priorité de coupure après un token : 3 = fin de phrase, 2 = ponctuation
// faible, 1 = avant un mot de liaison, 0 = pas de coupure naturelle.
function breakScore (tokens: string[], index: number): number {
  const token = tokens[index]
  if (/[.!?…][»"']*$/.test(token)) return 3
  if (/[,;:—–][»"']*$/.test(token)) return 2
  const next = tokens[index + 1]
  if (next && WEAK_BREAK_WORDS.has(wordCore(next).toLowerCase())) return 1
  return 0
}

// Découpe les tokens en groupes d'au plus 2 lignes (~80 caractères), en coupant
// de préférence à une fin de phrase. Exporté pour les tests.
export function groupTokens (tokens: string[]): Array<{ start: number, end: number }> {
  const groups: Array<{ start: number, end: number }> = []
  let cursor = 0
  while (cursor < tokens.length) {
    let end = cursor
    let chars = 0
    let strong = -1
    let medium = -1
    let weak = -1
    while (end < tokens.length) {
      const add = (end === cursor ? 0 : 1) + tokens[end].length
      if (end > cursor && chars + add > CUE_MAX_CHARS) break
      chars += add
      const score = breakScore(tokens, end)
      if (score === 3) strong = end
      else if (score === 2) medium = end
      else if (score === 1) weak = end
      end++
    }
    if (end >= tokens.length) {
      groups.push({ start: cursor, end: tokens.length - 1 })
      break
    }
    let cut = strong >= cursor ? strong : medium >= cursor ? medium : weak >= cursor ? weak : end - 1
    if (cut - cursor < 2 && end - cursor > 4) cut = end - 1
    if (!hasWord(tokens, cursor, cut)) cut = firstWord(tokens, cursor, end)
    // garde la ponctuation fermante (« ». », « : »…) avec le groupe précédent
    while (cut + 1 < tokens.length && /^[»)\]}.,;:!?…'"”’]/.test(tokens[cut + 1])) cut++
    groups.push({ start: cursor, end: cut })
    cursor = cut + 1
  }
  return groups
}

function firstWord (tokens: string[], start: number, end: number): number {
  for (let i = start; i <= end && i < tokens.length; i++) if (wordCore(tokens[i])) return i
  return end
}

function firstInRange (indexes: Array<number | undefined>, start: number, end: number): number | undefined {
  for (let i = start; i <= end; i++) if (indexes[i] !== undefined) return indexes[i]
  return undefined
}

function lastInRange (indexes: Array<number | undefined>, start: number, end: number): number | undefined {
  for (let i = end; i >= start; i--) if (indexes[i] !== undefined) return indexes[i]
  return undefined
}

// Index du mot parlé pour chaque token affiché (undefined pour la ponctuation
// seule), ou undefined si les timings ne couvrent pas exactement le texte.
function wordIndexes (tokens: string[], words: WordTiming[] | undefined, rules: PronunciationRule[]): Array<number | undefined> | undefined {
  if (!words?.length) return undefined
  const spoken = speakText(tokens.join(' '), rules)
  const bearing: number[] = []
  spoken.tokens.forEach((token, index) => {
    if (wordCore(token)) bearing.push(index)
  })
  if (bearing.length !== words.length) return undefined
  const byDisplay: Array<number | undefined> = new Array(tokens.length).fill(undefined)
  bearing.forEach((spokenIndex, wordIndex) => {
    const displayIndex = spoken.spokenToDisplay[spokenIndex]
    if (displayIndex !== undefined && byDisplay[displayIndex] === undefined) byDisplay[displayIndex] = wordIndex
  })
  return byDisplay
}

function buildCues (
  text: string,
  words: WordTiming[] | undefined,
  rules: PronunciationRule[],
  toVideoTime: (wall: number) => number,
  beatStartWall: number,
  beatDurAudio: number
): Cue[] {
  const tokens = text.match(/\S+/g) ?? []
  if (!tokens.length) return []
  const groups = groupTokens(tokens)
  const beatEndVid = toVideoTime(beatStartWall + beatDurAudio) + 0.6
  const cues: Cue[] = []
  const indexes = wordIndexes(tokens, words, rules)
  if (indexes && words) {
    for (const group of groups) {
      const first = firstInRange(indexes, group.start, group.end)
      const last = lastInRange(indexes, group.start, group.end)
      if (first === undefined || last === undefined) continue
      cues.push({
        start: toVideoTime(beatStartWall + words[first].start) - CUE_LEAD_IN,
        end: toVideoTime(beatStartWall + words[last].end) + CUE_LINGER,
        text: tokens.slice(group.start, group.end + 1).join(' ')
      })
    }
  } else {
    const beatDurVid = toVideoTime(beatStartWall + beatDurAudio) - toVideoTime(beatStartWall)
    const totalChars = groups.reduce((acc, group) => acc + tokens.slice(group.start, group.end + 1).join(' ').length, 0)
    let cursor = 0
    for (const group of groups) {
      const cueText = tokens.slice(group.start, group.end + 1).join(' ')
      const share = cueText.length / totalChars
      cues.push({
        start: toVideoTime(beatStartWall) + cursor,
        end: toVideoTime(beatStartWall) + cursor + Math.max(0.4, beatDurVid * share - CUE_GAP),
        text: cueText
      })
      cursor += beatDurVid * share
    }
  }
  return cleanupCues(cues, beatEndVid)
}

// Mode muet : les cues suivent la durée réelle de la scène à l'écran (t0 → t1
// projetés dans la vidéo, attentes compressées déduites), réparties au prorata
// du texte et affichées à un débit de lecture naturel. Scène plus longue que le
// texte : des trous apparaissent ; scène plus courte : les dernières cues
// débordent sur la suivante (avertissement en log). `notBefore` chaîne avec la
// cue précédente (débordement de la scène précédente compris).
export function buildSilentCues (text: string, videoStart: number, videoEnd: number, beatId: string, notBefore: number): Cue[] {
  const tokens = text.match(/\S+/g) ?? []
  if (!tokens.length) return []
  const groups = groupTokens(tokens)
  const span = Math.max(0, videoEnd - videoStart)
  const durations = groups.map(group => {
    const chars = tokens.slice(group.start, group.end + 1).join(' ').length
    return Math.max(SILENT_CUE_MIN_DUR, chars / SILENT_CPS)
  })
  const totalDur = durations.reduce((acc, duration) => acc + duration, 0)
  if (totalDur > span) console.warn(`  ${beatId} : narration ${totalDur.toFixed(1)}s > scène ${span.toFixed(1)}s (débordement sur la scène suivante)`)
  const totalChars = groups.reduce((acc, group) => acc + tokens.slice(group.start, group.end + 1).join(' ').length, 0)
  const cues: Cue[] = []
  let prevEnd = notBefore - CUE_GAP
  let chars = 0
  for (const [index, group] of groups.entries()) {
    const cueText = tokens.slice(group.start, group.end + 1).join(' ')
    const anchor = videoStart + (chars / totalChars) * span
    const start = Math.max(anchor, prevEnd + CUE_GAP, 0)
    const end = start + durations[index]
    cues.push({ start, end, text: cueText })
    prevEnd = end
    chars += cueText.length
  }
  return cues
}

function cleanupCues (cues: Cue[], beatEndVid: number): Cue[] {
  const out = cues.map(cue => ({ ...cue, start: Math.max(0, cue.start), end: Math.min(cue.end, beatEndVid) }))
    .filter(cue => cue.end > cue.start)
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].end + CUE_GAP) out[i].start = out[i - 1].end + CUE_GAP
  }
  for (let i = 0; i < out.length; i++) {
    const maxEnd = out[i + 1] ? out[i + 1].start - CUE_GAP : Number.POSITIVE_INFINITY
    if (out[i].end - out[i].start < CUE_MIN_DUR) {
      out[i].end = Math.min(Math.max(out[i].start + CUE_MIN_DUR, out[i].end), maxEnd)
    }
    if (out[i].end > maxEnd) out[i].end = Math.max(out[i].start + 0.3, maxEnd)
  }
  return out
}

// Découpe un texte de cue en 2 lignes équilibrées (~40 caractères). Exporté
// pour les tests.
export function wrapCue (text: string, width = CUE_LINE_WIDTH): string[] {
  if (text.length <= width) return [text]
  const words = text.split(' ')
  let split = -1
  // deux passes : d'abord les coupures qui ne font pas commencer une ligne par
  // de la ponctuation seule (« : », « ». »…), puis les autres.
  for (const strict of [true, false]) {
    let best = Number.POSITIVE_INFINITY
    for (let i = 1; i < words.length; i++) {
      if (strict && !wordCore(words[i])) continue
      const left = words.slice(0, i).join(' ')
      if (left.length > width) break
      const right = words.slice(i).join(' ')
      if (right.length > width) continue
      const balance = Math.abs(left.length - right.length)
      if (balance < best) {
        best = balance
        split = i
      }
    }
    if (split !== -1) break
  }
  if (split === -1) {
    let left = ''
    for (let i = 0; i < words.length; i++) {
      const candidate = left ? `${left} ${words[i]}` : words[i]
      if (candidate.length > width && wordCore(words[i])) {
        split = i
        break
      }
      left = candidate
    }
    if (split <= 0) return [text]
  }
  return [words.slice(0, split).join(' '), words.slice(split).join(' ')]
}

// Attentes marquées par le scénario (recorder, `idle.begin(factor?)`) : le
// passage temps mur → temps vidéo devient une application affine par morceaux
// (facteur 1 hors attente, 1/facteur pendant), appliquée à la vidéo
// (trim/setpts) comme aux sous-titres.

export interface TimeSegment {
  start: number
  end: number
  factor: number
}

export function mergeIdleSegments (spans: Array<{ t0: number, t1: number, factor?: number }>, a: number, b: number, videoDur: number): TimeSegment[] {
  const mapped = spans
    .map(span => ({ start: Math.max(0, a * span.t0 + b), end: Math.min(videoDur, a * span.t1 + b), factor: span.factor ?? IDLE_FACTOR }))
    .filter(span => span.end - span.start > 1)
    .sort((x, y) => x.start - y.start)
  const merged: TimeSegment[] = []
  for (const span of mapped) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
      last.factor = Math.max(last.factor, span.factor)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

export function buildTimeMapper (segments: TimeSegment[]) {
  return (videoTime: number) => {
    let out = 0
    let cursor = 0
    for (const segment of segments) {
      if (videoTime <= segment.start) break
      out += Math.max(0, Math.min(videoTime, segment.start) - cursor)
      out += Math.max(0, Math.min(videoTime, segment.end) - segment.start) / segment.factor
      cursor = segment.end
      if (videoTime <= segment.end) return out
    }
    return out + Math.max(0, videoTime - cursor)
  }
}

// Habillage panneaux : chaque beat (déjà trimé des chargements) est un fragment,
// précédé de son panneau s'il en déclare un. Les trous entre les beats (temps de
// chargement coupés au début du fragment suivant) ne sont pas repris. Les
// attentes `idle` (réponses du LLM) restent compressées à l'intérieur des
// fragments. Exporté pour les tests.
export interface PanelPartBeat {
  start: number
  end: number
  panel?: { spec: PanelSpec, duration: number }
}

export type MuxPart =
  | { kind: 'video', start: number, end: number, factor: number }
  | { kind: 'panel', panel: { spec: PanelSpec, duration: number } }

export function buildPanelParts (beats: PanelPartBeat[], idles: TimeSegment[]): MuxPart[] {
  const parts: MuxPart[] = []
  for (const beat of beats) {
    if (beat.panel) parts.push({ kind: 'panel', panel: beat.panel })
    const overlapping = idles
      .filter(idle => idle.end > beat.start && idle.start < beat.end)
      .sort((x, y) => x.start - y.start)
    let cursor = beat.start
    for (const idle of overlapping) {
      const start = Math.max(idle.start, beat.start)
      const end = Math.min(idle.end, beat.end)
      if (start - cursor > 0.05) parts.push({ kind: 'video', start: cursor, end: start, factor: 1 })
      if (end - start > 0.05) parts.push({ kind: 'video', start, end, factor: idle.factor })
      cursor = end
    }
    if (beat.end - cursor > 0.05) parts.push({ kind: 'video', start: cursor, end: beat.end, factor: 1 })
  }
  return parts
}

export async function mux (videoName: string, videosDir: string, opts: MuxOptions = {}) {
  const videoDir = resolve(videosDir, videoName)
  const outDir = resolve(videoDir, 'out')
  const webm = resolve(outDir, `${videoName}.webm`)
  if (!existsSync(webm)) throw new Error(`WebM introuvable : ${webm} (lancez d'abord la commande record).`)
  const timeline = JSON.parse(readFileSync(resolve(outDir, `${videoName}.timeline.json`), 'utf8')) as Timeline
  const scriptPath = resolve(videoDir, 'script.md')
  const script = existsSync(scriptPath) ? parseScript(scriptPath) : undefined
  const textById = new Map((script?.beats ?? []).map(beat => [beat.id, beat.text]))
  const rules = parsePronunciations(script?.frontMatter.prononciations)
  const wordsById = new Map<string, WordTiming[]>()
  for (const beat of script?.beats ?? []) {
    const metaPath = resolve(outDir, 'audio', `${beat.id}.json`)
    if (!existsSync(metaPath)) continue
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { words?: WordTiming[] }
    if (meta.words?.length) wordsById.set(beat.id, meta.words)
  }

  const videoDur = ffprobeDuration(webm)
  const beats = timeline.beats.filter(beat => textById.has(beat.id))
  const isMute = !beats.some(beat => existsSync(resolve(outDir, 'audio', `${beat.id}.mp3`)))
  const size = timeline.width && timeline.height
    ? { width: timeline.width, height: timeline.height }
    : videoSize(webm)

  let a: number
  // temps mur → temps de sortie pré-compression (source décalée de l'amorce)
  let b: number
  // temps mur → temps source (WebM brut), pour les découpes ffmpeg
  let bSource: number
  let startAt = 0
  if (opts.offset !== undefined) {
    a = 1
    b = opts.offset
    bSource = opts.offset
  } else if (beats.length) {
    // carton de titre : repère de calage (blanc → bleu) et coupe du préambule
    const detected = detectCardTime(webm)
    if (detected !== undefined) {
      a = timeline.endWall > 5 ? videoDur / timeline.endWall : 1
      bSource = detected - a * timeline.cardT0
      b = bSource
      console.log(`Carton détecté à ${detected.toFixed(2)}s (attendu ${timeline.cardT0.toFixed(2)}s) — échelle ${a.toFixed(4)}, offset ${b.toFixed(2)}s`)
      startAt = detected
    } else {
      a = 1
      b = -timeline.cardT0
      bSource = b
      console.warn('Carton non détecté : calage sur le début de la vidéo (vérifiez la synchro).')
    }
  } else {
    // format court sans carton : détection du premier rendu par luminance
    startAt = detectStart(webm, size.width, size.height)
    a = 1
    b = -startAt
    bSource = 0
    if (startAt > 0) console.log(`Préambule de chargement coupé : ${startAt.toFixed(2)}s (démarrage sur le premier rendu)`)
    else console.warn('Début de vidéo non détecté : conservation du préambule (vérifiez le montage).')
  }
  if (startAt > 0 && beats.length) {
    // les temps de sortie repartent de zéro (démarrage sur le carton), les
    // découpes des morceaux restent exprimées en temps source
    b -= startAt
    console.log(`Amorce coupée : ${startAt.toFixed(2)}s (démarrage sur le carton de titre)`)
  }

  // En mode muet, aucune piste audio n'est produite : les beats servent aux
  // sous-titres et à la durée de sortie, sans mélange audio.
  const audioBeats = beats.filter(beat => existsSync(resolve(outDir, 'audio', `${beat.id}.mp3`)))
  // attentes compressées : en temps de sortie pour le timeMapper (sous-titres),
  // en temps source pour les découpes ffmpeg
  const idleSegments = audioBeats.length ? [] : mergeIdleSegments(timeline.idles ?? [], a, b, Math.max(0, videoDur - startAt))
  const idleSegmentsSource = audioBeats.length ? [] : mergeIdleSegments(timeline.idles ?? [], a, bSource, videoDur)
  const timeMapper = idleSegments.length ? buildTimeMapper(idleSegments) : (videoTime: number) => videoTime

  // Habillage panneaux : la citation d'un beat devient un panneau inséré avant
  // son fragment ; les beats sans citation sont des fragments du panneau
  // précédent. Le chargement au début de chaque fragment est coupé par
  // luminance (le panneau remplace l'écran blanc). Réservé au muet : une piste
  // audio devrait être décalée du temps des panneaux.
  const frontMatter = script?.frontMatter ?? {}
  const isPanelMode = frontMatter.habillage === 'panneaux'
  if (isPanelMode && audioBeats.length) {
    throw new Error('Habillage panneaux : incompatible avec une narration audio (utiliser fournisseur: muet).')
  }
  const fps = isPanelMode ? videoFps(webm) : 25
  const beatTitles = new Map((script?.beats ?? []).map(beat => [beat.id, beat.title]))
  const panelBeats = isPanelMode
    ? beats.slice(1, -1).filter(beat => (textById.get(beat.id) ?? '').trim())
    : []
  const panels = panelBeats.map((beat, index) => {
    const text = (textById.get(beat.id) ?? '').trim()
    return {
      beatId: beat.id,
      duration: panelDuration(text),
      spec: {
        title: beatTitles.get(beat.id) ?? beat.id,
        text,
        badge: `${String(index + 1).padStart(2, '0')} / ${String(panelBeats.length).padStart(2, '0')}`,
        site: frontMatter.carton_site
      } satisfies PanelSpec
    }
  })
  const trims = new Map<string, number>()
  if (isPanelMode) {
    let cut = 0
    for (const beat of beats.slice(1)) {
      // découpes exprimées en temps source (WebM brut)
      const from = a * beat.t0 + bSource
      const to = a * beat.t1 + bSource
      // marque explicite du scénario (`mark()`) : coupe précise du chargement
      // quand l'ancienne page reste affichée sans écran blanc à détecter
      if (beat.contentT0 !== undefined) {
        const marked = Math.max(a * beat.contentT0 + bSource, from)
        if (marked - from > 0.15 && marked < to) {
          trims.set(beat.id, marked)
          cut += 1
          console.log(`  chargement coupé sur ${beat.id} : ${(marked - from).toFixed(2)}s (marque du scénario)`)
        }
        continue
      }
      const window = Math.min(20, to - from)
      if (window <= 1) continue
      const detected = detectLoadingEnd(webm, size.width, size.height, from, window)
      if (detected !== undefined && detected - from > 0.15 && detected < to) {
        trims.set(beat.id, detected)
        cut += 1
        console.log(`  chargement coupé sur ${beat.id} : ${(detected - from).toFixed(2)}s`)
      }
    }
    const panelDur = panels.reduce((acc, panel) => acc + panel.duration, 0)
    console.log(`Panneaux : ${panels.length} panneaux (${panelDur.toFixed(1)}s), chargements coupés sur ${cut} fragment(s)`)
  }

  // Découpage temps réel → temps vidéo (attentes compressées, facteur par
  // attente) : chaque morceau est encodé séparément puis assemblé par le concat
  // demuxer. Un graphe trim/concat en une seule passe bufferise toutes les
  // images du WebM en mémoire (SIGKILL au-delà de quelques minutes de 1080p).
  // En habillage panneaux, les morceaux sont les fragments (précédés de leur
  // panneau) : les temps de chargement entre fragments ne sont pas repris.
  let partList: MuxPart[] | undefined
  if (isPanelMode) {
    partList = buildPanelParts(beats.map((beat) => {
      const panel = panels.find(candidate => candidate.beatId === beat.id)
      return {
        start: trims.get(beat.id) ?? a * beat.t0 + bSource,
        end: a * beat.t1 + bSource,
        panel: panel ? { spec: panel.spec, duration: panel.duration } : undefined
      }
    }), idleSegmentsSource)
    console.log(`Montage panneaux : ${partList.length} segments`)
  } else if (idleSegmentsSource.length) {
    partList = []
    let cursor = startAt
    for (const segment of idleSegmentsSource) {
      if (segment.start - cursor > 0.05) partList.push({ kind: 'video', start: cursor, end: segment.start, factor: 1 })
      partList.push({ kind: 'video', start: segment.start, end: segment.end, factor: segment.factor })
      cursor = segment.end
    }
    if (videoDur - cursor > 0.05) partList.push({ kind: 'video', start: cursor, end: videoDur, factor: 1 })
    console.log(`Attentes compressées : ${idleSegments.map(segment => `${(segment.end - segment.start).toFixed(1)}s/×${segment.factor}`).join(', ')}`)
  }
  const inputs: string[] = []
  const filters: string[] = []
  audioBeats.forEach((beat, index) => {
    const audio = resolve(outDir, 'audio', `${beat.id}.mp3`)
    const videoT = Math.max(0, a * beat.audioStart + b)
    inputs.push('-i', audio)
    filters.push(`[${index + 1}:a]adelay=${Math.round(videoT * 1000)}:all=1,aresample=48000[a${index}]`)
  })
  const mixInputs = audioBeats.map((_, index) => `[a${index}]`).join('')
  const filterComplex = `${filters.join(';')};${mixInputs}amix=inputs=${audioBeats.length}:normalize=0:dropout_transition=0[mix];[mix]apad[aout]`

  const srtLines: string[] = []
  let cueIndex = 0
  let lastCueEnd = 0
  if (!isPanelMode) {
    for (const beat of beats) {
      const cues = isMute
        ? buildSilentCues(textById.get(beat.id) ?? '', timeMapper(a * beat.t0 + b), timeMapper(a * beat.t1 + b), beat.id, lastCueEnd)
        : buildCues(
          textById.get(beat.id) ?? '',
          wordsById.get(beat.id),
          rules,
          wall => timeMapper(a * wall + b),
          beat.audioStart,
          beat.audioDur
        )
      for (const cue of cues) {
        lastCueEnd = Math.max(lastCueEnd, cue.end)
        const lines = wrapCue(cue.text)
        if (lines.length > 2) throw new Error(`Cue de ${lines.length} lignes (${beat.id}) : ${cue.text}`)
        cueIndex++
        srtLines.push(`${cueIndex}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${lines.join('\n')}\n`)
      }
    }
  }

  // coupe la fin silencieuse après le dernier beat (dernière scène ou dernière
  // cue) ; en habillage panneaux, la durée est la somme des segments montés
  const lastBeatEnd = beats.length ? Math.max(...beats.map(beat => a * beat.t1 + b)) : 0
  let outputDur: number
  if (isPanelMode && partList) {
    outputDur = partList.reduce((acc, part) => acc + (part.kind === 'panel' ? part.panel.duration : (part.end - part.start) / part.factor), 0) + 1
  } else if (beats.length) {
    outputDur = Math.min(timeMapper(Math.max(0, videoDur - startAt)), Math.max(lastCueEnd, timeMapper(lastBeatEnd)) + 1.5)
  } else {
    outputDur = Math.max(0, timeMapper(videoDur) - startAt)
  }
  const srt = resolve(outDir, `${videoName}.srt`)
  if (cueIndex) writeFileSync(srt, srtLines.join('\n'))
  else if (isPanelMode) {
    // un tournage précédent a pu laisser un SRT et une variante sous-titrée :
    // les retirer pour ne pas diffuser par erreur la version d'avant
    for (const stale of [srt, resolve(outDir, `${videoName}.st.mp4`)]) {
      if (existsSync(stale)) {
        rmSync(stale, { force: true })
        console.log(`Artefact sous-titré supprimé : ${stale}`)
      }
    }
    console.log('Habillage panneaux : pas de sous-titres (le texte est porté par les panneaux).')
  } else console.log('Aucun sous-titre à produire (format court : sous-titres incrustés dans la vidéo).')

  const mp4 = resolve(outDir, `${videoName}.mp4`)
  let concatList: string | undefined
  if (partList) {
    // encodage des morceaux (mémoire bornée : chaque ffmpeg ne voit que son
    // extrait), puis liste pour le concat demuxer
    const segDir = resolve(outDir, 'segs')
    rmSync(segDir, { recursive: true, force: true })
    mkdirSync(segDir, { recursive: true })
    const panelDir = resolve(outDir, 'panels')
    if (isPanelMode) {
      rmSync(panelDir, { recursive: true, force: true })
      mkdirSync(panelDir, { recursive: true })
    }
    const listLines: string[] = []
    let panelIndex = 0
    for (const [index, part] of partList.entries()) {
      const segPath = resolve(segDir, `seg-${String(index).padStart(3, '0')}.mp4`)
      let segArgs: string[]
      let label: string
      if (part.kind === 'panel') {
        // panneau : PNG rendu à la charte, tenu pendant le temps de lecture
        const png = resolve(panelDir, `panel-${String(panelIndex++).padStart(2, '0')}.png`)
        await renderPanelPng(part.panel.spec, size, png)
        segArgs = [
          '-y', '-loglevel', 'error',
          '-loop', '1', '-framerate', String(fps), '-i', png,
          '-t', part.panel.duration.toFixed(3),
          '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-r', String(fps),
          segPath
        ]
        label = `panneau ${panelIndex}/${panels.length} « ${part.panel.spec.title} » (${part.panel.duration.toFixed(1)}s)`
      } else {
        segArgs = [
          '-y', '-loglevel', 'error',
          '-ss', part.start.toFixed(3), '-to', part.end.toFixed(3), '-i', webm,
          '-vf', part.factor === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${part.factor}`,
          '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
          segPath
        ]
        label = `morceau ${index + 1}/${partList.length} (${(part.end - part.start).toFixed(1)}s${part.factor === 1 ? '' : ` / ×${part.factor}`})`
      }
      const segRes = spawnSync('ffmpeg', segArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (segRes.status !== 0) throw new Error(`ffmpeg (${label}) : ${segRes.stderr?.slice(-2000)}`)
      listLines.push(`file '${segPath}'`)
      console.log(label)
    }
    concatList = resolve(outDir, `${videoName}.concat.txt`)
    writeFileSync(concatList, listLines.join('\n') + '\n')
  }

  const args = concatList
    ? ['-y', '-loglevel', 'warning', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy']
    : [
        '-y', '-loglevel', 'warning',
        ...(startAt > 0 ? ['-ss', startAt.toFixed(3)] : []),
        '-i', webm, ...inputs
      ]
  if (audioBeats.length) {
    args.push(
      '-filter_complex', filterComplex,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k'
    )
  } else if (!concatList) {
    args.push(
      '-map', '0:v', '-an',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p'
    )
  }
  args.push('-movflags', '+faststart', '-t', outputDur.toFixed(3), mp4)
  const audioLabel = audioBeats.length ? `${audioBeats.length} narrations` : 'muet'
  const cueLabel = isPanelMode ? `${panels.length} panneaux` : cueIndex ? `${cueIndex} sous-titres` : 'sans sous-titres'
  console.log(`Assemblage MP4 (${audioLabel}, ${cueLabel}, ${outputDur.toFixed(1)}s sur ${videoDur.toFixed(1)}s)…`)
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.status !== 0) throw new Error(`ffmpeg : ${res.stderr?.slice(-2000)}`)

  if (opts.burn) {
    if (isPanelMode) {
      console.warn('Incrustation ignorée : habillage panneaux (pas de sous-titres).')
    } else if (!cueIndex) {
      console.warn('Incrustation ignorée : aucun sous-titre (format court, déjà incrustés).')
    } else {
      const stMp4 = resolve(outDir, `${videoName}.st.mp4`)
      const style = 'FontName=DejaVu Sans,FontSize=12,PrimaryColour=&H00FFFFFF,BackColour=&H40000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=2,MarginV=30'
      console.log('Incrustation des sous-titres (bandeau sombre)…')
      const burn = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'warning',
        '-i', mp4,
        '-vf', `subtitles=${videoName}.srt:force_style='${style}'`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        stMp4
      ], { cwd: outDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (burn.status !== 0) throw new Error(`ffmpeg (incrustation) : ${burn.stderr?.slice(-2000)}`)
      console.log(`Version sous-titrée : ${stMp4}`)
    }
  }

  console.log(`Vidéo prête : ${mp4}`)
  if (cueIndex) console.log(`Sous-titres : ${srt}`)
  return { mp4, srt: cueIndex ? srt : undefined }
}
