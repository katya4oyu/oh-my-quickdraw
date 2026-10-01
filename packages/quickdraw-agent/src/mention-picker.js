// Asking an agent from a note: a note that starts with "@" and an agent's full
// name is a request to it (detectAgentMention), and full names are long
// ("Claude · my-repo"). While a person writes a note, "@" at its start opens a
// list of the agents on the board; what follows narrows it, and picking one
// (click, Enter or Tab) writes its full name. Esc closes the list.
//
// It works on core's text editor (editor.editing.textarea), from outside it:
// nothing in the core changes.

/**
 * The agent name being written at the start of a note, if the caret is in it:
 * { query, end } (end: where the name being written stops), or null.
 */
export function mentionQuery(value, caret = value.length) {
  const m = /^(\s*)@([^\n]*)$/.exec(value.slice(0, caret))
  if (!m) return null
  const rest = value.slice(caret)
  const tail = /^[^\s]*/.exec(rest)[0] // the rest of the word the caret is in
  return { query: m[2], start: m[1].length, end: caret + tail.length }
}

const fold = (s) => String(s).toLowerCase().replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The agents a query could mean, best first: a name that starts with it, then
 * one with a word that does, then one that has it anywhere. A query that is a
 * full name already, followed by a space, means the name is written: none.
 */
export function matchAgents(agents, query) {
  const q = fold(query)
  if (agents.some((a) => new RegExp(`^${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'i').test(query))) return []
  if (!q) return agents.slice()
  const rank = (a) => {
    const n = fold(a.name)
    if (n.startsWith(q)) return 0
    if (n.split(' ').some((w) => w.startsWith(q))) return 1
    return n.includes(q) ? 2 : -1
  }
  return agents.map((a) => [rank(a), a]).filter(([r]) => r >= 0).sort((x, y) => x[0] - y[0]).map(([, a]) => a)
}

const STYLE = `
.qda-mention{position:absolute;z-index:40;min-width:200px;max-width:320px;padding:4px;border-radius:10px;background:var(--qd-pop-bg,#fff);
  border:1px solid var(--qd-border,#ddd);box-shadow:var(--qd-pop-shadow,0 6px 24px rgba(0,0,0,.15));font:13px system-ui,-apple-system,sans-serif;color:var(--qd-ink-strong,#222)}
.qda-mention[hidden]{display:none}
.qda-mention-head{padding:4px 8px 2px;font-size:11px;color:var(--qd-ink-soft,#777)}
.qda-mention button{all:unset;box-sizing:border-box;display:flex;align-items:baseline;gap:8px;width:100%;padding:6px 8px;border-radius:7px;cursor:pointer}
.qda-mention button.on,.qda-mention button:hover{background:var(--qd-hover,rgba(0,0,0,.06))}
.qda-mention b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qda-mention small{color:var(--qd-ink-soft,#777);font-size:11px;white-space:nowrap}
`
function injectStyle() {
  if (document.getElementById('qda-mention-style')) return
  document.head.append(Object.assign(document.createElement('style'), { id: 'qda-mention-style', textContent: STYLE }))
}

/**
 * Binds the picker to an editor. agents(): the agents this person may ask
 * ([{ id, name, owner?, status? }]). Returns an unbind.
 */
export function bindMentionPicker({ editor, container = editor.container, agents }) {
  injectStyle()
  const list = document.createElement('div')
  list.className = 'qda-mention'
  list.hidden = true
  list.setAttribute('role', 'listbox')
  container.append(list)
  let ta = null // the note's textarea, while one is being written
  let shown = [] // the agents in the list
  let active = 0

  const close = () => { list.hidden = true; shown = [] }
  function pick(agent) {
    const q = mentionQuery(ta.value, ta.selectionStart)
    if (!q) return close()
    const before = ta.value.slice(0, q.start) + '@' + agent.name + ' '
    const after = ta.value.slice(q.end).replace(/^\s+/, '')
    ta.value = before + after
    ta.setSelectionRange(before.length, before.length)
    ta.dispatchEvent(new Event('input')) // the editor writes it to the note
    close()
  }
  function update() {
    const q = ta && mentionQuery(ta.value, ta.selectionStart)
    const note = ta && editor.store.get(editor.editing?.id)
    shown = q && note?.type === 'note' ? matchAgents(agents(), q.query).slice(0, 8) : []
    if (!shown.length) return close()
    active = Math.min(active, shown.length - 1)
    list.replaceChildren(Object.assign(document.createElement('div'), { className: 'qda-mention-head', textContent: 'Ask an agent' }))
    shown.forEach((a, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'option')
      b.className = i === active ? 'on' : ''
      const name = Object.assign(document.createElement('b'), { textContent: a.name })
      const more = [a.owner, a.status && a.status !== 'idle' ? a.status : ''].filter(Boolean).join(' · ')
      b.append(name)
      if (more) b.append(Object.assign(document.createElement('small'), { textContent: more }))
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pick(a) }) // the note keeps the focus
      list.append(b)
    })
    // under the text being written, inside the board
    const r = ta.getBoundingClientRect(), c = container.getBoundingClientRect()
    list.hidden = false
    const left = Math.max(8, Math.min(r.left - c.left, c.width - list.offsetWidth - 8))
    const below = r.bottom - c.top + 6
    const top = below + list.offsetHeight > c.height - 8 ? Math.max(8, r.top - c.top - list.offsetHeight - 6) : below
    Object.assign(list.style, { left: left + 'px', top: top + 'px' })
  }
  // before the editor's own keys (Esc and ⌘Enter end the editing): a capture on the board
  function onKey(e) {
    if (list.hidden || e.target !== ta) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length
      update()
    } else if ((e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.isComposing) || e.key === 'Tab') pick(shown[active])
    else if (e.key === 'Escape') close()
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  const onInput = () => { active = 0; update() }
  const onCaret = () => update()
  const onKeyUp = (e) => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) update() }
  function attach() {
    const next = editor.editing?.textarea ?? null
    if (next === ta) return
    if (ta) { ta.removeEventListener('input', onInput); ta.removeEventListener('click', onCaret); ta.removeEventListener('keyup', onKeyUp); ta.removeEventListener('blur', close) }
    ta = next
    close()
    if (!ta) return
    ta.addEventListener('input', onInput)
    ta.addEventListener('click', onCaret)
    ta.addEventListener('keyup', onKeyUp)
    ta.addEventListener('blur', close)
  }
  container.addEventListener('keydown', onKey, true)
  const offEdit = editor.on('edit', attach)
  const offCamera = editor.on('camera', () => { if (!list.hidden) update() })
  return () => {
    container.removeEventListener('keydown', onKey, true)
    offEdit?.()
    offCamera?.()
    ta = null
    list.remove()
  }
}
