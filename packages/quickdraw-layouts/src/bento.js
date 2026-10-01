// Bento packing, pure and DOM-free: cells of c×r units, in order, each at the
// first free spot (row by row, left to right) it fits in — as CSS Grid's
// `grid-auto-flow: dense` does. Wider cells than the grid are cut to its width.
//
// cells: [{ id, c, r }] in their order; cols: the grid's columns.
// Returns { places: [{ id, col, row, c, r }], rows }.
export function packBento(cells, cols) {
  cols = Math.max(1, Math.floor(cols))
  const taken = [] // taken[row][col]
  const free = (row, col, c, r) => {
    for (let y = row; y < row + r; y++) for (let x = col; x < col + c; x++) if (taken[y]?.[x]) return false
    return true
  }
  const places = []
  let rows = 0
  for (const cell of cells) {
    const c = Math.min(cols, Math.max(1, Math.round(cell.c) || 1))
    const r = Math.max(1, Math.round(cell.r) || 1)
    let row = 0, col = 0
    for (;; row++) {
      col = 0
      while (col + c <= cols && !free(row, col, c, r)) col++
      if (col + c <= cols) break
    }
    for (let y = row; y < row + r; y++) {
      taken[y] ??= []
      for (let x = col; x < col + c; x++) taken[y][x] = true
    }
    places.push({ id: cell.id, col, row, c, r })
    rows = Math.max(rows, row + r)
  }
  return { places, rows }
}
