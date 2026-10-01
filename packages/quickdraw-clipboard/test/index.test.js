import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { clipboardOf, payloadIn, pasteShapes, pasteNote, shapeText } from '../src/index.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const geo = (id, x, y, z, label = '') => ({ id, typeName: 'shape', type: 'geo', x, y, rot: 0, z, props: { geo: 'rectangle', w: 100, h: 60, color: 'blue', label } })
function fakeEditor(store = new Store(), view = { x: 0, y: 0, w: 800, h: 600 }) {
  return {
    store, tool: 'draw', selection: new Set(),
    viewportPageBounds: () => view,
    setTool(t) { this.tool = t },
    setSelection(ids) { this.selection = new Set(ids) },
  }
}

describe('copying out', () => {
  it('puts the shapes for a board (in html) and their text for anywhere else', () => {
    const store = new Store()
    store.put(geo('shape:a', 10, 10, 1, 'Login'))
    store.put(geo('shape:b', 200, 10, 2, 'Sign up — ünïcode'))
    store.put({ id: 'asset:p', typeName: 'asset', src: PNG, w: 1, h: 1 })
    store.put({ id: 'shape:i', typeName: 'shape', type: 'image', x: 0, y: 100, rot: 0, z: 3, props: { w: 10, h: 10, assetId: 'asset:p' } })
    const data = clipboardOf(store, ['shape:a', 'shape:b', 'shape:i'])
    expect(data.text).toBe('Login\n\nSign up — ünïcode')
    expect(data.html).toMatch(/^<meta charset="utf-8"><div data-quickdraw="[A-Za-z0-9+/=]+">Login<br><br>Sign up — ünïcode<\/div>$/)
    const back = payloadIn(data.html, data.text)
    expect(back.shapes.map((s) => s.id)).toEqual(['shape:a', 'shape:b', 'shape:i'])
    expect(Object.keys(back.assets)).toEqual(['asset:p'])
    // shapes with no text: their JSON as the text, so a board still takes them
    const plain = clipboardOf(store, ['shape:i'])
    expect(payloadIn('', plain.text).shapes).toHaveLength(1)
    expect(clipboardOf(store, [])).toBeNull()
  })

  it('reads text as people do: notes, labels, cards, tickets', () => {
    expect(shapeText({ props: { md: '# Title' } })).toBe('# Title')
    expect(shapeText({ props: { title: 'A ticket' } })).toBe('A ticket')
    expect(shapeText({ props: {} })).toBe('')
  })
})

describe('pasting in', () => {
  it('takes only a board\'s payload, and checks it first', () => {
    expect(payloadIn('<b>hi</b>', 'just words')).toBeNull()
    expect(payloadIn('', '{"quickdraw":1,"shapes":[]}')).toEqual({ quickdraw: 1, shapes: [] })
    const editor = fakeEditor()
    expect(() => pasteShapes(editor, { quickdraw: 1, shapes: [{ ...geo('s', 0, 0, 1), type: 'script' }] })).toThrow(/Invalid shape/)
    expect(editor.store.shapes()).toHaveLength(0)
  })

  it('puts shapes a little down and right of where they were, in view; else in the middle; and selects them', () => {
    const store = new Store()
    const editor = fakeEditor(store)
    const ids = pasteShapes(editor, { quickdraw: 1, shapes: [geo('shape:a', 10, 10, 1, 'A')], assets: {} })
    expect(store.get(ids[0])).toMatchObject({ x: 26, y: 26 })
    expect([...editor.selection]).toEqual(ids)
    const far = pasteShapes(editor, { quickdraw: 1, shapes: [geo('shape:b', 5000, 5000, 1)], assets: {} })
    expect(store.get(far[0])).toMatchObject({ x: 350, y: 270 }) // the middle of the view
  })

  it('makes text from elsewhere a note in the middle of the view', () => {
    const editor = fakeEditor()
    const id = pasteNote(editor, '  from an email\r\nsecond line  ')
    expect(editor.store.get(id)).toMatchObject({ type: 'note', x: 300, y: 200, props: { text: 'from an email\nsecond line' } })
    expect(pasteNote(editor, '   ')).toBeNull()
  })
})
