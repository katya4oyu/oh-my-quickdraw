// Toolbar items for layouts, as plain objects (the shape quickdraw-toolbar
// takes; nothing here depends on it): a bento grid for the rail, and for a
// selected area or cell: add a cell, its span, auto, and the columns.
import { addCell, createLayout, isCell, isLayout, setColumns, setSpan } from './index.js'

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const LAYOUT_ICONS = {
  bento: svg('<rect x="3" y="3" width="11" height="8" rx="1.5"/><rect x="16" y="3" width="5" height="8" rx="1.5"/><rect x="3" y="13" width="5" height="8" rx="1.5"/><rect x="10" y="13" width="11" height="8" rx="1.5"/>'),
  cell: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/>'),
  span: svg('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="m7 12 2-2"/><path d="m7 12 2 2"/><path d="m17 12-2-2"/><path d="m17 12-2 2"/>'),
  auto: svg('<rect x="6" y="3" width="12" height="18" rx="2"/><path d="m10 15 2 2 2-2"/><path d="m10 9 2-2 2 2"/>'),
  columns: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 4v16"/>'),
}

export const SPANS = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [4, 2]]
export const COLUMNS = [2, 3, 4, 6]

function addLayout(editor) {
  const v = editor.viewportPageBounds()
  const w = Math.min(1200, v.w * 0.9)
  const id = createLayout(editor.store, { x: v.x + (v.w - w) / 2, y: v.y + v.h * 0.1, w })
  addCell(editor.store, id, { c: 2, r: 2, title: 'Main' })
  addCell(editor.store, id, { title: 'Note' })
  addCell(editor.store, id, { title: 'Note' })
  editor.setTool('select')
  editor.setSelection([id])
}

const areaOf = (editor, s) => (isLayout(s) ? s : editor.store.get(s.layoutId))

export function layoutTools() {
  return {
    rail: [{ id: 'layout-bento', title: 'Bento grid', icon: LAYOUT_ICONS.bento, run: ({ editor }) => addLayout(editor) }],
    context: [
      {
        id: 'layout-add-cell', title: 'Add a cell', icon: LAYOUT_ICONS.cell, when: (s) => isLayout(s) || isCell(s),
        run: ({ editor, shape }) => {
          const id = addCell(editor.store, areaOf(editor, shape).id)
          editor.setSelection([id])
        },
      },
      {
        id: 'layout-span', title: 'Cell size', icon: LAYOUT_ICONS.span, when: isCell,
        menu: SPANS.map(([c, r]) => ({
          id: `layout-span-${c}x${r}`, title: `${c} × ${r}`,
          checked: ({ shape }) => shape.span?.c === c && shape.span?.r === r,
          run: ({ editor, shape }) => setSpan(editor.store, shape.id, { c, r, auto: false }),
        })),
      },
      {
        id: 'layout-auto', title: 'Rows follow contents (on / off)', icon: LAYOUT_ICONS.auto, when: isCell,
        run: ({ editor, shape }) => setSpan(editor.store, shape.id, { auto: !shape.span.auto }),
      },
      {
        id: 'layout-columns', title: 'Columns', icon: LAYOUT_ICONS.columns, when: isLayout,
        menu: COLUMNS.map((n) => ({
          id: `layout-columns-${n}`, title: `${n} columns`,
          checked: ({ shape }) => shape.layout?.cols === n,
          run: ({ editor, shape }) => setColumns(editor.store, shape.id, n),
        })),
      },
    ],
  }
}
