// Tooltips for the board's icon buttons: the core's tools and action bar, the
// rail, the selection bar, and any other button with a title inside the board.
// The browser's own tooltip comes late (a second or more) and not at all in
// some browsers, so an icon says nothing on a PC: this one comes in a moment
// with a mouse or pen (none with touch), and at once moving on to the next
// button. It reads each button's title, and takes it off while shown, so the
// browser's own does not come too. No core change.
import { placeTip } from './layout.js'

const STYLE = `
.qdx-tip { position: absolute; z-index: 1000; pointer-events: none; max-width: 240px; padding: 5px 9px;
  border-radius: 8px; background: var(--qd-on-bg, #211d14); color: var(--qd-on-ink, #fbf9f4);
  font: 500 12px/1.35 system-ui, -apple-system, sans-serif; white-space: pre-line; box-shadow: var(--qd-bar-shadow);
  opacity: 0; transition: opacity 0.1s; }
.qdx-tip.qdx-tip-on { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .qdx-tip { transition: none; } }
`
const DELAY = 350 // hovering this long shows it
const WARM = 600 // after one hides, the next button's shows at once for this long

function injectStyle() {
  if (document.getElementById('qdx-tip-style')) return
  const s = document.createElement('style')
  s.id = 'qdx-tip-style'
  s.textContent = STYLE
  document.head.append(s)
}

// createTooltips(root) -> destroy(): for the buttons inside root (the editor's container)
export function createTooltips(root) {
  injectStyle()
  const tip = document.createElement('div')
  tip.className = 'qdx-tip'
  tip.setAttribute('role', 'tooltip')
  let on = null // the button it is for (its title taken off)
  let text = ''
  let timer = 0
  let warmUntil = 0

  const buttonOf = (target) => {
    const b = target instanceof Element ? target.closest('button[title]') : null
    return b && root.contains(b) && !b.disabled && b.title.trim() ? b : null
  }

  function show(b) {
    if (!b.isConnected) return
    const r = root.getBoundingClientRect(), br = b.getBoundingClientRect()
    if (!br.width) return
    const bar = b.parentElement.getBoundingClientRect()
    ;(b.closest('.qd-ui') || root).append(tip)
    tip.textContent = text
    tip.classList.remove('qdx-tip-on')
    const vertical = bar.height > bar.width * 1.5
    // beside a vertical bar it clears the bar, not just the button
    const { left, top } = placeTip(
      { x: (vertical ? bar.left : br.left) - r.left, y: br.top - r.top, w: vertical ? bar.width : br.width, h: br.height },
      { vertical },
      { w: tip.offsetWidth, h: tip.offsetHeight },
      { w: r.width, h: r.height },
    )
    tip.style.left = left + 'px'
    tip.style.top = top + 'px'
    tip.classList.add('qdx-tip-on')
  }

  function enter(b) {
    if (on === b) return
    leave()
    on = b
    text = b.title
    if (!b.hasAttribute('aria-label')) b.setAttribute('aria-label', text)
    b.removeAttribute('title') // else the browser's own shows too
    clearTimeout(timer)
    if (Date.now() < warmUntil) show(b)
    else timer = setTimeout(() => show(b), DELAY)
  }

  function leave() {
    clearTimeout(timer)
    if (!on) return
    if (tip.isConnected) { tip.remove(); warmUntil = Date.now() + WARM }
    if (!on.hasAttribute('title')) on.title = text // unless its own code set another meanwhile
    on = null
  }

  const onOver = (e) => {
    if (e.pointerType === 'touch') return
    const b = buttonOf(e.target)
    if (b) enter(b)
    else if (on && !on.contains(e.target)) leave()
  }
  const onOut = (e) => { if (on && !on.contains(e.relatedTarget)) leave() }
  // pressed, typed or scrolled: it goes, and does not come straight back
  const quiet = () => { if (on) { leave(); warmUntil = 0 } }
  const onFocus = (e) => { const b = buttonOf(e.target); if (b && b.matches(':focus-visible')) { warmUntil = Date.now() + WARM; enter(b) } }
  const onBlur = () => leave()

  root.addEventListener('pointerover', onOver)
  root.addEventListener('pointerout', onOut)
  root.addEventListener('pointerdown', quiet, true)
  root.addEventListener('wheel', quiet, { capture: true, passive: true })
  root.addEventListener('focusin', onFocus)
  root.addEventListener('focusout', onBlur)
  addEventListener('keydown', quiet, true)

  return function destroy() {
    leave()
    root.removeEventListener('pointerover', onOver)
    root.removeEventListener('pointerout', onOut)
    root.removeEventListener('pointerdown', quiet, true)
    root.removeEventListener('wheel', quiet, { capture: true })
    root.removeEventListener('focusin', onFocus)
    root.removeEventListener('focusout', onBlur)
    removeEventListener('keydown', quiet, true)
  }
}
