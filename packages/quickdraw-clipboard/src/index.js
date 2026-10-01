// Copy and paste on a board through the browser's own clipboard events, which
// need no permission and work in any browser, on plain http too — where
// navigator.clipboard, which the core's ⌘C / ⌘V use, is not there.
//
// ⌘C, ⌘X and ⌘V on the board are taken before the core sees them (a capture
// listener on the window), and the focus goes for a moment to a hidden
// textarea: some browsers send copy, cut and paste events only to something
// editable. Nothing in the core changes.
// - copy / cut: the shapes for a board (their JSON in text/html,
//   data-quickdraw) and their text for anywhere else (text/plain);
// - paste: images (the core's importImageBlobs), a board's shapes (checked by
//   quickdraw-import first), SVG code (as an image), any other text (a note).
// A paste that comes as an event of its own (a phone, a menu) is handled too.
import { newId, pageBounds } from '@quickdrawjs/core'
import { parseJSON, isSvgText, sizedSvg } from 'quickdraw-import'

const toBase64 = (text) => { const b = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
const escape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A shape's text, as it reads: a note's or a label, a card's Markdown, a ticket's title. */
export const shapeText = (s) => String(s.props?.text || s.props?.label || s.props?.md || s.props?.title || '')

/** What copying these shapes puts on the clipboard: { html, text } (null for none). */
export function clipboardOf(store, ids, { textOf = shapeText } = {}) {
  const shapes = [], assets = {}
  for (const id of ids) {
    const s = store.get(id)
    if (!s || s.typeName !== 'shape') continue
    shapes.push(s)
    const a = s.props?.assetId && store.asset(s.props.assetId)
    if (a) assets[a.id] = a
  }
  if (!shapes.length) return null
  const json = JSON.stringify({ quickdraw: 1, shapes, assets })
  const text = shapes.map(textOf).filter((t) => t.trim()).join('\n\n')
  return {
    html: `<meta charset="utf-8"><div data-quickdraw="${toBase64(json)}">${escape(text).replace(/\n/g, '<br>')}</div>`,
    text: text || json, // shapes with no text: their JSON, so a board still takes them
  }
}

/** The board payload in what was copied ({ quickdraw: 1, shapes, assets }), or null: from text/html, else text/plain JSON (the core's own copies). */
export function payloadIn(html, text) {
  try {
    const m = html?.match(/data-quickdraw="([A-Za-z0-9+/=]+)"/)
    const data = JSON.parse(m ? fromBase64(m[1]) : text)
    return data && data.quickdraw === 1 && Array.isArray(data.shapes) ? data : null
  } catch { return null }
}

/**
 * Puts a board's shapes in, checked first (quickdraw-import's parseJSON;
 * `types`: validators for other packages' shapes): a little down and right of
 * where they were when that is in view, else in the middle of it. Selects them.
 */
export function pasteShapes(editor, data, { types } = {}) {
  const { shapes, assets } = parseJSON(data, { types })
  if (!shapes.length) return []
  const { store } = editor
  const view = editor.viewportPageBounds()
  const bs = shapes.map((s) => pageBounds(s))
  const box = { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)) }
  box.w = Math.max(...bs.map((b) => b.x + b.w)) - box.x
  box.h = Math.max(...bs.map((b) => b.y + b.h)) - box.y
  const inView = box.x < view.x + view.w && box.x + box.w > view.x && box.y < view.y + view.h && box.y + box.h > view.y
  const dx = inView ? 16 : view.x + view.w / 2 - (box.x + box.w / 2)
  const dy = inView ? 16 : view.y + view.h / 2 - (box.y + box.h / 2)
  const assetIds = {}, ids = []
  let z = store.maxZ()
  store.transact(() => {
    for (const a of Object.values(assets)) store.put({ ...a, id: assetIds[a.id] = newId('asset') })
    for (const s of [...shapes].sort((a, b) => a.z - b.z)) {
      const id = newId()
      ids.push(id)
      store.put({ ...s, id, x: s.x + dx, y: s.y + dy, z: ++z,
        props: s.props.assetId ? { ...s.props, assetId: assetIds[s.props.assetId] ?? s.props.assetId } : s.props })
    }
  })
  if (editor.tool !== 'select') editor.setTool('select')
  editor.setSelection(ids)
  return ids
}

/** Text pasted from elsewhere, as a note in the middle of the view. Returns its id. */
export function pasteNote(editor, text) {
  const t = String(text).replace(/\r\n?/g, '\n').trim().slice(0, 4000)
  if (!t) return null
  const v = editor.viewportPageBounds()
  const id = newId()
  editor.store.put({ id, typeName: 'shape', type: 'note', x: Math.round(v.x + v.w / 2 - 100), y: Math.round(v.y + v.h / 2 - 100), rot: 0, z: editor.store.maxZ() + 1,
    props: { text: t, color: 'yellow', size: 'm', font: 'draw', scale: 1 } })
  if (editor.tool !== 'select') editor.setTool('select')
  editor.setSelection([id])
  return id
}

