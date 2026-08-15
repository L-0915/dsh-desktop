/**
 * Browser-half entry for dsh-desktop — runs inside the dsh web GUI.
 *
 * Registers the dsh-desktop locale dictionary and the launcher card inside
 * the Settings → Plugins → Plugin configuration list ("desktop") where the
 * user creates/removes the desktop shortcut, picks an icon, and edits the
 * launch config.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings Plugins-section SlotMap merge
// (settings.plugins.tab) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the settings.plugin.item card-slot contract
// (SettingsPluginItemOwnerProps + SlotMap merge).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { DesktopLauncherCard } from './Card.tsx'
import { en, zh, type DesktopLauncherKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-desktop'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-desktop surface copy. */
    'dsh-desktop': DesktopLauncherKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { DesktopLauncherCardProps } from './Card.tsx'
export type { DesktopLauncherKey } from './locales.ts'

/**
 * Mount the launcher card into the Plugins → Plugin configuration list.
 * @param ctx - client root context (locale + slots services).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-desktop: dictionaries')

  // A configurable-plugin card: the Plugin configuration tab renders
  // settings.plugin.item contributions as expandable cards ordered by
  // `order`; the card draws its own chrome and controls.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'desktop-launcher',
    order: 30,
    locale: NS,
  }, DesktopLauncherCard))
}
