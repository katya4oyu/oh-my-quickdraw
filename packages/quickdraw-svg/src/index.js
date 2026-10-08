// An SVG as a whiteboard drawing: what a person with a pen would draw of it.
// The SVG's own structure decides what each part becomes, nothing is laid out
// anew: its document order is the order of drawing, a <g> or a box with what
// lies in it is one unit (drawn together), a rect, circle, ellipse, line or
// path is a pen stroke along its outline, a line's marker an arrowhead of two
// strokes, a text (or each positioned tspan) words where they were. Colours
// and widths come from attributes, <style> rules by class or tag, and what a
// <g> passes down, and go to the nearest of the board's colours and sizes.
// Fills are not drawn (a whiteboard has none): a shape with only a fill gets
// its outline. What cannot be carried (gradients, filters, faint decoration)
// is listed in `dropped`. Every part says which element it came from (`el`).
// Dependency-free.

const PEN = { black: '#1d1d1d', grey: '#9fa8b2', 'light-violet': '#e085f4', violet: '#ae3ec9', blue: '#4263eb', 'light-blue': '#4dabf7', yellow: '#f1ac4b', orange: '#e16919', green: '#099268', 'light-green': '#4cb05e', 'light-red': '#f87777', red: '#e03131' }
const PALE = { black: '#e8e8e8', grey: '#eceef0', 'light-violet': '#f9ebfc', violet: '#f0dcf5', blue: '#dfe5fb', 'light-blue': '#e0f0fe', yellow: '#fcefdc', orange: '#fae5d5', green: '#d3ebe3', 'light-green': '#dff0e2', 'light-red': '#fde4e4', red: '#f9dcdc' }
const NAMED = { white: '#ffffff', black: '#000000' }

const rgb = (c) => {
  let h = String(NAMED[c] ?? c).trim()
  const m = h.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/)
  if (m) return [m[1], m[2], m[3]].map(Number)
  h = h.replace('#', '')
  if (h.length === 3) h = [...h].map((x) => x + x).join('')
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return v.every(Number.isFinite) ? v : null
}
const lum = (c) => { const v = rgb(c); return v ? 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2] : 128 }
const closest = (c, table) => {
  const v = rgb(c)
  if (!v) return 'black'
  let best = 'black', d = Infinity
  for (const [name, hex] of Object.entries(table)) {
    const w = rgb(hex), e = (v[0] - w[0]) ** 2 + (v[1] - w[1]) ** 2 + (v[2] - w[2]) ** 2
    if (e < d) { d = e; best = name }
  }
  return best
}

// ---- a small XML reader, enough for SVG as programs write it
export function parseXml(src) {
  src = String(src).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t) => t.replace(/</g, '&lt;'))
  const root = { tag: '#root', attrs: {}, children: [] }, stack = [root]
  const entity = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&')
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(src))) {
    if (m[5] != null) { if (m[5].trim()) stack.at(-1).children.push({ tag: '#text', text: entity(m[5]) }); continue }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue }
    const attrs = {}
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = entity(a[2] ?? a[3])
    const el = { tag: m[2], attrs, children: [] }
    stack.at(-1).children.push(el)
    if (!m[4]) stack.push(el)
  }
  return root.children.find((c) => c.tag === 'svg') ?? null
}

