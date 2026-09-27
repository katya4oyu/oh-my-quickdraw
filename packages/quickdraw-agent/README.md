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

- **A board is opened the way a browser opens it**: live through the example server's relay (`examples/quickdraw-yjs/server.mjs`) as one more Yjs peer, or from a JSON file. The Store is bound with `bindYjs` and `bindFrames`, and the Markdown and embed types are registered, so frame rules and sync behave as in the app. People watching see the changes and the agent's cursor where it worked.
- **Reading**: `describeBoard` (frames and members, shapes with text and bounds, which shapes arrows connect) and `boardToMarkdown` (an outline to summarize or answer from).
- **Operations** (`runOp`, `applySteps`): each is one store transaction, all or nothing. What an agent adds carries `agent: { name, op }`; it may move and edit anything but delete only what an agent added. Arrows between shapes keep `link: { from, to }` and follow them when they move in a later operation.
- **Undo**: each operation's diff goes to `.quickdraw-agent/log.jsonl` (or `$QUICKDRAW_AGENT_LOG`); `undo` reverts what nobody changed since and reports the rest.
- **Text in Node**: the core measures text with a canvas, which Node lacks; `installMeasure` provides an estimating stand-in so notes and text can be laid out. Browsers still draw with real measurements.

## Not yet

- PNG export (needs a browser; the Chrome already on a machine could be driven headless without adding dependencies).
- An MCP server over the same operations.
