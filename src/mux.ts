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

// Coupe le préambule de chargement (fond uni avant le premier rendu) par
// variation de luminance dans une zone centrale, hors barres d'outils. Utilisé
// quand aucun carton ne sert de repère (format court piloté par le scénario).
function detectStart (video: string, width: number, height: number): number {
  const cropWidth = Math.round(width * 0.6 / 2) * 2
  const cropHeight = Math.round(height * 0.5 / 2) * 2
  const crop = `${cropWidth}:${cropHeight}:${Math.round((width - cropWidth) / 4) * 2}:${Math.round((height - cropHeight) / 4) * 2}`
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-i', video,
    '-t', '4',
    '-vf', `crop=${crop},signalstats,metadata=print:file=-`,
    '-f', 'null', '-'
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const frames = result.stdout?.matchAll(/pts_time:([\d.]+)[\s\S]*?YMIN=(\d+)[\s\S]*?YMAX=(\d+)/g) ?? []
  for (const frame of frames) {
    if (Number(frame[3]) - Number(frame[2]) > 40) return Math.max(0, Number(frame[1]) - 0.1)
  }
  return 0
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

  let a: number
  let b: number
  let startAt = 0
  if (opts.offset !== undefined) {
    a = 1
    b = opts.offset
  } else if (beats.length) {
    // carton de titre : repère de calage (blanc → bleu) et coupe du préambule
    const detected = detectCardTime(webm)
    if (detected !== undefined) {
      a = timeline.endWall > 5 ? videoDur / timeline.endWall : 1
      b = detected - a * timeline.cardT0
      console.log(`Carton détecté à ${detected.toFixed(2)}s (attendu ${timeline.cardT0.toFixed(2)}s) — échelle ${a.toFixed(4)}, offset ${b.toFixed(2)}s`)
      startAt = detected
    } else {
      a = 1
      b = -timeline.cardT0
      console.warn('Carton non détecté : calage sur le début de la vidéo (vérifiez la synchro).')
    }
  } else {
    // format court sans carton : détection du premier rendu par luminance
    const size = timeline.width && timeline.height
      ? { width: timeline.width, height: timeline.height }
      : videoSize(webm)
    startAt = detectStart(webm, size.width, size.height)
    a = 1
    b = -startAt
    if (startAt > 0) console.log(`Préambule de chargement coupé : ${startAt.toFixed(2)}s (démarrage sur le premier rendu)`)
    else console.warn('Début de vidéo non détecté : conservation du préambule (vérifiez le montage).')
  }
  if (startAt > 0 && beats.length && b !== opts.offset) {
    b -= startAt
    console.log(`Amorce coupée : ${startAt.toFixed(2)}s (démarrage sur le carton de titre)`)
  }

  // En mode muet, aucune piste audio n'est produite : les beats servent aux
  // sous-titres et à la durée de sortie, sans mélange audio.
  const audioBeats = beats.filter(beat => existsSync(resolve(outDir, 'audio', `${beat.id}.mp3`)))
  const idleSegments = audioBeats.length ? [] : mergeIdleSegments(timeline.idles ?? [], a, b, videoDur)
  const timeMapper = idleSegments.length ? buildTimeMapper(idleSegments) : (videoTime: number) => videoTime
  // Découpage temps réel → temps vidéo (attentes compressées, facteur par
  // attente) : chaque morceau est encodé séparément puis assemblé par le concat
  // demuxer. Un graphe trim/concat en une seule passe bufferise toutes les
  // images du WebM en mémoire (SIGKILL au-delà de quelques minutes de 1080p).
  let partList: Array<{ start: number, end: number, factor: number }> | undefined
  if (idleSegments.length) {
    partList = []
    let cursor = startAt
    for (const segment of idleSegments) {
      if (segment.start - cursor > 0.05) partList.push({ start: cursor, end: segment.start, factor: 1 })
      partList.push({ start: segment.start, end: segment.end, factor: segment.factor })
      cursor = segment.end
    }
    if (videoDur - cursor > 0.05) partList.push({ start: cursor, end: videoDur, factor: 1 })
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

  // coupe la fin silencieuse après le dernier beat (dernière scène ou dernière cue)
  const lastBeatEnd = beats.length ? Math.max(...beats.map(beat => a * beat.t1 + b)) : 0
  const outputDur = beats.length
    ? Math.min(timeMapper(videoDur), Math.max(lastCueEnd, timeMapper(lastBeatEnd)) + 1.5)
    : Math.max(0, timeMapper(videoDur) - startAt)
  const srt = resolve(outDir, `${videoName}.srt`)
  if (cueIndex) writeFileSync(srt, srtLines.join('\n'))
  else console.log('Aucun sous-titre à produire (format court : sous-titres incrustés dans la vidéo).')

  const mp4 = resolve(outDir, `${videoName}.mp4`)
  let concatList: string | undefined
  if (partList) {
    // encodage des morceaux (mémoire bornée : chaque ffmpeg ne voit que son
    // extrait), puis liste pour le concat demuxer
    const segDir = resolve(outDir, 'segs')
    rmSync(segDir, { recursive: true, force: true })
    mkdirSync(segDir, { recursive: true })
    const listLines: string[] = []
    for (const [index, part] of partList.entries()) {
      const segPath = resolve(segDir, `seg-${String(index).padStart(3, '0')}.mp4`)
      const segArgs = [
        '-y', '-loglevel', 'error',
        '-ss', part.start.toFixed(3), '-to', part.end.toFixed(3), '-i', webm,
        '-vf', part.factor === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${part.factor}`,
        '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
        segPath
      ]
      const segRes = spawnSync('ffmpeg', segArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (segRes.status !== 0) throw new Error(`ffmpeg (morceau ${index + 1}/${partList.length}) : ${segRes.stderr?.slice(-2000)}`)
      listLines.push(`file '${segPath}'`)
      console.log(`morceau ${index + 1}/${partList.length} (${(part.end - part.start).toFixed(1)}s → ${(part.end - part.start).toFixed(1)}s / ${part.factor})`)
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
  const cueLabel = cueIndex ? `${cueIndex} sous-titres` : 'sans sous-titres'
  console.log(`Assemblage MP4 (${audioLabel}, ${cueLabel}, ${outputDur.toFixed(1)}s sur ${videoDur.toFixed(1)}s)…`)
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.status !== 0) throw new Error(`ffmpeg : ${res.stderr?.slice(-2000)}`)

  if (opts.burn) {
    if (!cueIndex) {
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
