// The board commands of `quickdraw`. Every command prints JSON (or Markdown
// for `read`), so an agent can call it from any shell.
import { parseArgs } from 'node:util'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { text as readStream } from 'node:stream/consumers'
import type { ColorId, Diff, GeoId, Store } from '@quickdrawjs/core'
import { applySteps, boardToMarkdown, describeBoard, fixLayout, lintBoard, parseRatio, runOp, undoDiff, type Operation, type Operations } from 'quickdraw-agent'
import { openBoard, type Board } from '../board/open.ts'
import { announceMentions } from '../board/mentions.ts'
import { pointWith } from '../board/laser.ts'
import { teamOf, teamText } from '../board/team.ts'
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
  export --format png --out PATH [--frame ID|all] [--ids ID,…] [--scale 2] [--transparent] [--theme dark]
                                          an image, drawn by a headless Chrome (needs Chrome installed);
                                          --frame all writes one PNG per frame into the PATH directory

Writing (each command is one operation, undoable as a whole)
  note TEXT [--color C] [--in FRAME] [--at X,Y]
  text TEXT [--color C] [--in FRAME] [--at X,Y]
  shape KIND [LABEL] [--color C] [--size WxH] [--in FRAME] [--at X,Y]   KIND: rectangle, ellipse, …
  markdown TEXT | --md-file PATH [--in FRAME] [--at X,Y]
  embed URL [--link] [--title T] [--size WxH] [--in FRAME] [--at X,Y]
                                          a page (live from allowed sites: YouTube, Vimeo, Figma,
                                          CodePen, Google Maps), else a link card; --link: a card
  embed --html-file PAGE.html [--title T] [--size WxH] [--in FRAME] [--at X,Y]
                                          a self-contained HTML page, run when a viewer presses Run
  image FILE [--width N] [--in FRAME] [--at X,Y]
                                          a PNG, JPEG, GIF or WebP in the working directory
  image FILE --split COLSxROWS [--inset 0.1] [--width N] [--frame TITLE] [--at X,Y]
                                          a sheet cut into its cells, laid out as on the sheet
  frame TITLE [--aspect 16:9] [--around ID,ID,…] [--at X,Y] [--size WxH]
  arrow FROM TO [--color C] [--line]
  update ID [--text TEXT] [--color C] [--size WxH]   --size: a shape's size (not a frame's)
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
  apply STEPS.json                          several steps as one operation (see SKILL.md)

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
                                          minutes (30) without one
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
  leave                                   leaves the board
  Results say what waits for you as "inbox": take it with wait.

