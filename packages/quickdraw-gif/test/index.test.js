import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { isGifSrc, gifsOf, coveredIn } from '../src/index.js'

const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
const PNG = 'data:image/png;base64,iVBORw0KGgo='
function board() {
  const store = new Store()
  store.put({ id: 'asset:g', typeName: 'asset', src: GIF, w: 100, h: 80 })
  store.put({ id: 'asset:p', typeName: 'asset', src: PNG, w: 100, h: 80 })
  const image = (id, assetId, x, z) => store.put({ id, typeName: 'shape', type: 'image', x, y: 0, rot: 0, z, props: { w: 100, h: 80, assetId } })
  image('shape:gif', 'asset:g', 0, 1)
  image('shape:png', 'asset:p', 300, 2)
  return store
}
const sorted = (store) => store.shapes().filter((s) => s.typeName === 'shape').sort((a, b) => a.z - b.z)

describe('GIFs', () => {
  it('knows a GIF by its source', () => {
    expect(isGifSrc(GIF)).toBe(true)
    expect(isGifSrc('https://example.com/party.gif?x=1')).toBe(true)
    expect(isGifSrc(PNG)).toBe(false)
    expect(isGifSrc(undefined)).toBe(false)
  })

  it('finds the GIFs on a board', () => {
    expect(gifsOf(board()).map(([s]) => s.id)).toEqual(['shape:gif'])
  })

  it('keeps a GIF still while something is drawn over it, so what is on top stays on top', () => {
    const store = board()
    const gif = store.get('shape:gif')
    expect(coveredIn(sorted(store), gif)).toBe(false)
    store.put({ id: 'shape:note', typeName: 'shape', type: 'image', x: 50, y: 40, rot: 0, z: 3, props: { w: 60, h: 60, assetId: 'asset:p' } })
    expect(coveredIn(sorted(store), gif)).toBe(true)
    // under it (lower), or beside it: not covered
    store.update('shape:note', { z: 0 })
    expect(coveredIn(sorted(store), gif)).toBe(false)
    store.update('shape:note', { z: 3, x: 600 })
    expect(coveredIn(sorted(store), gif)).toBe(false)
  })
})
