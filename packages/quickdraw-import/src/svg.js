// SVG as an image on the board. The core takes an SVG file as an image (an
// image/svg+xml data URL, drawn on the canvas like any image, where its
// scripts and links do nothing); these are the pieces around it:
// - an SVG's size, from width/height or else its viewBox — an SVG with only a
//   viewBox has no size of its own, and an image without one does not land;
// - SVG code pasted as text (Figma's "Copy as SVG", a file's source) becomes
//   an image too (bindSvgPaste).
// No DOM needed but for bindSvgPaste: the CLI uses the rest in Node.

// what may come before the <svg> tag: an XML declaration, comments, a doctype
const PROLOGUE = /^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i

/** Whether a text is SVG code (an <svg> element, maybe after an XML prologue). */
export function isSvgText(text) {
  if (typeof text !== 'string') return false
  const rest = text.replace(PROLOGUE, '')
  return /^<svg[\s>]/i.test(rest) && /<\/svg\s*>\s*$/i.test(rest)
}

// the root <svg …> tag: [whole tag, its attributes]
function rootTag(text) {
  const m = text.replace(PROLOGUE, '').match(/^<svg\b([^>]*)>/i)
  return m ? { tag: m[0], attrs: m[1] } : null
}
const attr = (attrs, name) => attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find((v) => v != null)
// a length in px: a plain number or px; anything else (%, em) is not a size
const px = (v) => { const m = v?.trim().match(/^(\d+(?:\.\d+)?)(px)?$/i); return m ? Number(m[1]) : null }

/** An SVG's size: its width and height, else its viewBox's; null when it says neither. */
export function svgSize(text) {
  const root = rootTag(String(text ?? ''))
  if (!root) return null
  const w = px(attr(root.attrs, 'width')), h = px(attr(root.attrs, 'height'))
  const box = attr(root.attrs, 'viewBox')?.trim().split(/[\s,]+/).map(Number)
  const vb = box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? { w: box[2], h: box[3] } : null
  if (w && h) return { w, h }
  if (w && vb) return { w, h: (w * vb.h) / vb.w }
  if (h && vb) return { w: (h * vb.w) / vb.h, h }
  return vb
}

/**
 * The SVG with a width and height of its own, so it lands as an image: from
 * its viewBox (the longer side `max` at most), else 300 × 150 (what a browser
 * gives an SVG with neither). One that has both is returned as it is.
 */
export function sizedSvg(text, { max = 1024 } = {}) {
  const root = rootTag(text)
  if (!root) throw new Error('not SVG')
  const hasW = px(attr(root.attrs, 'width')), hasH = px(attr(root.attrs, 'height'))
  if (hasW && hasH) return text
  let size = svgSize(text) ?? { w: 300, h: 150 }
  const k = Math.min(1, max / Math.max(size.w, size.h))
  size = { w: Math.round(size.w * k * 100) / 100, h: Math.round(size.h * k * 100) / 100 }
  const attrs = root.attrs.replace(/(?:^|\s)(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
  return text.replace(root.tag, `<svg width="${size.w}" height="${size.h}"${attrs}>`)
}

/** An SVG as a data URL (UTF-8, base64), for an image asset. */
export function svgDataUrl(text) {
  const bytes = new TextEncoder().encode(text)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return 'data:image/svg+xml;base64,' + btoa(s)
}

/**
 * SVG code pasted onto the board becomes an image, as an SVG file would (the
 * core's importImageBlobs: same place, size and selection). Pasting from a
 * menu or a phone comes as a paste event; ⌘V / Ctrl+V the core reads from the
 * clipboard itself, so this reads it too, and takes the text only when the
 * clipboard has no image (the core takes that one). Returns an unbind.
 */
export function bindSvgPaste(editor, { container = editor.container } = {}) {
  const typing = () => {
    const a = document.activeElement
    return !!editor.editing || (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))
  }
  const take = (text) => {
    if (!isSvgText(text)) return false
    editor.importImageBlobs([new Blob([sizedSvg(text)], { type: 'image/svg+xml' })])
    return true
  }
  const onPaste = (e) => {
    if (editor.readonly || typing()) return
    const data = e.clipboardData
    if ([...(data?.files || [])].some((f) => f.type.startsWith('image/'))) return // the core's
    if (take(data?.getData('text/plain') ?? '')) { e.preventDefault(); e.stopPropagation() }
  }
  const onKey = async (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'v' || e.shiftKey || e.altKey) return
    if (editor.readonly || typing()) return
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read()
        if (items.some((it) => it.types.some((t) => t.startsWith('image/')))) return // the core's
      }
      take(await navigator.clipboard.readText())
    } catch {} // no clipboard here, or not allowed
  }
  container.addEventListener('paste', onPaste, true)
  container.addEventListener('keydown', onKey, true)
  return () => {
    container.removeEventListener('paste', onPaste, true)
    container.removeEventListener('keydown', onKey, true)
  }
}
