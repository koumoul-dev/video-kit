// Supprime le jeu de données (et l'application éventuelle) de démonstration
// créés pendant un tournage, avec la session du proxy NHI (voir auth.ts).

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { proxyServer } from './auth.ts'

export interface CleanupOptions {
  videosDir: string
  video?: string
  id?: string
  // back-office data-fair du tournage (défaut : https://koumoul.com/data-fair/)
  url?: string
  log?: (message: string) => void
}

export async function cleanup (opts: CleanupOptions) {
  const log = opts.log ?? console.log
  const video = opts.video ?? 'import-fichier'

  let ids: string[] = []
  if (opts.id) {
    ids = [opts.id]
  } else {
    const file = resolve(opts.videosDir, video, 'out/created-dataset.json')
    if (!existsSync(file)) {
      log(`Rien à supprimer (${file} absent).`)
      return
    }
    ids = [JSON.parse(readFileSync(file, 'utf8')).id as string]
  }

  // application éventuelle créée pendant le tournage (ex. cartographie) : notée
  // par le scénario dans out/created-application.json
  let appId: string | undefined
  if (!opts.id) {
    const appFile = resolve(opts.videosDir, video, 'out/created-application.json')
    if (existsSync(appFile)) appId = (JSON.parse(readFileSync(appFile, 'utf8')) as { id: string }).id
  }

  const proxy = proxyServer()
  if (!proxy) throw new Error('Aucun proxy NHI configuré : suppression impossible sans session (voir auth.md).')
  const browser = await chromium.launch({ channel: 'chrome', headless: true, proxy: { server: proxy } })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await page.goto(opts.url ?? 'https://koumoul.com/data-fair/', { waitUntil: 'domcontentloaded', timeout: 60_000 })

  for (const id of ids) {
    const result = await page.evaluate(async (datasetId) => {
      const res = await fetch(`/data-fair/api/v1/datasets/${datasetId}`, { method: 'DELETE' })
      return { status: res.status, body: await res.text() }
    }, id)
    log(`Suppression jeu de données ${id} : ${result.status} ${result.body.slice(0, 120)}`)
  }

  if (appId) {
    const result = await page.evaluate(async (applicationId) => {
      const res = await fetch(`/data-fair/api/v1/applications/${applicationId}`, { method: 'DELETE' })
      return { status: res.status, body: await res.text() }
    }, appId)
    log(`Suppression application ${appId} : ${result.status} ${result.body.slice(0, 120)}`)
  }

  await browser.close()
}
