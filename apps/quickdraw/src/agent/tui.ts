// `quickdraw agent claude` and `quickdraw agent codex`: Claude Code or Codex
// on a board, in its own TUI. It works the board through the quickdraw skill
// and the command (a session: ../session), so this only gets everything
// ready, then hands the terminal to it:
// - the skill it will read is there and current: yours (~/.claude/skills for
//   Claude Code, ~/.agents/skills for Codex) when you have one, else the
//   repository's, at its root
// - `quickdraw` runs from its shell: a shim in .quickdraw/bin when it is not
//   on the PATH; for Codex, a rule that lets `quickdraw` out of its sandbox
//   (it reaches the board: a local socket and the board's server)
// - this folder is on the board (quickdraw join), and leaves it when it exits
import { spawn, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installSkill, projectRoot, skillStatus } from '../commands/skill.ts'
import { findSession, joinSession, viaSession } from '../session/client.ts'

const BIN = fileURLToPath(new URL('../../bin/quickdraw.ts', import.meta.url))

export type Tui = 'claude' | 'codex'
const TUIS = {
  claude: { name: 'Claude Code', command: 'claude', skills: 'claude' as const, install: 'https://claude.com/claude-code' },
  codex: { name: 'Codex', command: 'codex', skills: 'agents' as const, install: 'https://developers.openai.com/codex' },
}

export interface TuiOptions {
  /** the board's relay URL */
  url: string
  name: string
  cwd: string
  remote?: boolean
  idle?: number
  /** without a skill anywhere: install it for you rather than in this repository */
  global?: boolean
  /** more arguments for the TUI */
  args?: string[]
  /** where the steps are reported (a line each) */
  say?: (line: string) => void
  /** the command to run instead (tests) */
  command?: string
  home?: string
}

const onPath = (cmd: string, env = process.env) => {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore', env }); return true } catch { return false }
}

/** Makes sure the TUI will read a current quickdraw skill; says what it did. */
export function ensureSkill({ cwd, global = false, home, tui = 'claude' }: { cwd: string, global?: boolean, home?: string, tui?: Tui }): string {
  const { name, skills } = TUIS[tui]
  const mine = skillStatus({ for: skills, home }).skills[0]
  if (mine.installed) {
    if (!mine.ours) return `the skill: ${mine.path} holds another skill named quickdraw, which ${name} reads first; left as it is`
    if (mine.current) return `the skill: yours, up to date (${mine.path})`
    installSkill({ home })
    return `the skill: yours was behind; updated (${mine.path})`
  }
  if (global) { installSkill({ home }); return `the skill: installed for you (${mine.path})` }
  const repo = skillStatus({ project: true, cwd, for: skills }).skills[0]
  if (repo.installed && !repo.ours) return `the skill: ${repo.path} holds another skill named quickdraw; left as it is`
  if (repo.installed && repo.current) return `the skill: in this repository, up to date (${repo.path})`
  installSkill({ project: true, cwd })
  return `the skill: ${repo.installed ? 'updated' : 'installed'} in this repository (${repo.path}; commit it for everyone's agents)`
}

// Codex runs commands in a sandbox without network by default; quickdraw
// reaches the board (a local socket, the board's server), so it may run
// outside it, and only it (Codex's rules: developers.openai.com/codex/rules)
export const CODEX_RULE = `# quickdraw reaches the Quickdraw board this folder joined (a local socket, the board's server):
# it runs outside Codex's sandbox, without asking. Written by quickdraw agent codex.
prefix_rule(
    pattern = ["quickdraw"],
    decision = "allow",
    justification = "quickdraw talks to the Quickdraw board this folder joined",
    match = ["quickdraw next --timeout 540", "quickdraw note hi"],
    not_match = ["quickdraw-other", "sh quickdraw"],
)
`
/** The rule in the repository's .codex/rules (Codex reads a project's rules once you trust the project). */
export function ensureCodexRule(cwd: string): string {
  const file = join(projectRoot(cwd), '.codex', 'rules', 'quickdraw.rules')
  if (existsSync(file) && readFileSync(file, 'utf8') === CODEX_RULE) return `the rule: quickdraw may leave Codex's sandbox (${file})`
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, CODEX_RULE)
  return `the rule: quickdraw may leave Codex's sandbox, written to ${file} (Codex reads it once you trust this project; else it asks to run quickdraw outside the sandbox: allow it)`
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
  + 'People on the board ask you things in its AI panel. Use the quickdraw skill: take what is for you (requests, mentions, tickets) with `quickdraw wait --timeout 540`, '
  + 'do it (on the board, in this folder, or both), answer with `quickdraw say` and `quickdraw finish`, then `quickdraw wait` again. '
  + 'Keep going until I tell you to stop; I may also ask you things here.'

// what the TUI is started with: the first prompt, and what lets it run quickdraw
function argsFor(tui: Tui, prompt: string, args: string[]) {
  // Claude Code: the prompt first (--allowedTools takes every value after it)
  if (tui === 'claude') return [prompt, ...args, '--allowedTools', 'Bash(quickdraw:*)']
  return [...args, prompt] // Codex: the rule does it
}

/** Gets ready, runs the TUI in this terminal, and leaves the board when it exits. Resolves to its exit code. */
export async function runTui(tui: Tui, o: TuiOptions): Promise<number> {
  const t = TUIS[tui]
  const say = o.say ?? ((l: string) => process.stdout.write(l + '\n'))
  const command = o.command ?? t.command
  const { path, shim } = quickdrawPath(o.cwd)
  if (!o.command && !onPath(command, { ...process.env, PATH: path })) throw new Error(`${t.name} (${command}) is not installed: ${t.install}`)
  say(ensureSkill({ cwd: o.cwd, global: o.global, home: o.home, tui }))
  if (tui === 'codex') say(ensureCodexRule(o.cwd))
  if (shim) say(`quickdraw: not on your PATH, so ${t.name} runs it through ${shim} (npm link -w apps/quickdraw puts it on your PATH)`)
  const joined = await joinSession(o.url, { name: o.name, idle: o.idle, remote: o.remote, cwd: o.cwd })
  say(`the board: ${o.name} is on it (${o.url})${joined.already ? ', as before' : ''}`)
  say(`Starting ${t.name}…`)
  // Ctrl-C is the TUI's (the terminal sends it to both): this waits for it to exit, then leaves
  const keep = () => {}
  process.on('SIGINT', keep)
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, argsFor(tui, firstPrompt(o.name, o.url), o.args ?? []), {
      cwd: o.cwd, stdio: 'inherit', env: { ...process.env, PATH: path },
    })
    child.on('error', reject)
    child.on('exit', (c, signal) => resolve(c ?? (signal ? 1 : 0)))
  }).finally(() => process.off('SIGINT', keep))
  // it is done: so is its time on the board
  const s = await findSession(o.cwd)
  if (s) await viaSession(s, ['leave'], () => {}).catch(() => {})
  say(`${o.name} left the board.`)
  return code
}