The team (live boards): agents' roles — a transcriber, a researcher, a reviewer — so each does what it is
there for and hands the rest to the one whose role fits; people and agents both set them
  members                                 the agents of the board: their roles, who is here, what each works on
  role ROLE [--about TEXT] [--of NAME]    sets your role (--of: another agent's); --clear takes it off
  join … --role ROLE                      joins with a role

History
  log                                       this board's operations, newest last
  undo [OP]                                 the last operation (or OP), where untouched since

--board takes an id, a board's page URL (https://host/b/ID) or its relay URL (ws://host/ws/ID);
or set $QUICKDRAW_BOARD (the same, or a file path). Ids are looked up on --server, $QUICKDRAW_SERVER,
or the \`quickdraw serve\` on this machine (http://localhost:8795). Without a board, the server's
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
    const png = await renderer.render({ ...opts, records, frame: o.frame, ids: o.ids?.split(',') })
    if (!png) throw new Error('nothing to draw')
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
  frame: { type: 'string' }, ids: { type: 'string' }, fix: { type: 'boolean' }, scale: { type: 'string' }, transparent: { type: 'boolean' }, theme: { type: 'string' },
  circle: { type: 'boolean' }, project: { type: 'boolean' }, for: { type: 'string' }, force: { type: 'boolean' },
  idle: { type: 'string' }, 'allow-remote': { type: 'boolean' }, request: { type: 'string' }, progress: { type: 'boolean' },
  status: { type: 'string' }, body: { type: 'string' }, result: { type: 'string' }, mine: { type: 'boolean' }, take: { type: 'boolean' }, timeout: { type: 'string' },
  role: { type: 'string' }, about: { type: 'string' }, of: { type: 'string' }, clear: { type: 'boolean' },
} as const

type Options = ReturnType<typeof parseArgs<{ options: typeof OPTIONS, allowPositionals: true }>>['values']

export const BOARD_COMMANDS = ['skill', 'boards', 'new', 'read', 'lint', 'export', 'log', 'undo', 'note', 'text', 'shape', 'markdown', 'embed', 'image', 'frame', 'arrow', 'update', 'move', 'arrange', 'fit', 'tidy', 'pen', 'point', 'delete', 'apply', 'tickets', 'ticket', 'take', 'done', 'fail', 'wait', 'watch', 'join', 'leave', 'next', 'say', 'finish', 'area', 'who', 'changes', 'members', 'role']

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
  if (cmd === 'new') {
    const b = await createBoard(server, args.join(' ') || undefined)
    return out(JSON.stringify({ ...b, url: `${server}/b/${b.id}` }))
  }

  const env = process.env.QUICKDRAW_BOARD
  const envFile = env && !/^(wss?|https?):\/\//.test(env) && /[./\\]/.test(env) ? env : undefined
  const file = o.file ?? (o.board ? undefined : envFile)

  // joined (quickdraw join): the session in this directory runs it, on its board
  if (cmd === 'join') {
    if (file) throw new Error('join needs a live board (--board), not a file')
    // named "<agent> · <repository>" unless it says (see SKILL.md)
    const name = argv.some((a) => a === '--name' || a.startsWith('--name=')) ? o.name : `Agent · ${(await import('./skill.ts')).repoName()}`
    return out(JSON.stringify(await joinSession(await resolveBoard(o.board ?? env, server), { name, idle: o.idle ? Number(o.idle) : undefined, remote: o['allow-remote'], role: o.role })))
  }
  if (!file) {
    const s = await findSession(process.cwd())
    if (s && (!o.board || s.url.includes(o.board) || o.board.includes(s.url.split('/').pop()!))) return viaSession(s, argv, out, { signal })
  }
  if (SESSION_COMMANDS.has(cmd)) throw new Error(`${cmd} works once you are on a board: quickdraw join --board ID --name NAME first`)

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
    const common = { color, at: point(o.at), inFrame: o.in, ...(size ? { w: size[0], h: size[1] } : {}) }
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
        if (o.format === 'json') return out(JSON.stringify(describeBoard(store), null, 2))
        const team = live ? teamText(teamOf(board, o.name)) : '' // who does what
        return out(boardToMarkdown(store) + (team ? '\n\n' + team : ''))
      }
      case 'members':
        needsLive()
        return out(JSON.stringify(teamOf(board, o.name), null, 2))
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
        const scope = { frame: o.frame, ids: o.ids?.split(',') }
        const fixedOp = o.fix ? fixLayout(store, o.name, scope) : null
        if (!fixedOp) {
          const issues = lintBoard(store, scope)
          return out(JSON.stringify({ problems: issues.length, issues }, null, 2))
        }
        // fixed: logged as an operation (undo reverts it), then what it did and what is left
        await log({ board: boardKey, op: fixedOp.op, at: new Date().toISOString(), name: o.name, command: 'lint --fix', diff: fixedOp.diff })
        return out(JSON.stringify({ op: fixedOp.op, fixed: fixedOp.fixed, problems: fixedOp.left.length, issues: fixedOp.left }, null, 2))
      }
      case 'export': {
        if (o.format === 'png') return out(JSON.stringify({ wrote: await exportPng(store, o) }))
        const { exportJSON } = await import('quickdraw-export')
        const text = o.format === 'md' ? boardToMarkdown(store) : JSON.stringify(exportJSON(store), null, 2)
        if (o.out) { await writeFile(o.out, text + '\n'); return out(JSON.stringify({ wrote: o.out })) }
        return out(text)
      }
      case 'log':
        return out(JSON.stringify((await readLog(boardKey)).map(({ op, at, name, command }) => ({ op, at, name, command })), null, 2))
      case 'undo': {
        const entries = await readLog(boardKey)
        const entry = args[0] ? entries.find((e) => e.op === args[0]) : entries.filter((e) => !e.undone && e.command !== 'undo').at(-1)
        if (!entry) throw new Error(args[0] ? `no operation ${args[0]} on this board` : 'nothing to undo')
        if (!entry.diff) throw new Error(`${entry.op} cannot be undone`)
        const r = undoDiff(store, entry.diff)
        await log({ board: boardKey, op: 'undo:' + entry.op, at: new Date().toISOString(), name: o.name, command: 'undo', undone: entry.op })
        return out(JSON.stringify({ undone: entry.op, ...r }))
      }
      case 'note': case 'text':
        done = await op((ops) => ops[cmd as 'note' | 'text'](args.join(' '), common)); break
      case 'shape':
        done = await op((ops) => ops.shape(args[0] as GeoId, args.slice(1).join(' '), common)); break
      case 'markdown': {
        const md = o['md-file'] ? await readFile(o['md-file'], 'utf8') : args.join(' ')
        done = await op((ops) => ops.markdown(md, common)); break
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
        done = await op((ops) => ops.frame(args.join(' ') || 'Frame', { ...common, aspect: parseRatio(o.aspect), around: o.around?.split(',') })); break
      case 'arrow':
        done = await op((ops) => ops.arrow(args[0], args[1], { color, line: o.line })); break
      case 'update':
        done = await op((ops) => ops.update(args[0], { text: o.text, color, ...(size ? { w: size[0], h: size[1] } : {}) })); break
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
        return out(JSON.stringify(listTickets(store, { status, for: o.mine ? o.name : o.to }).map(describeTicket), null, 2))
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
        done = await operate((s, where) => applySteps(s, o.name, steps, where)); break
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
    out(JSON.stringify({ op: done.op, ids, ...ticket }))
  }
}
