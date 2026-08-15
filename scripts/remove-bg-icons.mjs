/**
 * Batch background-removal for the plugin's built-in icons:
 * for every .ico in packages/dsh-desktop/assets/icons, extract the 256px PNG
 * entry, remove the solid-color background, and repack a fresh 6-size ICO
 * (same filename). Already-transparent icons pass through unchanged.
 *
 * Run: node scripts/remove-bg-icons.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('..\\packages\\dsh-desktop\\node_modules\\sharp')

const { removeBackground } = await import('../packages/dsh-desktop/lib/index.mjs')

// Repository-relative (no machine-specific paths): scripts/../packages/...
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICON_DIR = join(REPO_ROOT, 'packages', 'dsh-desktop', 'assets', 'icons')
const SIZES = [16, 32, 48, 64, 128, 256]

/** Extract the 256px PNG payload from an ICO (last entry is the largest). */
async function extract256(icoPath) {
  const buf = await readFile(icoPath)
  const count = buf.readUInt16LE(4)
  let entry = null
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 16
    const w = buf[p]
    const size = buf.readUInt32LE(p + 8)
    const off = buf.readUInt32LE(p + 12)
    if (entry === null || w === 0 || w >= entry.w) entry = { w, size, off }
  }
  if (!entry) throw new Error('no ICO entries')
  return buf.subarray(entry.off, entry.off + entry.size)
}

/** Pack N PNG payloads into one multi-size ICO. */
function packIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach((png, index) => {
    const p = 6 + 16 * index
    const size = SIZES[index]
    header.writeUInt8(size >= 256 ? 0 : size, p)
    header.writeUInt8(size >= 256 ? 0 : size, p + 1)
    header.writeUInt8(0, p + 2)
    header.writeUInt8(0, p + 3)
    header.writeUInt16LE(1, p + 4)
    header.writeUInt16LE(32, p + 6)
    header.writeUInt32LE(png.length, p + 8)
    header.writeUInt32LE(offset, p + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs])
}

const files = (await readdir(ICON_DIR)).filter(f => f.endsWith('.ico'))
let changed = 0
let untouched = 0
for (const f of files) {
  const icoPath = join(ICON_DIR, f)
  const png256 = await extract256(icoPath)
  const clean = await removeBackground(png256)
  if (clean.length === png256.length && clean.equals(png256)) {
    console.log(`SKIP ${f} (already transparent)`)
    untouched++
    continue
  }
  // Downscale the cleaned 256 master to every size, then repack.
  const pngs = []
  for (const size of SIZES) {
    pngs.push(size === 256 ? clean : await sharp(clean).resize(size, size).png().toBuffer())
  }
  await writeFile(icoPath, packIco(pngs))
  console.log(`OK   ${f} (background removed, ${SIZES.length} sizes)`)
  changed++
}
console.log(`\ndone: ${changed} cleaned, ${untouched} already transparent`)
