/**
 * The Desktop Launcher plugin card (inside Settings → Plugins → Plugin
 * configuration). Mirrors the official ui-plugin-config card chrome: a
 * disclosure header (name + description + chevron) that expands to the
 * launcher controls — shortcut create/remove, icon picker, launch config.
 *
 * All colors come from the skin system's `--dsw-alias-*` variables, so the
 * card follows the active theme (including custom skins) automatically.
 * All data flows through the /api/dsh-desktop route family over same-origin
 * fetch — no client-side state beyond the component.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SettingsPluginItemOwnerProps } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { DesktopLauncherKey } from './locales.ts'

/** Translated helper bound to this card's namespace. */
type T = (key: DesktopLauncherKey, params?: Record<string, unknown>) => string

/** Card component props: the plugin-card owner share plus the t seat. */
export interface DesktopLauncherCardProps extends SettingsPluginItemOwnerProps {
  /** Framework-injected translator for this card's dictionary. */
  t: T
}

/** One icon descriptor as surfaced by the host. */
interface IconDto {
  id: string
  name: string
  builtin: boolean
  url: string
  /** Absolute local path — matched against config.iconPath for selection. */
  path: string
}

/** The launcher config as surfaced by the host. */
interface ConfigDto {
  url: string
  port: number
  startCommand: string[]
  startCwd: string
  timeoutSecs: number
  shellPath: string
  /** Icon currently applied to the desktop shortcut. */
  iconPath: string
}

/** Status payload of GET /api/dsh-desktop/status. */
interface StatusDto {
  platform: string
  shell: { path: string; exists: boolean }
  shortcut: { path: string; exists: boolean }
  config: ConfigDto
  icons: IconDto[]
}

/** Shared fetch helper: parse JSON, surface the host's error message. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`HTTP ${response.status}`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return body as T
}

/** Chevron glyph matching the official card chrome (14px, currentColor). */
const CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path
      d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
      fill="currentColor"
    />
  </svg>
)

/**
 * The desktop launcher plugin card.
 * @param props - the plugin-card owner share and the t seat.
 */
