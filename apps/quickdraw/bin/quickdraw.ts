#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const USAGE = `quickdraw <command>

  serve [--port 8795] [--host 127.0.0.1] [--data ~/.quickdraw]
        the board: web page, relay (/ws), SQLite persistence, link previews (/preview)
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
  const data = resolve(values.data)
  mkdirSync(data, { recursive: true })
  const app = createQuickdrawServer({ dbPath: join(data, 'board.sqlite') })
  const { port } = await app.listen(Number(values.port), values.host)
  console.log(`http://${values.host === '0.0.0.0' ? 'localhost' : values.host}:${port}/   (data: ${data})`)
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