// ---- geometry, as polylines in the SVG's coordinates
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
// points along a straight edge, close enough that the board's smoothing keeps it straight
function edge(a, b, step = 10) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
}
function arc(cx, cy, rx, ry, a0, a1, step = 6) {
  const n = Math.max(3, Math.ceil((Math.abs(a1 - a0) * Math.max(rx, ry)) / step))
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] })
}
function rectLine(x, y, w, h, rx, ry) {
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2)
  if (!(rx > 0 && ry > 0)) return [...edge([x, y], [x + w, y]), ...edge([x + w, y], [x + w, y + h]), ...edge([x + w, y + h], [x, y + h]), ...edge([x, y + h], [x, y]), [x, y]]
  const P = Math.PI
  return [...arc(x + rx, y + ry, rx, ry, P, 1.5 * P), ...arc(x + w - rx, y + ry, rx, ry, 1.5 * P, 2 * P), ...arc(x + w - rx, y + h - ry, rx, ry, 0, 0.5 * P), ...arc(x + rx, y + h - ry, rx, ry, 0.5 * P, P), [x, y + ry]]
}
const ellipseLine = (cx, cy, rx, ry) => arc(cx, cy, rx, ry, -Math.PI / 2, 1.5 * Math.PI, 8)
// a path's subpaths: M L H V C S Q T A Z, absolute and relative
function pathLines(d, dropped) {
  const toks = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []
  const out = []
  let cur = null, i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lastC = null, lastQ = null
  const n = () => parseFloat(toks[i++])
  const to = (pts) => { if (!cur) { cur = { pts: [[x, y]], closed: false }; out.push(cur) } cur.pts.push(...pts) }
  const cubic = (p1, p2, p3) => { const p0 = [x, y]; to(Array.from({ length: 14 }, (_, k) => { const t = (k + 1) / 14, u = 1 - t; return [0, 1].map((j) => u ** 3 * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t ** 3 * p3[j]) })) }
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++]
    const rel = cmd !== cmd.toUpperCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0
    if (C === 'M') { x = ox + n(); y = oy + n(); cur = { pts: [[x, y]], closed: false }; out.push(cur); sx = x; sy = y; cmd = rel ? 'l' : 'L'; lastC = lastQ = null; continue }
    if (C === 'Z') { to([...edge([x, y], [sx, sy]).slice(1), [sx, sy]]); cur.closed = true; x = sx; y = sy; cur = null; lastC = lastQ = null; continue }
    if (C === 'L' || C === 'H' || C === 'V') {
      const nx = C === 'V' ? x : (C === 'H' ? (rel ? x : 0) : ox) + n(), ny = C === 'H' ? y : (C === 'V' ? (rel ? y : 0) : oy) + n()
      to([...edge([x, y], [nx, ny]).slice(1), [nx, ny]]); x = nx; y = ny; lastC = lastQ = null
    } else if (C === 'C' || C === 'S') {
      const p1 = C === 'C' ? [ox + n(), oy + n()] : lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y]
      const p2 = [ox + n(), oy + n()], p3 = [ox + n(), oy + n()]
      cubic(p1, p2, p3); lastC = p2; lastQ = null; x = p3[0]; y = p3[1]
    } else if (C === 'Q' || C === 'T') {
      const q = C === 'Q' ? [ox + n(), oy + n()] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y]
      const p3 = [ox + n(), oy + n()]
      cubic([x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)], [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])], p3); lastQ = q; lastC = null; x = p3[0]; y = p3[1]
    } else if (C === 'A') { // an elliptical arc: drawn through its end (its bulge is not worked out)
      n(); n(); n(); n(); n()
      const nx = ox + n(), ny = oy + n()
      dropped('arc in a path (drawn straight)')
      to([...edge([x, y], [nx, ny]).slice(1), [nx, ny]]); x = nx; y = ny; lastC = lastQ = null
    } else { dropped(`path command ${cmd}`); break }
  }
  return out.filter((p) => p.pts.length > 1)
}

// translate and scale (the rest of a transform is listed as dropped)
function transformOf(t, dropped) {
  let tx = 0, ty = 0, k = 1
  for (const m of String(t ?? '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = m[2].split(/[ ,]+/).filter(Boolean).map(Number)
    if (m[1] === 'translate') { tx += (v[0] ?? 0) * k; ty += (v[1] ?? 0) * k } else if (m[1] === 'scale') k *= v[0] ?? 1
    else dropped(`transform ${m[1]}`)
  }
  return { tx, ty, k }
}

const INHERITED = ['fill', 'stroke', 'stroke-width', 'font-size', 'font-weight', 'text-anchor', 'marker-start', 'marker-end', 'stroke-dasharray', 'opacity']
const decls = (s) => Object.fromEntries(String(s ?? '').split(';').map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()] }).filter(([k, v]) => k && v))

/**
 * Reads an SVG into what to draw. Positions are the SVG's own (its viewBox's
 * top-left is 0, 0). Returns { w, h, title, units: [name], parts, dropped }
 * where each part is
 *   { kind: 'stroke', el, unit, points: [[x, y], …], color, size }
 *   { kind: 'text', el, unit, text, at: [x, y] (top-left), fontSize, color, w?, align? }
 */
