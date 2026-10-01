# quickdraw-members

The agents of a Quickdraw board and their roles — a transcriber, a researcher, a reviewer — so each agent knows what it is there for and what the others are, and people can see and change who does what. Agents may settle it among themselves, or people assign them; the table says who set each.

It is a table in the board's Yjs document (a map named `members` beside the board's own), not shapes: it syncs and persists with the board, and goes into its versions. A profile card on the board is only a view of it.

```js
import { bindMembers } from 'quickdraw-members'

const members = bindMembers(ydoc)
members.set('Codex · api-server', { role: 'reviewer', about: 'Reads the PRs and comments' }, 'Ann')
members.get('codex · api-server') // { name, role, about, avatar, by: 'Ann', at }
members.list()
members.onChange(() => render())
```

One entry per agent, by name (case does not matter). `set` keeps what it is not given; an empty role and about take the agent out of the table. Roles are cut to 60 characters, `about` to 300.

## Pets (avatars)

An agent's avatar can be a **Codex pet** — the sprite sheet a Codex pet is made of (`~/.codex/pets/NAME/spritesheet.webp`: 8 × 9 cells of 192 × 208, a row per state; [hatch-pet](https://github.com/openai/skills/tree/main/skills/.curated/hatch-pet)), played as Codex plays it, so any Codex pet works as it is. The sheet goes on the board as an image asset (at half its size: it is shown about 44 px tall), and the table points at it: `avatar = { kind: 'codex-pet', name, asset }`.

```js
import { createPet, petState } from 'quickdraw-members'
const pet = createPet(sheetUrl, { height: 44 })   // { el, play(state), destroy() }
pet.play(petState({ activity: 'drawing', dx: 30 })) // running-right
```

`petState` turns what an agent does into a row, as [navi](https://github.com/katya4oyu/agent-pets) does: thinking / reading / searching → review, running / editing → running, drawing → running towards where its cursor goes, waiting for a person → waving, done → a jump (once), an error → failed, else idle. With reduced motion it keeps to the first idle frame. In `apps/quickdraw` a pet plays beside its agent's cursor (quickdraw-presence's `avatar` option) and in the Team panel; a profile card shows its first idle frame.

## Profile cards

A card on the board for an agent — its initials in its colour, its name, role and what it does — is a view of the table: `memberTools({ members, agents, me })` gives a rail button (a menu of the agents) and **Edit role** on a selected card (for [`quickdraw-toolbar`](../quickdraw-toolbar)); `bindMemberCardEditing(editor, members)` edits on double-click (first line the role, the rest what it does), and that goes to the table. `bindMemberCards(store, members)` keeps every card with the table. Removing a card leaves the role. Cards are a custom shape type (`member`), so they need the fork's `registerShapeType`; `validateMemberCard` is for `quickdraw-import`.

`apps/quickdraw` gives agents the table: `quickdraw role` and `members`, the `set_role` tool, and the team (who is here, their roles and what each is working on) with what they read of the board.
