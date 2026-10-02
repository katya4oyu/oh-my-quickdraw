// A session: an agent that has only a shell (a skill and this command) stays
// on a board between its commands. `omq join` starts a process that
// holds the board (./daemon.ts) and leaves it running; every later command in
// the same directory is sent to it over a local socket and runs there, as the
// agent: on the board it already has, in the thread of the request it works on.
//
// The protocol is a line of JSON each way: the command sends { argv, stdin? },
// the session answers { out } for each line of output, then { end: true } or
// { error }. Closing the socket stops a command that waits (next, wait, watch).
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { text as readStream } from 'node:stream/consumers'

/** Commands that only a session runs. */
export const SESSION_COMMANDS = new Set(['next', 'say', 'finish', 'area', 'who', 'changes', 'leave', 'screen', 'snap'])

export interface SessionInfo {
  /** the board's relay URL (the first it joined) */
  url: string
  /** all the boards it is on (their relay URLs) */
  boards?: string[]
  name: string
  socket: string
  pid: number
  cwd: string
}

export const sessionFile = (cwd: string) => join(cwd, '.quickdraw', 'session.json')
// in the temporary directory: a socket's path may not be long (104 bytes on macOS)
export const socketPath = (cwd: string) => {
  const h = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
  return process.platform === 'win32' ? `\\\\.\\pipe\\quickdraw-${h}` : join(tmpdir(), `quickdraw-${h}.sock`)
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }

/** The session in this directory, or null; one whose process is gone is cleared away. */
export async function findSession(cwd: string): Promise<SessionInfo | null> {
  const file = sessionFile(cwd)
  if (!existsSync(file)) return null
  let info: SessionInfo
  try { info = JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
  if (info.pid && alive(info.pid)) return info
  rmSync(file, { force: true })
  return null
}

/** Runs a command in the session: its output lines go to `out`, as the command's would. */
export function viaSession(s: SessionInfo, argv: string[], out: (line: string) => void, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // `apply -`: the steps come from this command's stdin
    const stdin = argv.includes('-') && argv.includes('apply') ? await readStream(process.stdin) : undefined
    const sock = connect(s.socket)
    let buf = '', settled = false
    const finish = (e?: Error) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); sock.end(); if (e) reject(e); else resolve() }
    const onAbort = () => finish()
    signal?.addEventListener('abort', onAbort)
    sock.on('connect', () => sock.write(JSON.stringify({ argv, ...(stdin != null ? { stdin } : {}) }) + '\n'))
    sock.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m
        try { m = JSON.parse(line) } catch { continue }
        if (typeof m.out === 'string') out(m.out)
        else if (m.error) finish(new Error(m.error))
        else if (m.end) finish()
      }
    })
    sock.on('error', (e) => finish(new Error(`the session in this directory is not answering (${(e as Error).message}): omq leave, then join again`)))
    sock.on('close', () => finish(settled ? undefined : new Error('the session ended')))
  })
}

const BIN = fileURLToPath(new URL('../../bin/omq.ts', import.meta.url))

/**
 * Joins a board for the agents of this directory: starts the session process,
 * which stays after this command, and returns once it is on the board.
 */
export async function joinSession(url: string, { name = 'Agent', idle, remote = false, role, avatar, cwd = process.cwd() }: { name?: string, idle?: number, remote?: boolean, role?: string, avatar?: string, cwd?: string } = {}) {
  const had = await findSession(cwd)
  if (had) {
    if (had.name !== name) throw new Error(`already on a board as ${had.name} from this directory: join as ${had.name}, or omq leave first`)
    if (had.url === url || had.boards?.includes(url)) return { joined: true, already: true, board: url, name: had.name, ...(had.boards && had.boards.length > 1 ? { boards: had.boards } : {}) }
    // another board: the session here goes there too (one agent, on several boards)
    let line = ''
    await viaSession(had, ['join-board', url], (l) => { line = l })
    return JSON.parse(line)
  }
  mkdirSync(join(cwd, '.quickdraw'), { recursive: true })
  // what omq keeps here (the session, its log, the op log) is this computer's, not the project's
  if (!existsSync(join(cwd, '.quickdraw', '.gitignore'))) writeFileSync(join(cwd, '.quickdraw', '.gitignore'), '*\n')
  const log = openSync(join(cwd, '.quickdraw', 'session.log'), 'a')
  const child = spawn(process.execPath, [BIN, 'session', '--board', url, '--name', name, ...(idle ? ['--idle', String(idle)] : []), ...(remote ? ['--allow-remote'] : []), ...(role ? ['--role', role] : []), ...(avatar ? ['--avatar', avatar] : [])], {
    cwd, detached: true, stdio: ['ignore', 'pipe', log], env: process.env,
  })
  // its first line says it is on the board (or why not); after that it is on its own
  const first = await new Promise<string>((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('the session did not start in time (see .quickdraw/session.log)')), 30_000)
    child.stdout!.on('data', (d) => {
      buf += d
      const i = buf.indexOf('\n')
      if (i >= 0) { clearTimeout(timer); resolve(buf.slice(0, i)) }
    })
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the session stopped (exit ${code}; see .quickdraw/session.log)`)) })
  })
  child.stdout!.destroy()
  child.unref()
  const r = JSON.parse(first)
  if (r.error) throw new Error(r.error)
  return r
}
