// Résolution des chemins du kit : répertoire des vidéos du projet consommateur,
// assets embarqués (charte, scripts Python) et interpréteur Python.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// `dist/paths.js` → racine du paquet installé
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const ASSETS_DIR = resolve(PACKAGE_ROOT, 'assets')
export const CHARTE_DIR = resolve(ASSETS_DIR, 'charte')

// Répertoire des vidéos du dépôt consommateur (`videos/` par défaut,
// `produits/videos` chez pilotage) : `--videos-dir` ou VIDEO_KIT_VIDEOS_DIR.
export function resolveVideosDir (arg?: string): string {
  return resolve(process.cwd(), arg ?? process.env.VIDEO_KIT_VIDEOS_DIR ?? 'videos')
}

// Interpréteur Python de la synthèse vocale (edge-tts, kokoro) : venv du projet
// d'abord (le répertoire de base est le dossier de la vidéo ou celui des
// vidéos), sinon `python3` du système.
export function resolvePython (baseDir: string): string {
  const candidates = [
    process.env.VIDEO_KIT_PYTHON,
    resolve(process.cwd(), '.venv/bin/python'),
    resolve(baseDir, '.venv/bin/python'),
    resolve(baseDir, '../.venv/bin/python'),
    resolve(baseDir, '../../.venv/bin/python')
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find(candidate => existsSync(candidate)) ?? 'python3'
}
