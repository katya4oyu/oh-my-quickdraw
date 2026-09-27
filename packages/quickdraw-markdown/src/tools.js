// Toolbar items for Markdown cards, as plain objects (the shape
// quickdraw-toolbar takes; nothing here depends on it): add a card or open a
// .md file from the rail; edit or save a selected card.
import { createMarkdown, downloadMarkdown, editMarkdown, isMarkdownSupported, openMarkdownFile, TYPE } from './index.js'

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const MARKDOWN_ICONS = {
  card: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15V9l2.5 3L12 9v6"/><path d="M17 9v6"/><path d="m15 13 2 2 2-2"/>'),
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  save: svg('<path d="M12 3v11"/><path d="m7 9 5 5 5-5"/><path d="M5 20h14"/>'),
}

const isCard = (shape) => shape.type === TYPE
const failed = (what) => (e) => alert(`${what} failed: ${e.message}`)

export function markdownTools({ md } = {}) {
  const available = isMarkdownSupported
  return {
    rail: [
      {
        id: 'markdown', title: 'Markdown card', icon: MARKDOWN_ICONS.card, available,
        run: ({ editor }) => {
          const v = editor.viewportPageBounds()
          const w = Math.min(360, v.w * 0.85)
          const id = createMarkdown(editor.store, { x: v.x + (v.w - w) / 2, y: v.y + v.h * 0.2, w, ...(md ? { md } : {}) })
          editor.setTool('select')
          editor.setSelection([id])
          editMarkdown(editor, id)
        },
      },
      { id: 'markdown-open', title: 'Open .md file', icon: MARKDOWN_ICONS.open, available, run: ({ editor }) => openMarkdownFile(editor).catch(failed('Open')) },
    ],
    context: [
      { id: 'markdown-edit', title: 'Edit Markdown', icon: MARKDOWN_ICONS.edit, when: isCard, run: ({ editor, shape }) => editMarkdown(editor, shape.id) },
      { id: 'markdown-save', title: 'Save as .md', icon: MARKDOWN_ICONS.save, when: isCard, run: ({ editor, shape }) => downloadMarkdown(editor.store, shape.id) },
    ],
  }
}
