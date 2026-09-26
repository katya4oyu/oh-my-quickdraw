// Board export as JSON. The format is the payload the core already writes to
// the clipboard — { quickdraw: 1, shapes, assets } — so an exported file's
// contents paste straight into any Quickdraw board.

// ids: the shapes to export (e.g. editor.selection); defaults to the whole board.
// Shapes come out back-to-front, with only the image assets they reference.
export function exportJSON(store, { ids = null } = {}) {
  const shapes = (ids ? [...ids].map((id) => store.get(id)) : store.shapes())
    .filter((s) => s && s.typeName !== 'asset')
    .sort((a, b) => a.z - b.z)
  const assets = {}
  for (const s of shapes) {
    const a = s.type === 'image' && store.asset(s.props.assetId)
    if (a) assets[a.id] = a
  }
  return { quickdraw: 1, shapes, assets }
}

// Saves the export as a .json file, named like the core's PNG export.
export function downloadJSON(editor, { ids = null } = {}) {
  const data = exportJSON(editor.store, { ids })
  if (!data.shapes.length) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  a.download = 'quickdraw-' + new Date().toISOString().slice(0, 19).replaceAll(':', '.') + '.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
