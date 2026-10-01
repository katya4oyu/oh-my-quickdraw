// An image file as a data URL for the board, kept light: the board's document
// carries it to every device. It is shrunk to 1024 px at most, and a large
// opaque PNG becomes a JPEG; sheets are cut into their cells. The work is done
// by `sips` on macOS, else by Pillow through `uv` (./image_tool.py); with
// neither, images go as they are (up to a limit) and sheets cannot be cut.
// An SVG goes as it is (a vector: nothing to shrink), with a size of its own
// (from its viewBox when it has none) so it lands as an image.
// $QUICKDRAW_IMAGE_TOOL (sips, uv or none) chooses. Only files in the agent's
// working directory or Codex's generated images are read.
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSvgText, sizedSvg, svgDataUrl, svgSize } from 'quickdraw-import'
import { promisify } from 'node:util'

const run = promisify(execFile)
const MAX_SIDE = 1024
const CELL_SIDE = 320 // a piece of a split sheet
const MAX_BYTES = 3_000_000 // as it goes on the board
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

export interface BoardImage { src: string, w: number, h: number }

/** whether `file` is inside one of `roots` */
export function within(file: string, roots: string[]): boolean {
  return roots.some((root) => {
    const rel = relative(resolve(root), resolve(file))
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

/** width and height from a PNG, GIF, JPEG or WebP header */
export function imageSize(b: Buffer): { w: number, h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L') { const n = b.readUInt32LE(21); return { w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff) } }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1], len = b.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }
      i += 2 + len
    }
  }
  return null
}

type Tool = 'sips' | 'uv' | 'none'
const PY = fileURLToPath(new URL('./image_tool.py', import.meta.url))
const has = new Map<string, Promise<boolean>>()
const available = (command: string) => {
  if (!has.has(command)) has.set(command, run(command, command === 'sips' ? ['--help'] : ['--version']).then(() => true, () => false))
  return has.get(command)!
}

/** what shrinks and cuts images here */
export async function imageTool(): Promise<Tool> {
  const asked = process.env.QUICKDRAW_IMAGE_TOOL
  if (asked === 'sips' || asked === 'uv' || asked === 'none') return asked
  if (process.platform === 'darwin' && await available('sips')) return 'sips'
  return (await available('uv')) ? 'uv' : 'none'
}
const python = (args: string[]) => run('uv', ['run', '--quiet', '--no-project', '--with', 'pillow', 'python', PY, ...args], { timeout: 120_000 })

async function shrink(file: string, opaque: boolean, side = MAX_SIDE): Promise<Buffer | null> {
  const tool = await imageTool()
  if (tool === 'none') return null
  const dir = await mkdtemp(join(tmpdir(), 'quickdraw-image-'))
  try {
    const out = join(dir, opaque ? 'image.jpg' : 'image.png')
    if (tool === 'sips') await run('sips', ['-Z', String(side), ...(opaque ? ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85'] : []), file, '--out', out])
    else await python(['shrink', file, out, String(side), opaque ? '1' : '0'])
    return await readFile(out)
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Reads an image file for the board; `transparent`: keep it a PNG (its background is see-through). */
export async function loadImage(file: string, roots: string[], { transparent = false } = {}): Promise<BoardImage> {
  if (!within(file, roots)) throw new Error(`${file} is outside the working directory; copy it in first`)
  const type = TYPES[extname(file).toLowerCase()]
  if (!type) throw new Error(`${file} is not a PNG, JPEG, GIF, WebP or SVG image`)
  if ((await stat(file)).size > 50_000_000) throw new Error(`${file} is too large`)
  if (type === 'image/svg+xml') return loadSvg(file)
  let data: Buffer = await readFile(file)
  let mime = type
  const size = imageSize(data)
  if (!size) throw new Error(`cannot read the size of ${file}`)
  if (type !== 'image/gif' && (Math.max(size.w, size.h) > MAX_SIDE || data.length > 600_000)) {
    const opaque = !transparent && type !== 'image/webp'
    const small = await shrink(file, opaque)
    if (small) { data = small; mime = opaque ? 'image/jpeg' : 'image/png' }
  }
  const final = imageSize(data) ?? size
  if (data.length > MAX_BYTES) throw new Error(`${file} is too large for the board (${Math.round(data.length / 1e6)} MB); make it smaller first`)
  return { src: `data:${mime};base64,${data.toString('base64')}`, w: final.w, h: final.h }
}

/** An image file at half its size, as WebP (keeping its transparency and grid), or null when nothing here can (it needs uv and Pillow). */
export async function halfWebp(file: string): Promise<Buffer | null> {
  if (!(await available('uv'))) return null
  const dir = await mkdtemp(join(tmpdir(), 'quickdraw-half-'))
  try {
    const out = join(dir, 'half.webp')
    await python(['half', file, out])
    return await readFile(out)
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// an SVG as it is, sized
async function loadSvg(file: string): Promise<BoardImage> {
  const text = await readFile(file, 'utf8')
  if (!isSvgText(text)) throw new Error(`${file} is not SVG (an <svg> element)`)
  const sized = sizedSvg(text)
  const src = svgDataUrl(sized)
  if (src.length > MAX_BYTES * 1.4) throw new Error(`${file} is too large for the board; make it smaller first`)
  const size = svgSize(sized)!
  return { src, w: size.w, h: size.h }
}

/** An image (a data URL) as a JPEG data URL `side` px at most, or null when nothing here can shrink it. */
export async function smallJpeg(src: string, side: number): Promise<string | null> {
  const m = src.match(/^data:image\/(png|jpeg|gif|webp);base64,(.*)$/)
  if (!m) return null
  const dir = await mkdtemp(join(tmpdir(), 'quickdraw-small-'))
  try {
    const file = join(dir, 'in.' + (m[1] === 'jpeg' ? 'jpg' : m[1]))
    await writeFile(file, Buffer.from(m[2], 'base64'))
    const out = await shrink(file, true, side)
    return out && `data:image/jpeg;base64,${out.toString('base64')}`
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The steps that put an image file on the board: as it is, or cut into the cells of an even grid (laid out as on the sheet, in a frame titled `frame`). */
export async function imageSteps(file: string, args: ImageArgs, roots: string[], { transparent = false } = {}): Promise<object[]> {
  if (args.split) {
    const cells = await splitImage(file, args.split, roots, { transparent, inset: args.split.inset })
    const refs = cells.map((_, i) => `cell${i}`)
    const steps: object[] = cells.map((img, i) => ({ do: 'image', ref: refs[i], src: img.src, natural: { w: img.w, h: img.h }, w: args.w ?? Math.min(img.w, 160) }))
    steps.push({ do: 'arrange', ids: refs.map((r) => '@' + r), layout: 'grid', cols: Math.floor(args.split.cols), gap: 16, ...(args.at ? { at: args.at } : {}) })
    if (args.frame) steps.push({ do: 'frame', title: String(args.frame), around: refs.map((r) => '@' + r) })
    return steps
  }
  const img = await loadImage(file, roots, { transparent })
  return [{ do: 'image', src: img.src, natural: { w: img.w, h: img.h }, w: args.w, at: args.at, in: args.in }]
}
export interface ImageArgs {
  w?: number, at?: { x: number, y: number }, in?: string, frame?: string,
  split?: { cols: number, rows: number, inset?: number },
}

/**
 * Cuts an image laid out as an even grid (a sprite or sticker sheet) into its
 * cells, row by row; `inset` trims that share of each cell's edges (gutters,
 * lines between cells). Needs `sips` (macOS) or `uv`.
 */
export async function splitImage(file: string, grid: { cols: number, rows: number }, roots: string[], { transparent = false, inset = 0 } = {}): Promise<BoardImage[]> {
  if (!within(file, roots)) throw new Error(`${file} is outside the working directory; copy it in first`)
  if (extname(file).toLowerCase() === '.svg') throw new Error('an SVG is not cut into cells: put it as it is (cutting is for PNG, JPEG, GIF and WebP sheets)')
  const tool = await imageTool()
  if (tool === 'none') throw new Error('cutting an image needs sips (macOS) or uv (https://docs.astral.sh/uv/)')
  const cols = Math.floor(grid.cols), rows = Math.floor(grid.rows)
  if (!(cols >= 1 && rows >= 1 && cols * rows <= 64 && cols * rows > 1)) throw new Error('split into 2 to 64 cells (cols × rows)')
  const size = imageSize(await readFile(file))
  if (!size) throw new Error(`cannot read the size of ${file}`)
  const cw = Math.floor(size.w / cols), ch = Math.floor(size.h / rows)
  const i = Math.round(Math.min(0.2, Math.max(0, inset)) * Math.min(cw, ch))
  const dir = await mkdtemp(join(tmpdir(), 'quickdraw-split-'))
  try {
    if (tool === 'uv') {
      await python(['split', file, dir, String(cols), String(rows), String(inset), String(CELL_SIDE)])
      const names = (await readdir(dir)).filter((n) => n.startsWith('cell-'))
      const order = (n: string) => n.match(/\d+/g)!.map(Number) // cell-R-C.png
      names.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1])
      return await Promise.all(names.map((n) => loadImage(join(dir, n), [dir], { transparent })))
    }
    const cells: BoardImage[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const out = join(dir, `cell-${r}-${c}.png`)
        // sips crops the middle for an offset of 0, 0: start the top-left cell 1 px in
        const y = Math.max(1, r * ch + i), x = Math.max(1, c * cw + i)
        const h = ch - 2 * i - (y - (r * ch + i)), w = cw - 2 * i - (x - (c * cw + i))
        await run('sips', ['-c', String(h), String(w), '--cropOffset', String(y), String(x), file, '--out', out])
        // a sticker is shown small: 320 px is plenty, and keeps the board light
        if (Math.max(w, h) > CELL_SIDE) await run('sips', ['-Z', String(CELL_SIDE), out, '--out', out])
        cells.push(await loadImage(out, [dir], { transparent }))
      }
    }
    return cells
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
