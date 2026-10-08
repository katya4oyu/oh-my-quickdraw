# Venn

One SVG, drawn with `omq svg` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

What two (or three) things share. The circles overlap on purpose.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 360">
  <title>Who uses it</title>
  <g id="first">
    <circle cx="210" cy="180" r="160" fill="none" stroke="#4263eb" stroke-width="3"/>
    <text x="130" y="186" font-size="16" fill="#4263eb" text-anchor="middle">Designers</text>
  </g>
  <g id="second">
    <circle cx="410" cy="180" r="160" fill="none" stroke="#099268" stroke-width="3"/>
    <text x="490" y="186" font-size="16" fill="#099268" text-anchor="middle">Engineers</text>
  </g>
  <g id="shared">
    <text x="310" y="176" font-size="14" fill="#1d1d1d" text-anchor="middle">review</text>
    <text x="310" y="198" font-size="14" fill="#1d1d1d" text-anchor="middle">together</text>
  </g>
</svg>
```

What only one has: in its own part; what both share: in the middle, short.