const STYLE = `
.qdc-sheet{position:absolute;left:50%;top:calc(64px + env(safe-area-inset-top));transform:translateX(-50%);width:min(320px,calc(100% - 24px));box-sizing:border-box;
  padding:12px;border-radius:14px;background:var(--qd-pop-bg,#fff);border:1px solid var(--qd-border,#ddd);box-shadow:var(--qd-pop-shadow,0 6px 24px rgba(0,0,0,.15));
  color:var(--qd-ink-strong,#222);font:13px/1.45 system-ui,-apple-system,sans-serif;display:grid;gap:8px;pointer-events:auto;z-index:2}
.qdc-sheet[hidden]{display:none}
.qdc-sheet textarea{box-sizing:border-box;width:100%;height:84px;resize:none;border:1.5px dashed var(--qd-ink-soft,#888);border-radius:10px;padding:10px;
  font:15px system-ui,-apple-system,sans-serif;background:transparent;color:var(--qd-ink-strong,#222);outline:none;text-align:center}
.qdc-sheet .qdc-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.qdc-sheet .qdc-hint{color:var(--qd-ink-soft,#777);font-size:12px}
.qdc-sheet button{all:unset;cursor:pointer;padding:4px 12px;border-radius:999px;border:1px solid var(--qd-border,#ddd)}
`
function injectStyle() {
  if (document.getElementById('qdc-style')) return
  document.head.append(Object.assign(document.createElement('style'), { id: 'qdc-style', textContent: STYLE }))
}

/**
 * Copy and paste for a board. types: validators for other packages' shapes,
 * as quickdraw-import takes them; text(editor, text): what pasted text from
 * elsewhere becomes (a note by default); textOf(shape): a shape's text when
 * copied out. Returns { copy(), paste(), destroy() }: copy and paste for a
 * button (a phone has no ⌘C / ⌘V; see clipboardTools).
 */
