import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { exportJSON } from '../../quickdraw-export/src/index.js'
import { importJSON, parseJSON, MAX_SHAPES } from '../src/index.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const geo = (id, x, y, z, props = {}) => ({ id, typeName: 'shape', type: 'geo', x, y, rot: 0, z, props: { geo: 'rectangle', w: 10, h: 10, color: 'blue', ...props } })
const image = (id, assetId) => ({ id, typeName: 'shape', type: 'image', x: 0, y: 0, rot: 0, z: 1, props: { w: 10, h: 10, assetId } })
const asset = (id, src = PNG) => ({ id, typeName: 'asset', src, w: 1, h: 1 })
const file = (shapes, assets = {}) => ({ quickdraw: 1, shapes, assets })

// the parts of the Editor that importJSON touches
function fakeEditor(store = new Store()) {
  return {
    store, tool: 'draw', selection: new Set(),
    viewportPageBounds: () => ({ x: 1000, y: 2000, w: 400, h: 200 }),
    setTool(t) { this.tool = t },
    setSelection(ids) { this.selection = new Set(ids) },
  }
}

describe('importJSON', () => {
  it('adds new records centered in the view, on top, as one undo step, and selects them', () => {
    const store = new Store()
    store.put(geo('shape:existing', 0, 0, 7))
    const editor = fakeEditor(store)
    const ids = importJSON(editor, file([geo('shape:b', 100, 0, 2), geo('shape:a', 0, 0, 1)]))

    expect(ids).toHaveLength(2)
    expect(ids).not.toContain('shape:a')
    const [a, b] = ids.map((id) => store.get(id))
    expect([a.x, a.y, b.x, b.y]).toEqual([1150, 2100, 1250, 2100]) // origin box centered at (1200, 2100)
    expect([a.z, b.z]).toEqual([8, 9]) // original order, above everything
    expect(editor.tool).toBe('select')
    expect([...editor.selection]).toEqual(ids)

    store.undo()
    expect(store.ids()).toEqual(['shape:existing'])
  })

  it('re-ids image assets and points images at them', () => {
    const store = new Store()
    const [id] = importJSON(fakeEditor(store), file([image('shape:i', 'asset:a')], { 'asset:a': asset('asset:a') }))
    const assetId = store.get(id).props.assetId
    expect(assetId).not.toBe('asset:a')
    expect(store.asset(assetId).src).toBe(PNG)
  })

  it('round-trips what quickdraw-export writes', () => {
    const src = new Store()
    src.put(geo('shape:a', 0, 0, 1, { label: 'hi' }))
    src.put(image('shape:i', 'asset:a'))
    src.put(asset('asset:a'))
    const dst = new Store()
    importJSON(fakeEditor(dst), JSON.parse(JSON.stringify(exportJSON(src))))
    expect(dst.shapes().filter((s) => s.typeName === 'shape').map((s) => s.props.label || s.type).sort()).toEqual(['hi', 'image'])
  })
})

describe('parseJSON rejects untrusted input', () => {
  const bad = {
    'not a quickdraw file': { shapes: [] },
    'shapes not an array': { quickdraw: 1, shapes: {} },
    'unknown shape type': file([{ ...geo('s', 0, 0, 1), type: 'script' }]),
    'non-finite position': file([geo('s', NaN, 0, 1)]),
    'string position': file([geo('s', '0', 0, 1)]),
    'unknown color': file([geo('s', 0, 0, 1, { color: 'url(javascript:alert(1))' })]),
    'missing geometry': file([{ ...geo('s', 0, 0, 1), props: { geo: 'rectangle' } }]),
    'bad pts': file([{ id: 's', typeName: 'shape', type: 'draw', x: 0, y: 0, z: 1, props: { pts: [1, 2] } }]),
    'image without asset': file([image('s', 'asset:none')]),
    'remote image url': file([image('s', 'asset:a')], { 'asset:a': asset('asset:a', 'https://evil.example/track.png') }),
    'svg image': file([image('s', 'asset:a')], { 'asset:a': asset('asset:a', 'data:image/svg+xml;base64,PHN2Zz4=') }),
    'too many shapes': file(Array.from({ length: MAX_SHAPES + 1 }, (_, i) => geo('s' + i, 0, 0, i))),
  }
  for (const [name, data] of Object.entries(bad)) {
    it(name, () => expect(() => parseJSON(data)).toThrow())
  }

  it('rejects the whole file and leaves the board untouched', () => {
    const store = new Store()
    expect(() => importJSON(fakeEditor(store), file([geo('ok', 0, 0, 1), geo('bad', 0, 0, 2, { size: 'huge' })]))).toThrow(/#2/)
    expect(store.size).toBe(0)
  })
})
