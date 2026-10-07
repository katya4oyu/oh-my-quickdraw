# Decision (issue → options → chosen)

The core of most meetings: a question, the options with what each costs, the one chosen. The options are joined to the question; the chosen one green, the dropped ones grey, the reason in the label's second line.

```json
[
  { "do": "shape", "shape": "diamond", "text": "Onboarding or\nbilling first?", "color": "red", "w": 260, "h": 180, "ref": "q" },
  { "do": "shape", "shape": "rectangle", "text": "Onboarding first\n(2 weeks, fewer tickets)", "color": "green", "fill": "solid", "w": 260, "from": "@q", "side": "right", "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Billing redesign first\n(paying users)", "color": "grey", "w": 260, "from": "@q", "side": "right", "line": true, "ref": "b" },
  { "do": "frame", "title": "Decided: onboarding first", "around": ["@q", "@a", "@b"] }
]
```

The frame's title says the decision, so it reads even from afar. Still open: the question stays red and no option is green.
