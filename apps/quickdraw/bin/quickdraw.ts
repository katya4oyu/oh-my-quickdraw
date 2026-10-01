#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const USAGE = `quickdraw <command>

  serve [--port 8795] [--host 127.0.0.1] [--data ~/.quickdraw] [--trust-lan-ip]
        the boards: their list (/) and pages (/b/ID), a relay per board (/ws/ID),
        SQLite persistence (<data>/boards.sqlite), link previews (/preview).
        --trust-lan-ip (with --host 0.0.0.0): a device on the local network that
        connects straight here is a person, known by its address, so what
        people start on their own computers is theirs (see the README)
  agent claude|codex [--board ID|URL] [--server URL] [--name NAME] [--role ROLE] [--allow-remote] [--idle MINUTES] [--global] [-- ARGS…]
        Claude Code or Codex joins a board in its own TUI, from this folder,
        where you can talk with it too: this makes sure it reads a current
        quickdraw skill (installing it in this repository, or for you with
        --global, when it has none) and can run quickdraw (for Codex, a rule
        in .codex/rules lets quickdraw out of its sandbox), joins the board
        (quickdraw join), starts it telling it to take the board's requests,
        and leaves the board when it exits. Only you can ask it, and whom you
        open it to from the board's AI panel (--allow-remote: everyone).
        What follows -- goes to claude or codex (--model …, say)
  agent codex-app-server [--board ID|URL] [--server URL] [--name NAME] [--role ROLE] [--id ID] [--model M] [--effort E] [--allow-remote]
              [--voice NAME] [--voice-model M] [--no-voice]
        Codex joins a board through codex app-server, working in this directory
        (its files, AGENTS.md and your Codex settings), with no TUI: the board's
        AI panel is where it is asked, where people choose the model and effort
        per request (--model and --effort set the defaults), and where it asks
        for approvals. Without --board, at a terminal, it asks which board. It
        takes requests and approvals only from you, who started it (here, or
        through the same tailnet login), and whom you open it to from the
        board's panel; --allow-remote opens it to everyone on the board.
        People can also talk with it (the microphone in the board's AI tools):
        a voice model (--voice-model, gpt-live-1-codex by default) talks and
        hands the work to Codex; its voice is picked in the panel (--voice: the
        default), --no-voice turns it off
  agent pi [--board ID|URL] [--server URL] [--name NAME] [--role ROLE] [--id ID] [--model PROVIDER/ID] [--effort LEVEL] [--allow-remote]
           [--no-approval]
        pi joins a board the same way, with your pi settings and sign-ins; the
        panel offers the models pi can use. Its commands and file changes
        (bash, edit, write) wait for a person's approval in the panel;
        --no-approval lets them run. It does not talk or make images. Needs
        pi's SDK: npm i -w apps/quickdraw @earendil-works/pi-coding-agent
  --role ROLE (any agent): its role on the board, as "transcriber" or
        "reviewer" (people and agents can change it: quickdraw role)
  --avatar PET (any agent): its picture, a Codex pet (~/.codex/pets/NAME):
        it moves by its cursor as the agent works (quickdraw avatar)
`

const [command, ...rest] = process.argv.slice(2)

if (command === 'serve') {
  const { values } = parseArgs({
    args: rest,
    options: {
      port: { type: 'string', default: process.env.PORT ?? '8795' },
      host: { type: 'string', default: '127.0.0.1' },
      data: { type: 'string', default: process.env.QUICKDRAW_DATA ?? join(homedir(), '.quickdraw') },
      'trust-lan-ip': { type: 'boolean' },
    },
  })
  const { createQuickdrawServer } = await import('../src/serve/index.ts')
  const { importSingleBoard } = await import('../src/serve/boards.ts')
  const data = resolve(values.data)
  mkdirSync(data, { recursive: true })
  const app = createQuickdrawServer({ dbPath: join(data, 'boards.sqlite'), trustLanIp: values['trust-lan-ip'] === true })
  // a board from before there were several: kept as a board of its own
  const imported = importSingleBoard(app.boards, join(data, 'board.sqlite'))
  if (imported) console.log(`imported board.sqlite as the board "${imported.title}" (${imported.id})`)
  const { port } = await app.listen(Number(values.port), values.host)
  console.log(`http://${values.host === '0.0.0.0' ? 'localhost' : values.host}:${port}/   (data: ${data})`)
} else if (command === 'session') {
  // the process `quickdraw join` leaves running (src/session): it says on its first line that it is on the board
  const { values } = parseArgs({ args: rest, options: { board: { type: 'string' }, name: { type: 'string' }, idle: { type: 'string' }, 'allow-remote': { type: 'boolean' }, role: { type: 'string' }, avatar: { type: 'string' } } })
  try {
    const { startSession } = await import('../src/session/daemon.ts')
    const s = await startSession({ url: values.board!, name: values.name ?? 'Agent', cwd: process.cwd(), idle: values.idle ? Number(values.idle) : undefined, remote: values['allow-remote'] === true, role: values.role, avatar: values.avatar })
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
} else if (command === 'agent' && (rest[0] === 'claude' || rest[0] === 'codex')) {
  // Claude Code or Codex in its own TUI, with the skill and the board made ready (src/agent/tui.ts)
  const tui = rest[0]
  const cut = rest.indexOf('--')
  const { values } = parseArgs({
    args: rest.slice(1, cut < 0 ? undefined : cut),
    options: { board: { type: 'string' }, server: { type: 'string' }, name: { type: 'string' }, idle: { type: 'string' }, 'allow-remote': { type: 'boolean' }, global: { type: 'boolean' }, role: { type: 'string' }, avatar: { type: 'string' } },
  })
  const { resolveBoard, serverOf, chooseBoard } = await import('../src/commands/boards.ts')
  const { runTui } = await import('../src/agent/tui.ts')
  const { repoName } = await import('../src/commands/skill.ts')
  try {
    const choose = process.stdin.isTTY && process.stdout.isTTY ? (boards: Parameters<typeof chooseBoard>[0]) => chooseBoard(boards, `quickdraw agent ${tui}`) : undefined
    const url = await resolveBoard(values.board ?? process.env.QUICKDRAW_BOARD, serverOf(values.server), choose)
    process.exit(await runTui(tui, {
      url, name: values.name ?? `${tui === 'claude' ? 'Claude' : 'Codex'} · ${repoName()}`, cwd: process.cwd(),
      remote: values['allow-remote'] === true, idle: values.idle ? Number(values.idle) : undefined, global: values.global === true, role: values.role, avatar: values.avatar,
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
      role: { type: 'string' }, avatar: { type: 'string' },
    },
  })
  const runtime = positionals[0]
  if (runtime !== 'codex-app-server' && runtime !== 'pi') {
    process.stderr.write('usage: quickdraw agent claude|codex [--board ID|URL] [--name NAME] [--allow-remote] [-- ARGS…]\n'
      + '       quickdraw agent codex-app-server|pi [--board ID|URL] [--server URL] [--name NAME] [--id ID] [--model M] [--effort E] [--allow-remote]\n'
      + '         codex-app-server: [--voice NAME] [--voice-model M] [--no-voice]   pi: [--no-approval]\n')
    process.exit(1)
  }
  const { basename } = await import('node:path')
  const { resolveBoard, serverOf, chooseBoard } = await import('../src/commands/boards.ts')
  const { openBoard } = await import('../src/board/open.ts')
  const { joinBoard } = await import('../src/agent/board-agent.ts')
  const { linkPreview, serverOfBoard } = await import('../src/board/link-preview.ts')
  const cwd = process.cwd()
  const folder = basename(cwd)
  // "<agent> · <repository>": the board shows who started it beside that
  const name = values.name ?? `${runtime === 'codex-app-server' ? 'Codex' : 'pi'} · ${(await import('../src/commands/skill.ts')).repoName(cwd)}`
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
    if (runtime === 'codex-app-server') {
      const { initCodex, startAppServer, runCodex } = await import('../src/agent/codex.ts')
      const { runVoice } = await import('../src/agent/voice.ts')
      const board = await openBoard({ url, name })
      const codex = startAppServer(cwd)
      stop = () => codex.close()
      const offered = await initCodex(codex, { model: values.model, effort: values.effort })
      const generatedImages = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'generated_images')
      const voice = values['no-voice'] !== true
      // the voices it can talk in, for the board's picker; --voice is the one it uses unless a person picks another
      const { realtimeVoices } = await import('../src/agent/voice.ts')
      const voices = voice ? await realtimeVoices(codex) : null
      if (values.voice && voices && !voices.voices.includes(values.voice)) process.stderr.write(`--voice ${values.voice}: not a voice it can talk in (${voices.voices.join(', ')}); using ${voices.default ?? 'the default'}\n`)
      const talk = voices ? { voices: voices.voices, defaultVoice: values.voice && voices.voices.includes(values.voice) ? values.voice : voices.default } : {}
      agent = await joinBoard(board, { id, name, knows: [folder], ...offered, remote, voice, ...talk, role: values.role, avatar: values.avatar }, { imageRoots: [cwd, generatedImages], preview })
      codex.onExit(() => leave(1, 'codex app-server stopped'))
      board.relay!.onClose(() => leave(1, 'lost the connection to the board'))
      const running = await runCodex(codex, agent, { cwd, name, model: offered.model, effort: offered.effort })
      if (voice) runVoice(codex, agent, running, { model: values['voice-model'], voice: voices ? talk.defaultVoice : values.voice, voices: voices?.voices })
    } else {
      const { initPi, runPi } = await import('../src/agent/pi.ts')
      const sdk = await import('@earendil-works/pi-coding-agent').catch(() => {
        throw new Error("pi's SDK is not installed: npm i -w apps/quickdraw @earendil-works/pi-coding-agent")
      })
      const offered = await initPi(sdk, cwd, { model: values.model, effort: values.effort })
      const board = await openBoard({ url, name })
      agent = await joinBoard(board, { id, name, knows: [folder], models: offered.models, model: offered.model, effort: offered.effort, remote, role: values.role, avatar: values.avatar }, { imageRoots: [cwd], preview })
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
