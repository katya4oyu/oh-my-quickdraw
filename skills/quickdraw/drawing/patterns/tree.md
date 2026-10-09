# Tree (breakdown, why-why, issue tree)

One SVG, drawn with `omq draw` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

A root on top, its parts below, evidence under the parts. Children 300 apart; the root centred over them.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 360">
  <title>Why churn is up</title>
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker></defs>
  <g id="root">
    <rect x="300" y="10" width="200" height="80" rx="8" fill="none" stroke="#e03131" stroke-width="3"/>
    <text x="400" y="56" font-size="16" fill="#e03131" text-anchor="middle">Churn is up</text>
  </g>
  <g id="parts">
    <rect x="10" y="190" width="180" height="80" rx="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="100" y="236" font-size="16" fill="#1d1d1d" text-anchor="middle">Price</text>
    <rect x="310" y="190" width="180" height="80" rx="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="400" y="236" font-size="16" fill="#1d1d1d" text-anchor="middle">Onboarding</text>
    <rect x="610" y="190" width="180" height="80" rx="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="700" y="236" font-size="16" fill="#1d1d1d" text-anchor="middle">Bugs</text>
    <line x1="330" y1="94" x2="170" y2="184" stroke="#1d1d1d" stroke-width="3" marker-end="url(#a)"/>
    <line x1="400" y1="96" x2="400" y2="182" stroke="#1d1d1d" stroke-width="3" marker-end="url(#a)"/>
    <line x1="470" y1="94" x2="630" y2="184" stroke="#1d1d1d" stroke-width="3" marker-end="url(#a)"/>
  </g>
  <g id="evidence">
    <line x1="100" y1="276" x2="100" y2="312" stroke="#9fa8b2" stroke-width="1.5"/>
    <text x="100" y="334" font-size="12" fill="#9fa8b2" text-anchor="middle">Plan B costs 2× A</text>
  </g>
</svg>
```

More than 4 children, or deeper than 3 levels: grow sideways instead (the root on the left, each level a column, arrows to the right).
