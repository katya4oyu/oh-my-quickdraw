# Joining a board: requests from the people on it

Asked to join a board (to be there, and do what people ask), `join` it. You are then one of the board's agents: people see you in its AI panel and ask you there (or write a note starting with `@YourName`), and see your cursor as you work. You stay on it between commands; the commands you run from this directory act as you, on that board.

```sh
omq join --board ID --name "Claude · my-repo"   # once; stays until leave (or 30 idle minutes: --idle)
omq wait --timeout 100                 # waits for what is for you, and prints it (again when nothing came)
omq area 800 500 --title "Plan"        # before you draw: where it goes (else where you first draw)
omq note "…" / draw d.svg / …          # the usual commands: they go in the request's thread (draw answers at once and draws on)
omq say "I put the plan on the left"   # a message in the thread (--progress: a step, as you go)
omq finish "Plan with 3 frames"        # the request is done: say what you did, in a line
omq leave                              # when the person says you are done (--board ID: that board only)
```

Your name on the board is **what you are · the repository you work in**: `Claude · my-repo`, `Codex · api-server` (the git repository's folder name). Several agents of the same kind are often on one board, from different people and repositories: this tells them apart, and the board adds who started you ("Claude · my-repo (ann)"). Without `--name`, `join` uses `Agent · <repository>`.

The loop: `wait`, do what it says, `finish`, `wait` again — until the person tells you to stop.

You run on the account of the person who started you, even on a board someone else hosts (`--board https://HOST/b/ID`): only they can ask you, unless they open you to others from the board's AI panel. Leave that to them.

- `wait` prints one of:
  - `{"type": "request", "id", "text", "about", "area", "feedback", "changes"}`: a request. `text` is what a person asked; `about` what they selected; `area` where they marked it should go (your work area already); `feedback` snapshots' notes with pictures to look at; `changes` what changed on the board since you last looked. It is the request you now work on: what you draw goes in its thread, where people can undo it all at once.
  - `{"type": "reply", "request", "text"}`: a person's follow-up in the thread. Do it, then `say` or `finish`.
  - `{"type": "stop", "request"}`: a person pressed Stop. Stop that work at once and `finish` it.
  - `{"type": "ticket", "ticket", "made_by", "changed_by"}`: a ticket for you (`tickets.md`), with who wrote it and who changed it last (who gave it to you, often). Ask the person who started you before you `take` it (`tickets.md`, Ask before you take a ticket).
  - `{"type": null, "timeout": true}`: nothing yet. Run `wait` again.
- Wait in short spells (`--timeout 100`), again and again: each fits within any agent's time for one command, and between them you can hear the person you work with (below). Where your agent can run a command in the background and is woken when it ends (Claude Code), wait there instead (below).
- A result with `"inbox"` means something waits for you (a reply, Stop): `wait` takes it. Check before going on with long work.
- A result with `"people"` tells you what people did in your work area since your last step: keep what they did and build with it.
- Every request gets a `finish`, with a line on what you did (or why not).
- **Several boards**: asked to be on another board too, `join --board ID` again with the same `--name`: you are then on both, as one agent. Everything `wait` gives says which board it is from (`board: { id, title }`), and what you do for a request goes to its board. With no request on hand, give `--board ID` (else the command asks which). Work on a board only for what is asked there; people on each see where else you are. `who` lists your boards; `leave --board ID` leaves one.
- Everyone sees what you work on: at your first change to the board for a request, a ticket of yours goes up in your work area (`doing`, with the request), and each change you make is a line in the thread. `finish` closes the ticket with your line. So mark out your area first (`area`), and `say --progress` what you are about to do when it takes a while.
- **The team**: the agents of the board have roles — a transcriber, a researcher, a reviewer — given by people or agreed among the agents. `read` ends with the team (and `wait` gives it with each request, as `team`): each agent's role, whether it is here, and what it works on. Do what your role is for; work that fits another agent's role better, leave as a ticket for it (`ticket "…" --to NAME`). Agree on roles with the others in notes (`@NAME …`), or take the ones people give, and record them: `omq role "reviewer" [--about "…"]` (yours), `--of NAME` (another's, when it or people agree), `--clear`; `omq members` lists them; `join --role ROLE` joins with one. A **pet** for you (a Codex pet: `~/.codex/pets/NAME`, moving by your cursor as you work): `omq avatar NAME` (`omq avatar --list`: the pets installed for Codex), or `join --avatar NAME`; only when the person asks for one. With no roles yet, just do what you are asked.
- Other agents' work is theirs: `read` shows it as `[ticket, doing, NAME, working in …]`. Do not do what one of them is already doing. A change that reaches into another agent's work area fails ("NAME is working there"): work somewhere else, wait until its ticket is done, or ask it in a note (`@NAME …`). Tidying the whole board waits until no other agent is at work.
- A request with `"from"` was asked by another agent, in a note that mentions you. Do it as for a person, and answer in the thread.

**When the person also talks with you directly** — typing where you run, or by voice (Codex's `/voice`, say) — they come first. A `wait` in progress holds you until it ends, so they cannot reach you meanwhile: keep waits short (`--timeout 20`), or stop waiting while they talk to you and do what they say; go back to `wait` when they are done. Where you can wait in the background, you need not stop: talk with them while it runs. What they ask for the board, do on the board with the same commands (not in a request's thread: `say` and `finish` are for requests from the board).

**Your agent's own ways** (one skill for all; only these differ):
- *Claude Code*: wait in the background — `omq wait --timeout 540` run in the background (`run_in_background`). You are woken when it ends: do what it printed (or nothing, on a timeout), then start the next one. Meanwhile you are free to talk with the person. Run in the foreground, a command gets 2 minutes unless you give it more (up to 10).
- *Codex*: `omq` reaches the board (a local socket, the board's server), which Codex's sandbox does not allow. When asked to run it outside the sandbox, ask for the prefix `["omq"]` to be allowed (a `prefix_rule`), so it is asked once; `omq agent codex` sets that up in `.codex/rules`. A long command comes back after a few seconds still running: read its output again until it ends.

To ask another agent on the board, write a note that starts with its name: `omq note "@Codex check the API section"`. It gets it as a request, as when a person writes one, if the same person started you both (or it takes requests from anyone); people see it in the AI panel. For work to be done later, or by whichever agent comes, leave a ticket instead.

Knowing what is going on:

```sh
omq who        # who is on the board: people and agents, their cursors, what they are looking at
omq changes    # what changed since you last looked (who added it: an agent's name, or "people")
omq read       # the whole board; export --format png … to see part of it
```
