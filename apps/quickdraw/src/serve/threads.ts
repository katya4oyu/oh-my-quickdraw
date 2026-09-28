// Requests to agents and what happened since, per board: one row per request,
// one per event. A thread is its events replayed (as the panel does), so what
// a page gets after reloading is what it saw live. Not in the board's Yjs
// document: the board stays the board.
import { DatabaseSync } from 'node:sqlite'
import { updateAgentThread, type AgentEvent, type AgentRequest, type AgentThread } from 'quickdraw-agent'

export interface Threads {
  create(board: string, request: AgentRequest): AgentThread
  /** the thread with the event added, or undefined for no such request */
  append(requestId: string, event: AgentEvent): AgentThread | undefined
  get(requestId: string): { board: string, thread: AgentThread } | undefined
  /** a board's threads, oldest first (the latest `limit`) */
  list(board: string, limit?: number): AgentThread[]
  close(): void
}

export function openThreads(dbPath: string): Threads {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, board TEXT NOT NULL, request TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS threads_board ON threads (board, created_at);
    CREATE TABLE IF NOT EXISTS thread_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS thread_events_thread ON thread_events (thread, seq);
  `)
  const insertThread = db.prepare('INSERT INTO threads (id, board, request, created_at) VALUES (?, ?, ?, ?)')
  const insertEvent = db.prepare('INSERT INTO thread_events (thread, data) VALUES (?, ?)')
  const one = db.prepare('SELECT board, request FROM threads WHERE id = ?')
  const events = db.prepare('SELECT data FROM thread_events WHERE thread = ? ORDER BY seq')
  const latest = db.prepare('SELECT id FROM (SELECT id, created_at FROM threads WHERE board = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at')

  const replay = (request: AgentRequest, id: string): AgentThread =>
    events.all(id).reduce<AgentThread>((t, r) => updateAgentThread(t, JSON.parse(r.data as string)), { request, events: [], diffs: [], status: 'working' })

  const threads: Threads = {
    create(board, request) {
      insertThread.run(request.id, board, JSON.stringify(request), new Date().toISOString())
      return { request, events: [], diffs: [], status: 'working' }
    },
    append(requestId, event) {
      if (!one.get(requestId)) return undefined
      insertEvent.run(requestId, JSON.stringify(event))
      return threads.get(requestId)!.thread
    },
    get(requestId) {
      const row = one.get(requestId) as { board: string, request: string } | undefined
      return row && { board: row.board, thread: replay(JSON.parse(row.request), requestId) }
    },
    list: (board, limit = 200) => latest.all(board, limit).map((r) => threads.get(r.id as string)!.thread),
    close: () => db.close(),
  }
  return threads
}