export function readSvg(source) {
  const svg = parseXml(source)
  if (!svg) throw new Error('not an SVG (no <svg> element)')
  const dropped = {}
  const drop = (what) => { dropped[what] = (dropped[what] ?? 0) + 1 }
  const vb = String(svg.attrs.viewBox ?? '').split(/[ ,]+/).map(Number)
  const [vx, vy, W, H] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, num(svg.attrs.width, 800), num(svg.attrs.height, 600)]
  const kids = (e) => e.children.filter((c) => c.tag !== '#text')
  const defs = kids(svg).filter((c) => c.tag === 'defs').flatMap(kids)
  const title = (kids(svg).find((c) => c.tag === 'title')?.children.map((c) => c.text ?? '').join('') ?? '').trim()

  // <style>: rules by tag, class and id (what a program writes; no combinators)
  const rules = {}
  for (const st of [...kids(svg), ...defs].filter((c) => c.tag === 'style')) {
    const css = st.children.map((c) => c.text ?? '').join('').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) for (const sel of m[1].split(',')) { const s = sel.trim(); rules[s] = { ...rules[s], ...decls(m[2]) } }
  }
  const gradients = {}
  for (const g of defs.filter((c) => /Gradient$/.test(c.tag))) {
    const stop = kids(g).find((c) => c.tag === 'stop')
    if (stop) gradients[g.attrs.id] = stop.attrs['stop-color'] ?? decls(stop.attrs.style)['stop-color']
  }
  const style = (el, parent) => {
    const out = {}
    for (const k of INHERITED) if (parent[k] != null && k !== 'opacity') out[k] = parent[k]
    Object.assign(out, el.attrs, rules[el.tag])
    for (const c of String(el.attrs.class ?? '').split(/\s+/).filter(Boolean)) Object.assign(out, rules['.' + c])
    if (el.attrs.id) Object.assign(out, rules['#' + el.attrs.id])
    Object.assign(out, decls(el.attrs.style))
    out.opacity = num(out.opacity, 1) * num(parent.opacity, 1)
    return out
  }

  // ---- the tree in document order, as flat records
  const counts = {}
  // its id, else the n-th of its tag in the drawing (counting those with ids too)
  const elId = (e) => { counts[e.tag] = (counts[e.tag] ?? 0) + 1; return e.attrs.id ?? `${e.tag}${counts[e.tag]}` }
  const recs = []
  const walk = (e, parent, T) => {
    for (const c of kids(e)) {
      if (['title', 'desc', 'defs', 'style', 'metadata'].includes(c.tag)) continue
      const cs = style(c, parent)
      const t = transformOf(c.attrs.transform, drop), T2 = { tx: T.tx + t.tx * T.k, ty: T.ty + t.ty * T.k, k: T.k * t.k }
      const P = (pts) => pts.map(([x, y]) => [T2.tx + x * T2.k - vx, T2.ty + y * T2.k - vy])
      if (c.tag === 'g' || c.tag === 'a') { recs.push({ open: elId(c) }); walk(c, cs, T2); recs.push({ close: true }); continue }
      if (cs.opacity < 0.5) { drop('faint element (opacity under 0.5)'); continue }
      if (cs.filter) drop('filter')
      if (String(cs.fill ?? '').startsWith('url(')) { const g = /url\(#([^)]+)\)/.exec(cs.fill)?.[1]; if (!gradients[g]) drop('pattern fill'); cs.fill = gradients[g] ?? 'none' }
      if (String(cs.stroke ?? '').startsWith('url(')) { const g = /url\(#([^)]+)\)/.exec(cs.stroke)?.[1]; cs.stroke = gradients[g] ?? 'none' }
      const r = { el: elId(c), tag: c.tag, cs }
      const a = c.attrs
      if (c.tag === 'rect') {
        const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)]
        if (!(w > 0 && h > 0)) continue
        recs.push({ ...r, lines: [{ pts: P(rectLine(x, y, w, h, num(a.rx ?? a.ry), num(a.ry ?? a.rx))), closed: true }], box: [T2.tx + x * T2.k - vx, T2.ty + y * T2.k - vy, w * T2.k, h * T2.k] })
      } else if (c.tag === 'circle') recs.push({ ...r, lines: [{ pts: P(ellipseLine(num(a.cx), num(a.cy), num(a.r), num(a.r))), closed: true }] })
      else if (c.tag === 'ellipse') recs.push({ ...r, lines: [{ pts: P(ellipseLine(num(a.cx), num(a.cy), num(a.rx), num(a.ry))), closed: true }] })
      else if (c.tag === 'line') { const p = [num(a.x1), num(a.y1)], q = [num(a.x2), num(a.y2)]; recs.push({ ...r, lines: [{ pts: P([...edge(p, q), q]), closed: false }] }) }
      else if (c.tag === 'polyline' || c.tag === 'polygon') {
        const v = String(a.points ?? '').trim().split(/[ ,]+/).map(Number), pts = []
        for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]])
        if (c.tag === 'polygon' && pts.length) pts.push(pts[0])
        const dense = pts.flatMap((p, i) => (i ? [...edge(pts[i - 1], p).slice(1), p] : [p]))
        recs.push({ ...r, lines: [{ pts: P(dense), closed: c.tag === 'polygon' }] })
      } else if (c.tag === 'path') recs.push({ ...r, lines: pathLines(a.d, drop).map((l) => ({ ...l, pts: P(l.pts) })) })
      else if (c.tag === 'text') recs.push({ ...r, x: T2.tx + num(a.x) * T2.k - vx, y: T2.ty + num(a.y) * T2.k - vy, T: { x: T2.tx - vx, y: T2.ty - vy }, k: T2.k, lines: null, words: textLines(c, num) })
      else drop(`<${c.tag}>`)
    }
  }
  walk(svg, {}, { tx: 0, ty: 0, k: 1 })

  // the page: a rect over (nearly) all of it is its paper, not a drawing
  const isPage = (r) => r.box && r.box[2] >= W * 0.95 && r.box[3] >= H * 0.95
  const page = recs.find(isPage)
  const dark = !!page && page.cs.fill && page.cs.fill !== 'none' && lum(page.cs.fill) < 110

  // ---- units: a top-level <g>; or a box and what is drawn inside it; or a run of loose words or lines
  const inside = (b, [x, y]) => x >= b[0] - 2 && y >= b[1] - 2 && x <= b[0] + b[2] + 2 && y <= b[1] + b[3] + 2
  const units = []
  let depth = 0, group = null
  for (const r of recs) {
    if (r.open) { if (depth++ === 0) { group = { name: r.open, recs: [] }; units.push(group) } continue }
    if (r.close) { if (--depth === 0) group = null; continue }
    if (isPage(r)) continue
    if (group) { group.recs.push(r); continue }
    const cur = units.at(-1)
    if (r.box && !(cur?.box && inside(cur.box, [r.box[0], r.box[1]]) && inside(cur.box, [r.box[0] + r.box[2], r.box[1] + r.box[3]]))) { units.push({ name: r.el, box: r.box, recs: [r] }); continue }
    const at = r.box ? [r.box[0], r.box[1]] : r.lines?.[0] ? r.lines[0].pts[0] : [r.x, r.y - 4]
    if (cur?.box && inside(cur.box, at)) { cur.recs.push(r); continue }
    const kind = r.tag === 'text' ? 'words' : 'lines'
    if (cur && !cur.box && cur.kind === kind) cur.recs.push(r)
    else units.push({ name: r.el, kind, recs: [r] })
  }

  // ---- what each record becomes
  const sizeOf = (w) => (w <= 1.6 ? 's' : w <= 3.2 ? 'm' : w <= 5 ? 'l' : 'xl')
  // an ink: near-neutral is black or grey (on a dark page, its light ink is the board's black)
  const ink = (c) => { const v = rgb(c); if (!v) return 'black'; if (Math.max(...v) - Math.min(...v) < 60) return (dark ? lum(c) >= 150 : lum(c) < 150) ? 'black' : 'grey'; return closest(c, PEN) }
  const r1 = (v) => Math.round(v * 10) / 10
  const marker = (v) => /url\(#([^)]+)\)/.exec(String(v ?? ''))?.[1]
  const parts = []
  const TAG = new Map(recs.filter((r) => r.el).map((r) => [r.el, r.tag]))
  for (const r of recs) if (r.el && r.lines?.some((l) => !l.closed) && (marker(r.cs['marker-end']) || marker(r.cs['marker-start']))) TAG.set(r.el, 'arrow')
  const head = (p, q, len) => { const a = Math.atan2(q[1] - p[1], q[0] - p[0]), s = Math.PI / 7; return [[q[0] - len * Math.cos(a - s), q[1] - len * Math.sin(a - s)], q, [q[0] - len * Math.cos(a + s), q[1] - len * Math.sin(a + s)]] }
  const stroke = (el, unit, pts, color, size) => {
    if (new Set(pts.map((p) => p.join())).size < 2) return
    parts.push({ kind: 'stroke', el, tag: TAG.get(el), unit, points: pts.map(([x, y]) => [r1(x), r1(y)]), color, size })
  }
  units.forEach((u, unit) => {
    for (const r of u.recs) {
      const cs = r.cs
      if (r.lines) {
        const hasStroke = cs.stroke && cs.stroke !== 'none'
        const fill = cs.fill ?? (hasStroke ? 'none' : '#000') // SVG fills black unless told
        // only a fill: its outline, in its colour (white, or the page's own colour, carries nothing)
        const outlineOnly = !hasStroke && fill !== 'none' && (dark ? lum(fill) > 20 : lum(fill) < 245)
        const size = sizeOf(num(cs['stroke-width'], 1))
        for (const l of r.lines) {
          if (hasStroke) stroke(r.el, unit, l.pts, ink(cs.stroke), size)
          else if (outlineOnly && (l.closed || r.tag !== 'path')) stroke(r.el, unit, l.pts, dark ? 'grey' : closest(fill, PALE), 's')
          else if (outlineOnly) stroke(r.el, unit, l.pts, ink(fill), 's') // a filled shape drawn as a path: its outline
          if (!l.closed && hasStroke) {
            const len = 10 + 3 * num(cs['stroke-width'], 1)
            const pts = l.pts, back = (k) => pts[Math.max(0, Math.min(pts.length - 1, k))]
            if (marker(cs['marker-end'])) stroke(r.el, unit, head(back(pts.length - 4), pts.at(-1), len), ink(cs.stroke), size)
            if (marker(cs['marker-start'])) stroke(r.el, unit, head(back(3), pts[0], len), ink(cs.stroke), size)
          }
        }
      } else if (r.words) {
        const px = num(cs['font-size'], 16) * r.k, anchor = cs['text-anchor'] ?? 'start'
        let y = r.y
        for (const w of r.words) {
          const x = w.x != null ? r.T.x + w.x * r.k : r.x
          y = w.y != null ? r.T.y + w.y * r.k : y + (w.dy ?? 0) * r.k
          const width = Math.ceil(textWidth(w.text, px) * 1.3) + 8
          const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
          const part = { kind: 'text', el: r.el, tag: 'text', unit, text: w.text, at: [r1(left), r1(y - px * 1.05)], fontSize: Math.round(px * 10) / 10, color: ink(cs.fill ?? '#000') }
          if (anchor !== 'start') Object.assign(part, { w: width, align: anchor === 'middle' ? 'middle' : 'end' })
          parts.push(part)
        }
      }
    }
  })
  for (const p of parts) p.sig = signature(p)
  const boxes = recs.filter((r) => r.box && !isPage(r) && r.tag === 'rect').map((r) => ({ el: r.el, x: r.box[0], y: r.box[1], w: r.box[2], h: r.box[3] }))
  return { w: W, h: H, title, dark, units: units.map((u) => u.name), parts, dropped, hits: hitsOf(parts, boxes) }
}

