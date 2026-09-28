#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const USAGE = `quickdraw <command>

  serve [--port 8795] [--host 127.0.0.1] [--data ~/.quickdraw]
        the boards: their list (/) and pages (/b/ID), a relay per board (/ws/ID),
        SQLite persistence (<data>/boards.sqlite), link previews (/preview)
  agent codex [--board ID|URL] [--server URL] [--name NAME] [--id ID] [--model M] [--effort E] [--allow-remote]
        Codex joins a board, working in this directory (its files, AGENTS.md
        and your Codex settings), and takes requests from the board's AI panel,
        where people choose the model and effort per request; --model and
        --effort (low, medium, high, …) set the defaults there. Without --board,
        at a terminal, it asks which board; the board's AI panel (and its More
        menu) has this command for that board, to copy. It takes requests
        and approvals only from the computer running quickdraw serve;
        --allow-remote takes them from anyone on the board (through Tailscale…)
`

const [command, ...rest] = process.argv.slice(2)

if (command === 'serve') {
  const { values } = parseArgs({
    args: rest,
    options: {
      port: { type: 'string', default: process.env.PORT ?? '8795' },
      host: { type: 'string', default: '127.0.0.1' },
      data: { type: 'string', default: process.env.QUICKDRAW_DATA ?? join(homedir(), '.quickdraw') },
    },
  })
  const { createQuickdrawServer } = await import('../src/serve/index.ts')
  const { importSingleBoard } = await import('../src/serve/boards.ts')
  const data = resolve(values.data)
  mkdirSync(data, { recursive: true })
  const app = createQuickdrawServer({ dbPath: join(data, 'boards.sqlite') })
  // a board from before there were several: kept as a board of its own
  const imported = importSingleBoard(app.boards, join(data, 'board.sqlite'))
  if (imported) console.log(`imported board.sqlite as the board "${imported.title}" (${imported.id})`)
  const { port } = await app.listen(Number(values.port), values.host)
  console.log(`http://${values.host === '0.0.0.0' ? 'localhost' : values.host}:${port}/   (data: ${data})`)
} else if (command === 'agent') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      board: { type: 'string' }, server: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' },
      model: { type: 'string' }, effort: { type: 'string' }, 'allow-remote': { type: 'boolean' },
    },
  })
  if (positionals[0] !== 'codex') {
    process.stderr.write('usage: quickdraw agent codex [--board ID|URL] [--server URL] [--name NAME] [--id ID] [--model M] [--effort E] [--allow-remote]\n')
    process.exit(1)
  }
  const { basename } = await import('node:path')
  const { resolveBoard, serverOf, chooseBoard } = await import('../src/commands/boards.ts')
  const { openBoard } = await import('../src/board/open.ts')
  const { joinBoard } = await import('../src/agent/board-agent.ts')
  const { initCodex, startAppServer, runCodex } = await import('../src/agent/codex.ts')
  const cwd = process.cwd()
  const folder = basename(cwd)
  const name = values.name ?? `Codex · ${folder}`
  const id = values.id ?? ('codex-' + folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  try {
    // at a terminal, several boards are a choice; elsewhere (piped, an agent) the command fails and lists them
    const choose = process.stdin.isTTY && process.stdout.isTTY ? (boards: Parameters<typeof chooseBoard>[0]) => chooseBoard(boards, 'quickdraw agent codex') : undefined
    const url = await resolveBoard(values.board ?? process.env.QUICKDRAW_BOARD, serverOf(values.server), choose)
    const board = await openBoard({ url, name })
    const codex = startAppServer(cwd)
    const offered = await initCodex(codex, { model: values.model, effort: values.effort })
    const { homedir } = await import('node:os')
    const generatedImages = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'generated_images')
    const remote = values['allow-remote'] === true
    const agent = await joinBoard(board, { id, name, knows: [folder], ...offered, remote }, { imageRoots: [cwd, generatedImages] })
    const leave = async (code: number, why?: string) => {
      if (why) process.stderr.write(why + '\n')
      codex.close()
      await agent.close()
      process.exit(code)
    }
    codex.onExit(() => leave(1, 'codex app-server stopped'))
    board.relay!.onClose(() => leave(1, 'lost the connection to the board'))
    process.on('SIGINT', () => leave(0))
    process.on('SIGTERM', () => leave(0))
    await runCodex(codex, agent, { cwd, name, model: offered.model, effort: offered.effort })
    console.log(`${name} is on the board (${url}). Ctrl-C leaves it.`)
    console.log(remote ? 'Anyone on the board can ask it (--allow-remote).' : 'Only people on the computer running quickdraw serve can ask it (--allow-remote lets anyone on the board).')
  } catch (e) {
    process.stderr.write(JSON.stringify({ error: (e as Error).message }) + '\n')
    process.exit(1)
  }
} else {
  const { BOARD_COMMANDS, BOARD_USAGE, main } = await import('../src/commands/index.ts')
  if (command && BOARD_COMMANDS.includes(command)) {
    try {
      await main(process.argv.slice(2))
    } catch (e) {
      process.stderr.write(JSON.stringify({ error: (e as Error).message }) + '\n')
      process.exit(1) // a half-open board must not keep the command alive
    }
  } else {
    process.stdout.write(USAGE + '\n' + BOARD_USAGE + '\n')
    process.exitCode = command && command !== 'help' && command !== '--help' ? 1 : 0
  }
}
