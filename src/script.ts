// Lecture de `script.md` (source de vérité de la narration) : front matter,
// beats (narration citée + mise en scène) et règles de prononciation.
//
// Le module est volontairement pur (aucun accès Playwright) : il sert à la
// synthèse, au tournage et au montage, et se teste sans navigateur.

import { readFileSync } from 'node:fs'

export interface Beat {
  id: string
  title: string
  text: string
  direction: string
}

export interface Script {
  dir: string
  frontMatter: Record<string, string>
  beats: Beat[]
}

export interface PronunciationRule {
  from: string[]
  to: string[]
}

export interface SpokenText {
  tokens: string[]
  spokenToDisplay: number[]
}

// « Data Fair=Data Fère, CSV=cé ès vé » : réécritures appliquées uniquement à la
// synthèse vocale (l'affichage et le SRT gardent le texte d'origine).
export function parsePronunciations (value: string | undefined): PronunciationRule[] {
  if (!value) return []
  return value.split(',').map(entry => entry.trim()).filter(Boolean).map((entry) => {
    const [from, to] = entry.split('=')
    const fromTokens = from?.trim().split(/\s+/) ?? []
    const toTokens = to?.trim().split(/\s+/) ?? []
    if (!fromTokens.length || !toTokens.length) {
      throw new Error(`Prononciation invalide : « ${entry} » (attendu « source=remplacement »).`)
    }
    return { from: fromTokens, to: toTokens }
  })
}

export function tokenize (text: string): string[] {
  return text.match(/\S+/g) ?? []
}

export function wordCore (token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function prefixOf (token: string): string {
  return token.slice(0, token.length - token.replace(/^[^\p{L}\p{N}]+/u, '').length)
}

function suffixOf (token: string): string {
  return /[^\p{L}\p{N}]+$/u.exec(token)?.[0] ?? ''
}

// Texte parlé + correspondance parlant → affiché (les mots des règles peuvent
// changer de nombre : les mots parlés sont répartis sur les tokens remplacés).
export function speakText (text: string, rules: PronunciationRule[]): SpokenText {
  const tokens = tokenize(text)
  const cores = tokens.map(token => wordCore(token).toLowerCase())
  const spoken: string[] = []
  const spokenToDisplay: number[] = []
  let i = 0
  while (i < tokens.length) {
    const rule = rules.find(candidate => candidate.from.every((word, k) => cores[i + k] === word.toLowerCase()))
    if (rule) {
      rule.to.forEach((word, j) => {
        const displayIndex = i + Math.min(rule.from.length - 1, Math.floor(j * rule.from.length / rule.to.length))
        spoken.push(prefixOf(tokens[displayIndex]) + word + suffixOf(tokens[displayIndex]))
        spokenToDisplay.push(displayIndex)
      })
      i += rule.from.length
    } else {
      spoken.push(tokens[i])
      spokenToDisplay.push(i)
      i++
    }
  }
  return { tokens: spoken, spokenToDisplay }
}

export function spokenText (text: string, rules: PronunciationRule[]): string {
  return speakText(text, rules).tokens.join(' ')
}

export function parseScript (path: string): Script {
  const raw = readFileSync(path, 'utf8')
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)
  const frontMatter: Record<string, string> = {}
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line)
      if (m) frontMatter[m[1]] = m[2].trim()
    }
  }
  const body = fm ? raw.slice(fm[0].length) : raw

  const beats: Beat[] = []
  const chunks = body.split(/^### /m).slice(1)
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/)
    const heading = /^(beat-[a-zA-Z0-9-]+)\s*[—-]\s*(.*)$/.exec(lines[0].trim())
    if (!heading) continue
    const [, id, title] = heading
    const quote: string[] = []
    const rest: string[] = []
    let inQuote = false
    for (const line of lines.slice(1)) {
      if (/^>\s?/.test(line)) {
        inQuote = true
        quote.push(line.replace(/^>\s?/, ''))
      } else if (inQuote && line.trim() === '') {
        // fin de citation : les lignes vides suivantes vont à la mise en scène
        inQuote = false
      } else if (!inQuote) {
        rest.push(line)
      }
    }
    beats.push({ id, title, text: quote.join(' ').trim(), direction: rest.join('\n').trim() })
  }
  if (!beats.length) throw new Error(`Aucun beat trouvé dans ${path}`)
  return { dir: path.replace(/\/script\.md$/, ''), frontMatter, beats }
}
