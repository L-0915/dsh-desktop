/**
 * Batch-convert every image in a directory to multi-size .ico files.
 * Originals are preserved; each input gets a sibling `<name>.ico`.
 *
 * Each ICO carries 16/32/48/64/128/256 PNG entries. Non-square inputs are
 * fitted (contain) onto a transparent 256 canvas so the icon never
 * distorts.
 *
 * Usage: node scripts/convert-to-ico.mjs <dir>
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('D:\\deepseek-harness\\node_modules\\.pnpm\\sharp@0.35.3_@types+node@22.20.0\\node_modules\\sharp')

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/convert-to-ico.mjs <dir>')
  process.exit(1)
}

const SIZES = [16, 32, 48, 64, 128, 256]
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.tif', '.tiff', '.avif'])

/** Pack N PNG payloads into one multi-size ICO. */
function packIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4) // image count
  let offset = header.length
  pngs.forEach((png, index) => {
    const p = 6 + 16 * index
    const size = SIZES[index]
    header.writeUInt8(size >= 256 ? 0 : size, p) // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, p + 1) // height
    header.writeUInt8(0, p + 2)
    header.writeUInt8(0, p + 3)
    header.writeUInt16LE(1, p + 4) // planes
    header.writeUInt16LE(32, p + 6) // bpp
    header.writeUInt32LE(png.length, p + 8)
    header.writeUInt32LE(offset, p + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs])
}

/** Fit one source image onto a 256px transparent canvas, then downscale. */
async function renderSizes(input) {
  const master = sharp(input)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  // Build every size from the 256 master so small sizes stay sharp.
  const base = await master
  const pngs = []
  for (const size of SIZES) {
    if (size === 256) {
      pngs.push(base)
    } else {
      pngs.push(await sharp(base).resize(size, size).png().toBuffer())
    }
  }
  return pngs
}

const entries = (await readdir(dir, { withFileTypes: true }))
  .filter(e => e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase()))

if (entries.length === 0) {
  console.log(`no images found in ${dir}`)
  process.exit(0)
}

let ok = 0
let failed = 0
for (const entry of entries) {
  const input = join(dir, entry.name)
  const output = join(dir, `${entry.name.slice(0, -extname(entry.name).length)}.ico`)
  try {
    const pngs = await renderSizes(input)
    await writeFile(output, packIco(pngs))
    console.log(`OK   ${entry.name} -> ${output.split('\\').pop()} (${SIZES.length} sizes)`)
    ok++
  } catch (error) {
    console.error(`FAIL ${entry.name}: ${error.message}`)
    failed++
  }
}

console.log(`\ndone: ${ok} converted, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
