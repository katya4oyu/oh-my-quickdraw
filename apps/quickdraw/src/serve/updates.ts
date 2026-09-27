// The board's Yjs updates, stored as they arrive in SQLite (built-in
// node:sqlite) and merged into one once they pile up.
import { DatabaseSync } from 'node:sqlite'
import * as Y from 'yjs'

export interface Updates {
  state(): Uint8Array
  append(update: Uint8Array): void
  close(): void
}

export function openUpdates(dbPath: string, compactEvery: number): Updates {
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)')
  const insert = db.prepare('INSERT INTO updates (data) VALUES (?)')
  const all = db.prepare('SELECT data FROM updates ORDER BY seq')
  const count = db.prepare('SELECT count(*) AS n FROM updates')
  const state = () => Y.mergeUpdates(all.all().map((r) => r.data as Uint8Array))
  return {
    state,
    append(update) {
      insert.run(update)
      if ((count.get() as { n: number }).n < compactEvery) return
      db.exec('BEGIN')
      try {
        const merged = state()
        db.exec('DELETE FROM updates')
        insert.run(merged)
        db.exec('COMMIT')
      } catch (e) { db.exec('ROLLBACK'); throw e }
    },
    close: () => db.close(),
  }
}
