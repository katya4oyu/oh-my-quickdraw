// The boards and their Yjs updates, in one SQLite file (built-in node:sqlite).
// Updates are stored as they arrive and merged per board once they pile up;
// one that cannot be read is set aside (broken_updates), the rest still load.
// A board is saved as it changes; besides that it can be renamed, archived
// (hidden from the list, kept), copied, made from a JSON file, and keep
// versions: whole-board snapshots, made by hand or before an AI request, that
// can be restored over it or opened as a board of their own. Boards have tags
// (to group and find them), and link to the boards their cards show
// (quickdraw-boards): together, a graph of the boards.
import { randomBytes } from 'node:crypto'
import { existsSync, renameSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import * as Y from 'yjs'

export interface BoardInfo { id: string, title: string, createdAt: string, archivedAt?: string, thumbnailAt?: string, tags?: string[] }
/** the boards and how they hang together: a board's cards for other boards (links), and its tags */
/** a link from a board to another: it shows it on a card (quickdraw-boards), or names it (its page URL, …/b/ID, in a note, a text, a link card, Markdown) */
export interface BoardLink { from: string, to: string, kind: 'card' | 'mention' }
export interface BoardGraph { boards: BoardInfo[], links: BoardLink[] }
export interface Thumbnail { data: Uint8Array, type: string, at: string }
export interface VersionInfo { id: number, name: string, at: string, auto: boolean }
type Rec = { id: string } & Record<string, unknown>

export interface Boards {
  /** the boards, oldest first; archived ones only with `archived` */
  list(opts?: { archived?: boolean }): BoardInfo[]
  get(id: string): BoardInfo | undefined
  create(title?: string): BoardInfo
  /** a new board holding these records (a board's shapes and assets, as a JSON file has them) */
  createFrom(title: string, records: Rec[]): BoardInfo
  /** a new board with what `id` holds now */
  duplicate(id: string, title?: string): BoardInfo
  rename(id: string, title: string): BoardInfo
  archive(id: string, archived: boolean): BoardInfo
  /** its tags, as given (trimmed, without #, each once whatever its case; up to 20 of 40 characters) */
  setTags(id: string, tags: string[]): BoardInfo
  /** the boards a board shows on cards (quickdraw-boards) and names by their page URL, read from what it holds now */
  links(id: string): { to: string, kind: 'card' | 'mention' }[]
  /** every board (archived ones too) and the links between them */
  graph(): BoardGraph
  state(id: string): Uint8Array
  append(id: string, update: Uint8Array): void
  /** keeps the board as it is now; automatic versions beyond the last 20 are let go */
  saveVersion(id: string, name: string, auto?: boolean): VersionInfo
  versions(id: string): VersionInfo[]
  /** puts the board back as it was in version `vid`: the update that does it (appended; send it to the peers) */
  restore(id: string, vid: number): Uint8Array
  /** a new board as the board was in version `vid` */
  openVersion(id: string, vid: number, title?: string): BoardInfo
  /** a small picture of the board for the list, as a page that has it open draws it */
  setThumbnail(id: string, data: Uint8Array, type: string): void
  thumbnail(id: string): Thumbnail | undefined
  close(): void
}

const MAP = 'quickdraw' // quickdraw-yjs's map: record id -> record
const AUTO_VERSIONS = 20

export const BOARD_ID = /^[a-z0-9]{4,32}$/

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const newBoardId = () => [...randomBytes(10)].map((b) => ALPHABET[b % 36]).join('')

export function openBoards(dbPath: string, compactEvery: number): Boards {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL, data BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS updates_board ON updates (board, seq);
    CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL, name TEXT NOT NULL, at TEXT NOT NULL, auto INTEGER NOT NULL, state BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS versions_board ON versions (board, id);
    CREATE TABLE IF NOT EXISTS thumbnails (board TEXT PRIMARY KEY, type TEXT NOT NULL, at TEXT NOT NULL, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS broken_updates (seq INTEGER PRIMARY KEY, board TEXT NOT NULL, at TEXT NOT NULL, error TEXT NOT NULL, data BLOB NOT NULL);
  `)
  const columns = db.prepare('PRAGMA table_info(boards)').all().map((c) => c.name)
  if (!columns.includes('archived_at')) db.exec('ALTER TABLE boards ADD COLUMN archived_at TEXT')
  if (!columns.includes('tags')) db.exec('ALTER TABLE boards ADD COLUMN tags TEXT')
  const COLS = 'id, title, created_at AS createdAt, archived_at AS archivedAt, tags, (SELECT at FROM thumbnails WHERE board = boards.id) AS thumbnailAt'
  const listQ = db.prepare(`SELECT ${COLS} FROM boards WHERE archived_at IS NULL ORDER BY created_at, id`)
  const listArchivedQ = db.prepare(`SELECT ${COLS} FROM boards WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, id`)
  const getQ = db.prepare(`SELECT ${COLS} FROM boards WHERE id = ?`)
  const setThumbQ = db.prepare('INSERT INTO thumbnails (board, type, at, data) VALUES (?, ?, ?, ?) ON CONFLICT (board) DO UPDATE SET type = excluded.type, at = excluded.at, data = excluded.data')
  const thumbQ = db.prepare('SELECT data, type, at FROM thumbnails WHERE board = ?')
  const renameQ = db.prepare('UPDATE boards SET title = ? WHERE id = ?')
  const archiveQ = db.prepare('UPDATE boards SET archived_at = ? WHERE id = ?')
  const tagsQ = db.prepare('UPDATE boards SET tags = ? WHERE id = ?')
  const lastSeqQ = db.prepare('SELECT max(seq) AS seq FROM updates WHERE board = ?')
  const saveQ = db.prepare('INSERT INTO versions (board, name, at, auto, state) VALUES (?, ?, ?, ?, ?)')
  const versionsQ = db.prepare('SELECT id, name, at, auto FROM versions WHERE board = ? ORDER BY id DESC')
  const versionQ = db.prepare('SELECT state FROM versions WHERE board = ? AND id = ?')
  const pruneQ = db.prepare('DELETE FROM versions WHERE board = ? AND auto = 1 AND id NOT IN (SELECT id FROM versions WHERE board = ? AND auto = 1 ORDER BY id DESC LIMIT ?)')
  const createQ = db.prepare('INSERT INTO boards (id, title, created_at) VALUES (?, ?, ?)')
  const insert = db.prepare('INSERT INTO updates (board, data) VALUES (?, ?)')
  const all = db.prepare('SELECT seq, data FROM updates WHERE board = ? ORDER BY seq')
  const count = db.prepare('SELECT count(*) AS n FROM updates WHERE board = ?')
  const clear = db.prepare('DELETE FROM updates WHERE board = ?')
  const setAsideQ = db.prepare('INSERT INTO broken_updates (seq, board, at, error, data) SELECT seq, board, ?, ?, data FROM updates WHERE seq = ?')
  const dropQ = db.prepare('DELETE FROM updates WHERE seq = ?')

  const state = (id: string) => {
    const rows = all.all(id) as { seq: number, data: Uint8Array }[]
    try { return Y.mergeUpdates(rows.map((r) => r.data)) } catch {}
    // one of them cannot be read (cut short, say): set it aside, keep the rest
    const good: Uint8Array[] = []
    const at = new Date().toISOString()
    const inTx = db.isTransaction
    if (!inTx) db.exec('BEGIN')
    try {
      for (const { seq, data } of rows) {
        try { Y.decodeUpdate(data); good.push(data); continue } catch (e) {
          setAsideQ.run(at, (e as Error).message, seq)
          dropQ.run(seq)
          console.warn(`board ${id}: set aside update ${seq} (${data.length} bytes), it cannot be read: ${(e as Error).message}`)
        }
      }
      if (!inTx) db.exec('COMMIT')
    } catch (e) { if (!inTx) db.exec('ROLLBACK'); throw e }
    return Y.mergeUpdates(good)
  }
  // no null fields: archivedAt, thumbnailAt and tags only when there are
  const clean = (b: BoardInfo | undefined) => {
    if (!b) return b
    const tags = typeof b.tags === 'string' ? JSON.parse(b.tags) as string[] : []
    return Object.fromEntries(Object.entries({ ...b, tags: tags.length ? tags : null }).filter(([, v]) => v != null)) as unknown as BoardInfo
  }
  // the links of a board as of its last update, kept until it changes
  const linked = new Map<string, { seq: number | null, to: { to: string, kind: 'card' | 'mention' }[] }>()
  const need = (id: string) => {
    const b = boards.get(id)
    if (!b) throw new Error('no such board')
    return b
  }
  const title = (t: string | undefined, fallback: string) => (t ?? '').trim().slice(0, 200) || fallback
  // a board's records as a Yjs update, for a board of its own
  const docOf = (records: Rec[]) => {
    const doc = new Y.Doc()
    const map = doc.getMap(MAP)
    doc.transact(() => { for (const r of records) map.set(r.id, r) })
    return Y.encodeStateAsUpdate(doc)
  }
  const recordsOf = (update: Uint8Array) => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, update)
    return doc.getMap(MAP).toJSON() as Record<string, Rec>
  }
  const versionState = (id: string, vid: number) => {
    const row = versionQ.get(id, vid) as { state: Uint8Array } | undefined
    if (!row) throw new Error('no such version')
    return row.state
  }
  const boards: Boards = {
    list: ({ archived = false } = {}) => (archived ? listArchivedQ : listQ).all().map((b) => clean(b as unknown as BoardInfo)!) as BoardInfo[],
    get: (id) => clean(getQ.get(id) as unknown as BoardInfo | undefined),
    create(title = 'Untitled') {
      const info = { id: newBoardId(), title: title.trim().slice(0, 200) || 'Untitled', createdAt: new Date().toISOString() }
      createQ.run(info.id, info.title, info.createdAt)
      return info
    },
    createFrom(t, records) {
      const info = boards.create(title(t, 'Imported'))
      if (records.length) boards.append(info.id, docOf(records))
      return info
    },
    duplicate(id, t) {
      const from = need(id)
      const info = boards.create(title(t, `${from.title} (copy)`))
      boards.append(info.id, docOf(Object.values(recordsOf(state(id)))))
      return info
    },
    rename(id, t) {
      need(id)
      renameQ.run(title(t, 'Untitled'), id)
      return need(id)
    },
    archive(id, archived) {
      need(id)
      archiveQ.run(archived ? new Date().toISOString() : null, id)
      return need(id)
    },
    setTags(id, tags) {
      need(id)
      const seen = new Set<string>(), keep: string[] = []
      for (const t of tags) {
        const tag = String(t).replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 40)
        if (tag && !seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); keep.push(tag) }
      }
      tagsQ.run(keep.length ? JSON.stringify(keep.slice(0, 20)) : null, id)
      return need(id)
    },
    links(id) {
      need(id)
      const seq = (lastSeqQ.get(id) as { seq: number | null }).seq
      const hit = linked.get(id)
      if (hit && hit.seq === seq) return hit.to
      const cards = new Set<string>(), named = new Set<string>()
      if (seq != null) for (const r of Object.values(recordsOf(state(id)))) {
        if (r.type === 'boardcard' && typeof (r.props as { board?: unknown })?.board === 'string') { cards.add((r.props as { board: string }).board); continue }
        // a board named by its page URL anywhere in what a shape holds (a note, a text, a link card, Markdown)
        if (r.typeName === 'shape') for (const m of JSON.stringify(r.props ?? {}).matchAll(/\/b\/([a-z0-9]{4,32})(?![a-z0-9])/g)) named.add(m[1])
      }
      const to = [...[...cards].map((b) => ({ to: b, kind: 'card' as const })), ...[...named].filter((b) => !cards.has(b)).map((b) => ({ to: b, kind: 'mention' as const }))].filter((l) => l.to !== id)
      linked.set(id, { seq, to })
      return to
    },
    graph() {
      const all = [...boards.list(), ...boards.list({ archived: true })]
      const ids = new Set(all.map((b) => b.id))
      return { boards: all, links: all.flatMap((b) => boards.links(b.id).filter((l) => ids.has(l.to)).map((l) => ({ from: b.id, ...l }))) }
    },
    saveVersion(id, name, auto = false) {
      need(id)
      const at = new Date().toISOString()
      const { lastInsertRowid } = saveQ.run(id, title(name, 'Version'), at, auto ? 1 : 0, state(id))
      if (auto) pruneQ.run(id, id, AUTO_VERSIONS)
      return { id: Number(lastInsertRowid), name: title(name, 'Version'), at, auto }
    },
    versions: (id) => versionsQ.all(id).map((v) => ({ ...(v as unknown as VersionInfo), auto: (v as { auto: number }).auto === 1 })),
    restore(id, vid) {
      const target = recordsOf(versionState(id, vid))
      // the board as it is, changed to what the version holds: an ordinary update
      const doc = new Y.Doc()
      Y.applyUpdate(doc, state(id))
      const map = doc.getMap(MAP)
      let update: Uint8Array = new Uint8Array()
      doc.on('update', (u: Uint8Array) => { update = u })
      doc.transact(() => {
        for (const key of [...map.keys()]) if (!(key in target)) map.delete(key)
        for (const [key, rec] of Object.entries(target)) if (JSON.stringify(map.get(key)) !== JSON.stringify(rec)) map.set(key, rec)
      })
      if (update.length) boards.append(id, update)
      return update
    },
    openVersion(id, vid, t) {
      const from = need(id)
      const records = Object.values(recordsOf(versionState(id, vid)))
      return boards.createFrom(title(t, `${from.title} (version)`), records)
    },
    setThumbnail(id, data, type) {
      need(id)
      setThumbQ.run(id, type, new Date().toISOString(), data)
    },
    thumbnail: (id) => thumbQ.get(id) as unknown as Thumbnail | undefined,
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
