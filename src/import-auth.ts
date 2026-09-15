// Importe des cookies de session récoltés depuis le navigateur MCP.
//
// Le fichier d'entrée est la valeur retournée telle quelle par
// `playwright_browser_run_code_unsafe` (chaîne JSON échappée), ou un storage
// state JSON brut. Écrit `<videos-dir>/.auth/state.json`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function importAuth (input: string, videosDir: string) {
  if (!input || !existsSync(input)) {
    throw new Error('Usage : koumoul-video auth:import <fichier JSON échappé> [--videos-dir <dossier>]')
  }
  const raw = readFileSync(input, 'utf8').trim()
  let state = JSON.parse(raw)
  if (typeof state === 'string') state = JSON.parse(state)
  if (!state?.cookies?.length) throw new Error('Aucun cookie dans le fichier fourni.')

  mkdirSync(resolve(videosDir, '.auth'), { recursive: true })
  const out = resolve(videosDir, '.auth/state.json')
  writeFileSync(out, JSON.stringify(state, null, 2) + '\n')
  const names = state.cookies.map((c: { name: string }) => c.name)
  console.log(`${names.length} cookies importés (${names.join(', ')}) -> ${out}`)
}
