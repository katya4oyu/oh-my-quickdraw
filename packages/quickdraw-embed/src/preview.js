// Link previews (Open Graph), pure and DOM-free so a proxy or server can use
// them too. A preview is fetched once, by whoever creates the card, and
// stored in the record: viewers never contact the site, and the canvas only
// ever draws stored text and an inline image.
//
// preview: { title?, description?, siteName?, image?: 'data:image/…;base64,…' }

export const PREVIEW_LIMITS = { title: 200, description: 400, siteName: 100, image: 200_000 }
const PREVIEW_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decode(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}
const clean = (s, max) => (s == null ? undefined : decode(String(s)).replace(/\s+/g, ' ').trim().slice(0, max) || undefined)

// Reads og:/twitter: tags (falling back to <title> and meta description)
// from a page's HTML. image is an absolute https URL, for the caller to fetch.
export function parseOpenGraph(html, pageUrl) {
  const head = String(html).slice(0, 500_000)
  const meta = {}
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i)
    if (key && content && !(key in meta)) meta[key] = content[1] ?? content[2]
  }
  let image
  const src = meta['og:image'] || meta['og:image:url'] || meta['twitter:image']
  if (src) {
    try {
      const u = new URL(decode(src), pageUrl)
      if (u.protocol === 'https:') image = u.href
    } catch {}
  }
  return {
    title: clean(meta['og:title'] || meta['twitter:title'] || head.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1], PREVIEW_LIMITS.title),
    description: clean(meta['og:description'] || meta['twitter:description'] || meta.description, PREVIEW_LIMITS.description),
    siteName: clean(meta['og:site_name'], PREVIEW_LIMITS.siteName),
    image,
  }
}

// Keeps only well-formed, bounded fields (for anything an app's fetchPreview returns).
export function cleanPreview(p) {
  if (!p || typeof p !== 'object') return undefined
  const out = {
    title: clean(p.title, PREVIEW_LIMITS.title),
    description: clean(p.description, PREVIEW_LIMITS.description),
    siteName: clean(p.siteName, PREVIEW_LIMITS.siteName),
  }
  if (typeof p.image === 'string' && p.image.length <= PREVIEW_LIMITS.image && PREVIEW_IMAGE.test(p.image)) out.image = p.image
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return Object.keys(out).length ? out : undefined
}

// For records: the preview, if any, must already be clean.
export function checkPreview(p) {
  if (p == null) return null
  if (typeof p !== 'object' || Array.isArray(p)) return 'bad props.preview'
  for (const k of Object.keys(p)) if (!(k in PREVIEW_LIMITS)) return `unknown props.preview.${k}`
  for (const k of ['title', 'description', 'siteName']) {
    if (p[k] != null && (typeof p[k] !== 'string' || p[k].length > PREVIEW_LIMITS[k])) return `bad props.preview.${k}`
  }
  if (p.image != null && (typeof p.image !== 'string' || p.image.length > PREVIEW_LIMITS.image || !PREVIEW_IMAGE.test(p.image))) return 'bad props.preview.image'
  return null
}
