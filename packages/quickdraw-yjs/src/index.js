// Binds a Quickdraw Store to a Yjs document. Each record lives in a Y.Map
// under its id, replaced whole on update (records are immutable in the store),
// so concurrent edits resolve last-writer-wins per record.
// Local edits (source 'user', which includes undo/redo) go to Yjs; Yjs
// changes from elsewhere come back as 'remote' diffs, which the store keeps
// out of local history and which this binding never echoes.

export function bindYjs(store, ydoc, { name = 'quickdraw' } = {}) {
  const ymap = ydoc.getMap(name)
  const origin = {} // tags our own Yjs transactions

  // initial sync: an empty shared doc takes the local board, otherwise the
  // shared doc wins
  if (ymap.size === 0) {
    ydoc.transact(() => {
      for (const rec of store.all()) ymap.set(rec.id, rec)
    }, origin)
  } else {
    store.loadSnapshot({ document: { store: ymap.toJSON() } }, 'remote')
  }

  const unlisten = store.listen((diff) => {
    ydoc.transact(() => {
      for (const [id, rec] of Object.entries(diff.added)) ymap.set(id, rec)
      for (const [id, [, to]] of Object.entries(diff.updated)) ymap.set(id, to)
      for (const id of Object.keys(diff.removed)) ymap.delete(id)
    }, origin)
  }, { source: 'user' })

  const observer = (event) => {
    if (event.transaction.origin === origin) return
    const diff = { added: {}, removed: {}, updated: {} }
    for (const [id, change] of event.changes.keys) {
      const prev = store.get(id)
      if (change.action === 'delete') {
        if (prev) diff.removed[id] = prev
      } else {
        const rec = ymap.get(id)
        if (prev) diff.updated[id] = [prev, rec]
        else diff.added[id] = rec
      }
    }
    store.applyDiff(diff, 'remote')
  }
  ymap.observe(observer)

  return () => {
    unlisten()
    ymap.unobserve(observer)
  }
}
