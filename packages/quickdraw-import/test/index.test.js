import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { exportJSON } from '../../quickdraw-export/src/index.js'
import { importJSON, parseJSON, MAX_SHAPES, isSvgText, svgSize, sizedSvg, svgDataUrl } from '../src/index.js'

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
    'svg not inline': file([image('s', 'asset:a')], { 'asset:a': asset('asset:a', 'https://evil.example/x.svg') }),
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

describe('SVG', () => {
  it('is an image like any other (shown as an image, its scripts and links do nothing)', () => {
    const data = file([image('s', 'asset:a')], { 'asset:a': asset('asset:a', 'data:image/svg+xml;base64,PHN2Zz4=') })
    expect(Object.keys(parseJSON(data).assets)).toEqual(['asset:a'])
  })

  it('knows SVG code, and its size from width/height or its viewBox', () => {
    expect(isSvgText('<svg viewBox="0 0 10 10"><rect/></svg>')).toBe(true)
    expect(isSvgText('<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n')).toBe(true)
    expect(isSvgText('<div><svg></svg></div>')).toBe(false)
    expect(isSvgText('hello <svg></svg>')).toBe(false)
    expect(svgSize('<svg width="120" height="80px"></svg>')).toEqual({ w: 120, h: 80 })
    expect(svgSize("<svg viewBox='0 0 24 12'></svg>")).toEqual({ w: 24, h: 12 })
    expect(svgSize('<svg width="48" viewBox="0 0 24 12"></svg>')).toEqual({ w: 48, h: 24 })
    expect(svgSize('<svg width="100%" viewBox="0,0,30,20"></svg>')).toEqual({ w: 30, h: 20 }) // % is no size
    expect(svgSize('<svg></svg>')).toBeNull()
  })

  it('gets a size of its own when it has none, so it lands as an image', () => {
    expect(sizedSvg('<svg viewBox="0 0 24 12" fill="red"><path/></svg>')).toBe('<svg width="24" height="12" viewBox="0 0 24 12" fill="red"><path/></svg>')
    expect(sizedSvg('<svg viewBox="0 0 4000 2000"></svg>')).toMatch(/^<svg width="1024" height="512" /)
    expect(sizedSvg('<svg width="100%" height="100%"></svg>')).toBe('<svg width="300" height="150"></svg>')
    const sized = '<svg width="10" height="10"></svg>'
    expect(sizedSvg(sized)).toBe(sized)
    expect(atob(svgDataUrl('<svg>é</svg>').split(',')[1])).toBe(String.fromCharCode(...new TextEncoder().encode('<svg>é</svg>')))
  })
})

describe('types from other packages', () => {
  const custom = (props) => ({ id: 's', typeName: 'shape', type: 'card', x: 0, y: 0, z: 1, props })
  const file = (props) => ({ quickdraw: 1, shapes: [custom(props)], assets: {} })
  const types = { card: (s) => (typeof s.props.text === 'string' ? null : 'bad props.text') }

  it('are validated by the given function', () => {
    expect(parseJSON(file({ text: 'hi' }), { types }).shapes).toHaveLength(1)
    expect(() => parseJSON(file({ text: 1 }), { types })).toThrow(/bad props.text/)
  })

  it('still get the common checks, and a throwing validator rejects the file', () => {
    expect(() => parseJSON({ quickdraw: 1, shapes: [{ ...custom({ text: 'x' }), x: NaN }] }, { types })).toThrow(/position/)
    expect(() => parseJSON(file({}), { types: { card: () => { throw new Error('boom') } } })).toThrow(/boom/)
  })

  it('cannot smuggle in a type through the prototype', () => {
    expect(() => parseJSON({ quickdraw: 1, shapes: [{ ...custom({}), type: 'constructor' }] }, { types: {} })).toThrow(/unknown shape type/)
  })
})
