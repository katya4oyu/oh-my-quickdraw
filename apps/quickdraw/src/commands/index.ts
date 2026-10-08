// The board commands of `omq`. Every command prints JSON (or Markdown
// for `read`), so an agent can call it from any shell.
import { parseArgs } from 'node:util'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { text as readStream } from 'node:stream/consumers'
import type { ColorId, Diff, GeoId, Store } from '@quickdrawjs/core'
import { applySteps, boardToMarkdown, describeBoard, fixLayout, lintBoard, parseRatio, runOp, spanOf, undoDiff, type Dash, type Fill, type Operation, type Operations, type TextSize } from 'quickdraw-agent'
import { openBoard, type Board } from '../board/open.ts'
import { announceMentions } from '../board/mentions.ts'
import { pointWith } from '../board/laser.ts'
import { teamOf, teamText } from '../board/team.ts'
import { commentsText } from 'quickdraw-comments'
import { linkedBoardsText } from '../board/linked.ts'
import { isPath, listPets, setPet } from '../board/avatar.ts'
import { pageBounds } from '@quickdrawjs/core'
import { findSession, joinSession, SESSION_COMMANDS, viaSession } from '../session/client.ts'
import { createBoard, listBoards, resolveBoard, serverOf } from './boards.ts'
import { imageSteps } from '../agent/images.ts'
import { cannotTake, nextTicket, waitFor, watchTickets } from './tickets.ts'
const { describeTicket, listTickets } = await import('quickdraw-tickets')
import { linkPreview, serverOfBoard } from '../board/link-preview.ts'

