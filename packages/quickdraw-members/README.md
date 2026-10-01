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

## Profile cards

A card on the board for an agent — its initials in its colour, its name, role and what it does — is a view of the table: `memberTools({ members, agents, me })` gives a rail button (a menu of the agents) and **Edit role** on a selected card (for [`quickdraw-toolbar`](../quickdraw-toolbar)); `bindMemberCardEditing(editor, members)` edits on double-click (first line the role, the rest what it does), and that goes to the table. `bindMemberCards(store, members)` keeps every card with the table. Removing a card leaves the role. Cards are a custom shape type (`member`), so they need the fork's `registerShapeType`; `validateMemberCard` is for `quickdraw-import`.

`apps/quickdraw` gives agents the table: `quickdraw role` and `members`, the `set_role` tool, and the team (who is here, their roles and what each is working on) with what they read of the board.
