/**
 * Desktop shortcut management.
 *
 * Windows: creates/removes a `.lnk` on the user's desktop via the
 * WScript.Shell COM object (spawned through PowerShell). The shortcut
 * targets the Tauri shell executable and points its icon at a custom `.ico`.
 *
 * macOS: `.app` alias support lands when a Mac build exists; every entry
 * point reports an explicit "not implemented on this platform" error until
 * then, so the UI never silently pretends a shortcut exists.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Stable display name of the desktop shortcut. */
export const SHORTCUT_BASE_NAME = 'DeepSeek Harness'

/** Current platform, normalized for the plugin's own branches. */
export type DesktopPlatform = 'windows' | 'macos' | 'other'

export function currentPlatform(): DesktopPlatform {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'other'
}

/** Absolute desktop directory of the current user. */
export function desktopDir(): string {
  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE ?? ''
    return join(profile, 'Desktop')
  }
  if (process.platform === 'darwin') {
    const home = process.env.HOME ?? ''
    return join(home, 'Desktop')
  }
  return ''
}

/** Full shortcut path for the current platform. */
export function shortcutPath(): string {
  return currentPlatform() === 'windows'
    ? join(desktopDir(), `${SHORTCUT_BASE_NAME}.lnk`)
    : join(desktopDir(), `${SHORTCUT_BASE_NAME}.app`)
}

/**
 * Whether a shortcut currently exists on the desktop.
 * @returns true when the shortcut file is present.
 */
export function shortcutExists(): boolean {
  return existsSync(shortcutPath())
}

/** Escaped single-quoted PowerShell literal (paths with `'` are rare but legal). */
function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Create (or refresh) the desktop shortcut on Windows.
 * @param shellPath - absolute path of the Tauri shell executable.
 * @param iconPath - absolute path of the `.ico` to show on the shortcut.
 * @returns the created shortcut path.
 */
export async function createShortcut(shellPath: string, iconPath: string): Promise<string> {
  const platform = currentPlatform()
  if (platform !== 'windows') {
    throw new Error(`desktop shortcuts are not implemented on ${platform === 'macos' ? 'macOS' : 'this platform'} yet`)
  }
  const target = shortcutPath()
  const workingDir = shellPath.replace(/[\\/][^\\/]*$/, '')
  const script = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut(${psQuote(target)})`,
    `$sc.TargetPath = ${psQuote(shellPath)}`,
    `$sc.WorkingDirectory = ${psQuote(workingDir)}`,
    `$sc.IconLocation = ${psQuote(`${iconPath},0`)}`,
    `$sc.Description = 'DeepSeek Harness desktop launcher'`,
    '$sc.Save()',
    // The shell icon cache can keep showing the old .lnk icon; force a
    // refresh so the new icon appears on the desktop immediately.
    '$sig = \'[DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);\'',
    '$type = Add-Type -MemberDefinition $sig -Name DshShellChange -Namespace Dsh -PassThru',
    '$type::SHChangeNotify(0x8000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)',
  ].join('; ')
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
  })
  return target
}

/**
 * Remove the desktop shortcut if it exists.
 * @returns the path that was removed, or undefined when nothing existed.
 */
export async function removeShortcut(): Promise<string | undefined> {
  const platform = currentPlatform()
  if (platform !== 'windows') {
    throw new Error(`desktop shortcuts are not implemented on ${platform === 'macos' ? 'macOS' : 'this platform'} yet`)
  }
  const target = shortcutPath()
  if (!existsSync(target)) return undefined
  const script = `Remove-Item -LiteralPath ${psQuote(target)} -Force`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
  })
  return target
}
