# Decision (issue → options → chosen)

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

The core of most meetings: a question, the options with what each costs, the one chosen. The question on the left, options in a column, the chosen one green, the dropped ones grey, the reason in the label's second line.

```json
[
  { "do": "shape", "shape": "diamond", "text": "Onboarding or\nbilling first?", "color": "red", "w": 260, "h": 180, "at": { "x": 0, "y": 60 }, "ref": "q" },
  { "do": "shape", "shape": "rectangle", "text": "Onboarding first\n(2 weeks, fewer tickets)", "color": "green", "fill": "solid", "w": 260, "h": 90, "at": { "x": 380, "y": 0 }, "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Billing redesign first\n(paying users)", "color": "grey", "w": 260, "h": 90, "at": { "x": 380, "y": 200 }, "ref": "b" },
  { "do": "arrow", "from": "@q", "to": "@a" },
  { "do": "arrow", "from": "@q", "to": "@b", "line": true },
  { "do": "frame", "title": "Decided: onboarding first", "around": ["@q", "@a", "@b"] }
]
```

The frame's title says the decision, so it reads even from afar. Still open: the question stays red and no option is green.
