# Flow (sequence, with decisions)

One SVG, drawn with `omq draw` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

Steps in order, 260 apart, centred on one line; a diamond for a choice.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 180">
  <title>Onboarding flow</title>
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker></defs>
  <g id="first-steps">
    <rect x="10" y="45" width="180" height="90" rx="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="100" y="96" font-size="16" fill="#1d1d1d" text-anchor="middle">Sign up</text>
    <rect x="270" y="45" width="180" height="90" rx="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="360" y="96" font-size="16" fill="#1d1d1d" text-anchor="middle">Verify email</text>
    <line x1="196" y1="90" x2="262" y2="90" stroke="#1d1d1d" stroke-width="3" marker-end="url(#a)"/>
  </g>
  <g id="the-choice">
    <path d="M530 90 L620 20 L710 90 L620 160 Z" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="620" y="96" font-size="16" fill="#1d1d1d" text-anchor="middle">Paid?</text>
    <line x1="456" y1="90" x2="522" y2="90" stroke="#1d1d1d" stroke-width="3" marker-end="url(#a)"/>
    <rect x="790" y="45" width="180" height="90" rx="8" fill="none" stroke="#099268" stroke-width="3"/>
    <text x="880" y="96" font-size="16" fill="#099268" text-anchor="middle">Dashboard</text>
    <line x1="716" y1="90" x2="782" y2="90" stroke="#1d1d1d" stroke-width="3" marker-end="url(#a)"/>
    <text x="749" y="78" font-size="12" fill="#1d1d1d" text-anchor="middle">yes</text>
  </g>
</svg>
```

The word on a branch ("yes"): a 12 px text just above the arrow's middle. More than 5 steps: two rows, or a column.
