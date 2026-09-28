// An agent's side of a board, whatever it runs on: it joins the board as a
// participant, takes the requests addressed to it, runs the board tools
// (quickdraw-agent's BOARD_TOOLS) on its own copy of the board, and reports
// back — progress, messages, each operation with its diff (so the panel can
// undo a request), approvals it waits for, done. A runtime (./codex.ts) turns
// its own events into these.
//
// People watch it work: an operation is made on a copy of the board first
// (so it is checked, all or nothing, and laid out as one), then put on the
// board a piece at a time with the cursor on each — one undo, as before.
import { pageBounds, Store, type BoardRecord, type Diff, type Store as StoreType } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { applySteps, BOARD_TOOLS, freeSpot, textOf, type AgentEvent, type AgentRequest } from 'quickdraw-agent'
import { snapshotFeedback } from 'quickdraw-screenshare'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Renderer } from '../board/render.ts'
import type { Board } from '../board/open.ts'
import { resolve as resolvePath } from 'node:path'
import { imageSteps } from './images.ts'

import type { AgentLimit, AgentModel, EmbedPreview } from 'quickdraw-agent'

export interface Participant {
  id: string, name: string, knows: string[], models?: AgentModel[], model?: string, effort?: string
  /** takes requests and approvals from anyone on the board; else only from the computer running quickdraw serve */
  remote?: boolean
  /** people can talk with it (its runtime sets onVoice) */
  voice?: boolean
}

export interface BoardAgent {
  /** set by the runtime: a new request */
  onRequest(request: AgentRequest): void
  /** set by the runtime: a person's follow-up in a request's thread */
  onReply(requestId: string, text: string): void
  /** set by a runtime that talks (./voice.ts): a request to talk, with the page's WebRTC offer */
  onVoice?(request: AgentRequest, sdp: string): void
  /** set by the runtime: a person asked it to stop working on a request */
  onStop?(requestId: string): void
  /** set by a runtime that talks: the person hung up */
  onVoiceStop?(requestId: string): void
  /** to the page that asked to talk: the WebRTC answer, or that the conversation ended (and why) */
  voice(requestId: string, message: { sdp: string } | { end: string | null }): void
  /** the tools, as the runtime hands them to the model */
  tools: { name: string, description: string, inputSchema: object }[]
  /** an image the runtime generated for a request, for add_image to put on the board */
  generated(requestId: string, file: string, opts?: { transparent?: boolean }): number
  /** runs a tool for a request, a piece at a time: what the model gets back, as text */
  runTool(requestId: string, name: string, args: unknown): Promise<string>
  /** puts the cursor on what a request is about, while the agent thinks */
  lookAt(request: AgentRequest): void
  /** an event in a request's thread */
  emit(requestId: string, event: Omit<AgentEvent, 'requestId'> & Record<string, unknown>): void
  /** asks the people on the board; resolves with their answer */
  approve(requestId: string, text: string): Promise<boolean>
  /** what the agent is doing overall, shown next to its name */
  status(status: 'idle' | 'working' | 'waiting'): void
  /** what it is doing just now, by its cursor (quickdraw-presence's agentActivity), and on what; 'done' shows a moment; null: nothing in particular */
  activity(kind: Activity | null, note?: string): void
  /** what it runs on, shown in the panel: its account and how much of its usage limits is used */
  account(info: { account?: string, limits?: AgentLimit[] }): void
  /** part of the board as a PNG, as drawn (a frame's contents, or some shapes); null when there is nothing */
  picture(what: { frame?: string, ids?: string[] }): Promise<Buffer | null>
  /** feedback on snapshots (their frame ids), for the model: a text, and image files (each: as drawn over, then the screen as it was) */
  feedback(frameIds: string[]): Promise<{ text: string, images: string[] }>
  /** leaves the board */
  close(): Promise<void>
}

