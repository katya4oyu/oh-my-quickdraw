import { describe, it, expect } from 'vitest'
import { Store } from '../../../vendor/quickdraw/packages/core/src/store.js'
import { exportJSON } from '../src/index.js'

const shape = (id, z, extra = {}) => ({ id, typeName: 'shape', type: 'geo', x: 0, y: 0, rot: 0, z, props: { w: 10, h: 10 }, ...extra })
const image = (id, z, assetId) => shape(id, z, { type: 'image', props: { w: 10, h: 10, assetId } })
const asset = (id) => ({ id, typeName: 'asset', src: 'data:image/png;base64,AAAA', w: 1, h: 1 })

function board() {
  const store = new Store()
  store.put(shape('shape:top', 3))
  store.put(image('shape:img', 1, 'asset:used'))
  store.put(shape('shape:mid', 2))
  store.put(asset('asset:used'))
  store.put(asset('asset:orphan'))
  return store
}

describe('exportJSON', () => {
  it('exports the whole board back-to-front in the clipboard format', () => {
    const data = exportJSON(board())
    expect(data.quickdraw).toBe(1)
    expect(data.shapes.map((s) => s.id)).toEqual(['shape:img', 'shape:mid', 'shape:top'])
  })

  it('includes only the assets that exported images reference', () => {
    expect(Object.keys(exportJSON(board()).assets)).toEqual(['asset:used'])
    expect(exportJSON(board(), { ids: new Set(['shape:top']) }).assets).toEqual({})
  })

  it('exports just the given ids, skipping missing ones and assets', () => {
    const data = exportJSON(board(), { ids: new Set(['shape:top', 'shape:img', 'shape:gone', 'asset:used']) })
    expect(data.shapes.map((s) => s.id)).toEqual(['shape:img', 'shape:top'])
    expect(Object.keys(data.assets)).toEqual(['asset:used'])
  })

  it('round-trips through JSON unchanged', () => {
    const data = exportJSON(board())
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
  })
})
