// The toolbar's decisions, pure so they test without a DOM: which items
// show, and where the selection bar goes.

// item: { id, title, icon, run?(ctx), menu?: item[] | (ctx) => item[],
//         available?(editor), when?(shape, editor), checked?(ctx) } — or '-', a divider

// rail items the editor supports, without leading, trailing or doubled dividers
export function railItems(items, editor) {
  const out = []
  for (const it of items) {
    if (it === '-') { if (out.length && out.at(-1) !== '-') out.push('-'); continue }
    if (!it.available || it.available(editor)) out.push(it)
  }
  while (out.at(-1) === '-') out.pop()
  return out
}

// the selection bar's items: only for one selected shape, those whose `when` holds
export function contextItems(items, editor) {
  if (editor.selection.size !== 1) return []
  const shape = editor.store.get([...editor.selection][0])
  if (!shape) return []
  return railItems(items.filter((it) => it === '-' || (it.when ? it.when(shape, editor) : false)), editor)
}

// Where the selection bar goes, in container px: centred above the selection,
// below it when there is no room above, and always inside the container.
// sel: the selection's screen rect; bar and frame: { w, h }. The gap clears
// the core's rotate handle, 22px above the selection (and a frame's title).
export function placeBar(sel, bar, frame, { gap = 40, margin = 8 } = {}) {
  let top = sel.y - gap - bar.h
  let side = 'above'
  if (top < margin) {
    top = sel.y + sel.h + gap
    side = 'below'
  }
  top = Math.max(margin, Math.min(top, frame.h - bar.h - margin))
  const left = Math.max(margin, Math.min(sel.x + sel.w / 2 - bar.w / 2, frame.w - bar.w - margin))
  return { left, top, side }
}
