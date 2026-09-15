// Authentification du navigateur d'enregistrement.
//
// Deux mécanismes :
//  1. proxy NHI : `nhi-proxy` échange une assertion contre une session
//     simple-directory et propage les Set-Cookie au premier client venu ; une
//     requête curl à travers le proxy récolte ces cookies de façon déterministe
//     (après un temps d'inactivité qui force un nouvel échange) ;
//  2. cookies fournis explicitement (`--state`).
//
// Exporte aussi la lecture des options de lancement du navigateur MCP.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export interface LaunchOptions {
  proxy?: { server: string }
  args?: string[]
}

export function mcpLaunchOptions (): LaunchOptions {
  const configPath = resolve(homedir(), '.config/opencode/playwright-mcp.json')
  let launchOptions: LaunchOptions = {}
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { browser?: { launchOptions?: LaunchOptions } }
    launchOptions = config.browser?.launchOptions ?? {}
  } else {
    // Repli : configuration locale de nhi-proxy (~/.config/nhi-proxy/<site>/config.json).
    launchOptions = proxyLaunchOptions()
  }
  if (process.env.RECORD_NO_PROXY) delete launchOptions.proxy
  return launchOptions
}

// Lit le port et le site du proxy NHI local, en préférant la configuration
// koumoul.com (les certificats du proxy sont auto-signés : on ignore les erreurs
// de certificat côté navigateur, comme le fait curl avec --proxy-insecure).
export function proxyLaunchOptions (): LaunchOptions {
  if (process.env.NHI_PROXY_SERVER) {
    return { proxy: { server: process.env.NHI_PROXY_SERVER }, args: ['--ignore-certificate-errors'] }
  }
  const base = resolve(homedir(), '.config/nhi-proxy')
  if (!existsSync(base)) return {}
  const configs: Array<{ site?: string, port?: number }> = []
  for (const name of readdirSync(base)) {
    const configPath = resolve(base, name, 'config.json')
    if (!existsSync(configPath)) continue
    try {
      configs.push(JSON.parse(readFileSync(configPath, 'utf8')) as { site?: string, port?: number })
    } catch {
      // configuration illisible : ignorée
    }
  }
  const config = configs.find(candidate => candidate.site?.includes('koumoul.com')) ?? configs.find(candidate => candidate.port)
  if (!config?.port) return {}
  return { proxy: { server: `http://localhost:${config.port}` }, args: ['--ignore-certificate-errors'] }
}

interface StateCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

// Récolte les Set-Cookie d'une requête à travers le proxy NHI. Absents tant que
// la session du proxy est encore fraîche (pas de nouvel échange).
function harvestProxyCookies (proxyServer: string, url = 'https://koumoul.com/data-fair/'): StateCookie[] {
  const res = spawnSync('curl', [
    '-k', '--proxy-insecure', '-x', proxyServer,
    '-s', '-D', '-', '-o', '/dev/null',
    '--max-time', '30', url
  ], { encoding: 'utf8' })
  if (res.status !== 0) return []
  const cookies: StateCookie[] = []
  for (const line of res.stdout.split(/\r?\n/)) {
    const match = /^set-cookie:\s*(.+)$/i.exec(line)
    if (!match) continue
    const parts = match[1].split(';').map(part => part.trim())
    const [name, ...valueParts] = parts[0].split('=')
    const value = valueParts.join('=')
    if (!name || !value) continue
    const attr = (key: string) => {
      const found = parts.find(part => part.toLowerCase().startsWith(key.toLowerCase() + '='))
      return found ? found.slice(key.length + 1) : undefined
    }
    const expiresRaw = attr('Expires')
    const maxAge = attr('Max-Age')
    let expires = -1
    if (maxAge && Number.isFinite(Number(maxAge))) expires = Math.floor(Date.now() / 1000) + Number(maxAge)
    else if (expiresRaw) {
      const date = new Date(expiresRaw)
      if (!Number.isNaN(date.getTime())) expires = Math.floor(date.getTime() / 1000)
    }
    const sameSiteRaw = (attr('SameSite') ?? 'Lax').toLowerCase()
    cookies.push({
      name,
      value,
      domain: attr('Domain') ?? 'koumoul.com',
      path: attr('Path') ?? '/',
      expires,
      httpOnly: parts.some(part => /^httponly$/i.test(part)),
      secure: parts.some(part => /^secure$/i.test(part)),
      sameSite: sameSiteRaw === 'strict' ? 'Strict' : sameSiteRaw === 'none' ? 'None' : 'Lax'
    })
  }
  return cookies
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Attend un nouvel échange du proxy (session expirée par l'inactivité) puis
// écrit les cookies dans un storage state Playwright.
export async function ensureProxyAuth (statePath: string, opts: { tries?: number, delayMs?: number, log?: (message: string) => void } = {}) {
  const log = opts.log ?? console.log
  const proxyServer = mcpLaunchOptions().proxy?.server
  if (!proxyServer) throw new Error('Aucun proxy NHI configuré dans playwright-mcp.json.')
  const tries = opts.tries ?? 12
  const delayMs = opts.delayMs ?? 15_000
  for (let attempt = 1; attempt <= tries; attempt++) {
    const cookies = harvestProxyCookies(proxyServer)
    if (cookies.length) {
      mkdirSync(dirname(statePath), { recursive: true })
      writeFileSync(statePath, JSON.stringify({ cookies: cookies.map(c => ({ ...c, domain: c.domain.startsWith('.') || c.domain === 'koumoul.com' ? c.domain : `.${c.domain}` })), origins: [] }, null, 2) + '\n')
      log(`session NHI récoltée via ${proxyServer} (${cookies.map(c => c.name).join(', ')})`)
      return
    }
    log(`session NHI du proxy encore fraîche, nouvelle tentative dans ${Math.round(delayMs / 1000)}s (${attempt}/${tries})…`)
    await sleep(delayMs)
  }
  throw new Error('Impossible de récolter une session NHI : le proxy n\'a pas renouvelé de session.')
}
