// Toolbar items for frames, as plain objects (the shape quickdraw-toolbar
// takes; nothing here depends on it): a Frame button with aspect ratios for
// the rail, and rename / aspect / export for a selected frame.
import { createFrame, exportFrame, frameTitle, isFrame, renameFrame, setFrameAspect } from './index.js'

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const FRAME_ICONS = {
  frame: svg('<path d="M4 8h16"/><path d="M4 16h16"/><path d="M8 4v16"/><path d="M16 4v16"/>'),
  rename: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  aspect: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4"/><path d="M17 10v4"/>'),
  exportImage: svg('<path d="M12 3v11"/><path d="m7 9 5 5 5-5"/><path d="M5 20h14"/>'),
}

export const FRAME_RATIOS = [['16:9', 16 / 9], ['16:10', 16 / 10], ['4:3', 4 / 3], ['1:1', 1], ['Free', null]]

function addFrame(editor, aspect) {
  const v = editor.viewportPageBounds()
  let w = Math.min(480, v.w * 0.8), h = Math.min(320, v.h * 0.6)
  if (aspect) { w = Math.min(w, h * aspect); h = w / aspect }
  const id = createFrame(editor.store, { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h, aspect })
  editor.setTool('select')
  editor.setSelection([id])
}

function download(blob, name) {
  if (!blob) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export function frameTools() {
  return {
    rail: [{
      id: 'frame', title: 'Frame', icon: FRAME_ICONS.frame,
      menu: FRAME_RATIOS.map(([label, aspect]) => ({
        id: 'frame-' + label, title: aspect ? `Frame ${label}` : 'Free frame', icon: FRAME_ICONS.frame,
        run: ({ editor }) => addFrame(editor, aspect),
      })),
    }],
    context: [
      {
        id: 'frame-rename', title: 'Rename frame', icon: FRAME_ICONS.rename, when: isFrame,
        run: ({ editor, shape }) => { // a prompt: the core edits text on dblclick, which iOS does not send
          const title = prompt('Frame name', frameTitle(editor.store, shape.id))
          if (title != null) renameFrame(editor.store, shape.id, title)
        },
      },
      {
        id: 'frame-aspect', title: 'Aspect ratio', icon: FRAME_ICONS.aspect, when: isFrame,
        menu: FRAME_RATIOS.map(([label, aspect]) => ({
          id: 'frame-aspect-' + label, title: label,
          checked: ({ shape }) => (aspect ? Math.abs((shape.aspect ?? 0) - aspect) < 1e-6 : !shape.aspect),
          run: ({ editor, shape }) => setFrameAspect(editor.store, shape.id, aspect),
        })),
      },
      {
        id: 'frame-export', title: 'Export frame as PNG', icon: FRAME_ICONS.exportImage, when: isFrame,
        run: async ({ editor, shape }) => download(await exportFrame(editor, shape.id), (frameTitle(editor.store, shape.id) || 'frame') + '.png'),
      },
    ],
  }
}
