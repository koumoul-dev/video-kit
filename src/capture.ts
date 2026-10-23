// Capture vidéo de la page à partir des images du screencast Playwright.
//
// `recordVideo` de Playwright encode en VP8 temps réel à 1 Mbit/s
// (`-deadline realtime -b:v 1M`) : texte baveux et aplats en blocs avant même
// le montage, qui réencode par-dessus. Ici, chaque image JPEG du screencast
// (`page.screencast`, Playwright ≥ 1.59) est horodatée sur l'horloge murale et
// écrite dans un ffmpeg local à cadence fixe : une image est répétée tant
// qu'aucune nouvelle n'arrive (Chrome n'envoie rien sur une page immobile).
// L'intermédiaire est un H.264 quasi sans perte (`-crf 10`), le seul
// réencodage avec perte reste celui du montage.
//
// L'horodatage de la première image (`startWall`, ms depuis l'epoch, même
// horloge que `Date.now()`) est écrit dans la timeline : le montage cale alors
// la vidéo sans détection de scène.

import { spawn } from 'node:child_process'
import type { Page } from '@playwright/test'

export const CAPTURE_FPS = 25

// Couleurs de diffusion : les JPEG du screencast sont en plage pleine (JFIF,
// BT.601). Gardée telle quelle, la vidéo était marquée `pc` et les navigateurs
// l'affichaient délavée (gris clairs blanchis, traits fins effacés). Tout
// encodage du kit convertit donc en plage vidéo (`tv`) et en BT.709, l'espace
// supposé des vidéos HD, et le déclare dans le flux.
export const COLOR_FILTER = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p'
export const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

// Nombre d'images de sortie (cadence fixe) écoulées entre le début de la
// capture et l'instant `ts` : les créneaux d'avant `ts` montrent encore l'image
// précédente. Exporté pour les tests.
export function slotsBefore (startTs: number, ts: number, fps = CAPTURE_FPS): number {
  return Math.max(0, Math.ceil(((ts - startTs) * fps) / 1000 - 1e-6))
}

export interface Capture {
  // arrête la capture et attend la fin de l'encodage ; renvoie l'horodatage
  // mural de la première image (undefined si aucune image n'est arrivée)
  stop: () => Promise<number | undefined>
}

export async function startCapture (page: Page, out: string, size: { width: number, height: number }, fps = CAPTURE_FPS): Promise<Capture> {
  if (typeof page.screencast?.start !== 'function') {
    throw new Error('page.screencast indisponible : @playwright/test ≥ 1.59 est requis.')
  }
  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    // dimensions paires exigées par yuv420p ; gris si une image est plus petite
    '-vf', `pad=${size.width}:${size.height}:0:0:gray,crop=${size.width}:${size.height}:0:0,${COLOR_FILTER}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p', ...COLOR_TAGS,
    out
  ], { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  ffmpeg.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const done = new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject)
    ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg (capture) : ${stderr.slice(-2000)}`)))
  })

  let startTs: number | undefined
  let last: Buffer | undefined
  let written = 0
  // les écritures restent en mémoire tant que ffmpeg n'a pas consommé : une
  // image répétée réutilise le même Buffer, sans copie
  const fill = (until: number) => {
    if (!last) return
    for (; written < until; written++) ffmpeg.stdin.write(last)
  }

  await page.screencast.start({
    size,
    // qualité JPEG 95 : texte fixe à ~38,7 dB d'un screenshot, contre 36,9 dB
    // en 90 ; le plafond du yuv420p de diffusion est à ~39,9 dB
    quality: 95,
    onFrame: ({ data, timestamp }) => {
      if (startTs === undefined) startTs = timestamp
      fill(slotsBefore(startTs, timestamp, fps))
      last = data
    }
  })

  return {
    stop: async () => {
      await page.screencast.stop().catch(() => {})
      if (startTs !== undefined) fill(Math.max(written + 1, slotsBefore(startTs, Date.now(), fps)))
      ffmpeg.stdin.end()
      await done
      return startTs
    }
  }
}
