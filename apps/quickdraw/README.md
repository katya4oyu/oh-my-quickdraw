# quickdraw (app)

The app built from this repository's packages: one `quickdraw` command.

```sh
npm link -w apps/quickdraw        # puts `quickdraw` on your PATH (once)
quickdraw serve                   # http://127.0.0.1:8795/ lists the boards
quickdraw new "Sprint 12"         # a board; prints its id and URL
quickdraw note "Idea" --board ID  # edits it; `quickdraw help` lists the commands
```

## `quickdraw serve`

`quickdraw serve [--port 8795] [--host 127.0.0.1] [--data ~/.quickdraw]`

- **Boards**: `/` lists them as cards with a picture of each (drawn by a page that has the board open, a few seconds after it settles and when it is left; a board not opened since has none yet; ✦ marks one with an AI on it) and makes new ones — empty, from a JSON file (as a board's Export writes it), or as a copy — and renames and archives them (an archived board leaves the list, and can be brought back). `/b/<id>` is a board, with every package, driven by `quickdraw-toolbar`; its "…" menu has the list, renaming, versions, and importing into it or exporting it as JSON. A board saves itself as it changes. A board is only ever made on purpose: an unknown id is refused, never created.
- **Versions**: a board kept as it was, by hand ("Keep this version") or before each AI request and each restore (the last 20 of those). A version can be restored over the board — everyone on it sees the change — or opened as a board of its own.
- **The boards API** (JSON): `GET /api/boards[?archived=1]`; `POST /api/boards` `{ title, from?, file? }` (empty, a copy, or a JSON file's); `GET`/`PATCH /api/boards/<id>` `{ title?, archived? }`; `GET`/`POST /api/boards/<id>/versions` `{ name }`; `POST /api/boards/<id>/versions/<v>/restore` `{ as: 'board' | 'new' }`; `GET`/`PUT /api/boards/<id>/thumbnail` (a JPEG, PNG or WebP, 500 KB at most).
- **The packages it imports**, served from wherever Node resolves them (`/_/<package>/src/…`), so it runs from any directory. Only their `src` is served.
- **A relay per board** at `/ws/<id>` for sync across tabs and devices, with live cursors. The protocol is in [`src/protocol.js`](src/protocol.js), shared by the server, the page and the CLI.
- **Who is here** ([`quickdraw-presence`](../../packages/quickdraw-presence)): a row at the top of the board shows everyone on it, people and agents. Press yourself to set your name, colour and a status ("reviewing", "away"); they are kept in that browser. Press someone to follow them: their view if they are a person, where it works if it is an agent. Moving the view yourself stops following. Someone out of sight shows as an arrow at the edge, which takes you there. An agent's cursor says what it is doing just then — thinking, reading the board, searching the web, running a command, making an image, drawing, waiting for you, done — and moves to match: it mulls in a small circle, sweeps as it reads, bobs while it waits, hops when done. The server keeps each connection's latest presence in memory only, so a page that comes later sees everyone at once.
- **Agents on a board**, through the same relay: an agent joins with a name and what it knows, and the page's AI panel ([`quickdraw-agent`](../../packages/quickdraw-agent)) lists it and sends it requests. The server passes requests to the agent they are addressed to, and the agent's events (progress, messages, approvals, operations with their diffs) to every page; a person's replies and approvals go back to the agent. It keeps each request's thread, so a page that reloads — or another device — sees it as it was, including what was undone. An agent that leaves ends what it was doing with an error in the thread. It does not know or start what an agent runs on.
- **Screen sharing** ([`quickdraw-screenshare`](../../packages/quickdraw-screenshare)), for reviewing an app together: someone uses "…" → **Share screen** to share the tab or window they are working in. Everyone on the board watches it live in a window over the board. Anyone can press **Snapshot**, and that moment lands on the board, at full size, in a frame of its own ("12:08 · Mac") for everyone to write and draw on. The relay carries it (`SHARE` messages and `LIVE` frames, never stored): one sharer per board, and whoever starts sharing takes over. A page that falls behind skips frames. Sharing needs a secure page on a computer (`http://localhost`, or https through `tailscale serve`); anyone can watch, phones included.
- **Talking with an agent** ([`quickdraw-voice`](../../packages/quickdraw-voice)): the microphone on the right starts a conversation with an agent that talks (`quickdraw agent codex` does). The page makes a WebRTC offer and sends it with a request; the agent answers through the relay, and from then on the sound goes straight between the page and the voice model, never through the server. The offer and the answer go between that page and that agent only and are not stored. Closing the page hangs up. The conversation is a thread in the panel like any request: what was said, and what was done, to undo.
- **Feedback to an agent**: snapshots written on since they last went to an agent show as chips in the AI panel ("📸 12:08 · Mac · 3"). They go with the next request, and × leaves one out. The agent gets what people wrote, and each snapshot twice: drawn with the notes and pen marks over it (in a headless Chrome, as for `export --format png`), and the screen as it was. Codex also gets a `look_at` tool, to see any frame or shapes as a picture.
  <img src="docs/live-review.png" alt="A board with Mac's shared screen live in a window at the top left, a snapshot of it in a frame, and the AI panel with a chip: 📸 12:08 PM · Mac · 1" width="640">

- **Persistence**: the boards and their Yjs updates in `<data>/boards.sqlite` (`node:sqlite`), merged per board as they pile up, and the agents' threads beside them (not in the board's document). A board comes back when no one else is online.
- **Link previews** at `/preview` for `quickdraw-embed`'s link cards, with SSRF guards (https on 443, public addresses on every redirect hop, timeouts, size caps).

It listens on 127.0.0.1. To reach it from other devices, put something in front, such as `tailscale serve --https=8795 http://127.0.0.1:8795`.

## `quickdraw agent codex`

`quickdraw agent codex [--board ID|URL] [--server URL] [--name NAME] [--id ID] [--model M] [--effort E] [--allow-remote] [--voice NAME] [--voice-model M] [--no-voice]`, from the directory Codex should work in (it offers the panel the models Codex lists, so people choose the model and effort per request; `--model` and `--effort` set the defaults there instead of your Codex settings; the thread shows what it runs on):

```sh
cd ~/src/some-project
quickdraw agent codex --board ID     # "Codex · some-project" joins the board
```

### Which board it joins

No need to note the board's id down:

- **Copy it from the board.** While no AI has joined, the board's AI panel (✦ on the right) shows the command for that board, with a Copy button; with an AI already there, "…" → *Copy AI command* copies it. It names the board by its id on this machine's `quickdraw serve` (port 8795), and by its page URL elsewhere (another port, or through `tailscale serve`), which says the server too.

  <img src="docs/agent-join.png" alt="The AI panel of a board no AI has joined: the command quickdraw agent codex --board ID, with a Copy button" width="320">

- **Or choose it at the terminal.** Without `--board`, with several boards on the server, it asks which one:

  ```console
  $ quickdraw agent codex
  Which board?
    1) Plan  (jlge2of3f7)
    2) Retro  (bfbblsruqg)
  Number (1-2): 2
  Next time: quickdraw agent codex --board bfbblsruqg
  ```

  Only at a terminal: piped or run by another agent, it fails and lists the boards, as the board commands do. With one board it joins that one, and it never makes a board.

Codex joins the board as a participant with a cursor, and the board's AI panel sends it requests. It works in that directory with its files, its `AGENTS.md` and skills, and your own Codex settings (model, sandbox, approvals): asking from the board never gets it more than that. When Codex asks for an approval, the panel shows it to the people on the board.

- It runs `codex app-server` (JSON-RPC over stdio). The board tools of [`quickdraw-agent`](../../packages/quickdraw-agent) go to Codex as client-defined tools (`dynamicTools`, part of app-server's **experimental** API), and run in this process, on its copy of the board: each operation goes to the panel with its diff, so a request can be undone at once, and no board command runs in Codex's sandbox.
- People watch it work: each operation is made on a copy of the board first (checked, all or nothing), then put on the board a piece at a time with its cursor on each; the panel's view follows it for a request asked there.
- **Drawing together**: for anything bigger than a note or two, Codex first claims a work area (`claim_area`): a dashed box with its name and what it is making, in free space by what the request is about (or where the request says). Everyone sees where it will draw; its inside lets the pointer through, so people draw in it too. Drag its label to move it, its corner to resize it. What Codex adds without a place goes in the area, which grows to take in what it puts beside it. It builds in steps people can follow (skeleton, contents, arrows, tidy), and each step's result tells it what people added, changed or removed in the area, or that they moved it: it keeps their work and builds with it. The area goes when the request is done.
- **Asking and answering on the board**: the panel's dashed-square button lets you drag out where it should work before you ask; that box is its work area from the start, and Codex is told where it is. While it works, an approval shows above its area's label too (Allow / Deny), and **Stop** by the label (or in the thread) ends its turn where it is (`turn/interrupt`): what it did stays, to keep or undo, and what it was waiting on is declined.
- **Images**: Codex's image generation works as usual; an `add_image` tool puts a generated image (or an image file from the working directory) on the board, where Codex says. Images are made lighter first (1024 px at most, a JPEG unless see-through), as every device loads them with the board. With `split`, a sheet laid out as an even grid — stickers for reacting on the board, icons, sprites — is cut into its cells, which go on the board as separate images in the same grid, in a frame if asked: "make 8 LINE-style reaction stickers and put them on the board one by one" works as one request. The shrinking and cutting is done by `sips` on macOS, else by Pillow through [`uv`](https://docs.astral.sh/uv/) ([`src/agent/image_tool.py`](src/agent/image_tool.py); uv fetches Pillow the first time); with neither, images go as they are and sheets cannot be cut. `QUICKDRAW_IMAGE_TOOL=sips|uv|none` chooses.
- **Who may ask it**: only people on the computer running `quickdraw serve`, unless it is started with `--allow-remote`. The server tells them apart: a connection is from this computer when it comes from a loopback address, to a loopback name (`localhost`, `127.0.0.1`), with no proxy's headers (`tailscale serve` connects from 127.0.0.1 too, but adds `Tailscale-User-Login` and `X-Forwarded-For`), and — from a browser — from one of the server's own pages (so another site open in the same browser cannot ask it). Anyone else sees the panel, the threads and the usage, but cannot send requests, replies or approvals to it; the panel says why. With `--allow-remote` (to ask from a phone through Tailscale, say), anyone who can open the board can. The server checks, and the agent checks again. A board's command to copy has `--allow-remote` when it is copied from another computer, since that is who would ask it.
- **Account and usage**: the panel shows what Codex runs on — the kind of account and its plan ("ChatGPT Pro Lite", "OpenAI API key"; never its email, as everyone on the board sees it) — and how much of each usage limit is used and when it starts again, from app-server's `account/read` and `account/rateLimits/read`, kept up to date by its `account/rateLimits/updated` notifications. The one most used is also beside the model picker.

  <img src="docs/agent-usage.png" alt="The AI panel with Codex on the board: ChatGPT Pro Lite, Weekly 9% · resets in 6d, and Weekly 9% beside the model picker" width="320">

- One Codex thread per request; a follow-up in the panel continues it (and steers a turn that is still running).
- **Talking**: press the microphone on the board's right rail and say what you want, while it works. `codex app-server`'s realtime conversation (`thread/realtime/*`, **experimental**) runs it: a voice model (`--voice-model`, `gpt-live-1-codex` by default) talks with you and hands the work to a Codex thread of its own as you speak, and that thread uses the board tools like any request. The call is WebRTC, placed by app-server with your own Codex sign-in (a ChatGPT account works; no API key needed), so the sound goes straight between your browser and OpenAI. A bar over the board says who you talk with and what was last said, with mute and hang up; the panel's thread keeps what you said, what it answered, and what it did (to undo). `--voice` picks its voice (`alloy`, `marin`, …), `--no-voice` turns talking off. The same people may talk as may ask (`--allow-remote`); a microphone needs a secure page (`http://localhost`, or https through `tailscale serve`).

  <img src="docs/voice.png" alt="A board with three frames — plan, doing, done — with two notes each, made while talking; the voice bar at the top says Talking with Codex · work, and the AI panel lists the Voice conversation" width="640">
- Ctrl-C leaves the board; so does losing Codex or the board. What it was still doing ends with an error in the thread.

## Board commands

`quickdraw boards | new | read | export | note | text | shape | markdown | embed | image | frame | arrow | update | move | arrange | fit | delete | apply | log | undo`. They join a board like a browser tab, as one more peer with a cursor, and print JSON.

- **Which board**: `--board` takes an id, the page URL (`https://host/b/<id>`, as the browser shows it) or the relay URL (`ws://host/ws/<id>`); or `$QUICKDRAW_BOARD`; or `--file` for a JSON file. Ids are looked up on `--server` / `$QUICKDRAW_SERVER`, by default this machine's `quickdraw serve`. Without a board, the server's only board is used; with several, the command fails and lists them — it never makes one up. (`quickdraw agent codex` at a terminal asks instead: [Which board it joins](#which-board-it-joins).) They are built on [`quickdraw-agent`](../../packages/quickdraw-agent)'s operations.

- **Images and embeds**: `image FILE` puts an image file from the working directory (made lighter, and cut into cells with `--split COLSxROWS`, as `add_image` does); `embed URL` a page or a link card, `embed --html-file` inline HTML. On a live board a link card gets its title and picture from the server's `/preview`, as in the page; Codex's `add_embed` too.
- **Undo**: each operation's diff goes to `.quickdraw/log.jsonl` in the working directory (or `$QUICKDRAW_LOG`); `undo` reverts what nobody changed since and reports the rest.
- **PNG** (`export --format png`): drawn by the core itself in a headless Chrome already on the machine — see below.

Agents learn the commands from the [Agent Skill](../../skills/quickdraw/SKILL.md): link or copy `skills/quickdraw` into the agent's skills folder (for Claude Code, `.claude/skills/quickdraw`).

### PNG export and the machine it runs on

- **Out of sight**: `--headless=new`, no window, focus, mouse or keyboard; on macOS it registers as a background-only app (not in the Dock or ⌘Tab).
- **Separate from the user's Chrome**: a throwaway profile (removed after), no extensions, sync, background networking or keychain.
- **No ports**: driven over a pipe (`--remote-debugging-pipe`); the page's code is served from disk through DevTools request interception, and every other request is refused.
- **Reused, without leaks**: one Chrome per `Renderer`; each render gets its own browser context and page, disposed afterwards; Chrome closes after 30 s idle and restarts every 100 renders. A command reuses it for every image it writes (e.g. `--frame all`) and closes it at the end.
- **Never outlives its process**: Chrome runs in its own process group, and a one-line shell watchdog ends it and removes its profile if the Node process dies without cleaning up (SIGKILL, SIGINT, SIGTERM). Stale profiles older than a day are swept on the next launch.
- **Smaller**: no GPU process, one renderer process, background features off.

## Moving from the old example server

A board from the old example server (`examples/quickdraw-yjs/board.sqlite`) carries over: copy the file to `~/.quickdraw/board.sqlite`. The next `quickdraw serve` takes it in as a board called "Board" and renames the file to `board.sqlite.imported`.

## Development

The Node side is TypeScript that Node runs as is (type stripping, Node ≥ 23.6): no build, and only erasable syntax (no `enum`, no parameter properties). Node does not strip types under `node_modules`, so the command runs from a checkout or `npm link`, not from a registry install. The page stays plain JavaScript that the browser loads as served.

```sh
npm test -w apps/quickdraw
npm run typecheck -w apps/quickdraw
```
