# Cause chain and loop

One SVG, drawn with `omq svg` (`../visual-thinking.md`, Place): each `<g>` is a unit of thought, drawn in the order written. Replace the words, widen the boxes for longer ones, and fix what `hits` reports with `--replace`.

"A leads to B leads to C"; a loop when C feeds back into A (a vicious or a virtuous circle). Lay the steps on a circle; the arrows go round, curved (`Q`).

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 480">
  <title>The support loop</title>
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker></defs>
  <g id="steps">
    <rect x="220" y="10" width="180" height="70" rx="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="310" y="51" font-size="16" fill="#1d1d1d" text-anchor="middle">More tickets</text>
    <rect x="430" y="300" width="180" height="70" rx="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="520" y="341" font-size="16" fill="#1d1d1d" text-anchor="middle">Slower replies</text>
    <rect x="10" y="300" width="180" height="70" rx="8" fill="none" stroke="#1d1d1d" stroke-width="3"/>
    <text x="100" y="341" font-size="16" fill="#1d1d1d" text-anchor="middle">Angry users</text>
  </g>
  <g id="arrows">
    <path d="M406 50 Q520 80 520 292" fill="none" stroke="#e03131" stroke-width="3" marker-end="url(#a)"/>
    <path d="M424 360 Q310 460 196 360" fill="none" stroke="#e03131" stroke-width="3" marker-end="url(#a)"/>
    <path d="M100 292 Q100 80 214 50" fill="none" stroke="#e03131" stroke-width="3" marker-end="url(#a)"/>
  </g>
  <g id="name">
    <text x="310" y="230" font-size="22" fill="#e03131" text-anchor="middle">vicious circle</text>
  </g>
</svg>
```

The loop's name in the middle. A chain without a loop: a flow.
