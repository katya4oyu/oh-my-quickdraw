// What the app's pages around the boards share: the bar over them, a tag's
// chip, a board's card, and calling the server.

export const $ = (id) => document.getElementById(id)
export const el = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); e.append(...children.filter((c) => c != null && c !== '')); return e }

export async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || r.statusText)
  return data
}

// line icons (no emoji)
const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  more: null,
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
}
export const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  if (name === 'more') { s.innerHTML = '<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>' } else s.innerHTML = ICONS[name]
  return s
}

/** The bar over the page: the app's name, the two views (this one current), and this page's own controls. */
export function bar(current, ...controls) {
  const tag = pickedTag(), tab = (href, label) => el('a', { href: href + (tag ? '?tag=' + encodeURIComponent(tag) : ''), textContent: label, ...(current === label ? { ariaCurrent: 'page' } : {}) })
  return el('header', { className: 'bar' },
    el('span', { className: 'brand', textContent: 'Quickdraw' }),
    el('nav', { className: 'tabs', ariaLabel: 'Views' }, tab('/', 'Boards'), tab('/graph', 'Graph')),
    el('span', { className: 'spacer' }),
    ...controls)
}

/** A tag, as a chip: the same wherever a tag shows. */
export const chip = (tag, { on = false, onclick, remove = false } = {}) =>
  el('button', { type: 'button', className: 'chip' + (on ? ' on' : ''), title: remove ? `Show all boards` : `Boards tagged ${tag}`, onclick }, tag, remove ? el('span', { className: 'x', textContent: '×' }) : null)

/** The tag picked to narrow the boards down (?tag= in the page's address, kept when going to the other view). */
export const pickedTag = () => new URLSearchParams(location.search).get('tag')
export function setPickedTag(tag) {
  history.replaceState(null, '', tag ? '?tag=' + encodeURIComponent(tag) : location.pathname)
  for (const a of document.querySelectorAll('.tabs a')) a.search = tag ? '?tag=' + encodeURIComponent(tag) : '' // the other view, narrowed the same
}

/** The tags of these boards as a row to pick from (one at a time; All: every board). */
export function tagBar(boards, current, onPick) {
  const tags = new Map()
  for (const b of boards) for (const t of b.tags ?? []) { const k = t.toLowerCase(); tags.set(k, { t: tags.get(k)?.t ?? t, n: (tags.get(k)?.n ?? 0) + 1 }) }
  const sorted = [...tags.values()].sort((a, b) => b.n - a.n || a.t.localeCompare(b.t))
  const on = (t) => !!current && t.toLowerCase() === current.toLowerCase()
  const row = el('nav', { className: 'tagbar', ariaLabel: 'Tags' },
    el('button', { type: 'button', className: 'chip all' + (current ? '' : ' on'), textContent: 'All', onclick: () => onPick(null) }),
    ...sorted.map(({ t, n }) => el('button', { type: 'button', className: 'chip' + (on(t) ? ' on' : ''), textContent: t, title: `${n} board${n === 1 ? '' : 's'}`, onclick: () => onPick(on(t) ? null : t) })))
  row.hidden = !sorted.length
  return row
}

export const thumbnailUrl = (b) => (b.thumbnailAt ? `/api/boards/${b.id}/thumbnail?at=${encodeURIComponent(b.thumbnailAt)}` : null)
export const when = (b) => new Date(b.createdAt).toLocaleDateString()
export const agentsText = (b) => (b.agents ? `${b.agents === 1 ? 'an AI' : b.agents + ' AIs'} here` : '')
