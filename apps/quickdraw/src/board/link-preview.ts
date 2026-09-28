// A link card's preview, for an embed an agent puts on a live board: the
// page's Open Graph tags, fetched by the `quickdraw serve` that holds the board
// (its /preview, guarded against SSRF) as the page does, with the picture made
// small enough to be kept in the card. No preview is not an error: the card
// then shows the link's host.
import { cleanPreview, PREVIEW_LIMITS } from 'quickdraw-embed'
import type { EmbedPreview } from 'quickdraw-agent'
import { smallJpeg } from '../agent/images.ts'

/** The http(s) server behind a board's relay URL (ws://host/ws/ID) or page URL. */
export const serverOfBoard = (url: string) => {
  const u = new URL(url)
  return `${u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol}//${u.host}`
}

export async function linkPreview(server: string, url: string, { fetch: get = fetch } = {}): Promise<EmbedPreview | undefined> {
  try {
    const res = await get(`${server}/preview?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return undefined
    const p = await res.json() as EmbedPreview
    if (typeof p.image === 'string' && p.image.length > PREVIEW_LIMITS.image) p.image = (await smallJpeg(p.image, 480).catch(() => null)) ?? undefined
    return cleanPreview(p)
  } catch {
    return undefined
  }
}
