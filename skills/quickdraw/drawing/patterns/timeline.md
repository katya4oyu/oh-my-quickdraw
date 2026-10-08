# Timeline

One SVG, drawn with `omq svg` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

Events at points in time, left to right: small dots on a line, the date above, the event below.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 200">
  <title>Roadmap</title>
  <g id="line">
    <line x1="10" y1="100" x2="950" y2="100" stroke="#1d1d1d" stroke-width="3"/>
  </g>
  <g id="kickoff">
    <circle cx="80" cy="100" r="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="80" y="76" font-size="13" fill="#9fa8b2" text-anchor="middle">Oct 1</text>
    <text x="80" y="134" font-size="16" fill="#1d1d1d" text-anchor="middle">Kickoff</text>
  </g>
  <g id="beta">
    <circle cx="380" cy="100" r="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="380" y="76" font-size="13" fill="#9fa8b2" text-anchor="middle">Nov 15</text>
    <text x="380" y="134" font-size="16" fill="#1d1d1d" text-anchor="middle">Beta</text>
  </g>
  <g id="launch">
    <circle cx="680" cy="100" r="10" fill="none" stroke="#e03131" stroke-width="5"/>
    <text x="680" y="76" font-size="13" fill="#e03131" text-anchor="middle">Jan 10</text>
    <text x="680" y="136" font-size="16" fill="#e03131" text-anchor="middle">Launch</text>
  </g>
</svg>
```

Space points by time when the gaps mean something; evenly when only the order does. The point that matters now (today, the deadline) in another colour, bolder.
