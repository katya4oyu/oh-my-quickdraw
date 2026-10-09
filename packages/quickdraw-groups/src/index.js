// Groups for Quickdraw: shapes that are selected and moved as one, built from
// plain records. A member carries `groupId` (and `groupName`, when the group
// has one), and its own id as `groupSelf`: a copy keeps these fields under a new
// id, which is how it is recognized (as `frameKey` does for frames). A group is flat (a shape is in one group) and holds shapes, not
// frames: a frame already holds what is in it.
//
// bindGroups(store): moving one member moves the others (unless they moved in
// the same change); a copy of a group's members is a group of its own. It works
// on any store, so agents and the CLI get it too.
// bindGroupSelection(editor): selecting a member selects the group, shown by a
// dashed outline and a tag with its name ("Group" when it has none) round each
// group selected whole; Cmd/Ctrl+G groups the selection, Shift+Cmd/Ctrl+G ungroups it.
import { pageBounds } from '@quickdrawjs/core'
import { isFrame } from 'quickdraw-frames'

const shapeOf = (rec) => rec?.typeName === 'shape'
/** Whether a shape may be in a group: not a frame or its title, not an arrow's label (it follows its arrow). */
export const groupable = (s) => shapeOf(s) && !isFrame(s) && !s.isFrameTitle && !s.labelOf && !s.layoutId && !s.cellOf

export const groupIdOf = (rec) => rec?.groupId ?? null

/** The members of a group: shapes, in the order they were put. */
export const groupMembers = (store, groupId) => (groupId ? store.shapes().filter((s) => s.groupId === groupId) : [])

/** Every group on the board: { id, name?, members: [shape ids] }. */
export function groups(store) {
  const out = new Map()
  for (const s of store.shapes()) {
    if (!s.groupId) continue
    const g = out.get(s.groupId) ?? { id: s.groupId, members: [] }
    if (s.groupName && !g.name) g.name = s.groupName
    g.members.push(s.id)
    out.set(s.groupId, g)
  }
  return [...out.values()]
}

let counter = 0
const newGroupId = () => 'group:' + Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 5)

/** Groups shapes (by id): they were in other groups, they are in this one now. Returns the group's id. */
export function groupShapes(store, ids, { name, id } = {}) {
  const list = [...new Set(ids)].map((i) => store.get(i))
  if (list.length < 2) throw new Error('a group needs two shapes or more')
  for (const s of list) {
    if (!shapeOf(s)) throw new Error(`group: no shape ${JSON.stringify(s?.id)}`)
    if (!groupable(s)) throw new Error(`group: ${s.id} is a frame, a frame's title or an arrow's label: a group holds other shapes`)
  }
  const gid = id ?? newGroupId()
  const label = name ? String(name).slice(0, 60) : undefined
  store.transact(() => {
    for (const s of list) {
      const { groupName, ...rest } = s
      store.put({ ...rest, groupId: gid, groupSelf: s.id, ...(label ? { groupName: label } : {}) })
    }
  })
  return gid
}

/** Takes a group apart (by its id, or the id of a member): its members stay where they are. Returns the ids freed. */
export function ungroup(store, idOrGroup) {
  const gid = store.get(idOrGroup)?.groupId ?? idOrGroup
  const members = groupMembers(store, gid)
  if (!members.length) throw new Error(`ungroup: ${idOrGroup} is not a group, nor in one`)
  store.transact(() => {
    for (const s of members) { const { groupId, groupName, groupSelf, ...rest } = s; store.put(rest) }
  })
  return members.map((s) => s.id)
}

const sameProps = (a, b) => JSON.stringify(a.props) === JSON.stringify(b.props) && a.rot === b.rot

/** Members follow a member that moved (not resized or turned), unless they moved too; a copy of a group's members is a group of its own. Returns an unbind. */
export function bindGroups(store) {
  let busy = false
  return store.listen((diff) => {
    if (busy) return
    const touched = new Set([...Object.keys(diff.added), ...Object.keys(diff.updated), ...Object.keys(diff.removed)])
    const follow = new Map() // group id → { dx, dy }
    for (const [id, [from, to]] of Object.entries(diff.updated)) {
      if (!to?.groupId || to.groupId !== from.groupId || !store.has(id)) continue
      const dx = to.x - from.x, dy = to.y - from.y
      if ((dx || dy) && sameProps(from, to) && !follow.has(to.groupId)) follow.set(to.groupId, { dx, dy })
    }
    // members added under another id than their own `groupSelf`: copies, so a group of their own
    const fresh = new Map()
    for (const rec of Object.values(diff.added)) {
      if (!rec.groupId || rec.groupSelf === rec.id || !store.has(rec.id)) continue
      fresh.set(rec.groupId, [...(fresh.get(rec.groupId) ?? []), rec.id])
    }
    const copies = [...fresh]
    if (!follow.size && !copies.length) return
    busy = true
    try {
      store.transact(() => {
        for (const [gid, ids] of copies) {
          const to = 'group:copy-' + [...ids].sort()[0] // the same on every page
          for (const id of ids) store.update(id, { groupId: to, groupSelf: id })
          follow.delete(gid)
        }
        if (follow.size) {
          for (const s of store.shapes()) {
            const d = s.groupId && follow.get(s.groupId)
            if (d && !touched.has(s.id)) store.update(s.id, { x: s.x + d.dx, y: s.y + d.dy })
          }
        }
      })
    } finally { busy = false }
  })
}