export const BOARD_USAGE = `Board commands: [--board ID | --file board.json] [--server URL] [--name Agent]

The skill (so agents on this machine know this command)
  skill install [--project] [--for agents,claude] [--link]
                                          puts the quickdraw skill where agents look: ~/.agents/skills (Codex, pi
                                          and other Agent Skills agents) and ~/.claude/skills (Claude Code, a link
                                          to it); --project: in this project's .agents/ and .claude/ instead, at
                                          the root of its git repository (to commit, for everyone's agents).
                                          A copy (install again after updating), or --link: a link to this checkout
  skill status | uninstall [--project]    where it is installed and whether it is up to date; or removes it

Boards
  boards                                  the boards on the server, oldest first
  new [TITLE]                             a new board; prints its id and page URL

Reading
  read [--format md|json]                 the board as a Markdown outline (default) or data
  lint [--frame ID] [--ids ID,…] [--fix]  layout problems: shapes on top of each other, arrows across
                                          shapes they do not connect, labels too big for their shapes,
                                          what sticks out of a frame or lies across its edge, frames on
                                          top of each other; check after drawing. --fix fixes what needs
                                          no judgement (on what agents made; one undo) and lists the rest
  export [--format json|md] [--out PATH]  the board as a quickdraw JSON file, or the outline
  look [--frame ID] [--ids ID,…] [--out look.png] [--max 1000]
                                          a small picture to check what you drew by (no side over --max)
  export --format png --out PATH [--frame ID|all] [--ids ID,…] [--scale 2] [--max N] [--transparent] [--theme dark]
                                          an image, drawn by a headless Chrome (needs Chrome installed);
                                          --frame all writes one PNG per frame into the PATH directory

Writing (each command is one operation, undoable as a whole)
  note TEXT [--color C] [--text-size S] [--in FRAME] [--at X,Y]
  markdown TEXT | --md-file PATH [--in FRAME] [--at X,Y]
  board-card BOARD [--live] [--size WxH] [--in FRAME] [--at X,Y]
                                          a card for another board (its id: omq boards): its picture and an
                                          Open button; --live: a window onto it as it is now
  embed URL [--link] [--title T] [--size WxH] [--in FRAME] [--at X,Y]
                                          a page (live from allowed sites: YouTube, Vimeo, Figma,
                                          CodePen, Google Maps), else a link card; --link: a card
  embed --html-file PAGE.html [--title T] [--size WxH] [--in FRAME] [--at X,Y]
                                          a self-contained HTML page, run when a viewer presses Run
  image FILE [--width N] [--in FRAME] [--at X,Y]
                                          a PNG, JPEG, GIF, WebP or SVG in the working directory
  image FILE --split COLSxROWS [--inset 0.1] [--width N] [--frame TITLE] [--at X,Y]
                                          a sheet cut into its cells, laid out as on the sheet
  frame TITLE [--aspect 16:9] [--around ID,ID,…] [--at X,Y] [--size WxH] [--in FRAME] [--title-inside]
                                          --in FRAME: a frame in that frame (frames nest); --title-inside: its title
                                          inside its top-left corner, not above it
  frame TITLE --in BENTO [--span 2x1] [--auto]
                                          a cell at the end of a bento grid, COLSxROWS units big
                                          (--auto: its rows follow what is in it)
  bento [--cols 4] [--width 1200] [--at X,Y]
                                          a bento grid: frames (cells) that pack themselves with no
                                          gaps; its height follows its cells. --in CELL fills a cell,
                                          which grows a row when full (the cells after it move along)
  span CELL COLSxROWS | --auto            a cell's size in units, or rows following its contents
                                          (--auto again: off); the other cells move along
  columns BENTO N                         a bento grid's columns; its cells pack again
  update ID [--text TEXT] [--color C] [--size WxH] [--text-size S] [--font-size PX] [--dash D] [--fill F] [--bend N] [--label TEXT]
                                          --size: a shape's size (not a frame's; a cell: span);
                                          --label "": takes an arrow's label off
  move ID (--to X,Y | --by DX,DY)
  arrange ID,ID,… [--layout grid|row|column] [--cols N] [--gap N] [--at X,Y]   frames count with their titles
  fit FRAME [ID,…]                          shrinks the frame's contents and the shapes named, together,
                                          to fit inside it (the frame keeps its size)
  pen circle|underline ID [--color C]     marks a shape with the pen, as a person would (red unless said)
  pen points "X,Y X,Y …" [--color C]      a pen stroke through page points
  point ID|X,Y [--circle]                 points at a shape or a point with the laser pointer: everyone sees
                                          it drawn, held a moment and faded; nothing stays (live boards)
  tidy [FRAME,…] [--at X,Y] [--gap N] [--width N]
                                          gathers frames (by default all) close together in reading order, in rows
                                          about --width wide (2400): each brings what is in it and its title, a
                                          kanban's columns stay together; for a board that has spread out
  delete ID…                               only shapes an agent added
  apply UNIT.json                          draws: shapes, words and arrows go on only this way, a unit of
                                           thought at a time, as written ({ origin, items }, every size a number),
                                           as one operation; prints placed (see SKILL.md)

Tickets (work people leave on the board for agents)
  tickets [--status todo,doing,…] [--to NAME | --mine]
                                          the tickets, oldest first, as JSON; --to: those for NAME or for
                                          any agent; --mine: for you (--name)
  ticket TITLE [--body TEXT] [--to NAME] [--in FRAME] [--at X,Y]
                                          a ticket (for NAME, else any agent), in the Todo column of the
                                          board's kanban if it has one
  wait [--take] [--timeout SECONDS]       (not on the board) waits until a ticket for you (--name) or any agent is to do, and
                                          prints it: at once if one is. --take: takes it too (if another
                                          agent took it first, it waits for the next). Live boards only
  take ID                                 takes a ticket: doing, and yours (--name); fails if taken
  done ID [--result TEXT]                 closes a ticket; --result: what came of it, in a line
  fail ID [--result TEXT]                 closes it as not done, and why
  watch [--to NAME | --mine]              prints each change to the tickets (added, status, changed,
                                          removed) as a line of JSON, until stopped. Live boards only

On the board, as a participant (for an agent that has only a shell: see SKILL.md)
  join --name NAME [--allow-remote] [--idle MINUTES]
                                          joins the board and stays: in its AI panel, with a cursor. The commands
                                          after it, from this directory, run as you on it; leaves after --idle
                                          minutes (30) without one. Again for another board (same --name): on
                                          both, as one agent — what wait gives says its board, a request's
                                          commands go to its board, else --board ID
  wait [--timeout SECONDS] [--take]       waits for what is for you and prints it: a request (from the panel or a
                                          note that mentions you; with what it is about, and what changed on the
                                          board), a person's reply, Stop, or a ticket (--take: taken). A request
                                          becomes the one you work on: what you draw goes in its thread, where
                                          people can undo it. Meanwhile your cursor stays by the people on the
                                          board, ready for a request. (next: the same)
  say [REQ] TEXT [--progress]             a message in the request's thread (--progress: a step, as you go)
  finish [REQ] [TEXT]                     the request is done (TEXT: what you did, in a line)
  area W H [--title T] [--at X,Y]         marks out where you will draw for the request; what you add without a
                                          place goes in it
  who                                     who is on the board: people and agents (with their roles), their cursors,
                                          what they look at
  changes                                 what changed on the board since you last looked
  leave [--board ID]                      leaves the boards (--board: that one only)
  screen [--watch | --unwatch | --out FILE.jpg]
                                          the screen someone shares on the board, when they let agents see it:
                                          --watch: wait gives { type: "screen" } when it has changed (and when
                                          sharing starts, stops, or agents may see it or not); --out: the screen
                                          as it is now, to a JPEG (nothing goes on the board); alone: whether
                                          someone shares and lets agents see it
  snap                                    puts a snapshot of the shared screen on the board, as a person's
                                          Snapshot does: a frame for people to write on (only when worth it)
  Results say what waits for you as "inbox": take it with wait.

The team (live boards): agents' roles — a transcriber, a researcher, a reviewer — so each does what it is
there for and hands the rest to the one whose role fits; people and agents both set them
  members                                 the agents of the board: their roles, who is here, what each works on
  role ROLE [--about TEXT] [--of NAME]    sets your role (--of: another agent's); --clear takes it off
  avatar PET [--of NAME]                  its picture: a Codex pet — its name (one in ~/.codex/pets), its folder
                                          or its spritesheet — played by its cursor as it works; --clear takes
                                          it off
  avatar --list                           the pets installed for Codex (~/.codex/pets)
  join … --role ROLE --avatar PET         joins with a role and a pet

Comments (live boards): a thread on a frame, which people see on the board and answer there
  comments [--frame ID]                   the threads (of one frame); read also shows them: read a drawing's
                                          before you change it, and follow what was agreed
  comment FRAME_ID TEXT                   adds to a frame's thread: ask what you cannot decide on your own
                                          (what to leave out or stress), and say what you did meanwhile

History
  log                                       this board's operations, newest last
  undo [OP]                                 the last operation (or OP), where untouched since

--board takes an id, a board's page URL (https://host/b/ID) or its relay URL (ws://host/ws/ID);
or set $QUICKDRAW_BOARD (the same, or a file path). Ids are looked up on --server, $QUICKDRAW_SERVER,
or the \`omq serve\` on this machine (http://localhost:8795). Without a board, the server's
only board is used; when it has several, say which.`

