import { describe, it, expect } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installSkill, skillStatus, uninstallSkill, SKILL_SOURCE } from '../src/commands/skill.ts'

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'qd-skill-')))
const skill = readFileSync(join(SKILL_SOURCE, 'SKILL.md'), 'utf8')

describe('quickdraw skill', () => {
  it('installs for Agent Skills agents (a copy) and Claude Code (a link to it), and says when it is behind', () => {
    const home = temp()
    const r = installSkill({ home })
    expect(r.installed).toHaveLength(2)
    const agents = join(home, '.agents/skills/quickdraw'), claude = join(home, '.claude/skills/quickdraw')
    expect(lstatSync(agents).isDirectory()).toBe(true)
    expect(readFileSync(join(agents, 'SKILL.md'), 'utf8')).toBe(skill)
    expect(lstatSync(claude).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(claude, 'SKILL.md'), 'utf8')).toBe(skill) // through the link
    expect(skillStatus({ home }).skills.every((s) => s.installed && s.ours && s.current)).toBe(true)

    writeFileSync(join(agents, 'SKILL.md'), skill.replace('# Quickdraw board', '# Old')) // an older copy
    expect(skillStatus({ home }).skills[0]).toMatchObject({ current: false, note: expect.stringMatching(/skill install/) })
    installSkill({ home }) // again: up to date
    expect(skillStatus({ home }).skills.every((s) => s.current)).toBe(true)

    expect(uninstallSkill({ home }).removed).toEqual([agents, claude])
    expect(existsSync(agents) || existsSync(claude)).toBe(false)
  })

  it('links to this checkout with --link, installs in a project with --project, and for one kind of agent', () => {
    const home = temp(), project = temp()
    installSkill({ home, link: true })
    expect(realpathSync(join(home, '.agents/skills/quickdraw'))).toBe(realpathSync(SKILL_SOURCE))
    expect(skillStatus({ home }).skills.every((s) => s.current)).toBe(true)

    installSkill({ project: true, cwd: project, for: 'claude' })
    expect(existsSync(join(project, '.agents'))).toBe(false)
    expect(lstatSync(join(project, '.claude/skills/quickdraw')).isDirectory()).toBe(true) // alone, a copy
    expect(() => installSkill({ home, for: 'cursor' })).toThrow(/unknown --for/)
  })

  it('leaves another skill named quickdraw alone unless forced', () => {
    const home = temp()
    const other = join(home, '.agents/skills/quickdraw')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'SKILL.md'), '---\nname: something-else\n---\n')
    expect(() => installSkill({ home })).toThrow(/another skill/)
    expect(() => uninstallSkill({ home })).toThrow(/left alone/)
    installSkill({ home, force: true })
    expect(readFileSync(join(other, 'SKILL.md'), 'utf8')).toBe(skill)
  })
})
