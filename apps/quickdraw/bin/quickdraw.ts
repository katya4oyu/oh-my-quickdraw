#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const USAGE = `quickdraw <command>

  serve [--port 8795] [--host 127.0.0.1] [--data ~/.quickdraw]
        the boards: their list (/) and pages (/b/ID), a relay per board (/ws/ID),
        SQLite persistence (<data>/boards.sqlite), link previews (/preview)
  agent codex [--board ID|URL] [--server URL] [--name NAME] [--id ID] [--model M] [--effort E]
        Codex joins a board, working in this directory (its files, AGENTS.md
        and your Codex settings), and takes requests from the board's AI panel;
        --model and --effort (low, medium, high, …) override your Codex defaults
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
      model: { type: 'string' }, effort: { type: 'string' },
    },
  })
  if (positionals[0] !== 'codex') {
    process.stderr.write('usage: quickdraw agent codex [--board ID|URL] [--server URL] [--name NAME] [--id ID] [--model M] [--effort E]\n')
    process.exit(1)
  }
  const { basename } = await import('node:path')
  const { resolveBoard, serverOf } = await import('../src/commands/boards.ts')
  const { openBoard } = await import('../src/board/open.ts')
  const { joinBoard } = await import('../src/agent/board-agent.ts')
  const { startAppServer, runCodex } = await import('../src/agent/codex.ts')
  const cwd = process.cwd()
  const folder = basename(cwd)
  const name = values.name ?? `Codex · ${folder}`
  const id = values.id ?? ('codex-' + folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  try {
    const url = await resolveBoard(values.board ?? process.env.QUICKDRAW_BOARD, serverOf(values.server))
    const board = await openBoard({ url, name })
    const codex = startAppServer(cwd)
    const running = [values.model, values.effort].filter(Boolean).join(' · ')
    const agent = await joinBoard(board, { id, name, knows: running ? [folder, running] : [folder] })
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
    await runCodex(codex, agent, { cwd, name, model: values.model, effort: values.effort })
    console.log(`${name} is on the board (${url}). Ctrl-C leaves it.`)
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