const pair = (s: string | undefined, what: string): [number, number] | undefined => {
  if (s == null) return undefined
  const [a, b] = String(s).split(/[,x]/).map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`bad ${what} "${s}"`)
  return [a, b]
}
const point = (s: string | undefined) => { const p = pair(s, 'point'); return p && { x: p[0], y: p[1] } }

interface LogEntry { board: string, op: string, at: string, name: string, command: string, diff?: Diff, undone?: string }

// the op log sits next to the work: .quickdraw/log.jsonl, one line per operation
const logFile = () => resolve(process.env.QUICKDRAW_LOG || join('.quickdraw', 'log.jsonl'))
async function readLog(board: string): Promise<LogEntry[]> {
  let text = ''
  try { text = await readFile(logFile(), 'utf8') } catch {}
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogEntry).filter((e) => e.board === board)
}
async function log(entry: LogEntry) {
  await mkdir(resolve(logFile(), '..'), { recursive: true })
  await appendFile(logFile(), JSON.stringify(entry) + '\n')
}

/**
 * JSON for an agent to read: no indentation, but each top-level field, and each
 * element of a top-level list, on a line of its own — one long line gets cut
 * by agents that keep tool output short (omp keeps 768 bytes a line), and
 * indentation costs tokens.
 */
export function jsonLines(v: unknown): string {
  if (Array.isArray(v)) return v.length ? '[\n' + v.map((x) => JSON.stringify(x)).join(',\n') + '\n]' : '[]'
  if (!v || typeof v !== 'object') return JSON.stringify(v)
  const fields = Object.entries(v as Record<string, unknown>).map(([k, x]) => JSON.stringify(k) + ':' + (Array.isArray(x) && x.length ? '[\n' + x.map((e) => JSON.stringify(e)).join(',\n') + '\n]' : JSON.stringify(x)))
  return '{' + fields.join(',\n') + '}'
}

