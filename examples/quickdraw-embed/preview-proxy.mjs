// A link-preview proxy for the example: browsers cannot read other sites'
// HTML (CORS), so the page asks this server, which fetches the page, reads
// its Open Graph tags with the package's parser, and returns them with the
// image inline. GET /preview?url=https://… -> { title?, description?, siteName?, image? }
//
// It fetches URLs on request, so it guards against SSRF: https on port 443
// only, every hop's address must be public (no loopback, private, link-local,
// CGNAT/Tailscale, multicast…), redirects are followed by hand and rechecked,
// with timeouts and size caps. Known gap, fine for a dev example: the address
// is checked before fetch() resolves it again (DNS rebinding); a production
// proxy should pin the checked address.
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { parseOpenGraph } from '../../packages/quickdraw-embed/src/preview.js'

const blocked = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) blocked.addSubnet(net, bits, 'ipv6')

export function isPublicAddress(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1] // IPv4-mapped IPv6
  if (mapped) return isPublicAddress(mapped)
  const family = isIP(address)
  return family !== 0 && !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

class Refused extends Error {}

async function guardedFetch(url, { accept, types, maxBytes }) {
  for (let hop = 0; hop < 4; hop++) {
    let u
    try { u = new URL(url) } catch { throw new Refused('invalid URL') }
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new Refused('https on port 443 only')
    const host = u.hostname.replace(/^\[|\]$/g, '')
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true })
    if (!addrs.length || !addrs.every((a) => isPublicAddress(a.address))) throw new Refused('not a public address')
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { accept, 'user-agent': 'QuickdrawLinkPreview/0.1' } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), u).href
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!types.includes(type)) throw new Refused(`unexpected content type ${type || '(none)'}`)
    const chunks = []
    let size = 0
    for await (const chunk of res.body) {
      size += chunk.length
      if (size > maxBytes) break // enough: the tags are near the top, and images must fit
      chunks.push(chunk)
    }
    if (size > maxBytes && types[0].startsWith('image/')) throw new Refused('image too large')
    return { url: u.href, type, body: Buffer.concat(chunks) }
  }
  throw new Refused('too many redirects')
}

export async function handlePreview(req, res) {
  const url = new URL(req.url, 'http://x').searchParams.get('url')
  const send = (status, body) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
  if (!url) return send(400, { error: 'missing url' })
  try {
    const page = await guardedFetch(url, { accept: 'text/html', types: ['text/html', 'application/xhtml+xml'], maxBytes: 1_000_000 })
    const og = parseOpenGraph(page.body.toString('utf8'), page.url)
    let image
    if (og.image) {
      try {
        const img = await guardedFetch(og.image, { accept: 'image/*', types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxBytes: 2_000_000 })
        image = `data:${img.type};base64,${img.body.toString('base64')}`
      } catch {} // a card without its image is still a card
    }
    send(200, { title: og.title, description: og.description, siteName: og.siteName, image })
  } catch (e) {
    send(e instanceof Refused ? 403 : 502, { error: e.message })
  }
}
