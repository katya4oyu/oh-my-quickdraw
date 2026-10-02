// An icon toolbar for extensions, in the core's own look.
//
// - The rail: a vertical pill on the right edge, mirroring the core's action
//   bar on the left. Always there: things to put on the board, and a "more"
//   menu for board-wide actions.
// - The selection bar: a small pill floating above the selected shape,
//   following it, with actions for that kind of shape only.
//
// Items are plain objects (see layout.js), so extension packages describe
// their buttons without depending on this one. It lives inside the core's
// .qd-ui and reuses its classes and theme variables, so it follows the theme
// and hides with the core's UI. No core change.
import { railItems, contextItems, placeBar } from './layout.js'
import { createTooltips } from './tooltip.js'

export { railItems, contextItems, placeBar, placeTip } from './layout.js'
export { createTooltips } from './tooltip.js'

const STYLE = `
.qd-actions.qdx-rail { left: auto; right: var(--qdx-rail-right, 10px); }
.qd-actions.qdx-bar { top: 0; left: 0; transform: none; flex-direction: row; padding: 4px 6px; }
.qd-actions.qdx-bar .qd-div { width: 1px; height: 18px; margin: 0 3px; }
.qd-actions.qdx-rail[hidden], .qd-actions.qdx-bar[hidden] { display: none; }
.qd-popover.qdx-pop { bottom: auto; transform-origin: 100% 50%; }
.qdx-pop .qd-menu-item.qdx-checked .qd-mi-ico { color: inherit; }
`
function injectStyle() {
  if (document.getElementById('qdx-toolbar-style')) return
  const s = document.createElement('style')
  s.id = 'qdx-toolbar-style'
  s.textContent = STYLE
  document.head.append(s)
}

// for an app's own "more" menu of board-wide actions
export const MORE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>'

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'

const el = (tag, cls) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

// createToolbar(editor, { rail, context }) -> { refresh(), destroy() }
export function createToolbar(editor, { rail = [], context = [] } = {}) {
  injectStyle()
  const root = editor.container
  const host = root.querySelector('.qd-ui') || root
  let pop = null // { el, id }
  let pressing = false // a pointer is down on the board: hide the selection bar
  // every button's title, as a tooltip that comes in a moment (the core's too)
  const offTips = createTooltips(root)

  const closePop = () => { pop?.el.remove(); pop = null }

  function button(item, getCtx) {
    const b = el('button', 'qd-tool')
    b.innerHTML = item.icon || ''
    b.title = item.title
    b.setAttribute('aria-label', item.title)
    b.addEventListener('pointerdown', (e) => e.stopPropagation()) // not a board gesture
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const ctx = { ...getCtx(), anchor: b }
      if (item.menu) return pop?.id === item.id ? closePop() : openMenu(item, ctx)
      closePop()
      item.run?.(ctx)
    })
    return b
  }

  // a menu next to its button: left of the rail, below the selection bar
  function openMenu(item, ctx) {
    closePop()
    const p = el('div', 'qd-popover qd-menu-pop qdx-pop')
    const entries = typeof item.menu === 'function' ? item.menu(ctx) : item.menu
    for (const it of railItems(entries, editor)) {
      if (it === '-') { p.append(el('i', 'qd-menu-div')); continue }
      const checked = it.checked?.(ctx)
      const b = el('button', 'qd-menu-item' + (checked ? ' qdx-checked' : ''))
      const ico = el('span', 'qd-mi-ico')
      ico.innerHTML = checked ? CHECK : it.icon || ''
      const label = el('span', 'qd-mi-label')
      label.textContent = it.title
      b.append(ico, label)
      b.addEventListener('pointerdown', (e) => e.stopPropagation())
      b.addEventListener('click', (e) => { e.stopPropagation(); closePop(); it.run?.(ctx) })
      p.append(b)
    }
    host.append(p)
    pop = { el: p, id: item.id }
    const rr = root.getBoundingClientRect()
    const ar = ctx.anchor.getBoundingClientRect()
    const fromRail = rail.includes(item)
    const w = p.offsetWidth, h = p.offsetHeight
    const left = fromRail ? ar.left - rr.left - w - 8 : ar.left - rr.left + ar.width / 2 - w / 2
    const top = fromRail ? ar.top - rr.top + ar.height / 2 - h / 2 : ar.bottom - rr.top + 8
    p.style.left = Math.max(8, Math.min(left, rr.width - w - 8)) + 'px'
    p.style.top = Math.max(8, Math.min(top, rr.height - h - 8)) + 'px'
  }

  // ---- rail ----------------------------------------------------------------
  const railEl = el('div', 'qd-actions qdx-rail')
  host.append(railEl)
  function buildRail() {
    railEl.replaceChildren()
    for (const it of railItems(rail, editor)) {
      railEl.append(it === '-' ? el('i', 'qd-div') : button(it, () => ({ editor, shape: null })))
    }
    railEl.hidden = !railEl.childElementCount
  }

  // ---- selection bar ---------------------------------------------------------
  const barEl = el('div', 'qd-actions qdx-bar')
  barEl.hidden = true
  host.append(barEl)
  let barKey = ''
  function updateBar() {
    const items = pressing || editor.editing ? [] : contextItems(context, editor)
    const shape = items.length ? editor.store.get([...editor.selection][0]) : null
    const key = shape ? shape.id + ':' + items.map((it) => it === '-' ? '-' : it.id).join(',') : ''
    if (key !== barKey) {
      barKey = key
      if (pop && !rail.some((it) => it.id === pop.id)) closePop()
      barEl.replaceChildren()
      for (const it of items) {
        barEl.append(it === '-' ? el('i', 'qd-div') : button(it, () => ({ editor, shape: editor.store.get(shape.id) })))
      }
    }
    barEl.hidden = !items.length
    if (!items.length) return
    const b = editor.selectionBounds()
    if (!b) { barEl.hidden = true; return }
    const a = editor.pageToScreen(b.x, b.y)
    const z = editor.camera.z
    const rr = root.getBoundingClientRect()
    const { left, top } = placeBar({ x: a.x, y: a.y, w: b.w * z, h: b.h * z }, { w: barEl.offsetWidth, h: barEl.offsetHeight }, { w: rr.width, h: rr.height })
    barEl.style.transform = `translate(${left}px, ${top}px)`
  }

  // ---- wiring ----------------------------------------------------------------
  let raf = 0
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; updateBar() }) }
  const onDown = (e) => {
    if (!host.contains(e.target) || e.target === host) { closePop(); pressing = true; schedule() }
  }
  const onUp = () => { if (pressing) { pressing = false; schedule() } }
  root.addEventListener('pointerdown', onDown, true)
  addEventListener('pointerup', onUp)
  addEventListener('pointercancel', onUp)
  addEventListener('resize', schedule)
  const offs = ['selection', 'camera', 'change', 'edit', 'theme'].map((ev) => editor.on(ev, schedule))

  function refresh() {
    buildRail()
    barKey = ''
    schedule()
  }
  refresh()

  return {
    refresh,
    destroy() {
      cancelAnimationFrame(raf)
      offTips()
      offs.forEach((off) => off())
      root.removeEventListener('pointerdown', onDown, true)
      removeEventListener('pointerup', onUp)
      removeEventListener('pointercancel', onUp)
      removeEventListener('resize', schedule)
      closePop()
      railEl.remove()
      barEl.remove()
    },
  }
}