export function createClipboard(editor, { types = {}, text = pasteNote, textOf = shapeText } = {}) {
  injectStyle()
  const container = editor.container
  const ui = container.querySelector('.qd-ui') || container
  const area = document.createElement('textarea')
  area.className = 'qd-clipboard'
  area.setAttribute('aria-hidden', 'true')
  area.tabIndex = -1
  Object.assign(area.style, { position: 'fixed', left: '-10000px', top: '0', width: '1px', height: '1px', opacity: '0' })
  container.append(area)

  // a phone's paste: the system's own Paste, which it offers only on a field — this one
  const sheet = document.createElement('div')
  sheet.className = 'qdc-sheet'
  sheet.hidden = true
  const field = document.createElement('textarea')
  field.setAttribute('inputmode', 'none') // no keyboard: only the Paste it offers
  field.placeholder = 'Press and hold here, then Paste'
  field.setAttribute('aria-label', 'Paste here')
  const row = document.createElement('div')
  row.className = 'qdc-row'
  const hint = Object.assign(document.createElement('span'), { className: 'qdc-hint', textContent: 'Text, an image, SVG or shapes copied from a board' })
  const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' })
  cancel.onclick = () => closeSheet()
  row.append(hint, cancel)
  sheet.append(field, row)
  ui.append(sheet)
  for (const type of ['keydown', 'keyup', 'pointerdown', 'wheel']) sheet.addEventListener(type, (e) => e.stopPropagation())
  field.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet() })
  field.addEventListener('paste', (e) => { e.preventDefault(); e.stopPropagation(); closeSheet(); take(fromEvent(e.clipboardData)) })
  const closeSheet = () => { sheet.hidden = true; field.value = ''; field.blur() }

  const typing = (el) => !!editor.editing || (el && el !== area && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
  const back = () => { if (document.activeElement === area) container.focus({ preventScroll: true }) }
  const toHidden = () => {
    area.value = '​' // something selected, so copy and cut happen
    area.focus({ preventScroll: true })
    area.select()
  }

  // ⌘C / ⌘X / ⌘V on the board: to the hidden textarea, where the browser does the rest
  function onKey(e) {
    const k = e.key?.toLowerCase()
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || !['c', 'x', 'v'].includes(k)) return
    if (editor.readonly || !container.contains(document.activeElement) || typing(document.activeElement)) return
    if (k !== 'v' && !editor.selection.size) return
    e.stopImmediatePropagation() // not the core's: its navigator.clipboard is not on every page
    toHidden()
    setTimeout(back, 0)
  }
  function onCopy(e, cut) {
    const data = clipboardOf(editor.store, editor.selection, { textOf })
    if (!data) return
    e.preventDefault()
    e.clipboardData.setData('text/html', data.html)
    e.clipboardData.setData('text/plain', data.text)
    if (cut) editor.deleteSelection()
    back()
  }
  // what was pasted, from wherever: images, a board's shapes, SVG code, text
  function take({ files = [], html = '', plain = '' } = {}) {
    if (files.length) return editor.importImageBlobs(files)
    const data = payloadIn(html, plain)
    if (data) { try { pasteShapes(editor, data, { types }) } catch (err) { console.warn('paste:', err.message) } return }
    if (isSvgText(plain)) return editor.importImageBlobs([new Blob([sizedSvg(plain)], { type: 'image/svg+xml' })])
    if (plain.trim()) text(editor, plain)
  }
  const fromEvent = (cd) => ({ files: [...(cd?.files || [])].filter((f) => f.type.startsWith('image/')), html: cd?.getData('text/html') ?? '', plain: cd?.getData('text/plain') ?? '' })
  // any paste on the board: ⌘V through the textarea, or one of its own
  function onPaste(e) {
    if (editor.readonly || typing(e.target) || sheet.contains(e.target)) return
    if (!e.clipboardData) return
    e.preventDefault()
    e.stopPropagation() // the core's own paste takes images only; all of it is here
    back()
    take(fromEvent(e.clipboardData))
  }
  const onCopyEvt = (e) => onCopy(e, false), onCut = (e) => onCopy(e, true)
  addEventListener('keydown', onKey, true)
  area.addEventListener('copy', onCopyEvt)
  area.addEventListener('cut', onCut)
  container.addEventListener('paste', onPaste, true)

  return {
    /** Copies the selection (a button: the browser's copy, on any page). Resolves to whether it did. */
    copy() {
      if (!editor.selection.size) return false
      toHidden()
      let ok = false
      try { ok = document.execCommand('copy') } catch {}
      back()
      return ok
    },
    /**
     * Pastes (a button): straight from the clipboard where the page may read
     * it (https, localhost), else through a field the system offers its own
     * Paste on (a phone: press and hold).
     */
    async paste() {
      if (editor.readonly) return
      try {
        if (!navigator.clipboard?.read) throw new Error('no clipboard here')
        const files = [], parts = { html: '', plain: '' }
        for (const it of await navigator.clipboard.read()) {
          const img = it.types.find((t) => t.startsWith('image/'))
          if (img) files.push(new File([await it.getType(img)], 'pasted', { type: img }))
          if (it.types.includes('text/html')) parts.html = await (await it.getType('text/html')).text()
          if (it.types.includes('text/plain')) parts.plain = await (await it.getType('text/plain')).text()
        }
        if (!files.length && !parts.html && !parts.plain) throw new Error('nothing to paste')
        return take({ files, ...parts })
      } catch {
        sheet.hidden = false
        field.focus({ preventScroll: true })
      }
    },
    destroy() {
      removeEventListener('keydown', onKey, true)
      container.removeEventListener('paste', onPaste, true)
      area.remove()
      sheet.remove()
    },
  }
}

/** Copy and paste for a board by its keys (see createClipboard). Returns an unbind. */
export function bindClipboard(editor, opts) {
  return createClipboard(editor, opts).destroy
}

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const CLIPBOARD_ICONS = {
  paste: svg('<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>'),
  // to the clipboard (not the core's Duplicate, two squares): a clipboard, an arrow out of it
  copy: svg('<rect x="7" y="3" width="7" height="4" rx="1"/><path d="M14 5h1a2 2 0 0 1 2 2v3"/><path d="M7 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7"/><path d="M13 15h8"/><path d="m18 12 3 3-3 3"/>'),
}

/**
 * Toolbar items (quickdraw-toolbar's shape) for where there is no ⌘C / ⌘V
 * (a phone): Paste on the rail, Copy on a selected shape.
 */
export function clipboardTools(clip) {
  return {
    rail: [{ id: 'paste', title: 'Paste', icon: CLIPBOARD_ICONS.paste, run: () => clip.paste() }],
    context: [{ id: 'copy', title: 'Copy', icon: CLIPBOARD_ICONS.copy, when: () => true, run: () => clip.copy() }],
  }
}

/**
 * Copies a text, where navigator.clipboard is there or not (plain http):
 * through a hidden textarea and the browser's copy. Resolves to whether it did.
 */
export async function copyText(text) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true } } catch {}
  const ta = Object.assign(document.createElement('textarea'), { value: text })
  Object.assign(ta.style, { position: 'fixed', left: '-10000px', top: '0', opacity: '0' })
  document.body.append(ta)
  const was = document.activeElement
  ta.focus(); ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch {}
  ta.remove()
  was?.focus?.({ preventScroll: true })
  return ok
}