// what a part is, as drawn: the same element drawn the same way has the same signature
function signature(p) {
  const v = JSON.stringify(p.kind === 'stroke' ? [p.el, p.points, p.color, p.size] : [p.el, p.text, p.at, p.fontSize, p.color, p.w ?? null, p.align ?? null])
  let h = 5381
  for (let i = 0; i < v.length; i++) h = ((h * 33) ^ v.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// What reads badly once drawn on the board, whose letters (hand-drawn) are about
// as wide as textWidth says: words that run past the box they are in, words
// on top of other words, a line through words. Measured, never changed.
function hitsOf(parts, boxes) {
  const hits = []
  const quote = (t) => `"${t.length > 30 ? t.slice(0, 29) + '…' : t}"`
  const texts = parts.filter((p) => p.kind === 'text').map((p) => {
    const w = textWidth(p.text, p.fontSize), h = p.fontSize * 1.32
    const x = p.align === 'middle' ? p.at[0] + p.w / 2 - w / 2 : p.align === 'end' ? p.at[0] + p.w - w : p.at[0]
    return { p, x, y: p.at[1] + p.fontSize * 0.2, w, h }
  })
  const inBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
  for (const t of texts) {
    const mid = t.y + t.h / 2
    // the smallest box it is anchored in: where it starts, its middle (centred) or where it ends
    const ax = t.p.align === 'middle' ? t.x + t.w / 2 : t.p.align === 'end' ? t.x + t.w - 1 : t.x + 1
    const box = boxes.filter((b) => inBox(b, ax, mid)).sort((a, b) => a.w * a.h - b.w * b.h)[0]
    if (box) {
      const over = Math.round(Math.max(t.x + t.w - (box.x + box.w), box.x - t.x))
      if (over > 2) hits.push(`words ${quote(t.p.text)} (${t.p.el}) run past the edge of ${box.el} by ${over} px`)
    }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j]
    if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 3 && b.y < a.y + a.h - 3) hits.push(`words ${quote(a.p.text)} (${a.p.el}) on words ${quote(b.p.text)} (${b.p.el})`)
  }
  const open = (p) => { const a = p.points[0], b = p.points.at(-1); return Math.hypot(a[0] - b[0], a[1] - b[1]) > 1 }
  const lines = [...new Map(parts.filter((p) => p.kind === 'stroke' && ['line', 'path', 'polyline', 'arrow'].includes(p.tag) && open(p)).map((p) => [p.el, p])).values()]
  for (const l of lines) for (const t of texts) {
    if (l.points.some(([x, y]) => x > t.x + 2 && x < t.x + t.w - 2 && y > t.y + 2 && y < t.y + t.h - 2)) hits.push(`a line (${l.el}) through words ${quote(t.p.text)} (${t.p.el})`)
  }
  return hits
}

