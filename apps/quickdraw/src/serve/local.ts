// Who is on this computer: what agents take requests from, unless they are
// started with --allow-remote.
//
// A connection is local when it comes from a loopback address, straight (no
// proxy in between: `tailscale serve` connects from 127.0.0.1 too, but says
// whom for in its headers), to a loopback name (not a DNS name that points
// here: DNS rebinding), and, from a browser, from a page of this server (not
// another site open in the same browser: it can open ws://localhost too).
import type { IncomingMessage } from 'node:http'

const LOOPBACK_ADDRESS = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/
const LOOPBACK_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i
const PROXIED = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'tailscale-user-login', 'tailscale-user-name']
/** Whether something in between says it passed the request on (a proxy, a tunnel, tailscale serve). */
export const isProxied = (req: Pick<IncomingMessage, 'headers'>) => PROXIED.some((h) => req.headers[h] !== undefined)

/**
 * The address of a device on the local network that connected straight here (no
 * proxy in between, not this computer): what a person is known by with
 * `--trust-lan-ip`. null for anything else.
 */
export function lanAddress(req: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string } }): string | null {
  const a = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  if (!a || isProxied(req) || LOOPBACK_ADDRESS.test(a)) return null
  // private ranges only: 10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10
  const private4 = /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
  const private6 = /^(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(a)
  return private4 || private6 ? a : null
}

export function isLocal(req: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string } }): boolean {
  const { headers } = req
  if (!LOOPBACK_ADDRESS.test(req.socket.remoteAddress ?? '')) return false
  if (PROXIED.some((h) => headers[h] !== undefined)) return false
  const host = headers.host ?? ''
  if (!LOOPBACK_HOST.test(host)) return false
  const origin = headers.origin
  return origin === undefined || origin === `http://${host}` // no Origin: not a browser (the CLI)
}
