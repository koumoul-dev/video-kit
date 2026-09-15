// Synthèse vocale des narrations d'une vidéo.
//
// Fournisseurs : `edge` (edge-tts, cloud) et `kokoro` (local, GPU), plus le mode
// `muet` (aucune synthèse : la durée estimée rythme les scènes et les
// sous-titres). Le fournisseur et la voix sont lus dans le front matter de
// `script.md`. Le cache est un fichier JSON par beat (hash texte + voix) :
// relancer ne resynthétise que ce qui change.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolvePython, ASSETS_DIR } from './paths.ts'
import { parsePronunciations, parseScript, spokenText, type Beat, type Script } from './script.ts'

// version du schéma du cache audio : à incrémenter pour resynthétiser (ex. ajout
// des timings mot à mot).
const AUDIO_SCHEMA = 'v2'

export interface WordTiming {
  text: string
  start: number
  end: number
}

export interface NarratedBeat extends Beat {
  audioPath?: string
  duration: number
  words?: WordTiming[]
}

export interface Voice {
  provider: 'edge' | 'kokoro' | 'muet'
  voice: string
}

// Mode « muet » : pas de synthèse, la durée estimée rythme les scènes et les
// sous-titres (vidéos présentées avec des slides).
export const MUET_WORDS_PER_SECOND = 2.6

export function silentDuration (text: string): number {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
  return Math.max(1.8, Math.round((words / MUET_WORDS_PER_SECOND) * 10) / 10)
}

export function ffprobeDuration (file: string): number {
  const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`ffprobe ${file} : ${res.stderr}`)
  return Number.parseFloat(res.stdout.trim())
}

function toMp3 (input: string, output: string) {
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-b:a', '128k', output], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`ffmpeg ${input} : ${res.stderr}`)
}

export function voiceFromScript (script: Script): Voice {
  const provider = (script.frontMatter.fournisseur ?? 'edge') as Voice['provider']
  if (provider === 'muet') return { provider, voice: 'muet' }
  const voice = script.frontMatter.voix ?? (provider === 'kokoro' ? 'ff_siwis' : 'fr-FR-DeniseNeural')
  return { provider, voice }
}

interface Synthesized {
  audio: string
  words?: WordTiming[]
}

function synthesize (text: string, outBase: string, voice: Voice, python: string): Synthesized {
  if (voice.provider === 'edge') {
    const out = `${outBase}.mp3`
    const wordsPath = `${outBase}.words.json`
    const res = spawnSync(python, [
      resolve(ASSETS_DIR, 'synth_edge.py'), text, out, wordsPath, voice.voice
    ], { encoding: 'utf8' })
    if (res.status !== 0) throw new Error(`edge-tts (${voice.voice}) : ${res.stderr || res.stdout}`)
    const words = JSON.parse(readFileSync(wordsPath, 'utf8')) as WordTiming[]
    rmSync(wordsPath, { force: true })
    return { audio: out, words }
  }
  if (voice.provider === 'kokoro') {
    const wav = `${outBase}.wav`
    const res = spawnSync(python, [resolve(ASSETS_DIR, 'synth_kokoro.py'), text, wav, voice.voice], { encoding: 'utf8' })
    if (res.status !== 0) throw new Error(`kokoro (${voice.voice}) : ${res.stderr || res.stdout}`)
    const mp3 = `${outBase}.mp3`
    toMp3(wav, mp3)
    rmSync(wav, { force: true })
    return { audio: mp3 }
  }
  throw new Error(`fournisseur inconnu : ${voice.provider}`)
}

