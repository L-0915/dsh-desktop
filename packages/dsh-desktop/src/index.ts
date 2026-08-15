/**
 * dsh-desktop — host half. Mounts the /api/dsh-desktop route family
 * (shortcut create/remove, launcher config, icon upload/listing) and a
 * system-prompt announcement. The browser half (./client) renders the
 * launcher section in the settings page. Everything rides official NPM SDK
 * packages — no dsh source changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { dshHome, loadConfig } from './config.ts'
import { makeRoutes } from './routes.ts'

export { configPath, defaultConfig, loadConfig, saveConfig } from './config.ts'
export { removeBackground } from './background.ts'
export { listIcons, pngToIco, removeUserIcon, saveUserIcon, userIconDir } from './icons.ts'

/** Stable cordis plugin name. */
export const name = 'desktop'

/** Services required before the launcher surfaces can mount. */
export const inject = ['webServer', 'systemPrompt']

/**
 * Settings namespace of the desktop-launcher capability — the section the
 * web settings surface edits. Spelled here rather than imported: the browser
 * half spells the same value and must not depend on a Host package.
 */
export const DESKTOP_SETTINGS_NAMESPACE = settingsNamespace('dsh-desktop')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** When true (default), a system-prompt section announces the launcher to every agent. */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes + prompt section). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160

/** Model-facing announcement: plugin presence and capability boundary. */
export const DESKTOP_GUIDANCE = '本机已安装 dsh-desktop 插件：设置页「插件配置」的 desktop 卡片可创建/删除桌面快捷方式、选择图标、配置启动命令；快捷方式指向 Tauri 壳，双击即以独立窗口打开 Web GUI（127.0.0.1:3080）。用户在 GUI 中操作，agent 无需直接调用。'

/**
 * Resolve the Tauri shell executable path: the configured value first, then
 * the plugin's packaged shell, then the local dev build.
 * @returns the absolute shell path, or '' when not found.
 */
export async function resolveShellPath(): Promise<string> {
  const configured = (await loadConfig()).shellPath
  if (configured.length > 0 && existsSync(configured)) return configured
  const candidates = [
    // Packaged shell inside the plugin bundle.
    join(import.meta.dirname, '..', 'shell', 'dsh-desktop.exe'),
    // Local dev build of this repository (apps/shell/src-tauri/target/release).
    join(dshHome(), 'dsh-desktop', 'apps', 'shell', 'src-tauri', 'target', 'release', 'dsh-desktop.exe'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

/**
 * Mount the launcher routes and announcement.
 * @param ctx - host plugin context carrying webServer/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  let current: () => Config = () => config ?? {}
  const resolve = (): Config => ({
    announceToAgent: current().announceToAgent ?? DEFAULT_ANNOUNCE,
    enabled: current().enabled ?? true,
  })

  const routes = makeRoutes({ resolveShellPath })
  let disposeRoutes: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    const value = resolve()
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-desktop',
        order: SECTION_ORDER,
        text: DESKTOP_GUIDANCE,
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-desktop: routes',
    )
  }

  installSettingsSection(ctx, DESKTOP_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}
