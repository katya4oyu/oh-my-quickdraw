import { describe, it, expect } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installSkill, repoName, skillStatus, uninstallSkill, SKILL_SOURCE } from '../src/commands/skill.ts'

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'qd-skill-')))
const skill = readFileSync(join(SKILL_SOURCE, 'SKILL.md'), 'utf8')

describe('omq skill', () => {
  it('installs for Agent Skills agents (a copy) and Claude Code (a link to it), and says when it is behind', () => {
    const home = temp()
    const r = installSkill({ home })
    expect(r.installed).toHaveLength(2)
    const agents = join(home, '.agents/skills/quickdraw'), claude = join(home, '.claude/skills/quickdraw')
    expect(lstatSync(agents).isDirectory()).toBe(true)
    expect(readFileSync(join(agents, 'SKILL.md'), 'utf8')).toBe(skill)
    expect(lstatSync(claude).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(claude, 'SKILL.md'), 'utf8')).toBe(skill) // through the link
    // the files SKILL.md points to come along
    const pointed = [...new Set(skill.match(/(?:drawing|reference)\/[\w-]+\.md/g))]
    expect(pointed.length).toBeGreaterThan(0)
    for (const f of pointed) expect(existsSync(join(agents, f)), f).toBe(true)
    // and the pattern files the drawing guides' index points to
    const index = readFileSync(join(SKILL_SOURCE, 'drawing/patterns.md'), 'utf8')
    const patterns = [...new Set(index.match(/patterns\/[\w-]+\.md/g))]
    expect(patterns.length).toBeGreaterThan(5)
    for (const f of patterns) expect(existsSync(join(agents, 'drawing', f)), f).toBe(true)
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

  it('installs in a project at its repository\'s root, from any folder in it; and says a link is not for committing', () => {
    const repo = temp()
    execFileSync('git', ['init', '-q'], { cwd: repo })
    const sub = join(repo, 'packages/app')
    mkdirSync(sub, { recursive: true })
    expect(repoName(sub)).toBe(repo.split('/').pop()) // an agent here is named after the repository, not this folder
    const r = installSkill({ project: true, cwd: sub })
    expect(r.installed.map((i: any) => i.path)).toEqual([join(repo, '.agents/skills/quickdraw'), join(repo, '.claude/skills/quickdraw')])
    expect(readlinkSync(join(repo, '.claude/skills/quickdraw'))).toBe('../../.agents/skills/quickdraw') // relative: commits as it is
    expect(skillStatus({ project: true, cwd: sub }).skills.every((s) => s.current)).toBe(true)
    expect(installSkill({ project: true, cwd: sub, link: true })).toHaveProperty('warning_link')
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
