/**
 * Shortcut icon management: built-in icons ship with the plugin package
 * (`assets/icons/`), user-uploaded icons are stored under
 * `$DSH_HOME/desktop-icons/`. Uploaded PNGs are wrapped into a PNG-in-ICO
 * container (Vista+ supports PNG payloads in ICO files), so no image
 * codec dependency is needed.
 */

import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeBackground } from './background.ts'
import { dshHome } from './config.ts'

/** Directory of this package's source/asset tree. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Built-in icon directory inside the installed package. */
export const BUILTIN_ICON_DIR = join(PACKAGE_ROOT, 'assets', 'icons')

/** User-uploaded icon directory under the DSH home. */
export function userIconDir(): string {
  return join(dshHome(), 'desktop-icons')
}

/** One icon descriptor surfaced to the settings page. */
export interface IconDescriptor {
  /** Stable id: `builtin:<name>` or `user:<name>`. */
  id: string
  /** Display name (file stem). */
  name: string
  /** Absolute path of the icon file. */
  path: string
  /** Whether this is a built-in icon. */
  builtin: boolean
  /** Absolute URL the browser can load the icon preview from. */
  url: string
}

/**
 * Wrap PNG bytes into an ICO container (single 256x256 PNG entry).
 * @param png - the PNG payload.
 * @returns complete ICO file bytes.
 */
export function pngToIco(png: Uint8Array): Uint8Array {
  const header = new Uint8Array(6 + 16)
  const view = new DataView(header.buffer)
  view.setUint16(0, 0, true) // reserved
  view.setUint16(2, 1, true) // type: icon
  view.setUint16(4, 1, true) // image count
  view.setUint8(6, 0) // width 256 -> 0
  view.setUint8(7, 0) // height 256 -> 0
  view.setUint8(8, 0) // palette
  view.setUint8(9, 0) // reserved
  view.setUint16(10, 1, true) // planes
  view.setUint16(12, 32, true) // bpp
  view.setUint32(14, png.length, true) // payload size
  view.setUint32(18, 22, true) // payload offset
  const out = new Uint8Array(22 + png.length)
  out.set(header)
  out.set(png, 22)
  return out
}

/**
 * List every available icon. Built-in icons are discovered live from the
 * package's assets/icons directory — any `.ico` file dropped there (any
 * name) shows up automatically, no code change needed. User-uploaded icons
 * follow from the DSH-home desktop-icons directory.
 * @returns icon descriptors sorted built-in then user, by name.
 */
export async function listIcons(): Promise<IconDescriptor[]> {
  const icons: IconDescriptor[] = []
  try {
    const entries = await readdir(BUILTIN_ICON_DIR)
    for (const name of entries.filter(n => n.endsWith('.ico')).sort()) {
      const path = join(BUILTIN_ICON_DIR, name)
      try {
        await readFile(path)
        icons.push({ id: `builtin:${name}`, name, path, builtin: true, url: `/api/dsh-desktop/icon/${name}` })
      } catch {
        // A vanished file is skipped (the listing is live, files may churn).
      }
    }
  } catch {
    // No built-in icon directory — nothing to list.
  }
  try {
    const entries = await readdir(userIconDir())
    for (const name of entries.sort()) {
      if (!name.endsWith('.ico')) continue
      icons.push({ id: `user:${name}`, name, path: join(userIconDir(), name), builtin: false, url: `/api/dsh-desktop/icon/user/${name}` })
    }
  } catch {
    // No user icon directory yet — nothing uploaded.
  }
  return icons
}

/**
 * Store a user-uploaded icon. The browser half rasterizes any source format
 * (PNG/JPG/WebP/GIF…) to PNG before uploading, so the host only accepts PNG
 * payloads (wrapped into ICO) — anything else is refused rather than stored
 * as a corrupt .ico. A solid-color background is removed automatically so
 * the icon blends into any desktop theme.
 * @param fileName - original file name (used for the stored stem).
 * @param bytes - icon bytes; must be a PNG payload.
 * @returns the stored descriptor.
 */
export async function saveUserIcon(fileName: string, bytes: Uint8Array): Promise<IconDescriptor> {
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50
    && bytes[2] === 0x4e && bytes[3] === 0x47
  if (!isPng) throw new Error('only PNG payloads are accepted (the browser half converts any image format first)')
  const clean = await removeBackground(Buffer.from(bytes))
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.png$/i, '')
  const dir = userIconDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${safe}.ico`)
  await writeFile(path, pngToIco(clean))
  return { id: `user:${safe}.ico`, name: `${safe}.ico`, path, builtin: false, url: `/api/dsh-desktop/icon/user/${safe}.ico` }
}

/**
 * Remove a user-uploaded icon.
 * @param name - icon file name (`.ico`).
 */
export async function removeUserIcon(name: string): Promise<void> {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  await unlink(join(userIconDir(), safe))
}
