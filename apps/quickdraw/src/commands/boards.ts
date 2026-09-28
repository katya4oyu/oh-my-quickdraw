// Which board a command works on, and the boards a server holds.
// A board is named by its id (on the server: --server, $QUICKDRAW_SERVER, or
// this machine's `quickdraw serve`), by its page URL (https://host/b/<id>, as
// the browser shows it), or by its relay URL (ws://host/ws/<id>).
import { createInterface } from 'node:readline/promises'
import type { BoardInfo } from '../serve/boards.ts'

export const DEFAULT_SERVER = 'http://localhost:8795'
const ID = /^[a-z0-9]{4,32}$/

export const serverOf = (server?: string) => (server ?? process.env.QUICKDRAW_SERVER ?? DEFAULT_SERVER).replace(/\/+$/, '')
const relayOf = (http: string, id: string) => http.replace(/^http/, 'ws') + '/ws/' + id

async function call<T>(server: string, path: string, init?: RequestInit): Promise<T> {
  let res
  try { res = await fetch(server + path, { ...init, signal: AbortSignal.timeout(5000) }) } catch {
    throw new Error(`no quickdraw serve at ${server} (start one with \`quickdraw serve\`, or pass --server)`)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${server}${path}: ${body.error ?? res.status}`)
  return body
}

export const listBoards = (server: string) => call<BoardInfo[]>(server, '/api/boards')

export const createBoard = (server: string, title?: string) =>
  call<BoardInfo>(server, '/api/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) })

// A board's relay URL. Without a board: the server's only one; with several,
// the person has to say which, through `choose` where there is one (a person
// at a terminal) — a new one is never made up.
export async function resolveBoard(board: string | undefined, server: string, choose?: (boards: BoardInfo[]) => Promise<BoardInfo>): Promise<string> {
  if (board) {
    if (/^wss?:\/\//.test(board)) return board
    const page = board.match(/^(https?:\/\/[^/]+)\/b\/([a-z0-9]+)\/?$/)
    if (page) return relayOf(page[1], page[2])
    if (ID.test(board)) return relayOf(server, board)
    throw new Error(`not a board: "${board}" (an id, https://host/b/ID, or ws://host/ws/ID)`)
  }
  const boards = await listBoards(server)
  if (boards.length === 1) return relayOf(server, boards[0].id)
  if (!boards.length) throw new Error(`${server} has no boards yet: create one with \`quickdraw new "Title"\``)
  if (choose) return relayOf(server, (await choose(boards)).id)
  const lines = boards.map((b) => `  ${b.id}  ${b.title}`).join('\n')
  throw new Error(`${server} has ${boards.length} boards; pass --board ID:\n${lines}`)
}

/** Asks which board, by its number in the list; `command` is how to name it next time. */
export async function chooseBoard(boards: BoardInfo[], command: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<BoardInfo> {
  const width = String(boards.length).length
  output.write('Which board?\n' + boards.map((b, i) => `  ${String(i + 1).padStart(width)}) ${b.title}  (${b.id})`).join('\n') + '\n')
  const rl = createInterface({ input, output, terminal: false })
  const lines = rl[Symbol.asyncIterator]()
  try {
    for (;;) {
      output.write(`Number (1-${boards.length}): `)
      const { value, done } = await lines.next()
      if (done || !value.trim()) throw new Error('no board chosen')
      const board = boards[Number(value.trim()) - 1]
      if (board && /^\d+$/.test(value.trim())) {
        output.write(`Next time: ${command} --board ${board.id}\n`)
        return board
      }
    }
  } finally { rl.close() }
}
