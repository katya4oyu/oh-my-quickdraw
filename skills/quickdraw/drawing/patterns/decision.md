# Decision (issue → options → chosen)

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `"@q"` points at what an earlier unit named `q`.

The core of most meetings: a question, the options with what each costs, the one chosen. The question on the left, options in a column, the chosen one green, the dropped ones grey, the reason in a smaller grey text under the option's name. A question in a diamond: its text narrower than the diamond (about half its width), wrapped to two lines.

```json
{"unit": "the question", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "diamond", "color": "red", "w": 260, "h": 180, "at": [0, 60], "ref": "q"},
  {"do": "text", "text": "Onboarding or billing first?", "font_size": 16, "color": "red", "w": 140, "align": "middle", "at": [60, 129]}
] }
```

```json
{"unit": "the options", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 260, "h": 90, "at": [380, 0], "ref": "a"},
  {"do": "text", "text": "Onboarding first", "font_size": 16, "color": "black", "w": 260, "align": "middle", "at": [380, 24]},
  {"do": "text", "text": "(2 weeks, fewer tickets)", "font_size": 12, "color": "grey", "w": 260, "align": "middle", "at": [380, 50]},
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 260, "h": 90, "at": [380, 200], "ref": "b"},
  {"do": "text", "text": "Billing redesign first", "font_size": 16, "color": "black", "w": 260, "align": "middle", "at": [380, 224]},
  {"do": "text", "text": "(paying users)", "font_size": 12, "color": "grey", "w": 260, "align": "middle", "at": [380, 250]},
  {"do": "arrow", "from": "@q", "to": "@a", "from_at": [229, 123], "to_at": [374, 83]},
  {"do": "arrow", "from": "@q", "to": "@b", "from_at": [231, 175], "to_at": [374, 211]}
] }
```

```json
{"unit": "the one chosen", "items": [
  {"do": "update", "id": "@a", "color": "green", "fill": "solid"},
  {"do": "update", "id": "@b", "color": "grey"},
  {"do": "frame", "title": "Decided: onboarding first", "around": ["@q", "@a", "@b"]}
] }
```

The frame's title says the decision, so it reads even from afar. Still open: the question stays red and no option is green.