// PNGs through one headless Chrome, reused for every image of this command
async function exportPng(store: Store, o: Options): Promise<string[]> {
  if (!o.out) throw new Error('export --format png needs --out')
  const { Renderer } = await import('../board/render.ts')
  const { isFrame, frameTitle } = await import('quickdraw-frames')
  const renderer = new Renderer()
  const opts = { background: !o.transparent, scale: o.scale ? Number(o.scale) : 2, theme: o.theme === 'dark' ? 'dark' as const : 'light' as const }
  const records = store.all()
  try {
    if (o.frame === 'all') {
      const frames = store.shapes().filter(isFrame)
      if (!frames.length) throw new Error('this board has no frames')
      await mkdir(o.out, { recursive: true })
      const wrote: string[] = []
      for (const f of frames) {
        const name = (frameTitle(store, f.id) || 'frame').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60) + '-' + f.id.split(':').pop() + '.png'
        const png = await renderer.render({ ...opts, records, frame: f.id })
        if (png) { await writeFile(join(o.out, name), png); wrote.push(join(o.out, name)) }
      }
      return wrote
    }
    if (o.frame && !isFrame(store.get(o.frame))) throw new Error(`${o.frame} is not a frame`)
    const what = { ...opts, records, frame: o.frame, ids: o.ids?.split(',') }
    let png = await renderer.render(what)
    if (!png) throw new Error('nothing to draw')
    // --max: no side longer than that, drawn again smaller (what an image costs a model goes with its pixels)
    const max = o.max ? Number(o.max) : 0, long = () => Math.max(png!.readUInt32BE(16), png!.readUInt32BE(20)) // the PNG's IHDR width, height
    if (max > 0 && long() > max) png = (await renderer.render({ ...what, scale: (opts.scale * max) / long() })) ?? png
    await writeFile(o.out, png)
    return [o.out]
  } finally {
    await renderer.close()
  }
}

const OPTIONS = {
  board: { type: 'string' }, file: { type: 'string' }, server: { type: 'string' }, name: { type: 'string', default: 'Agent' },
  format: { type: 'string' }, out: { type: 'string' }, color: { type: 'string' }, in: { type: 'string' },
  at: { type: 'string' }, size: { type: 'string' }, aspect: { type: 'string' }, around: { type: 'string' },
  text: { type: 'string' }, to: { type: 'string' }, by: { type: 'string' }, layout: { type: 'string' },
  gap: { type: 'string' }, line: { type: 'boolean' }, 'md-file': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  cols: { type: 'string' }, link: { type: 'boolean' }, title: { type: 'string' }, 'html-file': { type: 'string' },
  width: { type: 'string' }, split: { type: 'string' }, inset: { type: 'string' },
  frame: { type: 'string' }, ids: { type: 'string' }, max: { type: 'string' }, fix: { type: 'boolean' }, scale: { type: 'string' }, transparent: { type: 'boolean' }, theme: { type: 'string' },
  circle: { type: 'boolean' }, project: { type: 'boolean' }, for: { type: 'string' }, force: { type: 'boolean' },
  idle: { type: 'string' }, 'allow-remote': { type: 'boolean' }, request: { type: 'string' }, progress: { type: 'boolean' },
  span: { type: 'string' }, auto: { type: 'boolean' },
  status: { type: 'string' }, body: { type: 'string' }, result: { type: 'string' }, mine: { type: 'boolean' }, take: { type: 'boolean' }, timeout: { type: 'string' },
  role: { type: 'string' }, about: { type: 'string' }, of: { type: 'string' }, clear: { type: 'boolean' }, avatar: { type: 'string' }, list: { type: 'boolean' },
  'title-inside': { type: 'boolean' }, 'text-size': { type: 'string' }, 'font-size': { type: 'string' }, dash: { type: 'string' }, fill: { type: 'string' }, bend: { type: 'string' }, label: { type: 'string' }, live: { type: 'boolean' }, watch: { type: 'boolean' }, unwatch: { type: 'boolean' },
} as const

type Options = ReturnType<typeof parseArgs<{ options: typeof OPTIONS, allowPositionals: true }>>['values']

export const BOARD_COMMANDS = ['skill', 'boards', 'new', 'read', 'lint', 'look', 'export', 'log', 'undo', 'note', 'text', 'shape', 'markdown', 'embed', 'image', 'frame', 'bento', 'span', 'columns', 'arrow', 'update', 'move', 'arrange', 'fit', 'tidy', 'pen', 'point', 'delete', 'apply', 'tickets', 'ticket', 'take', 'done', 'fail', 'wait', 'watch', 'join', 'leave', 'next', 'say', 'finish', 'area', 'who', 'changes', 'members', 'role', 'avatar', 'comments', 'comment', 'board-card', 'screen', 'snap']

const TICKET_COMMANDS = new Set(['ticket', 'take', 'done', 'fail', 'wait'])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What a command runs against: an open board, and how its operations are made. */
export interface CommandContext {
  board: Board
  /** the board's live URL; none for a file */
  url?: string
  /** what the op log files it under */
  boardKey: string
  /**
   * Makes an operation: here and now by default; in a session (../session),
   * on a copy and then put on the board a piece at a time, in the thread of the
   * request being worked on.
   */
  operate<T>(make: (store: Store, where: { area?: { x: number, y: number, w: number, h: number }, prefer?: { x: number, y: number } }) => Operation<T>): Promise<Operation<T>>
  /** stdin's text, for `apply -` */
  stdin(): Promise<string>
  /** in a session: its operations show themselves as they are put, so no pause after */
  session?: boolean
}

