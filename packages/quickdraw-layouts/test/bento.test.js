import { describe, it, expect } from 'vitest'
import { packBento } from '../src/bento.js'

const at = ({ places }) => Object.fromEntries(places.map((p) => [p.id, [p.col, p.row]]))

describe('packBento', () => {
  it('fills rows left to right', () => {
    const r = packBento([{ id: 'a', c: 1, r: 1 }, { id: 'b', c: 1, r: 1 }, { id: 'c', c: 1, r: 1 }], 2)
    expect(at(r)).toEqual({ a: [0, 0], b: [1, 0], c: [0, 1] })
    expect(r.rows).toBe(2)
  })

  it('packs densely: a small cell fills a gap left by a big one', () => {
    // a 2×2 then a 3-wide that does not fit beside it, then a 1×1 that does
    const r = packBento([{ id: 'big', c: 2, r: 2 }, { id: 'wide', c: 3, r: 1 }, { id: 'small', c: 1, r: 1 }], 4)
    expect(at(r)).toEqual({ big: [0, 0], wide: [0, 2], small: [2, 0] })
    expect(r.rows).toBe(3)
  })

  it('cuts cells wider than the grid to its width', () => {
    const r = packBento([{ id: 'a', c: 9, r: 1 }], 3)
    expect(r.places[0]).toMatchObject({ col: 0, row: 0, c: 3 })
  })

  it('has no rows when empty, and takes bad spans as 1', () => {
    expect(packBento([], 4)).toEqual({ places: [], rows: 0 })
    expect(packBento([{ id: 'a', c: 0, r: NaN }], 4).places[0]).toMatchObject({ c: 1, r: 1 })
  })
})
