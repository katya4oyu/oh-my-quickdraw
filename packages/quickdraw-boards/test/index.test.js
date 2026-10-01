import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { createBoardCard, validateBoardCard, isBoardCard, boardCardTools, knowBoards } from '../src/index.js'

describe('board cards', () => {
  it('is a card for a board: its id, title, size, live or not', () => {
    const store = new Store()
    const id = createBoardCard(store, { x: 10, y: 20, board: 'abc123', title: 'Roadmap' })
    const s = store.get(id)
    expect(isBoardCard(s)).toBe(true)
    expect(s.props).toEqual({ board: 'abc123', title: 'Roadmap', w: 360, h: 260, live: false })
    expect(validateBoardCard(s)).toBeNull()
    expect(validateBoardCard({ props: { ...s.props, board: '../x' } })).toBe('bad props.board')
    expect(validateBoardCard({ props: { ...s.props, live: 'yes' } })).toBe('bad props.live')
  })

  it('offers the other boards from the rail, and live / open on a card', () => {
    const opened = []
    const tools = boardCardTools({ current: 'here', open: (id) => opened.push(id) })
    knowBoards([{ id: 'here', title: 'This one' }, { id: 'b2', title: 'Roadmap' }, { id: 'b3', title: 'Retro' }])
    expect(tools.rail[0].menu().map((m) => m.title)).toEqual(['Roadmap', 'Retro']) // not itself
    const store = new Store()
    const editor = { store, viewportPageBounds: () => ({ x: 0, y: 0, w: 800, h: 600 }), setTool() {}, setSelection(ids) { this.sel = ids } }
    tools.rail[0].menu()[0].run({ editor })
    const card = store.get(editor.sel[0])
    expect(card.props).toMatchObject({ board: 'b2', title: 'Roadmap' })
    const live = tools.context.find((c) => c.id === 'board-live').menu[0]
    live.run({ editor, shape: card })
    expect(store.get(card.id).props.live).toBe(true)
    tools.context.find((c) => c.id === 'board-open').run({ shape: card })
    expect(opened).toEqual(['b2'])
  })
})