type Emitted = Omit<AgentEvent, 'requestId'> & Record<string, unknown>
type Rect = { x: number, y: number, w: number, h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
export type Activity ='thinking' | 'reading' | 'searching' | 'running' | 'editing' | 'imaging' | 'drawing' | 'waiting' | 'done'

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const isShape = (r: BoardRecord) => r.typeName === 'shape' && !(r as { isFrameTitle?: boolean }).isFrameTitle

// the board as it is, to try an operation on
function copyOf(store: StoreType): StoreType {
  const copy = new Store()
  copy.loadSnapshot({ document: { store: Object.fromEntries(store.all().map((r) => [r.id, structuredClone(r)])) } })
  bindFrames(copy)
  return copy
}

/**
 * Puts what an operation did on `done` (a copy it ran on) onto `store` a record
 * at a time, pointing at each; `pace` spreads it over about that long. The
 * records are taken as they ended up on the copy: a diff's added records are
 * as they were added, before listeners (frame membership) touched them.
 */
export async function putLive(store: StoreType, diff: Diff, done: StoreType, point: (x: number, y: number) => void, pace = 2500) {
  const final = (id: string) => done.get(id) as BoardRecord
  // frames first (a member put before its frame would be let go of), arrows
  // last (after what they connect); otherwise in the order they were made
  const rank = (r: BoardRecord) => ((r as { isFrame?: boolean }).isFrame ? 0 : (r as { type?: string }).type === 'arrow' ? 2 : 1)
  const added = Object.keys(diff.added).map(final).filter(Boolean).sort((a, b) => rank(a) - rank(b))
  const updated = Object.entries(diff.updated).map(([id, [from]]) => [id, [from, final(id)]] as [string, [BoardRecord, BoardRecord]]).filter(([, [, to]]) => to)
  const shown = added.filter(isShape).length + updated.filter(([, [, to]]) => isShape(to)).length
  const gap = shown ? Math.min(250, Math.max(40, pace / shown)) : 0
  const one = async (d: Partial<Diff>, rec: BoardRecord) => {
    store.applyDiff({ added: {}, updated: {}, removed: {}, ...d }, 'user')
    if (!isShape(rec)) return
    const b = pageBounds(rec as never)
    point(b.x + b.w / 2, b.y + b.h / 2)
    await sleep(gap)
  }
  for (const rec of added) await one({ added: { [rec.id]: rec } }, rec)
  for (const [id, pair] of updated) await one({ updated: { [id]: pair } }, pair[1])
  if (Object.keys(diff.removed).length) store.applyDiff({ added: {}, updated: {}, removed: diff.removed }, 'user')
}

// Images: the board tools take an image as data; the agent names a file instead
const point = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false }
const LOOK_AT = {
  name: 'look_at',
  description: 'Looks at part of the board as a picture, as people see it: a frame (its contents: a snapshot of a screen with the notes, pen strokes and arrows people put on it) or some shapes by id. '
    + 'Use it for what read_board cannot say: what a screenshot shows, and where a circle, a stroke or an arrow points.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    frame: { type: 'string', description: 'a frame id' },
    ids: { type: 'array', items: { type: 'string' }, description: 'shape ids (instead of a frame)' },
  } },
}

const CLAIM_AREA = {
  name: 'claim_area',
  description: 'Marks out where you will work, before you draw anything bigger than a note or two, so people see where it will be: they work around it, or move it, or draw in it with you. '
    + 'Give a rough size for what you will make (a note is 200 × 200; it grows downwards when full); it goes in free space by what the request is about. '
    + 'Give `x`, `y` (its top-left) when the request says where, like under something. From then on, what you add without `at` or `in` goes in it, and it grows to take in what you put beside it. Call it again to change its size.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['w', 'h'], properties: {
    w: { type: 'number', description: 'width, in board units' },
    h: { type: 'number', description: 'height, in board units' },
    title: { type: 'string', description: 'what you are making, in a few words, shown on the area' },
    x: { type: 'number', description: 'left edge, when the request says where (else it finds free space)' },
    y: { type: 'number', description: 'top edge, when the request says where' },
  } },
}

const ADD_IMAGE = {
  name: 'add_image',
  description: 'Puts an image on the board: one you generated for this request ("latest", or "1", "2"… in the order you made them) or an image file (PNG, JPEG, GIF, WebP) in the working directory, by its path. Without a position it goes in free space; `in` puts it in a frame. Shown 400 wide unless `w` says otherwise. '
    + 'With `split`, an image laid out as an even grid (a sprite or sticker sheet) is cut into its cells, which go on the board as separate images in the same grid (each `w` wide, 160 by default), optionally in a new frame titled `frame`.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['image'], properties: {
    image: { type: 'string', description: '"latest", the number of a generated image, or a file path' },
    w: { type: 'number', description: 'shown width' },
    at: { ...point, description: 'page position of the top-left corner' },
    in: { type: 'string', description: 'a frame id (not with split)' },
    split: { type: 'object', additionalProperties: false, required: ['cols', 'rows'], description: 'cut an even grid into its cells',
      properties: { cols: { type: 'number' }, rows: { type: 'number' }, inset: { type: 'number', description: 'share of each cell to trim at its edges, 0 to 0.2 (for gutters or lines between cells)' } } },
    frame: { type: 'string', description: 'with split: a title for a frame around the pieces' },
  } },
}

