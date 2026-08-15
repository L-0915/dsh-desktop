/**
 * Automatic background removal for icon payloads.
 *
 * Icons uploaded as photos/screenshots (JPG-derived PNGs) carry an opaque
 * solid-color background (white/grey/etc.) that looks wrong on the desktop.
 * This module detects the dominant border color and fades pixels close to it
 * to transparent, with a soft edge so the subject keeps anti-aliased
 * contours. Transparent inputs (alpha already 0 on the border) pass through
 * untouched.
 *
 * @module dsh-desktop/background
 */

import sharp from 'sharp'

/** RGB distance below this means "background" (fully transparent). */
const BG_DISTANCE = 28
/** Distance band above BG_DISTANCE where alpha fades from 0 to 1. */
const FADE_BAND = 22

/** Euclidean RGB distance between two colors. */
function rgbDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/**
 * Remove a solid-color background from a PNG buffer.
 * @param png - PNG payload (any size; processed at its native resolution).
 * @returns the processed PNG buffer.
 */
export async function removeBackground(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const px = (x: number, y: number): number => (y * w + x) * 4

  // Sample the whole outer ring (every border pixel at 2px stride) and find
  // the dominant opaque color. This catches backgrounds even when the
  // corners are transparent (subject touches the frame) or the background is
  // only exposed along an edge.
  const samples: Array<{ r: number; g: number; b: number }> = []
  const stride = 2
  const ring = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let x = x0; x <= x1; x += stride) {
      for (const y of [y0, y1]) {
        const i = px(x, y)
        if ((data[i + 3] ?? 0) > 128) samples.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 })
      }
    }
    for (let y = y0; y <= y1; y += stride) {
      for (const x of [x0, x1]) {
        const i = px(x, y)
        if ((data[i + 3] ?? 0) > 128) samples.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 })
      }
    }
  }
  ring(0, 0, w - 1, h - 1)

  // An already-transparent image has few opaque border pixels (a cut-out
  // subject touches the frame only along its own silhouette). Only treat the
  // border as "background to remove" when opaque pixels dominate it — a
  // solid background fills the whole ring; a transparent cut-out does not.
  const ringTotal = Math.ceil((w / stride) * 2) + Math.ceil((h / stride) * 2)
  if (samples.length / ringTotal < 0.2) return png

  // Dominant color = median of the sampled border colors (robust to a
  // subject reaching the frame: the background is the majority).
  samples.sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b))
  const mid = samples[Math.floor(samples.length / 2)] ?? { r: 128, g: 128, b: 128 }
  const bg = mid

  // Fade each pixel near the background color to transparent.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = px(x, y)
      if ((data[i + 3] ?? 0) === 0) continue
      const dist = rgbDist(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, bg.r, bg.g, bg.b)
      if (dist < BG_DISTANCE) {
        data[i + 3] = 0
      } else if (dist < BG_DISTANCE + FADE_BAND) {
        const t = (dist - BG_DISTANCE) / FADE_BAND
        data[i + 3] = Math.round((data[i + 3] ?? 0) * t)
      }
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}