export function DesktopLauncherCard(props: DesktopLauncherCardProps): JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<StatusDto | undefined>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'none' | 'create' | 'remove' | 'save' | 'upload'>('none')
  const [selectedIcon, setSelectedIcon] = useState('')
  const [form, setForm] = useState<ConfigDto>({
    url: '', port: 3080, startCommand: [], startCwd: '', timeoutSecs: 60, shellPath: '', iconPath: '',
  })
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await api<StatusDto>('/api/dsh-desktop/status')
      setStatus(next)
      setForm(next.config)
      // Selection follows the REAL state — the icon currently applied to the
      // desktop shortcut (config.iconPath) — so reopening the card shows the
      // icon that is actually in use instead of always resetting to the first.
      const applied = next.config.iconPath !== ''
        ? next.icons.find(icon => icon.path === next.config.iconPath)?.id
        : undefined
      setSelectedIcon(applied ?? next.icons[0]?.id ?? '')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const run = useCallback(async (action: Exclude<typeof busy, 'none'>, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(action)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('none')
    }
  }, [refresh])

  /**
   * Decode any browser-supported image (PNG/JPG/WebP/GIF/BMP/SVG/AVIF…) and
   * rasterize it onto a 256×256 transparent canvas (contain fit, no
   * distortion), returning PNG base64 — one canonical payload the host
   * wraps into ICO regardless of the source format.
   */
  const onUpload = useCallback(async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      setError(t('error.generic', { message: t('icon.unsupported') }))
      return
    }
    try {
      const bitmap = await createImageBitmap(file)
      const SIZE = 256
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const ctx = canvas.getContext('2d')
      if (ctx === null) throw new Error('canvas unavailable')
      ctx.clearRect(0, 0, SIZE, SIZE)
      const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height)
      const w = bitmap.width * scale
      const h = bitmap.height * scale
      ctx.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
      bitmap.close()
      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      await run('upload', () => api('/api/dsh-desktop/icon', {
        method: 'POST',
        body: JSON.stringify({ name: file.name, dataBase64: base64 }),
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [run, t])

  const commandText = useMemo(() => form.startCommand.join(' '), [form.startCommand])

  const save = useCallback((): void => {
    void run('save', () => api('/api/dsh-desktop/config', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        startCommand: commandText.trim().split(/\s+/).filter(Boolean),
      }),
    }))
  }, [run, form, commandText])

  const create = useCallback((): void => {
    void run('create', () => api('/api/dsh-desktop/shortcut', {
      method: 'POST',
      body: JSON.stringify({ icon: selectedIcon }),
    }))
  }, [run, selectedIcon])

  const remove = useCallback((): void => {
    void run('remove', () => api('/api/dsh-desktop/shortcut', { method: 'DELETE' }))
  }, [run])

  const field = useCallback((key: keyof ConfigDto) => (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value
    setForm(prev => ({
      ...prev,
      [key]: key === 'port' || key === 'timeoutSecs' ? Number(value) || 0 : value,
    }))
  }, [])

  // --- skin-token styles (follow the active theme/skin) ---
  const card: React.CSSProperties = {
    border: '1px solid var(--dsw-alias-border-l2)',
    background: open ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
    borderRadius: 12,
    listStyle: 'none',
    transition: 'border-color .16s, background .16s',
  }
  const header: React.CSSProperties = {
    appearance: 'none', width: '100%', color: 'inherit', font: 'inherit', textAlign: 'left',
    cursor: 'pointer', background: 'none', border: 0, borderRadius: 12,
    alignItems: 'center', gap: 12, padding: '14px 16px', display: 'flex',
  }
  const headText: React.CSSProperties = { flexDirection: 'column', flex: 1, gap: 4, minWidth: 0, display: 'flex' }
  const name: React.CSSProperties = { color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 600, lineHeight: 1.4 }
  const description: React.CSSProperties = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1.5 }
  const chevron: React.CSSProperties = {
    color: 'var(--dsw-alias-label-tertiary)', flex: 'none', transition: 'transform .16s',
    transform: open ? 'rotate(180deg)' : undefined,
  }
  const body: React.CSSProperties = {
    borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', padding: '12px 0 8px',
  }
  const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }
  const cardInner: React.CSSProperties = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, padding: 14, marginBottom: 12 }
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0' }
  const labelStyle: React.CSSProperties = { display: 'block', margin: '10px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, marginTop: 4,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 13,
  }
  const buttonBase: React.CSSProperties = {
    padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 600, marginRight: 8,
  }
  const primaryButton: React.CSSProperties = {
    ...buttonBase,
    background: 'var(--dsw-alias-button-primary-fill)',
    color: 'var(--dsw-alias-label-primary-foreground)',
  }
  const dangerButton: React.CSSProperties = {
    ...buttonBase,
    background: 'var(--dsw-alias-button-contrast-fill)',
    color: 'var(--dsw-alias-label-primary-foreground)',
  }
  const disabled = busy !== 'none'

  return (
    <li style={card}>
      <button type="button" style={header} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <span style={headText}>
          <span style={name}>{t('section.title')}</span>
          <span style={description}>{t('section.description')}</span>
        </span>
        <span style={chevron}>{CHEVRON}</span>
      </button>
      {open
        ? (
          <div style={body}>
            {error !== '' && (
              <div style={{ ...cardInner, borderColor: 'var(--dsw-alias-border-l4)', background: 'var(--dsw-alias-bg-mask-1)' }}>
                <span style={{ color: 'var(--dsw-alias-label-primary)', fontSize: 13 }}>{error}</span>
              </div>
            )}

            <div style={cardInner}>
              <h3 style={titleStyle}>{t('status.platform')}: {status?.platform ?? '…'}</h3>
              <div style={rowStyle}>
                <span>{t('status.shell')}:</span>
                {status === undefined
                  ? <span>{t('status.loading')}</span>
                  : status.shell.exists
                    ? <span style={{ color: 'var(--dsw-alias-button-info-fill)' }}>{t('status.shell.found')}</span>
                    : <span style={{ color: 'var(--dsw-alias-button-contrast-fill)' }}>{t('status.shell.missing')}</span>}
              </div>
              <div style={rowStyle}>
                <span>{t('status.shortcut')}:</span>
                {status === undefined
                  ? <span>{t('status.loading')}</span>
                  : status.shortcut.exists
                    ? <span style={{ color: 'var(--dsw-alias-button-info-fill)' }}>{t('status.shortcut.exists')}</span>
                    : <span style={{ color: 'var(--dsw-alias-button-contrast-fill)' }}>{t('status.shortcut.missing')}</span>}
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  style={{ ...primaryButton, opacity: disabled || status?.shell.exists !== true ? 0.5 : 1, cursor: disabled || status?.shell.exists !== true ? 'not-allowed' : 'pointer' }}
                  disabled={disabled || status?.shell.exists !== true}
                  onClick={create}
                >
                  {busy === 'create' ? t('action.creating') : t('action.create')}
                </button>
                <button
                  type="button"
                  style={{ ...dangerButton, opacity: disabled || status?.shortcut.exists !== true ? 0.5 : 1, cursor: disabled || status?.shortcut.exists !== true ? 'not-allowed' : 'pointer' }}
                  disabled={disabled || status?.shortcut.exists !== true}
                  onClick={remove}
                >
                  {busy === 'remove' ? t('action.removing') : t('action.remove')}
                </button>
              </div>
            </div>

            <div style={cardInner}>
              <h3 style={titleStyle}>{t('icon.title')}</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {status?.icons.map(icon => (
                  <button
                    key={icon.id}
                    type="button"
                    title={t('icon.select')}
                    onClick={() => {
                      // Picking an icon applies it to the shortcut immediately
                      // (creates/refreshes the .lnk), so the desktop icon
                      // follows the selection without a second click.
                      setSelectedIcon(icon.id)
                      if (status?.shortcut.exists === true) {
                        void run('create', () => api('/api/dsh-desktop/shortcut', {
                          method: 'POST',
                          body: JSON.stringify({ icon: icon.id }),
                        }))
                      }
                    }}
                    style={{
                      border: selectedIcon === icon.id ? '2px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l2)',
                      borderRadius: 8, padding: 6,
                      background: 'var(--dsw-alias-bg-layer-1)',
                      cursor: 'pointer', textAlign: 'center',
                    }}
                  >
                    <img src={icon.url} alt={icon.name} style={{ width: 48, height: 48, display: 'block' }} />
                    <span style={{ fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' }}>
                      {icon.builtin ? t('icon.builtin') : t('icon.custom')}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={event => {
                    const file = event.target.files?.[0]
                    if (file !== undefined) void onUpload(file)
                    event.target.value = ''
                  }}
                />
                <button
                  type="button"
                  style={{ ...primaryButton, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                  disabled={disabled}
                  onClick={() => fileInput.current?.click()}
                >
                  {busy === 'upload' ? t('icon.uploading') : t('icon.upload')}
                </button>
              </div>
            </div>

            <div style={cardInner}>
              <h3 style={titleStyle}>{t('config.title')}</h3>
              <label style={labelStyle}>{t('config.url')}</label>
              <input style={inputStyle} value={form.url} onChange={field('url')} />
              <label style={labelStyle}>{t('config.port')}</label>
              <input style={inputStyle} type="number" value={form.port} onChange={field('port')} />
              <label style={labelStyle}>{t('config.startCommand')}</label>
              <input style={inputStyle} value={commandText} onChange={event => setForm(prev => ({ ...prev, startCommand: event.target.value.trim().split(/\s+/).filter(Boolean) }))} />
              <label style={labelStyle}>{t('config.startCwd')}</label>
              <input style={inputStyle} value={form.startCwd} onChange={field('startCwd')} />
              <label style={labelStyle}>{t('config.shellPath')}</label>
              <input style={inputStyle} value={form.shellPath} onChange={field('shellPath')} />
              <label style={labelStyle}>{t('config.timeoutSecs')}</label>
              <input style={inputStyle} type="number" value={form.timeoutSecs} onChange={field('timeoutSecs')} />
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  style={{ ...primaryButton, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                  disabled={disabled}
                  onClick={save}
                >
                  {busy === 'save' ? t('action.saving') : t('config.save')}
                </button>
              </div>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
