# Pyramid

One SVG, drawn with `omq draw` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

Levels, the base widest: foundations → goals, many → few.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 330">
  <title>What we build on</title>
  <g id="base">
    <path d="M10 320 L610 320 L530 220 L90 220 Z" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="310" y="276" font-size="16" fill="#1d1d1d" text-anchor="middle">Reliable sync</text>
  </g>
  <g id="middle">
    <path d="M90 220 L530 220 L450 120 L170 120 Z" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="310" y="176" font-size="16" fill="#1d1d1d" text-anchor="middle">Agents that draw</text>
  </g>
  <g id="top">
    <path d="M170 120 L450 120 L310 10 Z" fill="none" stroke="#099268" stroke-width="5"/>
    <text x="310" y="96" font-size="16" fill="#099268" text-anchor="middle">Shared thinking</text>
  </g>
</svg>
```

Draw from the base up when it is built up; from the top down when it breaks a goal down.
