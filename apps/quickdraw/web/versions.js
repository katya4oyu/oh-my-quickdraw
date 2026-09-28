// A board's versions, over the board: keep it as it is now, and go back to a
// version (over the board, for everyone on it: the relay sends the change) or
// open one as a board of its own. Versions made before an AI request, and
// before a restore, are kept for you (the last 20).
const el = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); e.append(...children); return e }
const when = (at) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// `container`: the board's element, whose theme (the core's --qd-* variables) it takes
export function createVersions(boardId, container = document.body) {
  const base = `/api/boards/${boardId}/versions`
  const call = async (method, path, body) => {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || r.statusText)
    return data
  }
  const list = el('ul')
  const save = el('button', { type: 'button', className: 'primary', textContent: 'Keep this version' })
  const close = el('button', { type: 'button', textContent: 'Close' })
  const dialog = el('dialog', { className: 'versions' },
    el('header', {}, el('strong', { textContent: 'Versions' }), el('span', {}, save, ' ', close)), list)
  container.append(dialog)

  async function show() {
    let versions
    try { versions = await call('GET', base) } catch (e) { list.replaceChildren(el('li', { className: 'empty', textContent: e.message })); return }
    list.replaceChildren(...versions.map((v) => el('li', {},
      el('span', { className: 'name' + (v.auto ? ' auto' : ''), textContent: v.name, title: v.name }),
      el('span', { className: 'when', textContent: when(v.at) }),
      el('button', { type: 'button', textContent: 'Restore', title: 'Put the board back as it was then (for everyone on it)', onclick: async () => {
        if (!confirm(`Put the board back as it was at "${v.name}"? The board as it is now is kept as a version.`)) return
        try { await call('POST', `${base}/${v.id}/restore`, { as: 'board' }); dialog.close() } catch (e) { alert(e.message) }
      } }),
      el('button', { type: 'button', textContent: 'Open as board', onclick: async () => {
        try { location.href = '/b/' + (await call('POST', `${base}/${v.id}/restore`, { as: 'new' })).id } catch (e) { alert(e.message) }
      } }),
    )))
    if (!versions.length) list.append(el('li', { className: 'empty', textContent: 'No versions yet. Keep one, or ask the AI: a version is kept before each request.' }))
  }
  save.onclick = async () => {
    const name = prompt('Name this version', new Date().toLocaleString())
    if (name == null) return
    try { await call('POST', base, { name }); show() } catch (e) { alert(e.message) }
  }
  close.onclick = () => dialog.close()
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close() }) // a click on the backdrop

  return { open() { dialog.showModal(); show() } }
}
