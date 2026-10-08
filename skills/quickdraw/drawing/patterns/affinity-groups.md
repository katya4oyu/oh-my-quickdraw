# Affinity groups

This moves what people made rather than drawing anew: plain lists of steps (no origin), one group per `apply`, so people see the groups form one by one.

Many loose items sorted into groups, each with a heading that says what the group means. See `../tidy.md` for the steps; the layout:

```json
[
  { "do": "arrange", "ids": ["NOTE1", "NOTE2", "NOTE3"], "layout": "grid", "cols": 2, "gap": 24, "at": [2000, 0] },
  { "do": "frame", "title": "Onboarding is slow", "around": ["NOTE1", "NOTE2", "NOTE3"] }
]
```

```json
[
  { "do": "arrange", "ids": ["NOTE4", "NOTE5"], "layout": "grid", "cols": 2, "gap": 24, "at": [2600, 0] },
  { "do": "frame", "title": "Pricing is unclear", "around": ["NOTE4", "NOTE5"] }
]
```

Put each group where it goes in the row (`at`, clear of the last group's frame), and the row is made as the groups are.

A frame's title is the group's meaning ("Onboarding is slow"), not its category ("Onboarding"). Relations between groups: arrows between the frames.