export interface JoinOptions {
  /** where image files may be read from: the working directory first (relative paths are in it) */
  imageRoots?: string[]
  /** a link card's preview for add_embed (see ../board/link-preview.ts); without it, cards show the link's host */
  preview?: (url: string) => Promise<EmbedPreview | undefined>
}

export function joinBoard(board: Board, me: Participant, { imageRoots = [process.cwd()], preview }: JoinOptions = {}): Promise<BoardAgent> {
  if (!board.relay) throw new Error('an agent needs a live board (quickdraw serve), not a file')
  const relay = board.relay
  const approvals = new Map<string, { requestId: string, resolve: (allow: boolean) => void }>()
  const approvalBase = Date.now().toString(36)
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let doneTimer: ReturnType<typeof setTimeout> | undefined
  const requests = new Map<string, AgentRequest>()
  // per request: its work area, and what was in it after its last step (to tell what people did since)
  const work = new Map<string, { area: Rect, title?: string, seen: Map<string, string>, moved?: boolean }>()
  const images = new Map<string, { file: string, transparent: boolean }[]>() // per request, in order
  const holdCursor = () => clearTimeout(hideTimer)
  let nextApproval = 1
  let renderer: Renderer | undefined // pictures of the board, in a headless Chrome made when first needed
  let files: string | undefined // where pictures for the model are written; removed on close

  relay.onMessage((m) => {
    // the server lets only this computer ask, unless `remote`; checked here too
    if ((m.kind === 'request' || m.kind === 'reply') && !me.remote && m.local !== true) {
      if (m.kind === 'request' && m.request?.id) emit(m.request.id, { type: 'error', message: `${me.name} takes requests only from the computer running quickdraw serve.` })
      return
    }
    if (m.kind === 'request' && m.request?.id && typeof m.sdp === 'string') {
      if (agent.onVoice) agent.onVoice(m.request, m.sdp)
      else agent.voice(m.request.id, { end: `${me.name} does not talk.` })
    } else if (m.kind === 'request' && m.request?.id) {
      requests.set(m.request.id, m.request)
      if (m.request.context?.area) markedOut(m.request.id, m.request.context.area)
      agent.onRequest(m.request)
    } else if (m.kind === 'reply' && m.message?.area && typeof m.requestId === 'string') moveArea(m.requestId, m.message.area)
    else if (m.kind === 'reply' && m.message?.stop === true && typeof m.requestId === 'string') {
      // what it waits on is declined: stopping answers it
      for (const [id, a] of approvals) if (a.requestId === m.requestId) { approvals.delete(id); a.resolve(false) }
      agent.onStop?.(m.requestId)
    }
    else if (m.kind === 'voice' && m.stop === true && typeof m.requestId === 'string') agent.onVoiceStop?.(m.requestId)
    else if (m.kind === 'reply' && typeof m.message === 'string') agent.onReply(m.requestId, m.message)
    else if (m.kind === 'reply' && typeof m.message?.approval === 'string') {
      const pending = approvals.get(m.message.approval)
      approvals.delete(m.message.approval)
      pending?.resolve(m.message.allow === true)
    }
  })

  function emit(requestId: string, event: Emitted) {
    relay.send({ kind: 'event', event: { ...event, requestId } })
  }

  // what the model gets back from a tool, with what people did in its work area since its last step
  async function runBoardTool(requestId: string, name: string, args: unknown): Promise<string> {
    if (name === 'claim_area') return claimArea(requestId, (args ?? {}) as { w?: number, h?: number, title?: string })
    const heard = peopleSince(requestId)
    return (await boardTool(requestId, name, args)) + heard
  }
  async function boardTool(requestId: string, name: string, args: unknown): Promise<string> {
    if (name === 'add_image') return put(requestId, await imageStep(requestId, (args ?? {}) as Record<string, any>))
    const tool = BOARD_TOOLS.find((t) => t.name === name)
    if (!tool) throw new Error(`no tool ${name}`)
    if (name === 'add_embed' && preview) {
      const a = (args ?? {}) as Record<string, unknown>
      if (typeof a.url === 'string' && a.html == null) args = { ...a, preview: await preview(a.url) }
    }
    if (name === 'read_board') {
      const result = tool.run(board.store as never, (args ?? {}) as never, { name: me.name }) as unknown
      return typeof result === 'string' ? result : JSON.stringify(result)
    }
    const area = work.get(requestId)?.area
    return put(requestId, (store) => tool.run(store as never, (args ?? {}) as never, { name: me.name, area }) as never)
  }

  // ---- a request's work area: where it draws, which people see, move and draw in ----
  const snapshot = (area: Rect) => new Map(board.store.shapes()
    .filter((s) => isShape(s as BoardRecord) && overlaps(pageBounds(s as never), area))
    .map((s) => [s.id, JSON.stringify([s.type, Math.round(s.x), Math.round(s.y), textOf(board.store as never, s as never)])]))
  function claimArea(requestId: string, { w = 800, h = 500, title, x, y }: { w?: number, h?: number, title?: string, x?: number, y?: number }) {
    w = Math.min(4000, Math.max(200, Number(w) || 800)); h = Math.min(4000, Math.max(200, Number(h) || 500))
    const had = work.get(requestId)
    let at: { x: number, y: number }
    if (Number.isFinite(x) && Number.isFinite(y)) at = { x: Math.round(x!), y: Math.round(y!) } // where the request says
    else if (had) at = had.area
    else {
      // beside what the request is about, else mid-view
      const request = requests.get(requestId)
      const about = (request?.context.shapeIds ?? []).map((id) => board.store.get(id)).filter((s) => s?.typeName === 'shape').map((s) => pageBounds(s as never))
      const v = request?.context.viewport ?? { x: 0, y: 0, w: 0, h: 0 }
      const prefer = about.length
        ? { x: Math.max(...about.map((b) => b.x + b.w)) + 120, y: Math.min(...about.map((b) => b.y)) }
        : { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2 }
      at = freeSpot(board.store as never, w, h, prefer)
    }
    const area = { x: at.x, y: at.y, w, h }
    const name = title ?? had?.title
    work.set(requestId, { area, title: name, seen: snapshot(area) })
    emit(requestId, { type: 'area', area, ...(name ? { title: name } : {}) })
    holdCursor()
    board.cursor(area.x + area.w / 2, area.y + area.h / 2)
    return JSON.stringify({ area, note: 'What you add without `at` or `in` now goes in this area. People see it, and may move it or draw in it with you.' })
  }
  // an area grown to hold these shapes too (and a frame's title above them)
  function takeIn(area: Rect, recs: BoardRecord[]): Rect {
    const PAD = 24
    const bs = recs.filter((r) => isShape(r)).map((r) => pageBounds(r as never))
    if (!bs.length) return area
    const x = Math.min(area.x, ...bs.map((b) => b.x - PAD)), y = Math.min(area.y, ...bs.map((b) => b.y - PAD - 20))
    const right = Math.max(area.x + area.w, ...bs.map((b) => b.x + b.w + PAD)), bottom = Math.max(area.y + area.h, ...bs.map((b) => b.y + b.h + PAD))
    return { x: Math.round(x), y: Math.round(y), w: Math.round(right - x), h: Math.round(bottom - y) }
  }
  // a person marked out where it should work: that is its work area from the start
  function markedOut(requestId: string, a: Rect) {
    if (![a.x, a.y, a.w, a.h].every(Number.isFinite) || a.w < 40 || a.h < 40) return
    const area = { x: a.x, y: a.y, w: a.w, h: a.h }
    work.set(requestId, { area, seen: snapshot(area) })
    emit(requestId, { type: 'area', area })
  }
  function moveArea(requestId: string, area: Rect) {
    const w = work.get(requestId)
    if (!w) return
    // told once, at its next step; what is already there is not news
    work.set(requestId, { ...w, area, seen: snapshot(area), moved: true })
  }
  function peopleSince(requestId: string): string {
    const w = work.get(requestId)
    if (!w) return ''
    const lines: string[] = []
    if (w.moved) lines.push(`People moved your work area to x ${Math.round(w.area.x)}, y ${Math.round(w.area.y)} (${Math.round(w.area.w)} × ${Math.round(w.area.h)}): build there.`)
    const now = snapshot(w.area)
    const said = (id: string) => {
      const s = board.store.get(id) as any
      const text = s ? String(textOf(board.store as never, s) ?? '').split('\n')[0].slice(0, 60) : ''
      return `${s?.type ?? 'shape'}${text ? ` "${text}"` : ''} (${id})`
    }
    const added = [...now.keys()].filter((id) => !w.seen.has(id))
    const changed = [...now.keys()].filter((id) => w.seen.has(id) && w.seen.get(id) !== now.get(id))
    const gone = [...w.seen.keys()].filter((id) => !now.has(id))
    if (added.length) lines.push(`People added ${added.slice(0, 8).map(said).join(', ')}${added.length > 8 ? ` and ${added.length - 8} more` : ''}.`)
    if (changed.length) lines.push(`People changed ${changed.slice(0, 8).map(said).join(', ')}.`)
    if (gone.length) lines.push(`People removed or moved out ${gone.slice(0, 8).join(', ')}.`)
    work.set(requestId, { ...w, seen: now, moved: false })
    if (!lines.length) return ''
    return `\n\nIn your work area since your last step: ${lines.join(' ')} Keep what they did and build with it; do not move or change it unless asked.`
  }

  const agent: BoardAgent = {
    onRequest() {},
    onReply() {},
    tools: [CLAIM_AREA, ...BOARD_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), ADD_IMAGE, LOOK_AT],
    generated(requestId, file, { transparent = false } = {}) {
      const list = images.get(requestId) ?? []
      list.push({ file, transparent })
      images.set(requestId, list)
      return list.length
    },
    async runTool(requestId, name, args) {
      // by its cursor: reading or drawing, then back to thinking
      agent.activity(name === 'read_board' ? 'reading' : 'drawing')
      try { return await runBoardTool(requestId, name, args) } finally { agent.activity('thinking') }
    },
    lookAt(request) {
      const shape = request.anchor.shapeId ? board.store.get(request.anchor.shapeId) : undefined
      const b = shape?.typeName === 'shape' ? pageBounds(shape as never) : null
      const v = request.context.viewport
      holdCursor()
      if (b) board.cursor(b.x + b.w / 2, b.y + b.h / 2)
      else board.cursor(request.anchor.x ?? v.x + v.w / 2, request.anchor.y ?? v.y + v.h / 2)
    },
    emit,
    voice: (requestId, message) => relay.send({ kind: 'voice', requestId, ...message }),
    approve(requestId, text) {
      const id = `${approvalBase}:${nextApproval++}`
      emit(requestId, { type: 'approval', id, text })
      agent.activity('waiting')
      return new Promise<boolean>((resolve) => approvals.set(id, { requestId, resolve })).finally(() => agent.activity('thinking'))
    },
    activity(kind, note) {
      clearTimeout(doneTimer)
      relay.activity(kind, note)
      if (kind === 'done') doneTimer = setTimeout(() => relay.activity(null), 2000) // a moment, then nothing
    },
    status(status) {
      relay.send({ kind: 'status', status })
      relay.status(status) // on its cursor too
      // the cursor stays a moment after the work, so people see where it ended
      if (status === 'idle') hideTimer = setTimeout(() => board.cursor(null, null), 3000)
    },
    account: ({ account, limits }) => relay.send({ kind: 'account', account, limits }),
    async picture({ frame, ids }) {
      renderer ??= new Renderer()
      return renderer.render({ records: board.store.all(), ...(frame ? { frame } : { ids: ids?.length ? ids : undefined }), scale: 1.5 })
    },
    async feedback(frameIds) {
      const lines: string[] = [], images: string[] = []
      for (const id of frameIds) {
        const fb = snapshotFeedback(board.store as never, id)
        if (!fb) continue
        const shapes = fb.shapeIds.map((sid) => board.store.get(sid)).filter(Boolean) as BoardRecord[]
        const said = shapes.map((s) => textOf(board.store as never, s)).filter(Boolean)
        const marks = shapes.filter((s) => ['draw', 'highlight', 'arrow', 'line', 'geo'].includes((s as { type?: string }).type ?? '')).length
        lines.push(`Snapshot "${fb.title}" (frame ${id}${fb.by ? ', taken for ' + fb.by : ''}):`)
        for (const t of said) lines.push(`- "${t.replace(/\s+/g, ' ')}"`)
        if (marks) lines.push(`- ${marks} pen mark${marks === 1 ? '' : 's'}, arrow${marks === 1 ? '' : 's'} or shape${marks === 1 ? '' : 's'}: see where they are in the picture`)
        files ??= mkdtempSync(join(tmpdir(), 'quickdraw-agent-'))
        const name = id.replace(/[^a-z0-9]+/gi, '-')
        try {
          const png = await agent.picture({ frame: id })
          if (png) { writeFileSync(join(files, `${name}-feedback.png`), png); images.push(join(files, `${name}-feedback.png`)) }
        } catch {
          lines.push('  (it could not be drawn with the feedback over it here: no Chrome; the screen alone follows)')
        }
        const image = board.store.get(fb.imageId) as { props?: { assetId?: string } } | undefined
        const src = image?.props?.assetId ? board.store.asset(image.props.assetId)?.src : undefined
        const m = typeof src === 'string' && src.match(/^data:image\/(png|jpeg|webp);base64,(.*)$/s)
        if (m) {
          const file = join(files, `${name}-screen.${m[1] === 'jpeg' ? 'jpg' : m[1]}`)
          writeFileSync(file, Buffer.from(m[2], 'base64'))
          images.push(file)
        }
      }
      if (!lines.length) return { text: '', images }
      return {
        text: 'People reviewed the app together and left feedback on these snapshots of its screen, taken while one of them used it. '
          + 'For each snapshot the pictures are: the snapshot with their notes and pen marks drawn over it, then the screen as it was. '
          + 'Pen strokes, circles and arrows point at what a note is about. Address each point; say which ones you did not.\n\n' + lines.join('\n'),
        images,
      }
    },
    close: async () => {
      clearTimeout(hideTimer)
      await renderer?.close()
      if (files) rmSync(files, { recursive: true, force: true })
      return board.close()
    },
  }

  // an operation made on a copy (checked, all or nothing), then put on the board a piece at a time
  async function put(requestId: string, make: (store: StoreType) => { op: string, diff: Diff, ids: string[], area?: Rect }) {
    const copy = copyOf(board.store)
    const r = make(copy)
    holdCursor()
    const w = work.get(requestId)
    // the area grows to take in what it added (when full, or put beside it): people see so before it lands
    const next = w && takeIn(r.area ?? w.area, Object.values(r.diff.added) as BoardRecord[])
    const grew = w && next && (next.x !== w.area.x || next.y !== w.area.y || next.w !== w.area.w || next.h !== w.area.h)
    if (grew) { w.area = next!; emit(requestId, { type: 'area', area: w.area, ...(w.title ? { title: w.title } : {}) }) }
    emit(requestId, { type: 'op', op: r.op, diff: r.diff, ids: r.ids }) // first, so the panel can take the view there
    await putLive(board.store, r.diff, copy, board.cursor)
    if (w) w.seen = snapshot(w.area) // its own work is not news
    return JSON.stringify({ op: r.op, ids: r.ids, ...(grew ? { area: w!.area } : {}) })
  }

  async function imageStep(requestId: string, args: Record<string, any>) {
    const made = images.get(requestId) ?? []
    const which = String(args.image ?? '')
    const pick = which === 'latest' ? made.at(-1) : /^\d+$/.test(which) ? made[Number(which) - 1] : null
    if ((which === 'latest' || /^\d+$/.test(which)) && !pick) throw new Error(made.length ? `there is no image ${which}; you made ${made.length}` : 'you have not generated an image for this request')
    const file = pick ? pick.file : resolvePath(imageRoots[0], which)
    const steps = await imageSteps(file, args, imageRoots, { transparent: pick?.transparent })
    return (store: StoreType) => {
      const { op, diff, result, area } = applySteps(store as never, me.name, steps as never, { area: work.get(requestId)?.area })
      return { op, diff, area, ids: (result as unknown[]).flat().filter((v): v is string => typeof v === 'string').filter((v, i, a) => a.indexOf(v) === i) }
    }
  }

  return new Promise((resolve) => {
    const off = relay.onMessage((m) => {
      if (m.kind !== 'joined') return
      off()
      resolve(agent)
    })
    relay.send({ kind: 'join', agent: me })
  })
}
