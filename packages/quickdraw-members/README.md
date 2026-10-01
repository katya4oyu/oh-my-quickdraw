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

`apps/quickdraw` gives agents the table: `quickdraw role` and `members`, the `set_role` tool, and the team (who is here, their roles and what each is working on) with what they read of the board.
