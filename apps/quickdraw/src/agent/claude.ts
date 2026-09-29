// `quickdraw agent claude`: Claude Code on a board, in its own TUI. Claude
// Code works the board through the quickdraw skill and the command (a
// session: ../session), so this only gets everything ready, then hands the
// terminal to `claude`:
// - the skill Claude Code will read is there and current (the repository's,
//   or yours in ~/.claude/skills, which wins when both are there)
// - `quickdraw` runs from Claude's shell (a shim in .quickdraw/bin when it is
//   not on the PATH)
// - this folder is on the board (quickdraw join), and leaves it when Claude exits
import { spawn, execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installSkill, skillStatus } from '../commands/skill.ts'
import { findSession, joinSession, viaSession } from '../session/client.ts'

const BIN = fileURLToPath(new URL('../../bin/quickdraw.ts', import.meta.url))

export interface ClaudeOptions {
  /** the board's relay URL */
  url: string
  name: string
  cwd: string
  remote?: boolean
  idle?: number
  /** without a skill anywhere: install it for you (~/.claude/skills) rather than in this repository */
  global?: boolean
  /** more arguments for `claude` */
  args?: string[]
  /** where the steps are reported (a line each) */
  say?: (line: string) => void
  /** the `claude` to run (tests) */
  claude?: string
  home?: string
}

const onPath = (cmd: string, env = process.env) => {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore', env }); return true } catch { return false }
}

/** Makes sure Claude Code will read a current quickdraw skill; says what it did. */
export function ensureSkill({ cwd, global = false, home }: { cwd: string, global?: boolean, home?: string }): string {
  const mine = skillStatus({ for: 'claude', home }).skills[0]
  if (mine.installed) {
    if (!mine.ours) return `the skill: ${mine.path} holds another skill named quickdraw, which Claude Code reads first; left as it is`
    if (mine.current) return `the skill: yours, up to date (${mine.path})`
    installSkill({ home })
    return `the skill: yours was behind; updated (${mine.path})`
  }
  if (global) { installSkill({ home }); return `the skill: installed for you (${mine.path})` }
  const repo = skillStatus({ project: true, cwd, for: 'claude' }).skills[0]
  if (repo.installed && !repo.ours) return `the skill: ${repo.path} holds another skill named quickdraw; left as it is`
  if (repo.installed && repo.current) return `the skill: in this repository, up to date (${repo.path})`
  installSkill({ project: true, cwd })
  return `the skill: ${repo.installed ? 'updated' : 'installed'} in this repository (${repo.path}; commit it for everyone's agents)`
}

/** A PATH on which `quickdraw` runs: as it is, or with a shim for this checkout in .quickdraw/bin. */
export function quickdrawPath(cwd: string, env = process.env): { path: string, shim?: string } {
  const path = env.PATH ?? ''
  if (onPath('quickdraw', env)) return { path }
  const dir = join(cwd, '.quickdraw', 'bin')
  mkdirSync(dir, { recursive: true })
  const shim = join(dir, process.platform === 'win32' ? 'quickdraw.cmd' : 'quickdraw')
  if (process.platform === 'win32') writeFileSync(shim, `@"${process.execPath}" "${BIN}" %*\r\n`)
  else { writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`); chmodSync(shim, 0o755) }
  return { path: dir + delimiter + path, shim }
}

export const firstPrompt = (name: string, url: string) =>
  `You are "${name}" on a Quickdraw whiteboard (${url}): this folder already joined it (quickdraw join). `
  + 'People on the board ask you things in its AI panel. Use the quickdraw skill: take what is for you with `quickdraw next --timeout 540`, '
  + 'do it (on the board, in this folder, or both), answer with `quickdraw say` and `quickdraw finish`, then `quickdraw next` again. '
  + 'Keep going until I tell you to stop; I may also ask you things here.'

/** Gets ready, runs `claude` in this terminal, and leaves the board when it exits. Resolves to its exit code. */
export async function runClaude(o: ClaudeOptions): Promise<number> {
  const say = o.say ?? ((l: string) => process.stdout.write(l + '\n'))
  const claude = o.claude ?? 'claude'
  const { path, shim } = quickdrawPath(o.cwd)
  if (!onPath(claude, { ...process.env, PATH: path }) && !o.claude) throw new Error('Claude Code (claude) is not installed: https://claude.com/claude-code')
  say(ensureSkill({ cwd: o.cwd, global: o.global, home: o.home }))
  if (shim) say(`quickdraw: not on your PATH, so Claude runs it through ${shim} (npm link -w apps/quickdraw puts it on your PATH)`)
  const joined = await joinSession(o.url, { name: o.name, idle: o.idle, remote: o.remote, cwd: o.cwd })
  say(`the board: ${o.name} is on it (${o.url})${joined.already ? ', as before' : ''}`)
  say('Starting Claude Code…')
  // Ctrl-C is Claude's (the terminal sends it to both): this waits for Claude to exit, then leaves
  const keep = () => {}
  process.on('SIGINT', keep)
  const code = await new Promise<number>((resolve, reject) => {
    // the prompt first: --allowedTools (and others) take every value after them
    const child = spawn(claude, [firstPrompt(o.name, o.url), ...(o.args ?? []), '--allowedTools', 'Bash(quickdraw:*)'], {
      cwd: o.cwd, stdio: 'inherit', env: { ...process.env, PATH: path },
    })
    child.on('error', reject)
    child.on('exit', (c, signal) => resolve(c ?? (signal ? 1 : 0)))
  }).finally(() => process.off('SIGINT', keep))
  // Claude is done: so is its time on the board
  const s = await findSession(o.cwd)
  if (s) await viaSession(s, ['leave'], () => {}).catch(() => {})
  say(`${o.name} left the board.`)
  return code
}
