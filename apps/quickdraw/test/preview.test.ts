import { describe, it, expect } from 'vitest'
import { handlePreview, isPublicAddress } from '../src/serve/preview.ts'

// calls the handler like the dev server does, and returns [status, body]
function ask(url?: string) {
  return new Promise<[number, { error?: string }]>((resolve) => {
    const res = { writeHead: (status: number) => ({ end: (body: string) => resolve([status, JSON.parse(body)]) }) }
    handlePreview({ url: '/preview' + (url == null ? '' : '?url=' + encodeURIComponent(url)) }, res as never)
  })
}

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local, CGNAT/Tailscale and mapped addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.90.1.2', '0.0.0.0',
      '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not an ip']) {
      expect(isPublicAddress(a), a).toBe(false)
    }
  })
  it('allows public ones', () => {
    for (const a of ['93.184.215.14', '8.8.8.8', '2606:2800:21f:cb07:6820:80da:af6b:8b2c']) expect(isPublicAddress(a), a).toBe(true)
  })
})

describe('handlePreview refuses before fetching', () => {
  it.each([
    ['no url', undefined, 400],
    ['http', 'http://example.com/', 403],
    ['another port', 'https://example.com:8443/', 403],
    ['credentials', 'https://user:pw@example.com/', 403],
    ['loopback name', 'https://localhost/', 403],
    ['loopback address', 'https://127.0.0.1/', 403],
    ['IPv6 loopback', 'https://[::1]/', 403],
    ['private network', 'https://192.168.1.1/', 403],
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/', 403],
    ['Tailscale address', 'https://100.90.1.2/', 403],
    ['not a URL', 'nope', 403],
  ])('%s', async (_, url, status) => {
    const [got, body] = await ask(url)
    expect(got).toBe(status)
    expect(body.error).toBeTruthy()
  })
})
