/**
 * The /api/dsh-desktop route family: status, shortcut create/remove, config
 * save, and icon upload/listing/serving. Every route carries a loopback-only
 * trust fence — these endpoints create files on the user's desktop and under
 * the DSH home, so LAN-exposed deployments must not serve them.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { LauncherConfig } from './config.ts'
import { loadConfig, saveConfig } from './config.ts'
import { BUILTIN_ICON_DIR, listIcons, removeUserIcon, saveUserIcon, userIconDir } from './icons.ts'
import { createShortcut, currentPlatform, removeShortcut, shortcutExists, shortcutPath } from './shortcut.ts'

/** Cap on JSON request bodies (config and shortcut payloads are tiny). */
const MAX_JSON_BODY_BYTES = 256 * 1024

/** Cap on uploaded icon payloads (a 256px PNG fits far below this). */
const MAX_ICON_BYTES = 4 * 1024 * 1024

/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Read a raw binary body capped at MAX_ICON_BYTES. */
async function readRawBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_ICON_BYTES) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Path-safe name check: basename only, no separators, no dot-dot. */
function safeName(value: string): string | undefined {
  if (value.length === 0 || value.length > 120) return undefined
  if (value.includes('/') || value.includes('\\') || value === '.' || value === '..') return undefined
  return value
}

/**
 * Serve a local icon file. Uses ETag conditional caching keyed on the file's
 * size + mtime, so a replaced icon file (built-in or uploaded) is picked up
 * on the next request instead of serving a stale browser cache. `no-cache`
 * still lets the browser store the payload; it just revalidates cheaply.
 */
async function serveIcon(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('not a file')
    const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        'etag': etag,
        'cache-control': 'no-cache',
        'referrer-policy': 'no-referrer',
      })
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'image/x-icon',
      'content-length': info.size,
      'cache-control': 'no-cache',
      'etag': etag,
      'referrer-policy': 'no-referrer',
    })
    createReadStream(path).pipe(res)
  } catch {
    writeJson(res, 404, { error: 'icon not found' })
  }
}

/**
 * Build the dsh-desktop route family.
 * @param context - runtime facts the routes resolve against.
 * @returns the single prefix route covering /api/dsh-desktop/*.
 */
export function makeRoutes(context: {
  /** Resolve the shell executable path (configured or default). */
  resolveShellPath: () => Promise<string>
}): WebRoute[] {
  return [{
    kind: 'prefix',
    path: '/api/dsh-desktop',
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'loopback only' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      const method = req.method ?? 'GET'
      try {
        if (method === 'GET' && path === '/api/dsh-desktop/status') {
          const [config, icons, shellPath] = await Promise.all([loadConfig(), listIcons(), context.resolveShellPath()])
          writeJson(res, 200, {
            platform: currentPlatform(),
            shell: { path: shellPath, exists: shellPath.length > 0 },
            shortcut: { path: shortcutPath(), exists: shortcutExists() },
            config,
            icons,
          })
          return
        }
        if (method === 'POST' && path === '/api/dsh-desktop/config') {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const current = await loadConfig()
          const next: LauncherConfig = {
            url: typeof body.url === 'string' && body.url.length > 0 ? body.url : current.url,
            port: typeof body.port === 'number' && body.port > 0 ? body.port : current.port,
            startCommand: Array.isArray(body.startCommand)
              ? body.startCommand.filter((item): item is string => typeof item === 'string')
              : current.startCommand,
            startCwd: typeof body.startCwd === 'string' ? body.startCwd : current.startCwd,
            timeoutSecs: typeof body.timeoutSecs === 'number' && body.timeoutSecs > 0 ? body.timeoutSecs : current.timeoutSecs,
            shellPath: typeof body.shellPath === 'string' ? body.shellPath : current.shellPath,
          }
          await saveConfig(next)
          writeJson(res, 200, { ok: true, config: next })
          return
        }
        if (method === 'POST' && path === '/api/dsh-desktop/shortcut') {
          const [config, icons] = await Promise.all([loadConfig(), listIcons()])
          const shellPath = await context.resolveShellPath()
          if (shellPath.length === 0) {
            writeJson(res, 400, { error: 'shell executable not found — build the Tauri shell first' })
            return
          }
          let iconPath = ''
          const body = await readJsonBody(req)
          const iconId = typeof body?.icon === 'string' ? body.icon : ''
          const match = icons.find(icon => icon.id === iconId)
          if (match !== undefined) iconPath = match.path
          const target = await createShortcut(shellPath, iconPath)
          writeJson(res, 200, { ok: true, path: target, config })
          return
        }
        if (method === 'DELETE' && path === '/api/dsh-desktop/shortcut') {
          const removed = await removeShortcut()
          writeJson(res, 200, { ok: true, removed: removed ?? null })
          return
        }
        if (method === 'POST' && path === '/api/dsh-desktop/icon') {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const name = safeName(typeof body.name === 'string' ? body.name : '')
          const data = typeof body.dataBase64 === 'string' ? body.dataBase64 : ''
          if (name === undefined || data.length === 0) {
            writeJson(res, 400, { error: 'name and dataBase64 are required' })
            return
          }
          let bytes: Buffer
          try {
            bytes = Buffer.from(data, 'base64')
          } catch {
            writeJson(res, 400, { error: 'invalid base64 payload' })
            return
          }
          if (bytes.length > MAX_ICON_BYTES) {
            writeJson(res, 400, { error: 'icon too large' })
            return
          }
          const icon = await saveUserIcon(name, bytes)
          writeJson(res, 200, { ok: true, icon })
          return
        }
        if (method === 'GET' && path.startsWith('/api/dsh-desktop/icon/user/')) {
          const name = safeName(basename(decodeURIComponent(path.slice('/api/dsh-desktop/icon/user/'.length))))
          if (name === undefined) {
            writeJson(res, 400, { error: 'invalid icon name' })
            return
          }
          await serveIcon(req, res, join(userIconDir(), name))
          return
        }
        if (method === 'DELETE' && path.startsWith('/api/dsh-desktop/icon/user/')) {
          const name = safeName(basename(decodeURIComponent(path.slice('/api/dsh-desktop/icon/user/'.length))))
          if (name === undefined) {
            writeJson(res, 400, { error: 'invalid icon name' })
            return
          }
          await removeUserIcon(name)
          writeJson(res, 200, { ok: true })
          return
        }
        if (method === 'GET' && path.startsWith('/api/dsh-desktop/icon/')) {
          const name = safeName(basename(decodeURIComponent(path.slice('/api/dsh-desktop/icon/'.length))))
          if (name === undefined) {
            writeJson(res, 400, { error: 'invalid icon name' })
            return
          }
          await serveIcon(req, res, join(BUILTIN_ICON_DIR, name))
          return
        }
        writeJson(res, 404, { error: 'not found' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(res, 500, { error: message })
      }
    },
  }]
}
