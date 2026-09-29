import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureSkill, firstPrompt, quickdrawPath, runClaude } from '../src/agent/claude.ts'
import { installSkill, SKILL_SOURCE } from '../src/commands/skill.ts'
import { sessionFile } from '../src/session/client.ts'
import { createQuickdrawServer } from '../src/serve/index.ts'

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'qd-claude-')))
const repo = () => { const dir = temp(); execFileSync('git', ['init', '-q'], { cwd: dir }); return dir }

describe('quickdraw agent claude', () => {
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
    const code = await runClaude({ url, name: 'Claude', cwd, home, claude: fake, args: ['--model', 'opus'], say: (l) => said.push(l) })
    expect(code).toBe(3)
    const args = readFileSync(join(cwd, 'args.txt'), 'utf8').trim().split('\n')
    expect(args).toEqual([firstPrompt('Claude', url), '--model', 'opus', '--allowedTools', 'Bash(quickdraw:*)'])
    expect(JSON.parse(readFileSync(join(cwd, 'who.txt'), 'utf8'))).toMatchObject({ you: 'Claude' }) // through the session
    expect(said[0]).toMatch(/installed in this repository/)
    expect(said).toContain(`the board: Claude is on it (${url})`)
    expect(existsSync(sessionFile(cwd))).toBe(false) // left
  }, 30_000)
})
