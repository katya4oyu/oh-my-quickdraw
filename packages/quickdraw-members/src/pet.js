// An agent's avatar as a Codex pet: the sprite sheet a Codex pet is made of
// (`~/.codex/pets/<name>/spritesheet.webp`, with its pet.json), played as the
// agent works. The sheet is 8 columns × 9 rows of 192 × 208 cells; each row
// is a state, with so many frames and their times (openai/skills, hatch-pet:
// references/animation-rows.md). Codex plays them the same way, so any Codex
// pet works here as it is.
//
// In the members table: avatar = { kind: 'codex-pet', name, asset }, the sheet
// kept on the board as an image asset (so it syncs and persists with it).

export const PET_CELL = { w: 192, h: 208 }
export const PET_COLUMNS = 8
export const PET_SHEET = { w: 1536, h: 1872 }
// row: [frame times in ms]; the last frame of each lingers
const ms = (n, each, last) => [...Array(n - 1).fill(each), last]
export const PET_ROWS = {
  idle: { row: 0, times: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, times: ms(8, 120, 220) },
  'running-left': { row: 2, times: ms(8, 120, 220) },
  waving: { row: 3, times: ms(4, 140, 280) },
  jumping: { row: 4, times: ms(5, 140, 280) },
  failed: { row: 5, times: ms(8, 140, 240) },
  waiting: { row: 6, times: ms(6, 150, 260) },
  running: { row: 7, times: ms(6, 120, 220) },
  review: { row: 8, times: ms(6, 150, 280) },
}
// played once, then back to idle
const ONCE = new Set(['jumping', 'waving'])

/**
 * The pet's state for what an agent is doing (quickdraw-presence's
 * agentActivity, its status), as navi does for the same agents: thinking or
 * reading is review, work is running (drawing: running the way its cursor
 * goes, dx), waiting for a person is waving, done a jump, an error failed.
 */
export function petState({ activity, status, dx = 0, failed = false } = {}) {
  if (failed) return 'failed'
  switch (activity) {
    case 'thinking': case 'reading': case 'searching': return 'review'
    case 'running': case 'editing': case 'imaging': return 'running'
    case 'drawing': return dx > 2 ? 'running-right' : dx < -2 ? 'running-left' : 'running'
    case 'waiting': return 'waving'
    case 'done': return 'jumping'
    default: return status === 'waiting' ? 'waving' : status === 'working' ? 'review' : 'idle'
  }
}

const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * A pet on the page: an element showing the sheet (src: a URL or data URL),
 * `height` px tall, that plays a state with play(state). Reduced motion shows
 * the first frame of idle. Returns { el, play, destroy }.
 */
export function createPet(src, { height = 48 } = {}) {
  const scale = height / PET_CELL.h
  const el = document.createElement('div')
  el.className = 'qd-pet'
  Object.assign(el.style, {
    width: Math.round(PET_CELL.w * scale) + 'px', height: height + 'px', flex: 'none',
    backgroundImage: `url("${src}")`, backgroundRepeat: 'no-repeat',
    backgroundSize: `${PET_SHEET.w * scale}px ${PET_SHEET.h * scale}px`, imageRendering: 'auto',
  })
  let state = null, frame = 0, timer = 0
  let asked = null // what was asked last: asked again (a jump, while "done" lasts), it is not played again
  const show = () => {
    const { row } = PET_ROWS[state]
    el.style.backgroundPosition = `${-frame * PET_CELL.w * scale}px ${-row * PET_CELL.h * scale}px`
  }
  const step = () => {
    const { times } = PET_ROWS[state]
    timer = setTimeout(() => {
      if (frame + 1 >= times.length && ONCE.has(state)) { state = 'idle'; frame = 0 }
      else frame = (frame + 1) % times.length
      show()
      step()
    }, times[frame])
  }
  function play(next) {
    if (!PET_ROWS[next]) next = 'idle'
    if (reduced()) next = 'idle'
    if (next === asked) return
    asked = next
    if (next === state) return
    clearTimeout(timer)
    state = next
    frame = 0
    show()
    if (!reduced()) step()
  }
  play('idle')
  return { el, play, get state() { return state }, destroy() { clearTimeout(timer); el.remove() } }
}

/** Whether an avatar is a Codex pet. */
export const isPet = (avatar) => avatar?.kind === 'codex-pet' && typeof avatar.asset === 'string'
