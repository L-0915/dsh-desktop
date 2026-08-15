/**
 * Regenerate the plugin's built-in icons from their source images.
 *
 * Source mapping (D:\pictures originals → assets/icons names):
 *   icon.png  -> write.ico      dark.jpg -> blank.ico
 *   all1.png  -> whale_a.ico    ds2.png  -> whale_l.ico
 *
 * Each source is fitted onto a 256 transparent canvas, background-removed,
 * then repacked as a 6-size ICO (16/32/48/64/128/256). Already-transparent
 * sources pass through the removal step unchanged.
 *
 * Run: node scripts/regenerate-builtin-icons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('D:\\deepseek-harness\\node_modules\\.pnpm\\sharp@0.35.3_@types+node@22.20.0\\node_modules\\sharp')
const { removeBackground } = await import('../packages/dsh-desktop/lib/index.mjs')

const ICON_DIR = 'D:\\dsh-home\\dsh-desktop\\packages\\dsh-desktop\\assets\\icons'
const SIZES = [16, 32, 48, 64, 128, 256]

const SOURCES = [
  { src: 'D:\\pictures\\icon.png', out: 'write.ico' },
  { src: 'D:\\pictures\\all1.png', out: 'whale_a.ico' },
  { src: 'D:\\pictures\\ds2.png', out: 'whale_l.ico' },
  { src: 'D:\\pictures\\dark.jpg', out: 'blank.ico' },
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
