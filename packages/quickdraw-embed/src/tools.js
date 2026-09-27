// Toolbar items for embeds, as plain objects (the shape quickdraw-toolbar
// takes; nothing here depends on it): add a web page, a link card or HTML
// from the rail; use or open a selected embed. Takes the controller from
// bindEmbeds, and the app's fetchPreview for link cards.
import { createEmbed, isEmbedSupported, openLink, TYPE } from './index.js'

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const EMBED_ICONS = {
  embed: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  html: svg('<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13.5 5-3 14"/>'),
  use: svg('<path d="M5 3l14 7-6 2-2 6z"/>'),
  open: svg('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
}

const SAMPLE_HTML = '<style>body{font:16px system-ui;display:grid;place-items:center;height:100vh}</style><button onclick="this.textContent=+this.textContent+1">0</button>'

// embeds: what bindEmbeds returned; opts.fetchPreview: the app's link previews;
// opts.html: false to leave the HTML entry out (as with bindEmbeds' html: false)
export function embedTools(embeds, { fetchPreview, html = true } = {}) {
  function add(editor, props, w, h) {
    const v = editor.viewportPageBounds()
    const k = Math.min(1, (v.w * 0.9) / w)
    const id = createEmbed(editor.store, { x: v.x + (v.w - w * k) / 2, y: v.y + v.h * 0.15, w: w * k, h: h * k, fetchPreview, ...props })
    editor.setTool('select')
    editor.setSelection([id])
  }
  const ask = (label) => prompt(label)?.trim() || null
  return {
    rail: [{
      id: 'embed', title: 'Embed', icon: EMBED_ICONS.embed, available: isEmbedSupported,
      menu: [
        { id: 'embed-page', title: 'Web page (YouTube, Figma…)', icon: EMBED_ICONS.embed, run: ({ editor }) => { const url = ask('Page URL'); if (url) add(editor, { url }, 480, 270) } },
        { id: 'embed-link', title: 'Link card', icon: EMBED_ICONS.link, run: ({ editor }) => { const url = ask('Link URL'); if (url) add(editor, { kind: 'link', url }, 320, 260) } },
        ...(html ? [{ id: 'embed-html', title: 'HTML', icon: EMBED_ICONS.html, run: ({ editor }) => add(editor, { kind: 'html', html: SAMPLE_HTML }, 320, 200) }] : []),
      ],
    }],
    context: [
      {
        id: 'embed-use', title: 'Use (run and interact)', icon: EMBED_ICONS.use,
        when: (s) => s.type === TYPE && (s.props.kind === 'url' || (s.props.kind === 'html' && html)),
        run: ({ shape }) => { if (shape.props.kind === 'html') embeds.run(shape.id); embeds.activate(shape.id) },
      },
      {
        id: 'embed-open', title: 'Open link', icon: EMBED_ICONS.open,
        when: (s) => s.type === TYPE && s.props.kind !== 'html',
        run: ({ shape }) => openLink(shape.props.url),
      },
    ],
  }
}
