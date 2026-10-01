import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { bindArrows, arrowEnds } from '../src/arrows.js'

const box = (id, x, y) => ({ id, typeName: 'shape', type: 'geo', x, y, rot: 0, z: 1, props: { geo: 'rectangle', w: 100, h: 60, color: 'black' } })
const arrow = (id, x, y, dx, dy, extra = {}) => ({ id, typeName: 'shape', type: 'arrow', x, y, rot: 0, z: 5, ...extra, props: { dx, dy, bend: 0, color: 'black', size: 'm', dash: 'solid' } })
const settle = () => new Promise((r) => setTimeout(r, 5))
function board() {
  const store = new Store()
  const container = new EventTarget()
  const unbind = bindArrows({ store, container })
  store.put(box('shape:a', 0, 0))
  store.put(box('shape:b', 300, 0))
  const letGo = async () => { container.dispatchEvent(new Event('pointerup')); await settle() }
  return { store, letGo, unbind }
}

describe('arrows that follow what they connect', () => {
  it('links an arrow drawn from one shape to another, once let go, edge to edge', async () => {
    const { store, letGo } = board()
    store.put(arrow('shape:ar', 50, 30, 300, 0)) // from inside A to inside B
    expect(store.get('shape:ar').link).toBeUndefined() // not while drawing
    await letGo()
    const a = store.get('shape:ar')
    expect(a.link).toEqual({ from: 'shape:a', to: 'shape:b' })
    expect(a.x).toBeGreaterThanOrEqual(100) // from A's edge…
    expect(a.x + a.props.dx).toBeLessThanOrEqual(300) // …to B's
  })

  it('follows a shape moved or resized, at once', async () => {
    const { store, letGo } = board()
    store.put(arrow('shape:ar', 50, 30, 300, 0))
    await letGo()
    store.update('shape:b', { y: 400 })
    const a = store.get('shape:ar')
    expect(a.y + a.props.dy).toBeGreaterThan(300) // it points down to B now
    const before = store.get('shape:ar').x
    store.update('shape:a', { props: { w: 200 } }) // wider: from its new middle
    expect(store.get('shape:ar').x).toBeGreaterThan(before)
  })

  it('lets go of a shape it was dragged off, and of one removed (the arrow stays)', async () => {
    const { store, letGo } = board()
    store.put(arrow('shape:ar', 50, 30, 300, 0))
    await letGo()
    store.update('shape:ar', { props: { dx: 900, dy: 500 } }) // its end, dragged off B
    await letGo()
    expect(store.get('shape:ar').link).toBeUndefined()
    store.put(arrow('shape:ar2', 50, 30, 300, 0))
    await letGo()
    store.remove(['shape:b'])
    expect(store.get('shape:ar2')).toBeTruthy()
    expect(store.get('shape:ar2').link).toBeUndefined()
  })

  it('leaves an arrow alone that does not land on two shapes, and remote edits', async () => {
    const { store, letGo } = board()
    store.put(arrow('shape:free', 500, 500, 100, 0))
    await letGo()
    expect(store.get('shape:free').link).toBeUndefined()
    expect(arrowEnds(store, arrow('x', 50, 30, 0, 10))).toBeNull() // both ends on A
    store.put(arrow('shape:ar', 50, 30, 300, 0), 'remote')
    await letGo()
    expect(store.get('shape:ar').link).toBeUndefined() // another page's: it links its own
  })
})
