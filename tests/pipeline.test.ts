import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { buildSilentCues, buildTimeMapper, groupTokens, mergeIdleSegments, wrapCue } from '../src/mux.ts'
import { silentDuration } from '../src/tts.ts'
import { parsePronunciations, parseScript, speakText, tokenize } from '../src/script.ts'

test('durée muette estimée d’après le nombre de mots (min 1,8 s)', () => {
  assert.equal(silentDuration(''), 1.8)
  assert.equal(silentDuration('un deux trois'), 1.8)
  assert.equal(silentDuration(Array.from({ length: 26 }, () => 'mot').join(' ')), 10)
})

test('découpage des cues : 2 lignes max (~80 caractères), coupure à la phrase', () => {
  const text = 'Première phrase assez courte. Deuxième phrase un peu plus longue mais qui reste raisonnable. Troisième partie.'
  const groups = groupTokens(tokenize(text))
  assert.ok(groups.length >= 2)
  for (const group of groups) {
    const cue = tokenize(text).slice(group.start, group.end + 1).join(' ')
    assert.ok(cue.length <= 80, `cue trop longue : ${cue.length}`)
  }
  // la coupure doit suivre la ponctuation forte quand elle existe
  const first = tokenize(text).slice(groups[0].start, groups[0].end + 1).join(' ')
  assert.ok(first.endsWith('.'), `coupure inattendue : « ${first} »`)
})

test('ponctuation fermante rattachée au groupe précédent', () => {
  const text = 'Il dit « bonjour à tout le monde » puis continue sa route sans regarder derrière lui ni ralentir.'
  const tokens = tokenize(text)
  const groups = groupTokens(tokens)
  for (let i = 1; i < groups.length; i++) {
    assert.ok(!/^[»)\]}.,;:!?…'"”’]/.test(tokens[groups[i].start]), `ponctuation orpheline en tête de groupe : « ${tokens[groups[i].start]} »`)
  }
})

test('wrapCue : 2 lignes équilibrées, largeur respectée', () => {
  assert.deepEqual(wrapCue('Court texte'), ['Court texte'])
  const lines = wrapCue('Un texte un peu plus long que la largeur maximale autorisée pour une seule ligne')
  assert.equal(lines.length, 2)
  assert.ok(Math.abs(lines[0].length - lines[1].length) <= 12)
  assert.ok(lines.every(line => line.length <= 40))
})

test('compression des attentes : segments fusionnés et facteur par défaut', () => {
  const segments = mergeIdleSegments([
    { t0: 10, t1: 20 },
    { t0: 19, t1: 25, factor: 10 },
    { t0: 50, t1: 52 }
  ], 1, 0, 100)
  assert.equal(segments.length, 2)
  assert.deepEqual(segments[0], { start: 10, end: 25, factor: 10 })
  assert.deepEqual(segments[1], { start: 50, end: 52, factor: 6 })
})

test('application affine par morceaux du temps', () => {
  const identity = buildTimeMapper([])
  assert.equal(identity(42), 42)
  const mapper = buildTimeMapper([{ start: 10, end: 20, factor: 2 }])
  assert.equal(mapper(5), 5)
  assert.equal(mapper(10), 10)
  assert.equal(mapper(15), 12.5)
  assert.equal(mapper(20), 15)
  assert.equal(mapper(30), 25)
})

test('cues muettes : durée de lecture naturelle et chaînage', () => {
  const text = 'Première phrase qui prend déjà pas mal de place dans la ligne. ' +
    'Deuxième phrase, un peu plus longue encore, qui doit forcer une seconde ligne de sous-titre. ' +
    'Troisième phrase pour finir.'
  const cues = buildSilentCues(text, 0, 20, 'beat-01', 0)
  assert.ok(cues.length >= 2)
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].end - cues[i].start >= 1.2 - 1e-9)
    if (i > 0) assert.ok(cues[i].start >= cues[i - 1].end - 1e-9)
  }
  assert.ok(cues[cues.length - 1].end <= 20 + 1e-9)
})

test('lecture de script.md : front matter, beats et prononciations', () => {
  const script = parseScript(resolve(import.meta.dirname, 'fixtures/script.md'))
  assert.equal(script.frontMatter.titre, 'Exemple de vidéo')
  assert.equal(script.frontMatter.fournisseur, 'muet')
  assert.equal(script.beats.length, 2)
  assert.equal(script.beats[0].id, 'beat-00')
  assert.match(script.beats[0].text, /Bienvenue/)
  assert.match(script.beats[0].direction, /Carton plein écran/)

  const rules = parsePronunciations(script.frontMatter.prononciations)
  const spoken = speakText('Data Fair est une plateforme', rules)
  assert.match(spoken.tokens.join(' '), /Data Fère/)
  assert.deepEqual(spoken.spokenToDisplay.slice(0, 2), [0, 1])
})
