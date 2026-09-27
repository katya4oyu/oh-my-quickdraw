// Board import from JSON: the core's clipboard payload
// ({ quickdraw: 1, shapes, assets }), which quickdraw-export also writes.
// Files are untrusted, and an imported shape syncs to every peer, so the whole
// payload is validated first — one bad shape rejects the file — against the
// core's own style ids, and image assets must be inline raster data URLs.
// Types added by other packages (e.g. quickdraw-markdown) are accepted only
// when the caller passes their validator: { types: { markdown: validateMarkdown } }.
import { COLOR_IDS, SIZE_IDS, DASH_IDS, FILL_IDS, GEO_IDS, FONTS, newId } from '@quickdrawjs/core'

const TYPES = ['draw', 'highlight', 'geo', 'arrow', 'line', 'text', 'note', 'image']
const ENUMS = { color: COLOR_IDS, size: SIZE_IDS, labelSize: SIZE_IDS, dash: DASH_IDS, fill: FILL_IDS, geo: GEO_IDS, font: Object.keys(FONTS) }
const NUMBERS = ['w', 'h', 'dx', 'dy', 'bend', 'scale']
const STRINGS = ['text', 'label', 'align', 'assetId']
const BOOLEANS = ['done', 'autosize', 'isPen']
const REQUIRED = { draw: ['pts'], highlight: ['pts'], geo: ['w', 'h'], arrow: ['dx', 'dy'], line: ['dx', 'dy'], text: ['text'], note: ['text'], image: ['w', 'h', 'assetId'] }
const IMAGE_SRC = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/
export const MAX_SHAPES = 5000
export const MAX_FILE_BYTES = 25 * 1024 * 1024

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

function checkShape(s, assets, types) {
  if (!isObject(s) || typeof s.id !== 'string' || s.typeName !== 'shape') return 'not a shape record'
  const custom = Object.hasOwn(types, s.type) ? types[s.type] : null
  if (!TYPES.includes(s.type) && !custom) return `unknown shape type ${JSON.stringify(s.type)}`
  if (![s.x, s.y, s.z].every(finite) || (s.rot != null && !finite(s.rot))) return 'bad position'
  const p = s.props
  if (!isObject(p)) return 'missing props'
  if (custom) {
    try { return custom(s) || null } catch (e) { return e.message } // (shape) -> error message, or null when valid
  }
  for (const k of REQUIRED[s.type]) if (p[k] == null) return `missing props.${k}`
  for (const [k, ids] of Object.entries(ENUMS)) if (p[k] != null && !ids.includes(p[k])) return `bad props.${k}`
  for (const k of NUMBERS) if (p[k] != null && !finite(p[k])) return `bad props.${k}`
  for (const k of STRINGS) if (p[k] != null && typeof p[k] !== 'string') return `bad props.${k}`
  for (const k of BOOLEANS) if (p[k] != null && typeof p[k] !== 'boolean') return `bad props.${k}`
  if (p.pts != null && !(Array.isArray(p.pts) && p.pts.length % 3 === 0 && p.pts.every(finite))) return 'bad props.pts'
  if (s.type === 'image' && !assets[p.assetId]) return 'image asset missing'
  return null
}

function checkAsset(a) {
  if (!isObject(a) || typeof a.id !== 'string' || a.typeName !== 'asset') return 'not an asset record'
  if (typeof a.src !== 'string' || !IMAGE_SRC.test(a.src)) return 'asset is not an inline png/jpeg/gif/webp image'
  if (!finite(a.w) || !finite(a.h)) return 'bad asset size'
  return null
}

// Validates a parsed payload; returns { shapes, assets } or throws.
// types: { [type]: (shape) => error | null } for shape types beyond the core's
export function parseJSON(data, { types = {} } = {}) {
  if (!isObject(data) || data.quickdraw !== 1 || !Array.isArray(data.shapes)) throw new Error('Not a Quickdraw file')
  if (data.shapes.length > MAX_SHAPES) throw new Error(`Too many shapes (max ${MAX_SHAPES})`)
  const all = isObject(data.assets) ? data.assets : {}
  const assets = {}
  for (const s of data.shapes) {
    const a = s?.type === 'image' && all[s.props?.assetId]
    if (!a) continue
    const err = checkAsset(a)
    if (err) throw new Error(`Invalid asset ${JSON.stringify(a.id)}: ${err}`)
    assets[s.props.assetId] = a
  }
  data.shapes.forEach((s, i) => {
    const err = checkShape(s, assets, types)
    if (err) throw new Error(`Invalid shape #${i + 1}: ${err}`)
  })
  return { shapes: data.shapes, assets }
}

// Adds the payload's shapes to the board as new records (fresh ids, stacked on
// top, centered in the view) in one undoable step, and selects them.
// Returns the new shape ids; throws when the payload is invalid.
export function importJSON(editor, data, opts) {
  const { shapes, assets } = parseJSON(data, opts)
  if (!shapes.length) return []
  const { store } = editor
  const xs = shapes.map((s) => s.x), ys = shapes.map((s) => s.y)
  const view = editor.viewportPageBounds()
  const dx = view.x + view.w / 2 - (Math.min(...xs) + Math.max(...xs)) / 2
  const dy = view.y + view.h / 2 - (Math.min(...ys) + Math.max(...ys)) / 2
  const assetIds = {}
  const ids = []
  let z = store.maxZ()
  store.transact(() => {
    for (const a of Object.values(assets)) {
      assetIds[a.id] = newId('asset')
      store.put({ ...a, id: assetIds[a.id] })
    }
    for (const s of [...shapes].sort((a, b) => a.z - b.z)) {
      const id = newId()
      ids.push(id)
      store.put({
        ...s, id, x: s.x + dx, y: s.y + dy, z: ++z,
        props: s.type === 'image' ? { ...s.props, assetId: assetIds[s.props.assetId] } : s.props,
      })
    }
  })
  if (editor.tool !== 'select') editor.setTool('select')
  editor.setSelection(ids)
  return ids
}

// A toolbar item (the plain-object shape quickdraw-toolbar takes) for a menu
// of board actions; opts are openJSON's, e.g. { types }.
const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export function importTool(opts) {
  return {
    id: 'import-json', title: 'Import JSON…',
    icon: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
    run: ({ editor }) => openJSON(editor, opts).catch((e) => alert(`Import failed: ${e.message}`)),
  }
}

// Asks the user for a .json file and imports it. Resolves to the new ids
// ([] when cancelled); rejects on an unreadable or invalid file.
export function openJSON(editor, opts) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files[0]
      if (!file) return resolve([])
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error(`File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`)
        let data
        try { data = JSON.parse(await file.text()) } catch { throw new Error('Not a JSON file') }
        resolve(importJSON(editor, data, opts))
      } catch (e) { reject(e) }
    }
    input.oncancel = () => resolve([])
    input.click()
  })
}
