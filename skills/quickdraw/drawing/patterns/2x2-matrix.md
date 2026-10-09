# 2x2 matrix

One SVG, drawn with `omq draw` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

Two axes, four quadrants: sort items by two qualities at once.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 500">
  <title>Effort and impact</title>
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker></defs>
  <g id="axes">
    <rect x="170" y="10" width="330" height="210" fill="none" stroke="#099268" stroke-width="3"/>
    <text x="335" y="40" font-size="16" fill="#099268" text-anchor="middle">Quick wins</text>
    <rect x="520" y="10" width="330" height="210" fill="none" stroke="#4263eb" stroke-width="3"/>
    <text x="685" y="40" font-size="16" fill="#4263eb" text-anchor="middle">Big bets</text>
    <rect x="170" y="240" width="330" height="210" fill="none" stroke="#9fa8b2" stroke-width="3"/>
    <text x="335" y="270" font-size="16" fill="#9fa8b2" text-anchor="middle">Fill-ins</text>
    <rect x="520" y="240" width="330" height="210" fill="none" stroke="#e03131" stroke-width="3"/>
    <text x="685" y="270" font-size="16" fill="#e03131" text-anchor="middle">Money pits</text>
    <text x="510" y="484" font-size="13" fill="#1d1d1d" text-anchor="middle">low effort ← → high effort</text>
    <text x="10" y="120" font-size="16" fill="#1d1d1d">high impact</text>
    <text x="10" y="350" font-size="16" fill="#1d1d1d">low impact</text>
  </g>
  <g id="first-items">
    <text x="190" y="80" font-size="14" fill="#1d1d1d">Sample data</text>
    <text x="540" y="80" font-size="14" fill="#1d1d1d">New billing</text>
  </g>
</svg>
```

The quadrant's name at its top. Then a `<g>` per item or two as you sort them: short texts (13–16 px) inside the quadrant, below its name. Many items: make the quadrants bigger.
