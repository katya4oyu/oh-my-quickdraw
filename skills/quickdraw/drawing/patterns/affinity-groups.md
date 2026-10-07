# Affinity groups

Many loose items sorted into groups, each with a heading that says what the group means. See `../tidy.md` for the steps. A row of frames, each lining up its items in a column: move each item `in` its group (people's notes may be moved, never deleted).

```json
[
  { "do": "frame", "title": "Retro", "arrange": "row", "ref": "all" },
  { "do": "frame", "title": "Onboarding is slow", "arrange": "column", "in": "@all", "ref": "g1" },
  { "do": "frame", "title": "Pricing is unclear", "arrange": "column", "in": "@all", "ref": "g2" },
  { "do": "move", "id": "NOTE1", "in": "@g1" },
  { "do": "move", "id": "NOTE2", "in": "@g1" },
  { "do": "move", "id": "NOTE3", "in": "@g2" }
]
```

A frame's title is the group's meaning ("Onboarding is slow"), not its category ("Onboarding"). Relations between groups: arrows between the frames.
