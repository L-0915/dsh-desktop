// Analyze the user's icon files: corner/edge colors, opaque ratio,
// background uniformity — decides which background-removal path fits.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('D:\\deepseek-harness\\node_modules\\.pnpm\\sharp@0.35.3_@types+node@22.20.0\\node_modules\\sharp')

const dir = 'D:/dsh-home/dsh-desktop/packages/dsh-desktop/assets/icons'
const files = ['blank.ico', 'write.ico', 'whale_a.ico', 'whale_l.ico']

/** Extract the 256px PNG entry from an ICO (last entry is usually 256). */
async function extract256(icoPath) {
  const buf = await readFile(icoPath)
  const count = buf.readUInt16LE(4)
  let best = null
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 16
    const w = buf[p]
    const size = buf.readUInt32LE(p + 8)
    const off = buf.readUInt32LE(p + 12)
    if (w === 0 || w === 255) { // 0 = 256
      best = { size, off }
    }
  }
  if (!best) best = { size: buf.readUInt32LE(6 + 8), off: buf.readUInt32LE(6 + 12) }
  return buf.subarray(best.off, best.off + best.size)
}

for (const f of files) {
  try {
    const png = await extract256(`${dir}/${f}`)
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width: w, height: h } = info
    // Sample: corners, edge midpoints, center
    const pts = {
      'corner-TL': [2, 2], 'corner-TR': [w - 3, 2], 'corner-BL': [2, h - 3], 'corner-BR': [w - 3, h - 3],
      'edge-top': [w >> 1, 2], 'edge-left': [2, h >> 1], 'center': [w >> 1, h >> 1],
    }
    const out = {}
    for (const [name, [x, y]] of Object.entries(pts)) {
      const i = (y * w + x) * 4
      out[name] = `rgba(${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]})`
    }
    // Opaque ratio over a 16x16 grid
    let opaque = 0, total = 0
    for (let gy = 0; gy < 16; gy++) {
      for (let gx = 0; gx < 16; gx++) {
        const i = ((Math.floor(gy * h / 16) * w + Math.floor(gx * w / 16)) * 4)
        if (data[i + 3] > 200) opaque++
        total++
      }
    }
    console.log(`=== ${f} (${w}x${h}) ===`)
    console.log('  samples:', JSON.stringify(out))
    console.log(`  opaque ratio: ${(opaque / total * 100).toFixed(0)}%`)
  } catch (e) {
    console.log(`=== ${f} === ERROR: ${e.message}`)
  }
}
