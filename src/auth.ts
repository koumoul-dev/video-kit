// Proxy NHI du navigateur d'enregistrement.
//
// `@data-fair/nhi-proxy` injecte la session de l'identité non humaine dans les
// réponses : un Chromium lancé derrière le proxy la reçoit en cookies ordinaires
// dès la première navigation (recette « script Playwright autonome » du skill
// data-fair-browse). Il n'y a donc ni cookie à récolter ni état à stocker ; le
// proxy re-signe l'hôte cible avec sa propre autorité, d'où `ignoreHTTPSErrors`
// sur le contexte.
//
// Serveur du proxy, par ordre de priorité :
//  1. `NHI_PROXY_SERVER` (ex. http://127.0.0.1:7335) ;
//  2. navigateur MCP d'opencode (`~/.config/opencode/playwright-mcp.json`) ;
//  3. profil nhi-proxy local : `NHI_PROXY_PROFILE`, sinon le profil de
//     https://koumoul.com, sinon le premier profil configuré.
// `RECORD_NO_PROXY=1` désactive le proxy (chargement anonyme).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const readJson = <T> (path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

export function proxyServer (): string | undefined {
  if (process.env.RECORD_NO_PROXY) return undefined
  if (process.env.NHI_PROXY_SERVER) return process.env.NHI_PROXY_SERVER

  const mcp = readJson<{ browser?: { launchOptions?: { proxy?: { server?: string } } } }>(resolve(homedir(), '.config/opencode/playwright-mcp.json'))
  if (mcp?.browser?.launchOptions?.proxy?.server) return mcp.browser.launchOptions.proxy.server

  const base = resolve(homedir(), '.config/nhi-proxy')
  if (!existsSync(base)) return undefined
  const profiles = readdirSync(base)
    .map(name => ({ name, config: readJson<{ site?: string, port?: number }>(resolve(base, name, 'config.json')) }))
    .filter(profile => profile.config?.port)
  const wanted = process.env.NHI_PROXY_PROFILE
  const profile = wanted
    ? profiles.find(candidate => candidate.name === wanted)
    : profiles.find(candidate => candidate.config?.site === 'https://koumoul.com') ?? profiles[0]
  if (wanted && !profile) throw new Error(`Profil nhi-proxy introuvable : ${wanted} (voir \`npx @data-fair/nhi-proxy profiles\`).`)
  return profile ? `http://127.0.0.1:${profile.config!.port}` : undefined
}
