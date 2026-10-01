// An agent's avatar from a Codex pet: one installed for Codex, by its name
// (~/.codex/pets/NAME, or as its pet.json calls it), its folder (pet.json and
// its sprite sheet) or the sheet itself. The sheet goes on the
// board as an image asset; the members table points at it
// (quickdraw-members: avatar = { kind: 'codex-pet', name, asset }).
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { PET_SHEET, isPet } from 'quickdraw-members'
import { halfWebp, imageSize } from '../agent/images.ts'
import type { Board } from './open.ts'

const TYPES: Record<string, string> = { '.webp': 'image/webp', '.png': 'image/png' }
const expand = (p: string, cwd: string) => resolve(cwd, p.replace(/^~(?=$|\/)/, homedir()))
/** where Codex keeps the pets it can use */
export const petsDir = () => join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'pets')
/** a path, not a name: has a slash, starts with . or ~, or is a sheet file */
export const isPath = (p: string) => /[\\/]/.test(p) || /^[.~]/.test(p) || /\.(webp|png)$/i.test(p)

export interface InstalledPet { name: string, displayName: string, description?: string, path: string }
/** The pets installed for Codex (~/.codex/pets), by name. */
export async function listPets(): Promise<InstalledPet[]> {
  const dir = petsDir()
  const names = await readdir(dir).catch(() => [] as string[])
  const out: InstalledPet[] = []
  for (const name of names.sort()) {
    const path = join(dir, name)
    try {
      const m = JSON.parse(await readFile(join(path, 'pet.json'), 'utf8'))
      out.push({ name, displayName: String(m.displayName ?? m.id ?? name), ...(m.description ? { description: String(m.description) } : {}), path })
    } catch {} // not a pet
  }
  return out
}
/** An installed pet by its folder's name, its id or its display name (case does not matter). */
async function installed(name: string): Promise<string> {
  const pets = await listPets()
  const want = name.toLowerCase()
  const pet = pets.find((p) => p.name.toLowerCase() === want) ?? pets.find((p) => p.displayName.toLowerCase() === want)
  if (!pet) throw new Error(`no pet "${name}" in ${petsDir()}${pets.length ? ` (there: ${pets.map((p) => p.name).join(', ')})` : ' (none installed: make one with /hatch in Codex, or npx codex-pet-cli add SLUG)'}`)
  return pet.path
}

/**
 * A pet's sheet as a data URL, and its name, from its folder or the sheet;
 * checks it is a Codex pet's (1536 × 1872). On the board it is shown 44 px
 * tall, so the sheet goes at half its size (a tenth of the bytes) where uv can
 * make it so.
 */
export async function readPet(path: string, cwd = process.cwd()): Promise<{ name: string, src: string, w: number, h: number }> {
  let file = isPath(path) ? expand(path, cwd) : await installed(path)
  let name = basename(file).replace(/\.(webp|png)$/i, '')
  if ((await stat(file)).isDirectory()) {
    const manifest = JSON.parse(await readFile(join(file, 'pet.json'), 'utf8').catch(() => { throw new Error(`${path}: no pet.json (a Codex pet's folder has pet.json and its sprite sheet)`) }))
    name = String(manifest.displayName ?? manifest.id ?? basename(file))
    file = join(file, String(manifest.spritesheetPath ?? 'spritesheet.webp'))
  } else if (basename(file).startsWith('spritesheet')) name = basename(dirname(file))
  const type = TYPES[file.slice(file.lastIndexOf('.')).toLowerCase()]
  if (!type) throw new Error(`${path}: a pet's sheet is a .webp or .png`)
  const bytes = await readFile(file)
  const size = imageSize(bytes)
  if (!size || size.w !== PET_SHEET.w || size.h !== PET_SHEET.h) throw new Error(`${path}: a Codex pet's sheet is ${PET_SHEET.w} × ${PET_SHEET.h} (8 × 9 cells of 192 × 208)${size ? `, not ${size.w} × ${size.h}` : ''}`)
  const half = await halfWebp(file)
  if (half) return { name, src: `data:image/webp;base64,${half.toString('base64')}`, w: PET_SHEET.w / 2, h: PET_SHEET.h / 2 }
  return { name, src: `data:${type};base64,${bytes.toString('base64')}`, w: size.w, h: size.h }
}

/** Gives an agent a pet (or none: path null), as `by`; the sheet it had goes if nothing else uses it. */
export async function setPet(board: Board, agent: string, path: string | null, by: string, cwd = process.cwd()) {
  if (!board.members) throw new Error('avatars need a live board')
  const pet = path ? await readPet(path, cwd) : null
  const was = board.members.get(agent)?.avatar as { asset?: string } | undefined
  let asset: string | undefined
  if (pet) {
    asset = 'asset:pet-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    board.store.put({ id: asset, typeName: 'asset', src: pet.src, w: pet.w, h: pet.h } as never)
  }
  const set = board.members.set(agent, { avatar: pet ? { kind: 'codex-pet', name: pet.name, asset } : null }, by)
  if (isPet(was) && was!.asset !== asset && !board.members.list().some((m) => (m.avatar as { asset?: string } | null)?.asset === was!.asset)) board.store.remove([was!.asset!])
  return set
}