// Synthétise chaque beat et retourne les chemins + durées réelles.
export function prepareNarration (script: Script, opts: { force?: boolean, providerOverride?: Voice } = {}): NarratedBeat[] {
  const voice = opts.providerOverride ?? voiceFromScript(script)
  const rules = parsePronunciations(script.frontMatter.prononciations)
  const python = resolvePython(script.dir)
  const audioDir = resolve(script.dir, 'out/audio')
  const beats: NarratedBeat[] = []
  if (voice.provider !== 'muet') mkdirSync(audioDir, { recursive: true })
  for (const beat of script.beats) {
    if (voice.provider === 'muet') {
      const duration = silentDuration(beat.text)
      console.log(`  ${beat.id} — ${duration.toFixed(2)}s (muet)`)
      beats.push({ ...beat, duration })
      continue
    }
    const spoken = spokenText(beat.text, rules)
    const hash = createHash('sha1').update(`${AUDIO_SCHEMA}|${spoken}|${voice.provider}|${voice.voice}`).digest('hex').slice(0, 16)
    const base = resolve(audioDir, beat.id)
    const metaPath = `${base}.json`
    let audioPath: string | undefined
    let duration: number | undefined
    let words: WordTiming[] | undefined
    if (!opts.force && existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { hash: string, audio: string, duration: number, words?: WordTiming[] }
      const candidate = resolve(audioDir, meta.audio)
      if (meta.hash === hash && existsSync(candidate)) {
        audioPath = candidate
        duration = meta.duration
        words = meta.words
      }
    }
    if (!audioPath || duration === undefined) {
      const produced = synthesize(spoken, base, voice, python)
      renameSync(produced.audio, resolve(audioDir, `${beat.id}.mp3`))
      audioPath = resolve(audioDir, `${beat.id}.mp3`)
      duration = ffprobeDuration(audioPath)
      words = produced.words
      writeFileSync(metaPath, JSON.stringify({ hash, audio: `${beat.id}.mp3`, duration, provider: voice.provider, voice: voice.voice, words }, null, 2) + '\n')
    }
    console.log(`  ${beat.id} — ${duration.toFixed(2)}s${words?.length ? ` (${words.length} mots)` : ''}`)
    beats.push({ ...beat, audioPath, duration, words })
  }
  const total = beats.reduce((acc, b) => acc + b.duration, 0).toFixed(1)
  if (voice.provider === 'muet') console.log(`Mode muet : ${beats.length} beats, ${total}s estimées.`)
  else console.log(`Voix « ${voice.voice} » (${voice.provider}) : ${beats.length} beats, ${total}s de narration.`)
  return beats
}

// Écoute comparative : mêmes phrases lues par plusieurs voix.
export function bakeoff (videoName: string, videosDir: string) {
  const dir = resolve(videosDir, videoName)
  const script = parseScript(resolve(dir, 'script.md'))
  const text = script.beats.slice(0, 2).map(b => b.text).join(' ')
  const voices: Voice[] = (script.frontMatter.voix_bakeoff ?? 'edge:fr-FR-DeniseNeural, edge:fr-FR-HenriNeural, kokoro:ff_siwis')
    .split(',').map(v => v.trim()).filter(Boolean).map((entry) => {
      const [provider, voice] = entry.split(':')
      return { provider: provider as Voice['provider'], voice }
    })
  const outDir = resolve(dir, 'out/voix')
  const python = resolvePython(dir)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'texte.txt'), text + '\n')
  console.log(`Bake-off sur ${text.length} caractères :`)
  for (const voice of voices) {
    const base = resolve(outDir, `${voice.provider}-${voice.voice.replace(/[^a-zA-Z0-9-]/g, '_')}`)
    const produced = synthesize(text, base, voice, python)
    console.log(`  ${voice.provider}/${voice.voice} -> ${produced.audio} (${ffprobeDuration(produced.audio).toFixed(1)}s)`)
  }
  console.log(`\nÉcoutez les extraits dans ${outDir}, puis figez « fournisseur » et « voix » dans script.md.`)
}

// Écoute comparative des graphies d'un terme mal prononcé (« Data Fair »).
const PRONUNCIATION_CANDIDATES = ['Data Fair', 'Data Fère', 'Data Faïr', 'Datafaire']

export function pronunciationBakeoff (videoName: string, videosDir: string) {
  const dir = resolve(videosDir, videoName)
  const script = parseScript(resolve(dir, 'script.md'))
  const voice = voiceFromScript(script)
  const sentence = script.beats[0].text
  const python = resolvePython(dir)
  const outDir = resolve(dir, 'out/voix/prononciation')
  mkdirSync(outDir, { recursive: true })
  console.log(`Prononciation avec ${voice.provider}/${voice.voice} :`)
  PRONUNCIATION_CANDIDATES.forEach((candidate, index) => {
    const text = sentence.replaceAll('Data Fair', candidate)
    const slug = candidate.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
    const base = resolve(outDir, `${index + 1}-${slug}`)
    const produced = synthesize(text, base, voice, python)
    console.log(`  « ${candidate} » -> ${produced.audio} (${ffprobeDuration(produced.audio).toFixed(1)}s)`)
  })
  console.log(`\nÉcoutez les extraits dans ${outDir}, puis figez « prononciations » dans script.md.`)
}
