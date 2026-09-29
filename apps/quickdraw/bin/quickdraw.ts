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
              [--voice NAME] [--voice-model M] [--no-voice]
        Codex joins a board, working in this directory (its files, AGENTS.md
        and your Codex settings), and takes requests from the board's AI panel,
        where people choose the model and effort per request; --model and
        --effort (low, medium, high, …) set the defaults there. Without --board,
        at a terminal, it asks which board; the board's AI panel (and its More
        menu) has this command for that board, to copy. It takes requests
        and approvals only from you, who started it (here, or through the
        same tailnet login), and whom you open it to from the board's panel;
        --allow-remote opens it to everyone on the board.
        People can also talk with it (the microphone in the board's AI tools):
        a voice model (--voice-model, gpt-live-1-codex by default) talks and
        hands the work to Codex; --voice picks its voice, --no-voice turns it off
  agent claude [--board ID|URL] [--server URL] [--name NAME] [--allow-remote] [--idle MINUTES] [--global] [-- CLAUDE ARGS…]
        Claude Code joins a board in its own TUI, from this folder: this
        makes sure Claude Code reads a current quickdraw skill (installing it
        in this repository, or for you with --global, when it has none) and can
        run quickdraw, joins the board (quickdraw join), starts claude telling
        it to take the board's requests, and leaves the board when it exits.
        What follows -- goes to claude (--model opus, say)
  agent pi [--board ID|URL] [--server URL] [--name NAME] [--id ID] [--model PROVIDER/ID] [--effort LEVEL] [--allow-remote]
           [--no-approval]
        pi joins a board the same way, with your pi settings and sign-ins; the
        panel offers the models pi can use. Its commands and file changes
        (bash, edit, write) wait for a person's approval in the panel;
        --no-approval lets them run. It does not talk or make images. Needs
        pi's SDK: npm i -w apps/quickdraw @earendil-works/pi-coding-agent
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
} else if (command === 'session') {
  // the process `quickdraw join` leaves running (src/session): it says on its first line that it is on the board
  const { values } = parseArgs({ args: rest, options: { board: { type: 'string' }, name: { type: 'string' }, idle: { type: 'string' }, 'allow-remote': { type: 'boolean' } } })
  try {
    const { startSession } = await import('../src/session/daemon.ts')
    const s = await startSession({ url: values.board!, name: values.name ?? 'Agent', cwd: process.cwd(), idle: values.idle ? Number(values.idle) : undefined, remote: values['allow-remote'] === true })
    process.stdout.write(JSON.stringify({ joined: true, board: s.info.url, name: s.info.name, cwd: s.info.cwd }) + '\n')
    const leave = () => void s.close()
    process.on('SIGINT', leave)
    process.on('SIGTERM', leave)
    process.stdout.on('error', () => {}) // the one who started it stops listening after the first line
    await s.closed
    process.exit(0)
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: (e as Error).message }) + '\n')
    process.exit(1)
  }
} else if (command === 'agent' && rest[0] === 'claude') {
  // Claude Code in its own TUI, with the skill and the board made ready (src/agent/claude.ts)
  const cut = rest.indexOf('--')
  const { values } = parseArgs({
    args: rest.slice(1, cut < 0 ? undefined : cut),
    options: { board: { type: 'string' }, server: { type: 'string' }, name: { type: 'string' }, idle: { type: 'string' }, 'allow-remote': { type: 'boolean' }, global: { type: 'boolean' } },
  })
  const { basename } = await import('node:path')
  const { resolveBoard, serverOf, chooseBoard } = await import('../src/commands/boards.ts')
  const { runClaude } = await import('../src/agent/claude.ts')
  try {
    const choose = process.stdin.isTTY && process.stdout.isTTY ? (boards: Parameters<typeof chooseBoard>[0]) => chooseBoard(boards, 'quickdraw agent claude') : undefined
    const url = await resolveBoard(values.board ?? process.env.QUICKDRAW_BOARD, serverOf(values.server), choose)
    process.exit(await runClaude({
      url, name: values.name ?? `Claude · ${basename(process.cwd())}`, cwd: process.cwd(),
      remote: values['allow-remote'] === true, idle: values.idle ? Number(values.idle) : undefined, global: values.global === true,
      args: cut < 0 ? [] : rest.slice(cut + 1),
    }))
  } catch (e) {
    process.stderr.write((e as Error).message + '\n')
    process.exit(1)
  }
} else if (command === 'agent') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      board: { type: 'string' }, server: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' },
      model: { type: 'string' }, effort: { type: 'string' }, 'allow-remote': { type: 'boolean' },
      voice: { type: 'string' }, 'voice-model': { type: 'string' }, 'no-voice': { type: 'boolean' }, 'no-approval': { type: 'boolean' },
    },
  })
  const runtime = positionals[0]
  if (runtime !== 'codex' && runtime !== 'pi') {
    process.stderr.write('usage: quickdraw agent codex|pi|claude [--board ID|URL] [--server URL] [--name NAME] [--id ID] [--model M] [--effort E] [--allow-remote]\n'
      + '         codex: [--voice NAME] [--voice-model M] [--no-voice]   pi: [--no-approval]\n')
    process.exit(1)
  }
  const { basename } = await import('node:path')
  const { resolveBoard, serverOf, chooseBoard } = await import('../src/commands/boards.ts')
  const { openBoard } = await import('../src/board/open.ts')
  const { joinBoard } = await import('../src/agent/board-agent.ts')
  const { linkPreview, serverOfBoard } = await import('../src/board/link-preview.ts')
  const cwd = process.cwd()
  const folder = basename(cwd)
  const name = values.name ?? `${runtime === 'codex' ? 'Codex' : 'pi'} · ${folder}`
  const id = values.id ?? (runtime + '-' + folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const remote = values['allow-remote'] === true
  try {
    // at a terminal, several boards are a choice; elsewhere (piped, an agent) the command fails and lists them
    const choose = process.stdin.isTTY && process.stdout.isTTY ? (boards: Parameters<typeof chooseBoard>[0]) => chooseBoard(boards, `quickdraw agent ${runtime}`) : undefined
    const url = await resolveBoard(values.board ?? process.env.QUICKDRAW_BOARD, serverOf(values.server), choose)
    const preview = (link: string) => linkPreview(serverOfBoard(url), link)
    // what it runs on: started, joined to the board, and stopped when it leaves
    let stop: () => void
    let agent: Awaited<ReturnType<typeof joinBoard>>
    const leave = async (code: number, why?: string) => {
      if (why) process.stderr.write(why + '\n')
      stop?.()
      await agent?.close()
      process.exit(code)
    }
    if (runtime === 'codex') {
      const { initCodex, startAppServer, runCodex } = await import('../src/agent/codex.ts')
      const { runVoice } = await import('../src/agent/voice.ts')
      const board = await openBoard({ url, name })
      const codex = startAppServer(cwd)
      stop = () => codex.close()
      const offered = await initCodex(codex, { model: values.model, effort: values.effort })
      const generatedImages = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'generated_images')
      const voice = values['no-voice'] !== true
      agent = await joinBoard(board, { id, name, knows: [folder], ...offered, remote, voice }, { imageRoots: [cwd, generatedImages], preview })
      codex.onExit(() => leave(1, 'codex app-server stopped'))
      board.relay!.onClose(() => leave(1, 'lost the connection to the board'))
      const running = await runCodex(codex, agent, { cwd, name, model: offered.model, effort: offered.effort })
      if (voice) runVoice(codex, agent, running, { model: values['voice-model'], voice: values.voice })
    } else {
      const { initPi, runPi } = await import('../src/agent/pi.ts')
      const sdk = await import('@earendil-works/pi-coding-agent').catch(() => {
        throw new Error("pi's SDK is not installed: npm i -w apps/quickdraw @earendil-works/pi-coding-agent")
      })
      const offered = await initPi(sdk, cwd, { model: values.model, effort: values.effort })
      const board = await openBoard({ url, name })
      agent = await joinBoard(board, { id, name, knows: [folder], models: offered.models, model: offered.model, effort: offered.effort, remote }, { imageRoots: [cwd], preview })
      board.relay!.onClose(() => leave(1, 'lost the connection to the board'))
      const running = await runPi(sdk, offered.runtime, agent, { cwd, name, model: offered.model, effort: offered.effort, approval: values['no-approval'] !== true })
      stop = running.close
    }
    process.on('SIGINT', () => leave(0))
    process.on('SIGTERM', () => leave(0))
    console.log(`${name} is on the board (${url}). Ctrl-C leaves it.`)
    console.log(remote ? 'Anyone on the board can ask it (--allow-remote).' : 'Only you can ask it, and whom you open it to from the board\'s AI panel (--allow-remote: everyone on the board).')
  } catch (e) {
    process.stderr.write(JSON.stringify({ error: (e as Error).message }) + '\n')
    process.exit(1)
  }
} else {
  const { BOARD_COMMANDS, BOARD_USAGE, main } = await import('../src/commands/index.ts')
  if (command && BOARD_COMMANDS.includes(command)) {
    // Ctrl-C ends wait and watch cleanly: they leave the board as they would
    const stop = new AbortController()
    process.once('SIGINT', () => stop.abort())
    process.once('SIGTERM', () => stop.abort())
    try {
      await main(process.argv.slice(2), undefined, { signal: stop.signal })
      process.exit(0) // a board that stays open (wait, watch) must not keep the command alive
    } catch (e) {
      process.stderr.write(JSON.stringify({ error: (e as Error).message }) + '\n')
      process.exit(1) // a half-open board must not keep the command alive
    }
  } else {
    process.stdout.write(USAGE + '\n' + BOARD_USAGE + '\n')
    process.exitCode = command && command !== 'help' && command !== '--help' ? 1 : 0
  }
}
