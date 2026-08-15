/**
 * Regenerate the plugin's built-in icons from their source images.
 *
 * Each source is fitted onto a 256 transparent canvas, background-removed,
 * then repacked as a 6-size ICO (16/32/48/64/128/256). Already-transparent
 * sources pass through the removal step unchanged.
 *
 * Usage: node scripts/regenerate-builtin-icons.mjs <source-dir>
 *   source-dir: directory containing icon.png / all1.png / ds2.png / dark.jpg
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('..\\packages\\dsh-desktop\\node_modules\\sharp')
const { removeBackground } = await import('../packages/dsh-desktop/lib/index.mjs')

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICON_DIR = join(REPO_ROOT, 'packages', 'dsh-desktop', 'assets', 'icons')
const SIZES = [16, 32, 48, 64, 128, 256]

const SOURCE_DIR = process.argv[2] ?? 'D:\\pictures'
const SOURCES = [
  { src: join(SOURCE_DIR, 'icon.png'), out: 'write.ico' },
  { src: join(SOURCE_DIR, 'all1.png'), out: 'whale_a.ico' },
  { src: join(SOURCE_DIR, 'ds2.png'), out: 'whale_l.ico' },
  { src: join(SOURCE_DIR, 'dark.jpg'), out: 'blank.ico' },
]

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

for (const { src, out } of SOURCES) {
  try {
    const master = await sharp(src)
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    const clean = await removeBackground(master)
    const pngs = []
    for (const size of SIZES) {
      pngs.push(size === 256 ? clean : await sharp(clean).resize(size, size).png().toBuffer())
    }
    await writeFile(`${ICON_DIR}\\${out}`, packIco(pngs))
    console.log(`OK   ${src.split('\\').pop()} -> ${out}`)
  } catch (error) {
    console.error(`FAIL ${src}: ${error.message}`)
  }
}
console.log('done')
