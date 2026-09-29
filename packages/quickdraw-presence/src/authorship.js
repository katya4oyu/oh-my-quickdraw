// Who made what, and who changed it last: a shape carries `made: { by, at }`
// and `edited: { by, at }`, so everyone (agents reading the board too) can
// tell. Each page marks what its own person does (local edits only; a change
// that comes through sync was marked where it was made), in the same undo
// step as the edit. Undo and redo are not marked: they put a shape back as it
// was, marks included.
import { composeDiff } from '@quickdrawjs/core'

const isShape = (r) => r?.typeName === 'shape'
const MARKS = new Set(['made', 'edited'])
// whether a change is more than the marks themselves
const changed = (from, to) => Object.keys({ ...from, ...to }).some((k) => !MARKS.has(k) && JSON.stringify(from[k]) !== JSON.stringify(to[k]))

/**
 * Marks the shapes this page's person adds (`made`) and changes (`edited`).
 * `me()` says who that is ({ name }). Returns an unbind.
 */
export function bindAuthorship(store, { me, now = () => Date.now() }) {
  let busy = false
  return store.listen((diff) => {
    if (busy || store._applyingHistory) return
    const by = me()?.name
    if (!by) return
    const at = now()
    const marks = []
    for (const rec of Object.values(diff.added)) if (isShape(rec) && !rec.made) marks.push([rec.id, { made: { by, at } }])
    for (const [id, [from, to]] of Object.entries(diff.updated)) {
      if (!isShape(to) || !changed(from, to)) continue
      // a drag is many changes: marked once a second at most
      if (to.edited?.by === by && at - to.edited.at < 1000) continue
      marks.push([id, { edited: { by, at } }])
    }
    if (!marks.length) return
    const before = store.undos.length
    busy = true
    try { store.transact(() => { for (const [id, patch] of marks) if (store.has(id)) store.update(id, patch) }) } finally { busy = false }
    // outside a gesture our marks would be an undo step of their own: fold them into the edit
    if (store.undos.length === before + 1 && before > 0) {
      const ours = store.undos.pop()
      store.undos.push(composeDiff(store.undos.pop(), ours))
    }
  }, { source: 'user' })
}

/** Who made a shape and who changed it last, as data: { made_by?, edited_by? }. */
export function authorsOf(s) {
  const made = s?.made?.by ?? s?.agent?.name
  const edited = s?.edited?.by
  return { ...(made ? { made_by: made } : {}), ...(edited && edited !== made ? { edited_by: edited } : {}) }
}
