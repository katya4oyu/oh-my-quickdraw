// Which board a command works on, and the boards a server holds.
// A board is named by its id (on the server: --server, $QUICKDRAW_SERVER, or
// this machine's `quickdraw serve`), by its page URL (https://host/b/<id>, as
// the browser shows it), or by its relay URL (ws://host/ws/<id>).
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
// the person has to say which (a new one is never made up).
export async function resolveBoard(board: string | undefined, server: string): Promise<string> {
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
  const lines = boards.map((b) => `  ${b.id}  ${b.title}`).join('\n')
  throw new Error(`${server} has ${boards.length} boards; pass --board ID:\n${lines}`)
}
