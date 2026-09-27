// The core measures text with a canvas (OffscreenCanvas, or a DOM canvas).
// Node has neither, so text and note bounds would throw; this installs a
// stand-in that estimates widths — close enough to lay things out, and the
// browsers that draw the board measure for real.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

export function estimateWidth(font, text) {
  const size = parseFloat(String(font).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16)
  let w = 0
  for (const ch of text) w += WIDE.test(ch) ? size : size * 0.56
  return w
}

export function installMeasure() {
  if (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined') return false
  const ctx = {
    font: '16px sans-serif',
    measureText(text) {
      const size = parseFloat(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16)
      return { width: estimateWidth(this.font, text), fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 }
    },
  }
  globalThis.OffscreenCanvas = class { getContext() { return ctx } }
  return true
}
