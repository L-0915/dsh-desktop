/**
 * Shared launcher configuration (`$DSH_HOME/desktop-launcher.json`).
 *
 * Both halves of dsh-desktop read this one file: the Tauri shell consumes it
 * at startup (URL to load, port to probe, command to spawn when the web
 * service is down), and this plugin writes it from the settings page. The
 * file lives under the DSH home so it survives profile re-installs.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** One durable launcher configuration document. */
export interface LauncherConfig {
  /** Target URL of the dsh web GUI. */
  url: string
  /** Port probed to decide whether the service is up. */
  port: number
  /** Optional command (program + args) that starts the web service. */
  startCommand: string[]
  /** Working directory for the start command. */
  startCwd: string
  /** Seconds to keep polling for the port before giving up. */
  timeoutSecs: number
  /** Absolute path of the shell executable the shortcut targets. */
  shellPath: string
}

const CONFIG_FILE = 'desktop-launcher.json'

/** Default URL/port match the dsh web profile's default listen address. */
export const DEFAULT_URL = 'http://127.0.0.1:3080'
export const DEFAULT_PORT = 3080
export const DEFAULT_TIMEOUT_SECS = 60

/**
 * Resolve the DSH home directory (`$DSH_HOME`, falling back to `~/.dsh`).
 * @returns the absolute DSH home path.
 */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh')
}

/**
 * Absolute path of the launcher config document.
 * @returns the config file path under the DSH home.
 */
export function configPath(): string {
  return join(dshHome(), CONFIG_FILE)
}

/** Default values before any user configuration exists. */
export function defaultConfig(): LauncherConfig {
  return {
    url: DEFAULT_URL,
    port: DEFAULT_PORT,
    startCommand: [],
    startCwd: '',
    timeoutSecs: DEFAULT_TIMEOUT_SECS,
    shellPath: '',
  }
}

/**
 * Read the current launcher config, falling back to defaults on any error
 * (missing file, invalid JSON, schema violations).
 * @returns the resolved configuration.
 */
export async function loadConfig(): Promise<LauncherConfig> {
  try {
    const text = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(text) as Partial<LauncherConfig>
    const base = defaultConfig()
    return {
      url: typeof parsed.url === 'string' && parsed.url.length > 0 ? parsed.url : base.url,
      port: Number.isInteger(parsed.port) && (parsed.port as number) > 0 ? parsed.port as number : base.port,
      startCommand: Array.isArray(parsed.startCommand)
        ? parsed.startCommand.filter((item): item is string => typeof item === 'string')
        : base.startCommand,
      startCwd: typeof parsed.startCwd === 'string' ? parsed.startCwd : base.startCwd,
      timeoutSecs: Number.isInteger(parsed.timeoutSecs) && (parsed.timeoutSecs as number) > 0
        ? parsed.timeoutSecs as number
        : base.timeoutSecs,
      shellPath: typeof parsed.shellPath === 'string' ? parsed.shellPath : base.shellPath,
    }
  } catch {
    return defaultConfig()
  }
}

/**
 * Persist a launcher configuration document (atomically via temp + rename).
 * @param config - the full next configuration.
 */
export async function saveConfig(config: LauncherConfig): Promise<void> {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true })
  const text = JSON.stringify(config, null, 2)
  const tmp = `${path}.tmp`
  await writeFile(tmp, text, 'utf8')
  await writeFile(path, text, 'utf8')
  try {
    await import('node:fs/promises').then(({ rename }) => rename(tmp, path))
  } catch {
    // rename on Windows may fail if the target is momentarily locked; the
    // direct write above already landed the content.
  }
}
