# Affinity groups

This moves what people made rather than drawing anew: plain lists of steps with `apply` (no origin), one group per `apply`, so people see the groups form one by one.

Many loose items sorted into groups, each with a heading that says what the group means. See `../tidy.md` for the steps; the layout:

```json
[
  {"do": "arrange", "ids": ["shape:a", "shape:b", "shape:c"], "layout": "grid", "cols": 3, "gap": 24, "at": [0, 0]},
  {"do": "frame", "title": "Onboarding is slow", "around": ["shape:a", "shape:b", "shape:c"]}
]
```

```json
[
  {"do": "arrange", "ids": ["shape:d", "shape:e"], "layout": "grid", "cols": 3, "gap": 24, "at": [800, 0]},
  {"do": "frame", "title": "Pricing confuses people", "around": ["shape:d", "shape:e"]}
]
```

Put each group where it goes in the row (`at`, clear of the last group's frame), and the row is made as the groups are.

A frame's title is the group's meaning ("Onboarding is slow"), not its category ("Onboarding"). Relations between groups: draw them as an SVG over the frames (arrows between them), with `omq svg --at`.
