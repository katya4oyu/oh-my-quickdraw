// The boards and their Yjs updates, in one SQLite file (built-in node:sqlite).
// Updates are stored as they arrive and merged per board once they pile up.
import { randomBytes } from 'node:crypto'
import { existsSync, renameSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import * as Y from 'yjs'

export interface BoardInfo { id: string, title: string, createdAt: string }

export interface Boards {
  list(): BoardInfo[]
  get(id: string): BoardInfo | undefined
  create(title?: string): BoardInfo
  state(id: string): Uint8Array
  append(id: string, update: Uint8Array): void
  close(): void
}

export const BOARD_ID = /^[a-z0-9]{4,32}$/

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const newBoardId = () => [...randomBytes(10)].map((b) => ALPHABET[b % 36]).join('')

export function openBoards(dbPath: string, compactEvery: number): Boards {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL, data BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS updates_board ON updates (board, seq);
  `)
  const listQ = db.prepare('SELECT id, title, created_at AS createdAt FROM boards ORDER BY created_at, id')
  const getQ = db.prepare('SELECT id, title, created_at AS createdAt FROM boards WHERE id = ?')
  const createQ = db.prepare('INSERT INTO boards (id, title, created_at) VALUES (?, ?, ?)')
  const insert = db.prepare('INSERT INTO updates (board, data) VALUES (?, ?)')
  const all = db.prepare('SELECT data FROM updates WHERE board = ? ORDER BY seq')
  const count = db.prepare('SELECT count(*) AS n FROM updates WHERE board = ?')
  const clear = db.prepare('DELETE FROM updates WHERE board = ?')

  const state = (id: string) => Y.mergeUpdates(all.all(id).map((r) => r.data as Uint8Array))
  const boards: Boards = {
    list: () => listQ.all() as unknown as BoardInfo[],
    get: (id) => getQ.get(id) as unknown as BoardInfo | undefined,
    create(title = 'Untitled') {
      const info = { id: newBoardId(), title: title.trim().slice(0, 200) || 'Untitled', createdAt: new Date().toISOString() }
      createQ.run(info.id, info.title, info.createdAt)
      return info
    },
    state,
    append(id, update) {
      insert.run(id, update)
      if ((count.get(id) as { n: number }).n < compactEvery) return
      db.exec('BEGIN')
      try {
        const merged = state(id)
        clear.run(id)
        insert.run(id, merged)
        db.exec('COMMIT')
      } catch (e) { db.exec('ROLLBACK'); throw e }
    },
    close: () => db.close(),
  }
  return boards
}

// A board from before there were several (one `updates` table, no boards):
// becomes a board of its own, once; the old file is kept, renamed.
export function importSingleBoard(boards: Boards, path: string, title = 'Board'): BoardInfo | null {
  if (!existsSync(path)) return null
  const old = new DatabaseSync(path, { readOnly: true })
  let updates: Uint8Array[]
  try { updates = old.prepare('SELECT data FROM updates ORDER BY seq').all().map((r) => r.data as Uint8Array) } finally { old.close() }
  const info = boards.create(title)
  if (updates.length) boards.append(info.id, Y.mergeUpdates(updates))
  renameSync(path, path + '.imported')
  return info
}
