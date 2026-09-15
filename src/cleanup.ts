// Supprime le jeu de données (et l'application éventuelle) de démonstration
// créés pendant un tournage.
//
// Utilise les cookies de `<videos-dir>/.auth/state.json`.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { ensureProxyAuth, mcpLaunchOptions } from './auth.ts'

export interface CleanupOptions {
  videosDir: string
  video?: string
  id?: string
  state?: string
  log?: (message: string) => void
}

export async function cleanup (opts: CleanupOptions) {
  const log = opts.log ?? console.log
  const video = opts.video ?? 'import-fichier'
  const stateFile = opts.state ?? resolve(opts.videosDir, '.auth/state.json')
  if (!existsSync(stateFile)) await ensureProxyAuth(stateFile, { log })
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { cookies: any[], origins: any[] }

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

  const launchOptions = mcpLaunchOptions()
  const browser = await chromium.launch({ channel: 'chrome', headless: true, proxy: launchOptions.proxy, args: launchOptions.args })
  const context = await browser.newContext({ storageState: state })
  const page = await context.newPage()
  await page.goto('https://koumoul.com/data-fair/', { waitUntil: 'domcontentloaded', timeout: 60_000 })

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
