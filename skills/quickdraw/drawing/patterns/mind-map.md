# Mind map

One SVG, drawn with `omq svg` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

One topic in the centre, its parts around it; parts of parts further out.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 500">
  <title>Offsite</title>
  <g id="topic">
    <ellipse cx="410" cy="250" rx="130" ry="60" fill="none" stroke="#1d1d1d" stroke-width="5"/>
    <text x="410" y="258" font-size="22" fill="#1d1d1d" text-anchor="middle">Offsite</text>
  </g>
  <g id="venue">
    <rect x="10" y="40" width="170" height="60" rx="8" fill="none" stroke="#4263eb" stroke-width="3"/>
    <text x="95" y="76" font-size="16" fill="#4263eb" text-anchor="middle">Venue</text>
    <line x1="186" y1="90" x2="320" y2="210" stroke="#4263eb" stroke-width="3"/>
  </g>
  <g id="agenda">
    <rect x="640" y="40" width="170" height="60" rx="8" fill="none" stroke="#099268" stroke-width="3"/>
    <text x="725" y="76" font-size="16" fill="#099268" text-anchor="middle">Agenda</text>
    <line x1="634" y1="90" x2="500" y2="210" stroke="#099268" stroke-width="3"/>
  </g>
</svg>
```

Then a `<g>` per branch as it comes up (redraw with `--replace`): Budget at the lower left, People at the lower right; up to 6 branches: the corners, then left and right of the centre. A branch's own items: a column of short texts beyond it, joined with lines.