export const parseCommand = (argv: string[]) => {
  const { values: o, positionals: [cmd, ...args] } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  return { o, cmd, args }
}

// signal: stops wait and watch
export async function main(argv: string[], out = (s: string) => { process.stdout.write(s + '\n') }, { signal }: { signal?: AbortSignal } = {}) {
  const { o, cmd, args } = parseCommand(argv)
  if (!cmd || o.help || cmd === 'help') return out(BOARD_USAGE)

  const server = serverOf(o.server)
  if (cmd === 'skill') {
    const { installSkill, skillStatus, uninstallSkill } = await import('./skill.ts')
    const opts = { project: o.project, for: o.for, link: o.link, force: o.force }
    const sub = args[0] ?? 'status'
    if (sub === 'install') return out(JSON.stringify(installSkill(opts), null, 2))
    if (sub === 'status') return out(JSON.stringify(skillStatus(opts), null, 2))
    if (sub === 'uninstall') return out(JSON.stringify(uninstallSkill(opts), null, 2))
    throw new Error(`unknown "skill ${sub}" (install, status, uninstall)`)
  }
  if (cmd === 'boards') return out(JSON.stringify(await listBoards(server), null, 2))
  if (cmd === 'avatar' && o.list) return out(JSON.stringify(await listPets(), null, 2)) // on this computer: no board needed
  if (cmd === 'new') {
    const b = await createBoard(server, args.join(' ') || undefined)
    return out(JSON.stringify({ ...b, url: `${server}/b/${b.id}` }))
  }

  const env = process.env.QUICKDRAW_BOARD
  const envFile = env && !/^(wss?|https?):\/\//.test(env) && /[./\\]/.test(env) ? env : undefined
  const file = o.file ?? (o.board ? undefined : envFile)

  // joined (omq join): the session in this directory runs it, on its board
  if (cmd === 'join') {
    if (file) throw new Error('join needs a live board (--board), not a file')
    // named "<agent> · <repository>" unless it says (see SKILL.md)
    const name = argv.some((a) => a === '--name' || a.startsWith('--name=')) ? o.name : `Agent · ${(await import('./skill.ts')).repoName()}`
    return out(JSON.stringify(await joinSession(await resolveBoard(o.board ?? env, server), { name, idle: o.idle ? Number(o.idle) : undefined, remote: o['allow-remote'], role: o.role, avatar: o.avatar && isPath(o.avatar) ? resolve(o.avatar.replace(/^~(?=$|\/)/, process.env.HOME ?? '~')) : o.avatar })))
  }
  if (!file) {
    const s = await findSession(process.cwd())
    // a board the session here is on (any of them): the session runs it, there
    const onIt = (u: string) => u.includes(o.board!) || o.board!.includes(u.split('/').pop()!)
    if (s && (!o.board || [s.url, ...(s.boards ?? [])].some(onIt))) return viaSession(s, argv, out, { signal })
  }
  if (SESSION_COMMANDS.has(cmd)) throw new Error(`${cmd} works once you are on a board: omq join --board ID --name NAME first`)

  const url = file ? undefined : await resolveBoard(o.board ?? env, server)
  const board = await openBoard(url ? { url, name: o.name } : { file: file!, name: o.name })
  try {
    await runCommand({
      board, url, boardKey: url ?? resolve(file!),
      operate: async (make) => make(board.store, {}),
      stdin: () => readStream(process.stdin),
    }, argv, out, { signal })
  } finally {
    await board.close()
  }
}

