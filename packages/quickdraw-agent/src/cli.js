// The quickdraw-agent command line. Every command prints JSON (or Markdown
// for `read`), so an agent can call it from any shell.
import { parseArgs } from 'node:util'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openBoard } from './board.js'
import { applySteps, boardToMarkdown, describeBoard, parseRatio, runOp, undoDiff } from './ops.js'

export const USAGE = `quickdraw-agent <command> [args] [--board ws://host/ws | --file board.json] [--name Agent]

Reading
  read [--format md|json]                 the board as a Markdown outline (default) or data
  export [--format json|md] [--out PATH]  the board as a quickdraw JSON file, or the outline

Writing (each command is one operation, undoable as a whole)
  note TEXT [--color C] [--in FRAME] [--at X,Y]
  text TEXT [--color C] [--in FRAME] [--at X,Y]
  shape KIND [LABEL] [--color C] [--size WxH] [--in FRAME] [--at X,Y]   KIND: rectangle, ellipse, …
  markdown TEXT | --md-file PATH [--in FRAME] [--at X,Y]
  frame TITLE [--aspect 16:9] [--around ID,ID,…] [--at X,Y] [--size WxH]
  arrow FROM TO [--color C] [--line]
  update ID [--text TEXT] [--color C]
  move ID (--to X,Y | --by DX,DY)
  arrange ID,ID,… [--layout grid|row|column] [--gap N] [--at X,Y]
  delete ID…                               only shapes an agent added
  apply STEPS.json                          several steps as one operation (see SKILL.md)

History
  log                                       this board's operations, newest last
  undo [OP]                                 the last operation (or OP), where untouched since

The board comes from --board, --file, or $QUICKDRAW_BOARD (a ws:// URL or a file path).`

const pair = (s, what) => {
  if (s == null) return undefined
  const [a, b] = String(s).split(/[,x]/).map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`bad ${what} "${s}"`)
  return [a, b]
}
const point = (s) => { const p = pair(s, 'point'); return p && { x: p[0], y: p[1] } }

// the op log sits next to the work: .quickdraw-agent/log.jsonl, one line per operation
const logFile = () => resolve(process.env.QUICKDRAW_AGENT_LOG || join('.quickdraw-agent', 'log.jsonl'))
async function readLog(board) {
  let text = ''
  try { text = await readFile(logFile(), 'utf8') } catch {}
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.board === board)
}
async function log(entry) {
  await mkdir(resolve(logFile(), '..'), { recursive: true })
  await appendFile(logFile(), JSON.stringify(entry) + '\n')
}

export async function main(argv, out = (s) => process.stdout.write(s + '\n')) {
  const { values: o, positionals: [cmd, ...args] } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      board: { type: 'string' }, file: { type: 'string' }, name: { type: 'string', default: 'Agent' },
      format: { type: 'string' }, out: { type: 'string' }, color: { type: 'string' }, in: { type: 'string' },
      at: { type: 'string' }, size: { type: 'string' }, aspect: { type: 'string' }, around: { type: 'string' },
      text: { type: 'string' }, to: { type: 'string' }, by: { type: 'string' }, layout: { type: 'string' },
      gap: { type: 'string' }, line: { type: 'boolean' }, 'md-file': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  })
  if (!cmd || o.help || cmd === 'help') return out(USAGE)

  const target = o.board ?? o.file ?? process.env.QUICKDRAW_BOARD
  if (!target) throw new Error('which board? pass --board ws://host/ws, --file board.json, or set QUICKDRAW_BOARD')
  const live = /^wss?:\/\//.test(target)
  const board = await openBoard(live ? { url: target, name: o.name } : { file: target, name: o.name })
  const boardKey = live ? target : resolve(target)
  try {
    const { store } = board
    const size = pair(o.size, 'size')
    const common = { color: o.color, at: point(o.at), inFrame: o.in, ...(size ? { w: size[0], h: size[1] } : {}) }
    let done // { op, diff, result, focus }
    switch (cmd) {
      case 'read':
        return out(o.format === 'json' ? JSON.stringify(describeBoard(store), null, 2) : boardToMarkdown(store))
      case 'export': {
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
        const r = undoDiff(store, entry.diff)
        await log({ board: boardKey, op: 'undo:' + entry.op, at: new Date().toISOString(), name: o.name, command: 'undo', undone: entry.op })
        return out(JSON.stringify({ undone: entry.op, ...r }))
      }
      case 'note': case 'text':
        done = runOp(store, o.name, (ops) => ops[cmd](args.join(' '), common)); break
      case 'shape':
        done = runOp(store, o.name, (ops) => ops.shape(args[0], args.slice(1).join(' '), common)); break
      case 'markdown': {
        const md = o['md-file'] ? await readFile(o['md-file'], 'utf8') : args.join(' ')
        done = runOp(store, o.name, (ops) => ops.markdown(md, common)); break
      }
      case 'frame':
        done = runOp(store, o.name, (ops) => ops.frame(args.join(' ') || 'Frame', { ...common, aspect: parseRatio(o.aspect), around: o.around?.split(',') })); break
      case 'arrow':
        done = runOp(store, o.name, (ops) => ops.arrow(args[0], args[1], { color: o.color, line: o.line })); break
      case 'update':
        done = runOp(store, o.name, (ops) => ops.update(args[0], { text: o.text, color: o.color })); break
      case 'move': {
        const to = point(o.to), by = pair(o.by, 'offset')
        done = runOp(store, o.name, (ops) => ops.move(args[0], to ?? { dx: by?.[0] ?? 0, dy: by?.[1] ?? 0 })); break
      }
      case 'arrange':
        done = runOp(store, o.name, (ops) => ops.arrange(args.join(',').split(',').filter(Boolean), { layout: o.layout, gap: o.gap ? Number(o.gap) : undefined, at: point(o.at) })); break
      case 'delete':
        done = runOp(store, o.name, (ops) => ops.delete(args)); break
      case 'apply': {
        const steps = JSON.parse(args[0] === '-' ? await new Response(process.stdin).text() : await readFile(args[0], 'utf8'))
        done = applySteps(store, o.name, steps); break
      }
      default:
        throw new Error(`unknown command "${cmd}" (see --help)`)
    }
    await log({ board: boardKey, op: done.op, at: new Date().toISOString(), name: o.name, command: [cmd, ...args].join(' ').split('\n')[0].slice(0, 120), diff: done.diff })
    // show where the work happened, briefly, to anyone watching the board
    if (live && done.focus) { board.cursor(done.focus.x, done.focus.y); await new Promise((r) => setTimeout(r, 1200)) }
    const ids = [...new Set([done.result].flat(Infinity).filter((v) => typeof v === 'string'))]
    out(JSON.stringify({ op: done.op, ids }))
  } finally {
    await board.close()
  }
}
