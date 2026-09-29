// `quickdraw skill`: puts the quickdraw Skill (skills/quickdraw) where agents
// look for skills, so an agent on this machine knows the command.
// - ~/.agents/skills/quickdraw: the Agent Skills location, read by Codex, pi
//   and others (a project's .agents/skills/ with --project)
// - ~/.claude/skills/quickdraw: Claude Code's, a link to the one above
// A copy by default (install again to update; `status` says when it is behind),
// or with --link a link to this checkout, which follows it.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const SKILL_SOURCE = fileURLToPath(new URL('../../../../skills/quickdraw', import.meta.url))
const NAME = 'quickdraw'

export interface SkillOptions {
  /** in this project (.agents/skills, .claude/skills here) rather than for you (in your home) */
  project?: boolean
  /** which agents: 'agents' (Codex, pi, …), 'claude' (Claude Code); both by default */
  for?: string
  /** a link to this checkout instead of a copy */
  link?: boolean
  /** replace a skill named quickdraw that is not this one */
  force?: boolean
  home?: string
  cwd?: string
}

const WHO = { agents: 'Codex, pi and other agents that read Agent Skills', claude: 'Claude Code' } as const
type Target = keyof typeof WHO

function targets(o: SkillOptions): { which: Target[], base: string } {
  const which = (o.for ?? 'agents,claude').split(',').map((s) => s.trim()).filter(Boolean)
  for (const w of which) if (!(w in WHO)) throw new Error(`unknown --for "${w}" (agents, claude)`)
  return { which: which as Target[], base: o.project ? resolve(o.cwd ?? process.cwd()) : (o.home ?? homedir()) }
}
const dirOf = (base: string, t: Target) => join(base, t === 'agents' ? '.agents' : '.claude', 'skills', NAME)

const kind = (p: string) => { try { return lstatSync(p).isSymbolicLink() ? 'link' : 'dir' } catch { return null } }
const where = (p: string) => resolve(dirname(p), readlinkSync(p))
const skillName = (dir: string) => readFileSync(join(dir, 'SKILL.md'), 'utf8').match(/^name:\s*(\S+)/m)?.[1]
// the files of a skill folder, by relative path
function files(dir: string, at = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of readdirSync(join(dir, at), { withFileTypes: true })) {
    const rel = join(at, e.name)
    if (e.isDirectory()) for (const [k, v] of files(dir, rel)) out.set(k, v)
    else out.set(rel, readFileSync(join(dir, rel), 'utf8'))
  }
  return out
}
const same = (a: string, b: string) => { const x = files(a), y = files(b); return x.size === y.size && [...x].every(([k, v]) => y.get(k) === v) }

// what is at a target now: ours (and how), someone else's, or nothing
function state(path: string, agentsDir: string) {
  const k = kind(path)
  if (!k) return { installed: false as const }
  if (k === 'link') {
    const to = where(path)
    const ours = to === SKILL_SOURCE || to === agentsDir
    return { installed: true as const, ours, link: to, current: ours && existsSync(join(to, 'SKILL.md')) && (to === SKILL_SOURCE || same(to, SKILL_SOURCE)) }
  }
  let name: string | undefined
  try { name = skillName(path) } catch {}
  return { installed: true as const, ours: name === NAME, current: name === NAME && same(path, SKILL_SOURCE) }
}

const onPath = () => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', ['quickdraw'], { stdio: 'ignore' }); return true } catch { return false } }

export function installSkill(o: SkillOptions = {}) {
  const { which, base } = targets(o)
  const agentsDir = dirOf(base, 'agents')
  const done: object[] = []
  // agents first: Claude Code's links to it
  for (const t of (['agents', 'claude'] as Target[]).filter((t) => which.includes(t))) {
    const path = dirOf(base, t)
    const now = state(path, agentsDir)
    if (now.installed && !now.ours && !o.force) throw new Error(`${path} holds another skill named ${NAME}: --force replaces it`)
    rmSync(path, { recursive: true, force: true })
    mkdirSync(dirname(path), { recursive: true })
    const viaAgents = t === 'claude' && which.includes('agents')
    const to = o.link ? SKILL_SOURCE : viaAgents ? agentsDir : null
    if (to) symlinkSync(relative(dirname(path), to), path, 'dir')
    else cpSync(SKILL_SOURCE, path, { recursive: true })
    done.push({ for: WHO[t], path, ...(to ? { link: to } : {}) })
  }
  return {
    installed: done, source: SKILL_SOURCE,
    ...(o.link ? {} : { note: 'A copy: run quickdraw skill install again after updating quickdraw (quickdraw skill status says when it is behind).' }),
    ...(onPath() ? {} : { warning: 'quickdraw is not on your PATH, and the skill runs it by that name: npm link -w apps/quickdraw (from the quickdraw-extensions checkout) puts it there.' }),
  }
}

export function skillStatus(o: SkillOptions = {}) {
  const { which, base } = targets(o)
  const agentsDir = dirOf(base, 'agents')
  return {
    source: SKILL_SOURCE,
    skills: which.map((t) => {
      const path = dirOf(base, t)
      const s = state(path, agentsDir)
      return { for: WHO[t], path, ...s, ...(s.installed && s.ours && !s.current ? { note: 'behind this quickdraw: quickdraw skill install' } : {}) }
    }),
  }
}

export function uninstallSkill(o: SkillOptions = {}) {
  const { which, base } = targets(o)
  const agentsDir = dirOf(base, 'agents')
  const removed: string[] = []
  for (const t of which) {
    const path = dirOf(base, t)
    const s = state(path, agentsDir)
    if (!s.installed) continue
    if (!s.ours && !o.force) throw new Error(`${path} holds another skill named ${NAME}: left alone (--force removes it)`)
    rmSync(path, { recursive: true, force: true })
    removed.push(path)
  }
  return { removed }
}
