import { describe, it, expect } from 'vitest'
import { escapeArgument, planSpawn } from '../src/agent/spawn.ts'

describe('starting claude or codex, on Windows too', () => {
  it('runs a command as it is elsewhere', () => {
    expect(planSpawn('codex', ['app-server'], { platform: 'darwin' })).toEqual({ command: 'codex', args: ['app-server'] })
  })

  it('runs an .exe straight, by its full path', () => {
    const plan = planSpawn('claude', ['hi there'], { platform: 'win32', resolve: () => 'C:\\Users\\a\\.local\\bin\\claude.exe' })
    expect(plan).toEqual({ command: 'C:\\Users\\a\\.local\\bin\\claude.exe', args: ['hi there'] })
  })

  it('runs an npm .cmd through cmd.exe, each argument quoted and escaped twice (the shim passes them on)', () => {
    const shim = '@SETLOCAL\r\n"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n'
    const plan = planSpawn('codex', ['-m', 'x"y'], { platform: 'win32', resolve: () => 'C:\\npm\\codex.cmd', read: () => shim, comspec: 'cmd.exe' })
    expect(plan.command).toBe('cmd.exe')
    expect(plan.windowsVerbatimArguments).toBe(true)
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(plan.args[3]).toBe(`"C:\\npm\\codex.cmd ${escapeArgument('-m', true)} ${escapeArgument('x"y', true)}"`)
  })

  it('escapes as cross-spawn does', () => {
    expect(escapeArgument('x"y', false)).toBe('^"x\\^"y^"')
    expect(escapeArgument('x"y', true)).toBe('^^^"x\\^^^"y^^^"')
    expect(escapeArgument('a & b', false)).toBe('^"a^ ^&^ b^"')
    expect(escapeArgument('dir\\', false)).toBe('^"dir\\\\^"') // a trailing backslash would escape the closing quote
    expect(escapeArgument('50% `done`', false)).toBe('^"50^%^ ^`done^`^"')
  })

  it('leaves a batch file that does not pass its arguments on escaped once', () => {
    const plan = planSpawn('tool', ['a b'], { platform: 'win32', resolve: () => 'C:\\bin\\tool.bat', read: () => '@echo %1', comspec: 'cmd.exe' })
    expect(plan.args[3]).toBe(`"C:\\bin\\tool.bat ${escapeArgument('a b', false)}"`)
  })
})
