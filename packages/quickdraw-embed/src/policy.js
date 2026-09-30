// The security boundary for embeds. Pure functions, no DOM, so they are easy
// to test and to reuse (import validation, servers).
//
// Every client decides for itself, at render time, what a record may show:
// a synced or imported record only carries a URL or some HTML, never
// permission. URLs must be https and match an allowed rule, which also
// rewrites them to the provider's embed URL. Inline HTML runs in an
// opaque-origin sandbox (scripts only) under a CSP that allows no network.
import { checkPreview, checkThumbnail } from './preview.js'

export const MAX_URL_LENGTH = 2048
export const MAX_HTML_LENGTH = 200_000

const ID = /^[\w-]+$/

// rule: { name, embed(url: URL) -> embed URL string | null, or a Promise of one }
// Async rules can consult a file, IndexedDB or any other store of the app's.
export const DEFAULT_RULES = [
  {
    name: 'YouTube',
    embed(u) {
      const host = u.hostname.replace(/^(www\.|m\.)/, '')
      let id = null
      if (host === 'youtu.be') id = u.pathname.slice(1)
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]
      }
      return id && ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
    },
  },
  {
    name: 'Vimeo',
    embed(u) {
      const id = u.hostname === 'vimeo.com' ? u.pathname.match(/^\/(\d+)$/)?.[1]
        : u.hostname === 'player.vimeo.com' ? u.pathname.match(/^\/video\/(\d+)$/)?.[1] : null
      return id ? `https://player.vimeo.com/video/${id}` : null
    },
  },
  {
    name: 'Figma',
    embed(u) {
      if (u.hostname !== 'www.figma.com' && u.hostname !== 'figma.com') return null
      if (!/^\/(file|design|proto|board|slides)\/[\w-]+/.test(u.pathname)) return null
      return `https://www.figma.com/embed?embed_host=quickdraw&url=${encodeURIComponent(u.href)}`
    },
  },
  {
    name: 'CodePen',
    embed(u) {
      const m = u.hostname === 'codepen.io' && u.pathname.match(/^\/([\w-]+)\/(?:pen|embed)\/([\w-]+)\/?$/)
      return m ? `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result` : null
    },
  },
  {
    name: 'Google Maps',
    embed(u) {
      return u.hostname === 'www.google.com' && u.pathname === '/maps/embed' && u.searchParams.has('pb') ? u.href : null
    },
  },
]

// -> Promise of { src, name } for an allowed https URL, else of null.
// Rules are tried in order; the first to return an https URL wins. A rule
// that throws or rejects counts as not allowing the URL.
export async function resolveEmbedUrl(url, rules = DEFAULT_RULES) {
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return null
  let u
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  for (const rule of rules) {
    let src = null
    try { src = await rule.embed(new URL(u.href)) } catch {}
    if (typeof src === 'string' && src.startsWith('https://')) return { src, name: rule.name }
  }
  return null
}

// iframe attributes, by kind
export const URL_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation'
export const URL_ALLOW = 'fullscreen; picture-in-picture; encrypted-media'
export const HTML_SANDBOX = 'allow-scripts' // opaque origin: no parent, cookies, forms, popups or navigation of the top
export const HTML_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"

// the srcdoc for inline HTML: the CSP comes first, so the page can only tighten it
export function htmlDocument(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_CSP}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0}</style></head><body>${html}</body></html>`
}

// For quickdraw-import's `types` option: { types: { embed: validateEmbed } }.
// Checks the record is well formed; what it may show is decided at render time.
export function validateEmbed(shape) {
  const p = shape.props
  if (!Number.isFinite(p.w) || !Number.isFinite(p.h) || p.w < 40 || p.h < 40 || p.w > 4000 || p.h > 4000) return 'bad size'
  if (p.title != null && (typeof p.title !== 'string' || p.title.length > 200)) return 'bad props.title'
  const bad = checkThumbnail(p.thumbnail)
  if (bad) return bad
  if (p.kind === 'url' || p.kind === 'link') {
    if (typeof p.url !== 'string' || p.url.length > MAX_URL_LENGTH || !/^https?:\/\//.test(p.url)) return 'bad props.url'
    if (p.kind === 'url' && !p.url.startsWith('https://')) return 'bad props.url'
    const err = checkPreview(p.preview)
    if (err) return err
  } else if (p.kind === 'html') {
    if (typeof p.html !== 'string') return 'bad props.html'
    if (p.html.length > MAX_HTML_LENGTH) return `props.html is too long (max ${MAX_HTML_LENGTH} characters)`
  } else return 'bad props.kind'
  return null
}
