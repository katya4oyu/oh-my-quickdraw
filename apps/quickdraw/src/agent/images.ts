// An image file as a data URL for the board, kept light: the board's document
// carries it to every device. On macOS `sips` shrinks it to 1024 px at most
// and turns a large opaque PNG into a JPEG; elsewhere it goes as it is, up to
// a limit. Only files in the agent's working directory or Codex's generated
// images are read.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const MAX_SIDE = 1024
const CELL_SIDE = 320 // a piece of a split sheet
const MAX_BYTES = 3_000_000 // as it goes on the board
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

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

async function shrink(file: string, opaque: boolean): Promise<Buffer | null> {
  if (process.platform !== 'darwin') return null
  const dir = await mkdtemp(join(tmpdir(), 'quickdraw-image-'))
  try {
    const out = join(dir, opaque ? 'image.jpg' : 'image.png')
    await run('sips', ['-Z', String(MAX_SIDE), ...(opaque ? ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85'] : []), file, '--out', out])
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
  if (!type) throw new Error(`${file} is not a PNG, JPEG, GIF or WebP image`)
  if ((await stat(file)).size > 50_000_000) throw new Error(`${file} is too large`)
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

/**
 * Cuts an image laid out as an even grid (a sprite or sticker sheet) into its
 * cells, row by row; `inset` trims that share of each cell's edges (gutters,
 * lines between cells). Needs `sips` (macOS).
 */
export async function splitImage(file: string, grid: { cols: number, rows: number }, roots: string[], { transparent = false, inset = 0 } = {}): Promise<BoardImage[]> {
  if (!within(file, roots)) throw new Error(`${file} is outside the working directory; copy it in first`)
  if (process.platform !== 'darwin') throw new Error('splitting an image needs macOS (sips)')
  const cols = Math.floor(grid.cols), rows = Math.floor(grid.rows)
  if (!(cols >= 1 && rows >= 1 && cols * rows <= 64 && cols * rows > 1)) throw new Error('split into 2 to 64 cells (cols × rows)')
  const size = imageSize(await readFile(file))
  if (!size) throw new Error(`cannot read the size of ${file}`)
  const cw = Math.floor(size.w / cols), ch = Math.floor(size.h / rows)
  const i = Math.round(Math.min(0.2, Math.max(0, inset)) * Math.min(cw, ch))
  const dir = await mkdtemp(join(tmpdir(), 'quickdraw-split-'))
  try {
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
