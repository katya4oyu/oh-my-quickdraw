# Affinity groups

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

Many loose items sorted into groups, each with a heading that says what the group means. See `../tidy.md` for the steps; the layout:

```json
[
  { "do": "arrange", "ids": ["NOTE1", "NOTE2", "NOTE3"], "layout": "grid", "cols": 2, "gap": 24 },
  { "do": "frame", "title": "Onboarding is slow", "around": ["NOTE1", "NOTE2", "NOTE3"], "ref": "g1" },
  { "do": "arrange", "ids": ["NOTE4", "NOTE5"], "layout": "grid", "cols": 2, "gap": 24 },
  { "do": "frame", "title": "Pricing is unclear", "around": ["NOTE4", "NOTE5"], "ref": "g2" },
  { "do": "arrange", "ids": ["@g1", "@g2"], "layout": "row", "gap": 80 }
]
```

A frame's title is the group's meaning ("Onboarding is slow"), not its category ("Onboarding"). Relations between groups: arrows between the frames.