const PAD = 10 // the outline, this far outside the selection box (screen px)

// a dashed outline and a name tag round each group the selection holds whole, over the board
function groupMarks(editor) {
  const { store } = editor
  if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !editor.pageToScreen) return { update() {}, remove() {} }
  const layer = document.createElement('div')
  layer.className = 'qd-group-marks'
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden'
  editor.container.append(layer)
  let frame = 0
  const draw = () => {
    frame = 0
    layer.replaceChildren()
    const sel = editor.selection
    if (sel.size < 2 || editor.tool !== 'select' || editor.editing) return // as the selection box: only with select, not while typing
    const color = editor.theme?.selection ?? '#2f80ec'
    const seen = new Set()
    for (const id of sel) {
      const gid = store.get(id)?.groupId
      if (!gid || seen.has(gid)) continue
      seen.add(gid)
      const members = groupMembers(store, gid)
      if (members.length < 2 || members.some((m) => !sel.has(m.id))) continue
      let b = null
      for (const m of members) {
        const r = pageBounds(m)
        b = b ? { x: Math.min(b.x, r.x), y: Math.min(b.y, r.y), r: Math.max(b.r, r.x + r.w), b: Math.max(b.b, r.y + r.h) } : { x: r.x, y: r.y, r: r.x + r.w, b: r.y + r.h }
      }
      const p = editor.pageToScreen(b.x, b.y), q = editor.pageToScreen(b.r, b.b)
      const left = p.x - PAD, top = p.y - PAD, width = q.x - p.x + PAD * 2, height = q.y - p.y + PAD * 2
      const box = document.createElement('div')
      box.style.cssText = `position:absolute;box-sizing:border-box;border-radius:10px;border:1.5px dashed ${color};left:${left}px;top:${top}px;width:${width}px;height:${height}px`
      const tag = document.createElement('div')
      tag.textContent = members.find((m) => m.groupName)?.groupName ?? 'Group'
      tag.style.cssText = `position:absolute;left:${left}px;top:${top - 22}px;max-width:${Math.max(60, Math.min(240, width))}px;height:18px;padding:0 7px;border-radius:9px;box-sizing:border-box;`
        + `font:600 11px/18px system-ui,-apple-system,sans-serif;letter-spacing:.02em;color:#fff;background:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
      layer.append(box, tag)
    }
  }
  const update = () => { if (!frame) frame = requestAnimationFrame(draw) }
  return { update, remove() { cancelAnimationFrame(frame); layer.remove() } }
}

/** What the page does with groups: selecting a member selects the group, outlined with its name (shift-click on one takes the group off the selection); Cmd/Ctrl+G groups the selection, with Shift ungroups. Returns an unbind. */
export function bindGroupSelection(editor) {
  const { store } = editor
  let last = new Set(editor.selection), expanding = false, shift = false
  const c = editor.container
  const down = (e) => { shift = !!e.shiftKey }
  c.addEventListener('pointerdown', down, true)
  const widen = () => {
    if (expanding) return
    const now = editor.selection
    const next = new Set(now)
    const gone = new Set()
    if (shift) for (const id of last) if (!now.has(id)) { const g = store.get(id)?.groupId; if (g) gone.add(g) }
    for (const id of now) {
      const g = store.get(id)?.groupId
      if (!g) continue
      if (gone.has(g)) next.delete(id)
      else for (const m of groupMembers(store, g)) next.add(m.id)
    }
    for (const g of gone) for (const m of groupMembers(store, g)) next.delete(m.id)
    if (next.size !== now.size || [...next].some((id) => !now.has(id))) {
      expanding = true
      try { editor.setSelection([...next]) } finally { expanding = false }
    }
    last = new Set(editor.selection)
  }
  const marks = groupMarks(editor)
  const off = editor.on('selection', () => { widen(); marks.update() })
  const offs = ['camera', 'change', 'theme', 'tool', 'edit'].map((ev) => editor.on(ev, marks.update))
  const key = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key?.toLowerCase() !== 'g' || e.altKey) return
    if (/^(input|textarea)$/i.test(e.target?.tagName ?? '') || e.target?.isContentEditable) return
    const ids = [...editor.selection]
    if (!ids.length) return
    e.preventDefault()
    try {
      if (e.shiftKey) { for (const g of new Set(ids.map((i) => store.get(i)?.groupId).filter(Boolean))) ungroup(store, g) }
      else {
        const ok = ids.filter((i) => groupable(store.get(i)))
        if (ok.length > 1) groupShapes(store, ok)
      }
    } catch (err) { console.warn('group failed', err) }
    last = new Set(editor.selection)
    marks.update()
  }
  document.addEventListener('keydown', key)
  return () => { off(); offs.forEach((f) => f()); marks.remove(); c.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key) }
}
