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
  mux --video <slug>        assemble le MP4 et le SRT depuis la vidéo brute
  clean --video <slug>      supprime le jeu de données / l'application de démo
  tts --video <slug>        synthétise la narration, ou compare des voix

Options record :
  --preset <voix|muet|social>  format (taille par défaut : 1920x1080, 1280x720)
  --video <slug>               dossier <videos-dir>/<slug> (script.md, scenario.ts)
  --size <LxH>                 taille de la fenêtre (surcharge le preset)
  --scale <n>                  densité de pixels : vidéo de LxH × n (1,5 → 1080p
                               depuis 1280x720, 3 → 4K), mise en page inchangée
  --headed                     navigateur visible (mise au point)
  --url <url>                  page ouverte avant le scénario
  --mux                        enchaîne le montage MP4/SRT
  --burn                       avec --mux : variante sous-titrée .st.mp4
  --no-tts                     réutilise la narration déjà synthétisée
  --state <fichier>            cookies de session explicites (en plus du proxy NHI)
  --caption-right <px>         décale les sous-titres incrustés (panneau à droite)

Options mux :
  --burn                       produit aussi la variante sous-titrée

Options clean :
  --id <identifiant>           jeu de données à supprimer (sinon celui du tournage)
  --url <url>                  back-office du tournage (défaut : https://koumoul.com/data-fair/)

Options tts :
  --force                      resynthétise tout
  --bakeoff                    extraits comparatifs de voix (out/voix)
  --bakeoff-prononciation      extraits comparatifs de graphies

Options communes :
  --videos-dir <dossier>       dossier des vidéos (défaut : videos)

Proxy NHI : NHI_PROXY_SERVER, sinon navigateur MCP d'opencode, sinon profil
nhi-proxy (NHI_PROXY_PROFILE, défaut : celui de https://koumoul.com) ;
RECORD_NO_PROXY=1 pour un chargement anonyme.`)
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
      scale: arg('scale') !== undefined ? Number(arg('scale')) : undefined,
      headed: flag('headed'),
      mux: flag('mux'),
      burn: flag('burn'),
      noTts: flag('no-tts'),
      state: arg('state'),
      url: arg('url'),
      captionRight: arg('caption-right') !== undefined ? Number(arg('caption-right')) : undefined
    })
    return
  }

  if (command === 'mux') {
    const video = requireVideo()
    const { mux } = await import('./mux.ts')
    await mux(video, VIDEOS_DIR, { burn: flag('burn') })
    return
  }

  if (command === 'clean') {
    const video = requireVideo()
    const { cleanup } = await import('./cleanup.ts')
    await cleanup({ videosDir: VIDEOS_DIR, video, id: arg('id'), url: arg('url') })
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

  usage()
  throw new Error(`Commande inconnue : ${command}`)
}

await main()
