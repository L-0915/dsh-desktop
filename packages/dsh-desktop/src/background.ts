/**
 * Automatic background removal for icon payloads.
 *
 * Icons uploaded as photos/screenshots (JPG-derived PNGs) carry an opaque
 * solid-color background that looks wrong on the desktop. The background is
 * removed with a flood fill seeded at the image BORDER: only regions of the
 * background color that are CONNECTED to the edge become transparent, so
 * background-colored areas INSIDE the subject (clothes, highlights, eyes)
 * stay intact. Transparent inputs (opaque border ratio below the threshold)
 * pass through untouched.
 *
 * @module dsh-desktop/background
 */

import sharp from 'sharp'

/**
 * A border region counts as a removable background only when opaque border
 * pixels cover at least this fraction of the sampled ring. Below it the
 * image is treated as an already-transparent cut-out and returned as-is.
 */
const BORDER_OPAQUE_RATIO = 0.2
/** RGB distance to the background reference color that still counts as background. */
const BG_TOLERANCE = 56
/**
 * RGB distance to the CURRENT flood-front pixel: lets the fill crawl across
 * gradients/shadows that drift away from the reference color without eating
 * neighboring subject areas (the connected constraint still gates it).
 */
const LOCAL_TOLERANCE = 14
/** Border ring sampling stride in pixels. */
const STRIDE = 2

/** Euclidean RGB distance between two colors. */
function rgbDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/**
 * Remove the border-connected solid-color background from a PNG buffer.
 * @param png - PNG payload (any size; processed at its native resolution).
 * @returns the processed PNG buffer.
 */
export async function removeBackground(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const px = (x: number, y: number): number => (y * w + x) * 4

  // Sample the border ring for the background reference color and the
  // opaque-ratio gate.
  const samples: Array<{ r: number; g: number; b: number }> = []
  for (let x = 0; x < w; x += STRIDE) {
    for (const y of [0, h - 1]) {
      const i = px(x, y)
      if ((data[i + 3] ?? 0) > 128) samples.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 })
    }
  }
  for (let y = 0; y < h; y += STRIDE) {
    for (const x of [0, w - 1]) {
      const i = px(x, y)
      if ((data[i + 3] ?? 0) > 128) samples.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 })
    }
  }
  const ringTotal = Math.ceil(w / STRIDE) * 2 + Math.ceil(h / STRIDE) * 2
  if (samples.length / ringTotal < BORDER_OPAQUE_RATIO) return png

  samples.sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b))
  const bg = samples[Math.floor(samples.length / 2)] ?? { r: 128, g: 128, b: 128 }

  // Flood fill from every border pixel. A pixel joins the background only
  // when it is reachable from the border through background-colored pixels —
  // background-colored regions inside the subject are enclosed by subject
  // pixels and never reached.
  const visited = new Uint8Array(w * h)
  const queueX = new Int32Array(w * h)
  const queueY = new Int32Array(w * h)
  let head = 0
  let tail = 0
  const enqueue = (x: number, y: number): void => {
    const idx = y * w + x
    if (visited[idx] === 1) return
    visited[idx] = 1
    queueX[tail] = x
    queueY[tail] = y
    tail++
  }
  const colorAt = (x: number, y: number): { r: number; g: number; b: number } => {
    const i = px(x, y)
    return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 }
  }
  for (let x = 0; x < w; x++) {
    enqueue(x, 0)
    enqueue(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    enqueue(0, y)
    enqueue(w - 1, y)
  }

  while (head < tail) {
    const cx = queueX[head] ?? 0
    const cy = queueY[head] ?? 0
    head++
    const current = colorAt(cx, cy)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const idx = ny * w + nx
        if (visited[idx] === 1) continue
        const ni = px(nx, ny)
        if ((data[ni + 3] ?? 0) === 0) {
          visited[idx] = 1 // already transparent — part of the background region
          continue
        }
        const neighbor = { r: data[ni] ?? 0, g: data[ni + 1] ?? 0, b: data[ni + 2] ?? 0 }
        const toBg = rgbDist(neighbor.r, neighbor.g, neighbor.b, bg.r, bg.g, bg.b)
        const toLocal = rgbDist(neighbor.r, neighbor.g, neighbor.b, current.r, current.g, current.b)
        if (toBg < BG_TOLERANCE || toLocal < LOCAL_TOLERANCE) enqueue(nx, ny)
      }
    }
  }

  // Clear the flood-filled region.
  for (let idx = 0; idx < w * h; idx++) {
    if (visited[idx] === 1) data[idx * 4 + 3] = 0
  }

  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}
