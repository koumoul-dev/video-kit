// CLI `koumoul-video` : tournage, montage, synthèse et nettoyage des vidéos de
// démonstration. Chaque commande accepte `--videos-dir <dossier>` (défaut :
// `videos`, ou VIDEO_KIT_VIDEOS_DIR).

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveVideosDir } from './paths.ts'
import { parseScript } from './script.ts'

const PRESET_SIZES: Record<string, string> = {
  voix: '1920x1080',
  muet: '1920x1080',
  social: '1280x720'
}

const rawArgs = process.argv.slice(2)
const command = rawArgs[0]

function arg (name: string): string | undefined {
  const index = rawArgs.indexOf(`--${name}`)
  if (index === -1) return undefined
  return rawArgs[index + 1]
}

function flag (name: string): boolean {
  return rawArgs.includes(`--${name}`)
}

const VIDEOS_DIR = resolveVideosDir(arg('videos-dir'))

function usage () {
  console.log(`Usage : koumoul-video <commande> [options]

Commandes :
  record --video <slug>     tourne la vidéo (scénario, cartons, curseur, narration)
  mux --video <slug>        assemble le MP4 et le SRT depuis le WebM
  clean --video <slug>      supprime le jeu de données / l'application de démo
  tts --video <slug>        synthétise la narration, ou compare des voix
  auth:import <fichier>     importe des cookies de session dans <videos-dir>/.auth

Options record :
  --preset <voix|muet|social>  format (taille par défaut : 1920x1080, 1280x720)
  --video <slug>               dossier <videos-dir>/<slug> (script.md, scenario.ts)
  --size <LxH>                 taille de la fenêtre (surcharge le preset)
  --headed                     navigateur visible (mise au point)
  --url <url>                  page ouverte avant le scénario
  --mux                        enchaîne le montage MP4/SRT
  --burn                       avec --mux : variante sous-titrée .st.mp4
  --no-tts                     réutilise la narration déjà synthétisée
  --state <fichier>            cookies de session explicites
  --no-state                   aucun cookie (chargement anonyme)
  --profile                    profil persistant du navigateur MCP
  --caption-right <px>         décale les sous-titres incrustés (panneau à droite)

Options mux :
  --offset <secondes>          force l'offset au lieu de détecter le carton
  --burn                       produit aussi la variante sous-titrée

Options tts :
  --force                      resynthétise tout
  --bakeoff                    extraits comparatifs de voix (out/voix)
  --bakeoff-prononciation      extraits comparatifs de graphies

Options communes :
  --videos-dir <dossier>       dossier des vidéos (défaut : videos)`)
}

function requireVideo (): string {
  const video = arg('video')
  if (!video) {
    usage()
    throw new Error('Option --video obligatoire.')
  }
  return video
}

async function main () {
  if (!command || flag('help') || command === 'help') {
    usage()
    return
  }

  if (command === 'record') {
    const video = requireVideo()
    const preset = arg('preset') ?? 'voix'
    const size = arg('size') ?? PRESET_SIZES[preset]
    if (!size) throw new Error(`Preset inconnu : ${preset} (attendu voix, muet ou social).`)
    if (!existsSync(resolve(VIDEOS_DIR, video))) throw new Error(`Dossier vidéo introuvable : ${resolve(VIDEOS_DIR, video)}`)
    const { record } = await import('./recorder.ts')
    await record({
      video,
      videosDir: VIDEOS_DIR,
      size,
      headed: flag('headed'),
      mux: flag('mux'),
      burn: flag('burn'),
      offset: arg('offset') !== undefined ? Number(arg('offset')) : undefined,
      noTts: flag('no-tts'),
      state: arg('state'),
      noState: flag('no-state'),
      profile: flag('profile'),
      url: arg('url'),
      captionRight: arg('caption-right') !== undefined ? Number(arg('caption-right')) : undefined
    })
    return
  }

  if (command === 'mux') {
    const video = requireVideo()
    const { mux } = await import('./mux.ts')
    await mux(video, VIDEOS_DIR, {
      offset: arg('offset') !== undefined ? Number(arg('offset')) : undefined,
      burn: flag('burn')
    })
    return
  }

  if (command === 'clean') {
    const video = requireVideo()
    const { cleanup } = await import('./cleanup.ts')
    await cleanup({ videosDir: VIDEOS_DIR, video, id: arg('id'), state: arg('state') })
    return
  }

  if (command === 'tts') {
    const video = requireVideo()
    const scriptPath = resolve(VIDEOS_DIR, video, 'script.md')
    if (!existsSync(scriptPath)) throw new Error(`script.md introuvable : ${scriptPath}`)
    const { prepareNarration, bakeoff, pronunciationBakeoff } = await import('./tts.ts')
    if (flag('bakeoff')) {
      bakeoff(video, VIDEOS_DIR)
    } else if (flag('bakeoff-prononciation')) {
      pronunciationBakeoff(video, VIDEOS_DIR)
    } else {
      prepareNarration(parseScript(scriptPath), { force: flag('force') })
    }
    return
  }

  if (command === 'auth:import') {
    const input = rawArgs[1]
    const { importAuth } = await import('./import-auth.ts')
    importAuth(input, VIDEOS_DIR)
    return
  }

  usage()
  throw new Error(`Commande inconnue : ${command}`)
}

await main()
