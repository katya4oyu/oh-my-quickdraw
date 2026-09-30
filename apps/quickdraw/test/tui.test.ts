import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CODEX_RULE, ensureCodexRule, ensureSkill, firstPrompt, quickdrawPath, runTui } from '../src/agent/tui.ts'
import { installSkill, SKILL_SOURCE } from '../src/commands/skill.ts'
import { sessionFile } from '../src/session/client.ts'
import { createQuickdrawServer } from '../src/serve/index.ts'

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'qd-claude-')))
const repo = () => { const dir = temp(); execFileSync('git', ['init', '-q'], { cwd: dir }); return dir }

describe('quickdraw agent claude and codex', () => {
  let app: ReturnType<typeof createQuickdrawServer> | undefined
  afterEach(() => app?.close())

  it('puts the skill in the repository when Claude Code has none, and keeps whichever it reads current', () => {
    const home = temp(), cwd = repo()
    expect(ensureSkill({ cwd, home })).toMatch(/installed in this repository/)
    expect(readFileSync(join(cwd, '.claude/skills/quickdraw/SKILL.md'), 'utf8')).toBe(readFileSync(join(SKILL_SOURCE, 'SKILL.md'), 'utf8'))
    expect(ensureSkill({ cwd, home })).toMatch(/in this repository, up to date/)
    // yours (~/.claude/skills) is what Claude Code reads first: that one is kept current
    installSkill({ home })
    writeFileSync(join(home, '.agents/skills/quickdraw/SKILL.md'), '---\nname: quickdraw\n---\nold')
    expect(ensureSkill({ cwd, home })).toMatch(/yours was behind; updated/)
    expect(ensureSkill({ cwd, home })).toMatch(/yours, up to date/)
    // --global: for you, when there is none
    expect(ensureSkill({ cwd: repo(), home: temp(), global: true })).toMatch(/installed for you/)
  })

  it('makes quickdraw runnable for Claude when it is not on the PATH', () => {
    const cwd = temp()
    const { path, shim } = quickdrawPath(cwd, { PATH: '/usr/bin:/bin' })
    expect(shim).toBe(join(cwd, '.quickdraw/bin/quickdraw'))
    expect(execFileSync('quickdraw', ['help'], { env: { PATH: path }, encoding: 'utf8' })).toMatch(/Board commands/)
  })

  it('gets ready, joins, runs claude with the board to work on, and leaves when it exits', async () => {
    app = createQuickdrawServer()
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('CC').id}`
    const cwd = repo(), home = temp()
    // a stand-in for claude: says what it was given, and asks the board who is here, as Claude would
    const fake = join(temp(), 'claude')
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "${cwd}/args.txt"\nquickdraw who > "${cwd}/who.txt"\nexit 3\n`)
    chmodSync(fake, 0o755)
    const said: string[] = []
    const code = await runTui('claude', { url, name: 'Claude', cwd, home, command: fake, args: ['--model', 'opus'], say: (l: string) => said.push(l) })
    expect(code).toBe(3)
    const args = readFileSync(join(cwd, 'args.txt'), 'utf8').trim().split('\n')
    expect(args).toEqual([firstPrompt('Claude', url), '--model', 'opus', '--allowedTools', 'Bash(quickdraw:*)'])
    expect(JSON.parse(readFileSync(join(cwd, 'who.txt'), 'utf8'))).toMatchObject({ you: 'Claude' }) // through the session
    expect(said[0]).toMatch(/installed in this repository/)
    expect(said).toContain(`the board: Claude is on it (${url})`)
    expect(firstPrompt('Claude', url)).toContain('in the background')
    expect(firstPrompt('Codex', url, 'codex')).toContain('--timeout 100')
    expect(firstPrompt('Codex', url, 'codex')).toContain('Before you take a ticket, ask me')
    expect(existsSync(sessionFile(cwd))).toBe(false) // left
  }, 30_000)

  it('for Codex: the Agent Skills copy, and a rule that lets quickdraw out of its sandbox', async () => {
    const home = temp(), cwd = repo()
    expect(ensureSkill({ cwd, home, tui: 'codex' })).toMatch(/installed in this repository/)
    expect(existsSync(join(cwd, '.agents/skills/quickdraw/SKILL.md'))).toBe(true)
    const sub = join(cwd, 'app')
    execFileSync('mkdir', ['-p', sub])
    expect(ensureCodexRule(sub)).toMatch(/written to/) // at the repository's root, from any folder in it
    expect(readFileSync(join(cwd, '.codex/rules/quickdraw.rules'), 'utf8')).toBe(CODEX_RULE)
    expect(ensureCodexRule(cwd)).not.toMatch(/written/)

    app = createQuickdrawServer()
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('CX').id}`
    const fake = join(temp(), 'codex')
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "${cwd}/args.txt"\nquickdraw who > "${cwd}/who.txt"\n`)
    chmodSync(fake, 0o755)
    const said: string[] = []
    expect(await runTui('codex', { url, name: 'Codex', cwd, home, command: fake, args: ['-m', 'gpt-6'], say: (l: string) => said.push(l) })).toBe(0)
    expect(readFileSync(join(cwd, 'args.txt'), 'utf8').trim().split('\n')).toEqual(['-m', 'gpt-6', firstPrompt('Codex', url, 'codex')])
    expect(JSON.parse(readFileSync(join(cwd, 'who.txt'), 'utf8'))).toMatchObject({ you: 'Codex' })
    expect(said.some((l) => l.startsWith('the rule:'))).toBe(true)
    expect(existsSync(sessionFile(cwd))).toBe(false)
  }, 30_000)
})
