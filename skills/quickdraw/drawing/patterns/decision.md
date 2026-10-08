# Decision (issue → options → chosen)

One SVG, drawn with `omq svg` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

The core of most meetings: a question, the options with what each costs, the one chosen. The question on the left, options in a column, the chosen one green and bold, the dropped ones grey, the reason in a smaller grey text under the option's name. A question in a diamond: its words about half the diamond's width, on two lines.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 320">
  <title>Decided: onboarding first</title>
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker></defs>
  <g id="question">
    <path d="M10 160 L140 70 L270 160 L140 250 Z" fill="none" stroke="#e03131" stroke-width="3"/>
    <text x="140" y="154" font-size="16" fill="#e03131" text-anchor="middle">Onboarding or</text>
    <text x="140" y="176" font-size="16" fill="#e03131" text-anchor="middle">billing first?</text>
  </g>
  <g id="options">
    <rect x="390" y="30" width="260" height="90" rx="8" fill="none" stroke="#099268" stroke-width="5"/>
    <text x="520" y="70" font-size="16" fill="#099268" text-anchor="middle">Onboarding first</text>
    <text x="520" y="94" font-size="12" fill="#9fa8b2" text-anchor="middle">2 weeks · fewer tickets</text>
    <rect x="390" y="200" width="260" height="90" rx="8" fill="none" stroke="#9fa8b2" stroke-width="3"/>
    <text x="520" y="240" font-size="16" fill="#9fa8b2" text-anchor="middle">Billing redesign first</text>
    <text x="520" y="264" font-size="12" fill="#9fa8b2" text-anchor="middle">paying users</text>
    <line x1="240" y1="138" x2="382" y2="90" stroke="#1d1d1d" stroke-width="3" marker-end="url(#a)"/>
    <line x1="240" y1="182" x2="382" y2="230" stroke="#9fa8b2" stroke-width="3" marker-end="url(#a)"/>
  </g>
</svg>
```

The title says the decision, so it reads even from afar. Still open: the question stays red, no option is green, and the title asks the question. When it is decided, change the SVG and draw it again with `--replace`: only what changed is redrawn.
