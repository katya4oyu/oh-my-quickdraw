# quickdraw-agent

Lets agents read and edit Quickdraw boards: a CLI any shell-using agent can call, an [Agent Skill](skill/SKILL.md) that teaches it, and the operations underneath. No core change; no dependencies beyond the other packages here and `yjs` (for live boards).

```sh
quickdraw-agent read --board ws://localhost:8080/ws
quickdraw-agent note "Idea" --in FRAME_ID --board ws://localhost:8080/ws --name Claude
quickdraw-agent apply diagram.json --file board.json
quickdraw-agent undo --board ws://localhost:8080/ws
```

See [skill/SKILL.md](skill/SKILL.md) for every command; install it as a skill (e.g. copy the `skill` folder to `.claude/skills/quickdraw-board/`) so the agent knows how to use the CLI.

## How it works

- **A board is opened the way a browser opens it**: live through the relay of `quickdraw serve` (`apps/quickdraw`) as one more Yjs peer, or from a JSON file. The Store is bound with `bindYjs` and `bindFrames`, and the Markdown and embed types are registered, so frame rules and sync behave as in the app. People watching see the changes and the agent's cursor where it worked.
- **Reading**: `describeBoard` (frames and members, shapes with text and bounds, which shapes arrows connect) and `boardToMarkdown` (an outline to summarize or answer from).
- **Operations** (`runOp`, `applySteps`): each is one store transaction, all or nothing. What an agent adds carries `agent: { name, op }`; it may move and edit anything but delete only what an agent added. Arrows between shapes keep `link: { from, to }` and follow them when they move in a later operation.
- **Undo**: each operation's diff goes to `.quickdraw-agent/log.jsonl` (or `$QUICKDRAW_AGENT_LOG`); `undo` reverts what nobody changed since and reports the rest.
- **Text in Node**: the core measures text with a canvas, which Node lacks; `installMeasure` provides an estimating stand-in so notes and text can be laid out. Browsers still draw with real measurements.
- **PNG** (`export --format png`, `Renderer`): drawn by the core itself (`exportImage`, `exportFrame`) in a headless Chrome already on the machine — no dependency added.

## PNG export and the machine it runs on

- **Out of sight**: `--headless=new`, no window, focus, mouse or keyboard; on macOS it registers as a background-only app (not in the Dock or ⌘Tab).
- **Separate from the user's Chrome**: a throwaway profile (removed after), no extensions, sync, background networking or keychain.
- **No ports**: driven over a pipe (`--remote-debugging-pipe`); the page's code is served from disk through DevTools request interception, and every other request is refused.
- **Reused, without leaks**: one Chrome per `Renderer`; each render gets its own browser context and page, disposed afterwards; Chrome closes after `idleMs` (30 s) idle and restarts every `maxRenders` (100). Over 60 renders its footprint stayed flat (~250–280 MB, measured with `footprint`). A CLI command reuses it for every image it writes (e.g. `--frame all`) and closes it at the end.
- **Never outlives its process**: Chrome runs in its own process group, and a one-line shell watchdog ends it and removes its profile if the Node process dies without cleaning up (SIGKILL, SIGINT, SIGTERM). Stale profiles older than a day are swept on the next launch.
- **Smaller**: no GPU process, one renderer process, background features off.

## Not yet

- An MCP server over the same operations.
