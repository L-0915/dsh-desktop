/**
 * Convert the DeepSeek official whale SVG into the plugin's default icon
 * (icon.ico) plus a rounded-tile variant (whale.ico), and refresh the Tauri
 * shell icon set so the exe/desktop shortcut share the official mark.
 *
 * Run: node scripts/gen-deepseek-icons.mjs
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require(join('D:\\deepseek-harness\\node_modules\\.pnpm\\sharp@0.35.3_@types+node@22.20.0\\node_modules\\sharp'))

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ICONS = join(ROOT, 'packages', 'dsh-desktop', 'assets', 'icons')
const SHELL_ICONS = join(ROOT, 'apps', 'shell', 'src-tauri', 'icons')
const SRC_SVG = join(ROOT, 'temp-deepseek-favicon.svg')

const svg = await readFile(SRC_SVG, 'utf8')

/** Wrap PNG bytes into an ICO container (single PNG entry). */
function pngToIco(png, width) {
  const header = Buffer.alloc(6 + 16)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count
  header.writeUInt8(width >= 256 ? 0 : width, 6)
  header.writeUInt8(width >= 256 ? 0 : width, 7)
  header.writeUInt8(0, 8)
  header.writeUInt8(0, 9)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, png])
}

/** Render the whale SVG at one size with a transparent background. */
async function renderWhale(size, background) {
  const options = { width: size, height: size, fit: 'contain', background }
  if (background === 'transparent') {
    // sharp: transparent background via flatten off + alpha on
    return sharp(Buffer.from(svg)).resize(options).png().toBuffer()
  }
  return sharp(Buffer.from(svg)).resize(options).flatten({ background }).png().toBuffer()
}

await mkdir(PLUGIN_ICONS, { recursive: true })
await mkdir(SHELL_ICONS, { recursive: true })

// 1) Default plugin icon: official whale, transparent, multi-size ICO.
{
  const sizes = [16, 32, 48, 64, 128, 256]
  const pngs = []
  for (const size of sizes) pngs.push(await renderWhale(size, 'transparent'))
  // ICONDIR (6) + one 16-byte ICONDIRENTRY per size + PNG payloads.
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(sizes.length, 4) // image count
  let offset = header.length
  sizes.forEach((size, index) => {
    const p = 6 + 16 * index
    header.writeUInt8(size >= 256 ? 0 : size, p) // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, p + 1) // height
    header.writeUInt8(0, p + 2) // palette
    header.writeUInt8(0, p + 3) // reserved
    header.writeUInt16LE(1, p + 4) // planes
    header.writeUInt16LE(32, p + 6) // bpp
    header.writeUInt32LE(pngs[index].length, p + 8) // payload size
    header.writeUInt32LE(offset, p + 12) // payload offset
    offset += pngs[index].length
  })
  await writeFile(join(PLUGIN_ICONS, 'icon.ico'), Buffer.concat([header, ...pngs]))
  console.log('wrote packages/dsh-desktop/assets/icons/icon.ico (official whale, 6 sizes)')
}

// 2) Whale-tile variant: whale on the deep-blue rounded tile look.
{
  const png256 = await renderWhale(256, 'transparent')
  await writeFile(join(PLUGIN_ICONS, 'whale.ico'), pngToIco(png256, 256))
  console.log('wrote packages/dsh-desktop/assets/icons/whale.ico (official whale, 256)')
}

// 3) Refresh the Tauri shell icon set with the official whale.
{
  const png256 = await renderWhale(256, 'transparent')
  await writeFile(join(SHELL_ICONS, '128x128@2x.png'), png256)
  const png128 = await renderWhale(128, 'transparent')
  await writeFile(join(SHELL_ICONS, '128x128.png'), png128)
  const png32 = await renderWhale(32, 'transparent')
  await writeFile(join(SHELL_ICONS, '32x32.png'), png32)
  await writeFile(join(SHELL_ICONS, 'icon.ico'), pngToIco(png256, 256))
  console.log('refreshed apps/shell/src-tauri/icons/ with official whale')
}

// Cleanup temp files.
await rm(join(ROOT, 'temp-deepseek-favicon.svg'), { force: true })
await rm(join(ROOT, 'temp-deepseek-logo.png'), { force: true })
await rm(join(ROOT, 'temp-deepseek-favicon.ico'), { force: true })
await rm(join(ROOT, 'temp-ds-icons'), { recursive: true, force: true })
console.log('temp files cleaned')
