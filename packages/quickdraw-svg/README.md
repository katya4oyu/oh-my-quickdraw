# quickdraw-svg

An SVG as a whiteboard drawing. `readSvg(source)` reads an SVG's structure into what a person with a pen would draw of it, without laying anything out anew:

- its document order is the order of drawing; a top-level `<g>`, or a box and what is drawn inside it, is one unit
- a `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` or `path` is a pen stroke along its outline; a line's `marker-start` / `marker-end` an arrowhead of two strokes
- a `text` (each positioned `tspan`) is a line of words where it was, its size in px
- colours and widths come from attributes, `<style>` rules (by tag, class, id) and what a `<g>` passes down, to the nearest of the board's 12 colours and 4 pen sizes
- fills are not drawn (a whiteboard has none): a shape with only a fill gets its outline; a rect over the whole page is its paper (dark paper: its light ink is drawn black)
- what cannot be carried (gradients, filters, faint decoration, rotations) is listed in `dropped`

Every part says which element it came from (`el`: its `id`, else its tag and number, like `rect3`), so a board can keep the SVG as the source of what was drawn and say what people changed since. `svgElements(source)` says what each element is in a few words.

Dependency-free. `omq svg FILE` (oh-my-quickdraw) draws one on a live board, a stroke at a time.
