// Starting another program (claude, codex) the same way everywhere. On
// Windows a command is often not an .exe but a .cmd (what npm installs:
// codex.cmd), which Node does not find by its bare name and will not run
// without a shell (EINVAL since CVE-2024-27980). There it goes through
// cmd.exe, with every argument escaped as cross-spawn does
// (github.com/moxystudio/node-cross-spawn, lib/parse.js and lib/util/escape.js).
import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { normalize } from 'node:path'

// See http://www.robvanderwoude.com/escapechars.php
const META = /([()\][%!^"`<>&|;, *?])/g
const escapeCommand = (arg: string) => arg.replace(META, '^$1')
export function escapeArgument(arg: string, twice: boolean) {
  // backslashes before a quote are doubled and the quote escaped; those at the end doubled (https://qntm.org/cmd)
  arg = `${arg}`.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1')
  arg = `"${arg}"`.replace(META, '^$1')
  return twice ? arg.replace(META, '^$1') : arg
}

export interface Plan { command: string, args: string[], windowsVerbatimArguments?: boolean }

/**
 * How to start `command` with `args`: as it is, except on Windows, where a
 * .cmd or .bat goes through cmd.exe. `resolve` finds the command's file (on
 * Windows: `where`); `read` its text, to tell an npm shim (it passes its
 * arguments on to node, so cmd.exe reads them twice: escaped twice).
 */
export function planSpawn(command: string, args: string[], {
  platform = process.platform, resolve = whereFirst, read = (f: string) => readFileSync(f, 'utf8'), comspec = process.env.comspec || 'cmd.exe',
}: { platform?: string, resolve?: (cmd: string) => string | null, read?: (file: string) => string, comspec?: string } = {}): Plan {
  if (platform !== 'win32') return { command, args }
  const file = resolve(command)
  if (!file || /\.(com|exe)$/i.test(file)) return { command: file ?? command, args }
  let shim = false
  try { shim = /%\*/.test(read(file)) } catch {}
  const line = [escapeCommand(normalize(file)), ...args.map((a) => escapeArgument(a, shim))].join(' ')
  return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true }
}

/** The first file `where` finds for a command on Windows (with its extension), or null. */
export function whereFirst(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try { return execFileSync('where', [command], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || null } catch { return null }
}

/** spawn(), but a Windows .cmd (npm's) runs too. */
export function spawnCommand(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  const plan = planSpawn(command, args, { resolve: (c) => whereFirst(c, options.env ?? process.env) })
  return spawn(plan.command, plan.args, { ...options, ...(plan.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) })
}