// a text's lines: its own words, and each tspan placed with x, y or dy starts one
function textLines(el, num) {
  const lines = []
  let cur = null
  const walk = (e) => {
    for (const c of e.children) {
      if (c.tag === '#text') { if (!cur) { cur = { text: '' }; lines.push(cur) } cur.text += c.text.replace(/\s+/g, ' ') }
      else if (c.tag === 'tspan') {
        if (c.attrs.x != null || c.attrs.y != null || c.attrs.dy != null) {
          cur = { text: '', ...(c.attrs.x != null ? { x: num(c.attrs.x) } : {}), ...(c.attrs.y != null ? { y: num(c.attrs.y) } : {}), ...(c.attrs.dy != null ? { dy: num(c.attrs.dy) } : {}) }
          lines.push(cur)
        }
        walk(c)
      }
    }
  }
  walk(el)
  return lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text)
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
export const textWidth = (text, px) => [...text].reduce((w, ch) => w + (WIDE.test(ch) ? px : px * 0.56), 0)

const KIND = { rect: 'a box', circle: 'a circle', ellipse: 'an ellipse', line: 'a line', polyline: 'a line', polygon: 'a shape', path: 'a line', arrow: 'an arrow' }
/** What each element of an SVG is, in a few words (a box, an arrow, words "…"), by its el. */
export function svgElements(source) {
  const out = {}
  for (const p of readSvg(source).parts) out[p.el] ??= p.kind === 'text' ? `words "${p.text.slice(0, 40)}"` : KIND[p.tag] ?? 'a stroke'
  return out
}
