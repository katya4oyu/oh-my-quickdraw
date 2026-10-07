# Tidy: making sense of what people put on the board

People have scattered notes, sketches and links over the board (a brainstorm, feedback, a retro), and you are asked to sort it out. The content is theirs: you group it, name the groups and draw what it adds up to. Read `visual-thinking.md` first.

What people made may be moved and edited when asked to tidy, never deleted (ask them to). Leave other agents' work areas alone, and tidy the whole board only when no other agent is at work (`read` shows who works where).

## 1. Read

`omq read` (and `omq look` for sketches and pen strokes text cannot show). List every item people made in the region you were asked about, with its id. The step is done when every item is in your list.

## 2. Group (affinity)

1. Read the items for what they **mean**, not the words they share.
2. Put each item in a group; one item per group. Items that fit nowhere go in a small "Other" group — not forced into a group they do not belong to.
3. Name each group by what it says: a short sentence ("Onboarding is slow"), not a category ("Onboarding").
4. Lay out with the affinity pattern (`patterns.md`): each group arranged, framed with its name, and the frames lined up in a second operation. Duplicates sit next to each other in their group.

## 3. Relate and conclude

1. Between groups: arrows where one causes or feeds another, the biggest or most urgent group first in reading order (or `pen circle` it).
2. Above the groups: a Markdown card with what it all adds up to — 2–3 lines, each pointing at the groups it comes from. This is the part only you add; keep it clearly yours (a card, not people's notes rewritten).

## 4. Check

`lint --fix` (it touches only what agents made), then fix the rest with `move` and `arrange`, then `omq look` once. Tell the person how many items went into which groups, and what you concluded.