/** Runs a board command against an open board (see CommandContext). */
export async function runCommand(ctx: CommandContext, argv: string[], out: (s: string) => void, { signal }: { signal?: AbortSignal } = {}) {
  const { o, cmd, args } = parseCommand(argv)
  const { board, url, boardKey, operate } = ctx
  const live = !!url
  {
    const { store } = board
    const size = pair(o.size, 'size')
    // strings from the command line: the operations check them
    const color = o.color as ColorId | undefined
    const textSize = o['text-size'] as TextSize | undefined, dash = o.dash as Dash | undefined
    const style = { textSize, dash, fill: o.fill as Fill | undefined } // the operations check them
    const bend = o.bend == null ? undefined : Number(o.bend)
    const common = { color, at: point(o.at), inFrame: o.in, ...(size ? { w: size[0], h: size[1] } : {}), ...style }
    let done: Operation<unknown>
    // the operations of a command, in a work area when it has one
    // where what has no place goes: a work area, else near where people look (in a session), else right of everything
    const op = <T>(fn: (ops: Operations) => T) => operate((s, where) => runOp(s, o.name, fn, where))
    // takes a ticket; on a live board, null when another agent's take won
    // (the peers agree on one once each has the other's change)
    const take = async (id: string) => {
      const took = await op((ops) => ops.status(id, 'doing', { by: o.name }))
      if (live) await sleep(800)
      return (store.get(id) as { props?: { by?: string } } | undefined)?.props?.by === o.name ? took : null
    }
    const needsLive = () => { if (!live) throw new Error(`${cmd} needs a live board (--board), not a file`) }
    switch (cmd) {
      case 'read': {
        if (o.format === 'json') return out(jsonLines(describeBoard(store)))
        const team = live ? teamText(teamOf(board, o.name)) : '' // who does what
        const linked = live ? await linkedBoardsText(board) : '' // the boards its cards show
        const said = board.comments ? commentsText(store, board.comments) : '' // the threads on the drawings
        return out(boardToMarkdown(store) + [linked, team, said].filter(Boolean).map((t) => '\n\n' + t).join(''))
      }
      case 'members':
        needsLive()
        return out(jsonLines(teamOf(board, o.name)))
      case 'avatar': {
        needsLive()
        const who = o.of ?? o.name
        if (!who) throw new Error('avatar needs your --name (or --of NAME)')
        if (!o.clear && !args[0]) throw new Error('avatar needs a Codex pet: its name (omq avatar --list), its folder or its sprite sheet (or --clear)')
        const set = await setPet(board, who, o.clear ? null : args[0], o.name ?? who)
        if (live) await sleep(300)
        const pet = set?.avatar as { name?: string } | null | undefined
        return out(JSON.stringify({ name: who, avatar: pet?.name ?? null }))
      }
      case 'comments':
        needsLive()
        return out(commentsText(store, board.comments!, { frames: o.frame ? [o.frame] : undefined }) || `No comments${o.frame ? ` on ${o.frame}` : ''}.`)
      case 'comment': {
        needsLive()
        const [frame, ...words] = args
        if (!frame || (store.get(frame) as { isFrame?: boolean } | undefined)?.isFrame !== true) throw new Error('comment needs a frame\'s id (omq read lists them), then the text')
        if (!words.length) throw new Error('comment needs some text')
        const c = board.comments!.add(frame, words.join(' '), o.name)
        if (live) await sleep(300) // out to the others before the board closes
        return out(JSON.stringify({ comment: c.id, frame }))
      }
      case 'role': {
        needsLive()
        const who = o.of ?? o.name
        if (!who) throw new Error('role needs your --name (or --of NAME)')
        if (!o.clear && !args.length && o.about === undefined) throw new Error('role needs a role (or --clear)')
        const set = board.members!.set(who, o.clear ? { role: '', about: '' } : { ...(args.length ? { role: args.join(' ') } : {}), ...(o.about !== undefined ? { about: o.about } : {}) }, o.name)
        if (live) await sleep(300) // out to the others before the board closes
        return out(JSON.stringify(set ? { member: set } : { removed: who }))
      }
      case 'lint': {
        const scope = { frame: o.frame, ids: o.ids?.split(','), words: 'cli' as const } // fixes named as omq commands
        const fixedOp = o.fix ? fixLayout(store, o.name, scope) : null
        if (!fixedOp) {
          const issues = lintBoard(store, scope)
          return out(jsonLines({ problems: issues.length, issues }))
        }
        // fixed: logged as an operation (undo reverts it), then what it did and what is left
        await log({ board: boardKey, op: fixedOp.op, at: new Date().toISOString(), name: o.name, command: 'lint --fix', diff: fixedOp.diff })
        return out(jsonLines({ op: fixedOp.op, fixed: fixedOp.fixed, problems: fixedOp.left.length, issues: fixedOp.left }))
      }
      case 'look': // a small picture to check by: no side over 1000 (`--max`), of a frame, some shapes, or all
        return out(JSON.stringify({ wrote: await exportPng(store, { ...o, out: o.out ?? 'look.png', max: o.max ?? '1000' }) }))
      case 'export': {
        if (o.format === 'png') return out(JSON.stringify({ wrote: await exportPng(store, o) }))
        const { exportJSON } = await import('quickdraw-export')
        const text = o.format === 'md' ? boardToMarkdown(store) : JSON.stringify(exportJSON(store), null, 2)
        if (o.out) { await writeFile(o.out, text + '\n'); return out(JSON.stringify({ wrote: o.out })) }
        return out(text)
      }
      case 'log':
        return out(jsonLines((await readLog(boardKey)).map(({ op, at, name, command }) => ({ op, at, name, command }))))
      case 'undo': {
        const entries = await readLog(boardKey)
        const entry = args[0] ? entries.find((e) => e.op === args[0]) : entries.filter((e) => !e.undone && e.command !== 'undo').at(-1)
        if (!entry) throw new Error(args[0] ? `no operation ${args[0]} on this board` : 'nothing to undo')
        if (!entry.diff) throw new Error(`${entry.op} cannot be undone`)
        const r = undoDiff(store, entry.diff)
        await log({ board: boardKey, op: 'undo:' + entry.op, at: new Date().toISOString(), name: o.name, command: 'undo', undone: entry.op })
        return out(JSON.stringify({ undone: entry.op, ...r }))
      }
      case 'note':
        done = await op((ops) => ops.note(args.join(' '), common)); break
      // shapes, words and arrows have one way on: a unit with apply, every size a number
      case 'text': case 'shape': case 'arrow':
        throw new Error(`${cmd}: draw with omq apply, a unit ({ origin, items }, each item at its at, every size a number; see SKILL.md)`)
      case 'markdown': {
        const md = o['md-file'] ? await readFile(o['md-file'], 'utf8') : args.join(' ')
        done = await op((ops) => ops.markdown(md, common)); break
      }
      case 'board-card': {
        needsLive()
        const target = args[0]
        if (!target) throw new Error('board-card needs a board id (omq boards lists them)')
        const found = (await listBoards(serverOf(o.server ?? (url ? serverOfBoard(url) : undefined)))).find((b: { id: string }) => b.id === target)
        if (!found) throw new Error(`no board ${target} on this server (omq boards lists them)`)
        done = await op((ops) => ops.board({ board: target, title: found.title, live: o.live }, common)); break
      }
      case 'embed': {
        const html = o['html-file'] ? await readFile(o['html-file'], 'utf8') : undefined
        const link = args[0]
        if (html == null && !link) throw new Error('embed needs a URL, or --html-file PAGE.html')
        // a card's title and picture, fetched by the server as the page does; a file board has none
        const preview = html == null && url ? await linkPreview(serverOfBoard(url), link) : undefined
        done = await op((ops) => ops.embed({ url: link, html, link: o.link, title: o.title, preview }, common)); break
      }
      case 'image': {
        if (!args[0]) throw new Error('image needs a file')
        const grid = pair(o.split, 'grid')
        const steps = await imageSteps(resolve(args[0]), {
          w: o.width ? Number(o.width) : undefined, at: point(o.at), in: o.in, frame: o.frame,
          split: grid && { cols: grid[0], rows: grid[1], inset: o.inset ? Number(o.inset) : undefined },
        }, [process.cwd()])
        done = await operate((s, where) => applySteps(s, o.name, steps as never, where)); break
      }
      case 'frame':
        done = await op((ops) => ops.frame(args.join(' ') || 'Frame', { ...common, aspect: parseRatio(o.aspect), around: o.around?.split(','), span: spanOf(o.span), auto: o.auto, titleInside: o['title-inside'] })); break
      case 'bento':
        done = await op((ops) => ops.layout({ cols: o.cols ? Number(o.cols) : undefined, w: o.width ? Number(o.width) : undefined, gap: o.gap ? Number(o.gap) : undefined }, { at: point(o.at) })); break
      case 'span': {
        if (!args[0]) throw new Error('span needs a cell id')
        const cell = store.get(args[0]) as { span?: { auto?: boolean } } | undefined
        done = await op((ops) => ops.span(args[0], { ...spanOf(args[1] ?? o.span), ...(o.auto ? { auto: !cell?.span?.auto } : {}) })); break
      }
      case 'columns':
        done = await op((ops) => ops.columns(args[0], Number(args[1] ?? o.cols))); break
      case 'update':
        done = await op((ops) => ops.update(args[0], { text: o.text, color, ...(size ? { w: size[0], h: size[1] } : {}), ...style, fontSize: o['font-size'] == null ? undefined : Number(o['font-size']), bend, label: o.label })); break
      case 'move': {
        const to = point(o.to), by = pair(o.by, 'offset')
        done = await op((ops) => ops.move(args[0], to ?? { dx: by?.[0] ?? 0, dy: by?.[1] ?? 0 })); break
      }
      case 'arrange':
        done = await op((ops) => ops.arrange(args.join(',').split(',').filter(Boolean), { layout: o.layout as 'grid' | 'row' | 'column' | undefined, cols: o.cols ? Number(o.cols) : undefined, gap: o.gap ? Number(o.gap) : undefined, at: point(o.at) })); break
      case 'fit':
        done = await op((ops) => ops.fit(args[0], { ids: args.slice(1).join(',').split(',').filter(Boolean) })); break
      case 'pen': {
        const kind = args[0] as 'circle' | 'underline' | 'points'
        const points = kind === 'points' ? args.slice(1).join(' ').trim().split(/\s+/).map((p) => pair(p, 'point')!) : undefined
        done = await op((ops) => ops.pen({ kind, id: kind === 'points' ? undefined : args[1], points, color })); break
      }
      case 'point': {
        needsLive()
        const at = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(args[0] ?? '') ? point(args[0])! : null
        const s = at ? null : store.get(args[0])
        if (!at && s?.typeName !== 'shape') throw new Error(`point needs a shape id or X,Y (no shape ${args[0]})`)
        const target = at ?? pageBounds(s as never)
        await pointWith(board.relay!, target, { circle: o.circle })
        return out(JSON.stringify({ pointed: args[0] }))
      }
      case 'tidy':
        done = await op((ops) => ops.tidy({ ids: args.join(',').split(',').filter(Boolean), at: point(o.at), gap: o.gap ? Number(o.gap) : undefined, width: o.width ? Number(o.width) : undefined })); break
      case 'delete':
        done = await op((ops) => ops.delete(args)); break
      case 'tickets': {
        const status = o.status?.split(',').filter(Boolean)
        return out(jsonLines(listTickets(store, { status, for: o.mine ? o.name : o.to }).map(describeTicket)))
      }
      case 'ticket':
        if (!args.length) throw new Error('ticket needs a title')
        done = await op((ops) => ops.ticket(args.join(' '), { body: o.body, to: o.to }, common)); break
      case 'take': {
        const why = cannotTake(store, args[0], o.name)
        if (why) throw new Error(why)
        const took = await take(args[0])
        if (!took) throw new Error(cannotTake(store, args[0], o.name) ?? 'taken by another agent')
        done = took; break
      }
      case 'done': case 'fail':
        done = await op((ops) => ops.status(args[0], cmd === 'done' ? 'done' : 'failed', { result: o.result })); break
      case 'wait': {
        needsLive()
        board.relay!.status('waiting')
        board.relay!.activity('waiting', 'for a ticket')
        const until = o.timeout ? Date.now() + Number(o.timeout) * 1000 : null
        let took = null
        while (!took) {
          const t = await waitFor(board, () => nextTicket(store, o.name), { timeout: until == null ? undefined : Math.max(0, until - Date.now()), signal })
          if (!t) return out(JSON.stringify({ ticket: null, ...(signal?.aborted ? { stopped: true } : { timeout: true }) }))
          if (!o.take) return out(JSON.stringify({ ticket: describeTicket(t) }))
          took = await take(t.id)
        }
        done = took; break
      }
      case 'watch':
        needsLive()
        board.relay!.status('waiting')
        board.relay!.activity('waiting', 'on the tickets')
        return await watchTickets(board, (e) => out(JSON.stringify(e)), { for: o.mine ? o.name : o.to, signal })
      case 'apply': {
        const steps = JSON.parse(args[0] === '-' ? await ctx.stdin() : await readFile(args[0], 'utf8'))
        done = await operate((s, where) => applySteps(s, o.name, steps, { ...where, drawing: 'units' })); break
      }
      default:
        throw new Error(`unknown command "${cmd}" (see --help)`)
    }
    await log({ board: boardKey, op: done.op, at: new Date().toISOString(), name: o.name, command: [cmd, ...args].join(' ').split('\n')[0].slice(0, 120), diff: done.diff })
    // show where the work happened, briefly, to anyone watching the board
    if (!ctx.session) announceMentions(board.relay, done.diff) // in a session, its agent does
    if (live && done.focus && !ctx.session) { board.cursor(done.focus.x, done.focus.y); await new Promise((r) => setTimeout(r, 1200)) }
    const ids = [...new Set([done.result].flat(Infinity).filter((v) => typeof v === 'string'))]
    const ticket = TICKET_COMMANDS.has(cmd) && store.get(ids[0]) ? { ticket: describeTicket(store.get(ids[0])) } : {}
    // a unit (apply with an origin): what each item became, one per line
    const placed = (done as { placed?: unknown[] }).placed
    out(jsonLines({ op: done.op, ids, ...ticket, ...(placed ? { placed } : {}) }))
  }
}
