import { describe, it, expect } from 'vitest'
import { Store, pageBounds, hitShape } from '@quickdrawjs/core'
import {
  resolveEmbedUrl, htmlDocument, validateEmbed, createEmbed, HTML_CSP, HTML_SANDBOX, URL_SANDBOX, MAX_HTML_LENGTH, LINK_CARDS_ONLY,
} from '../src/index.js'

describe('resolveEmbedUrl', () => {
  it('rewrites allowed pages to their embed URLs', async () => {
    expect(await resolveEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', name: 'YouTube' })
    expect((await resolveEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=3')).src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect((await resolveEmbedUrl('https://vimeo.com/76979871')).src).toBe('https://player.vimeo.com/video/76979871')
    expect((await resolveEmbedUrl('https://codepen.io/team/pen/abcDEF')).src).toBe('https://codepen.io/team/embed/abcDEF?default-tab=result')
    expect((await resolveEmbedUrl('https://www.figma.com/design/AbC123/Name')).src).toMatch(/^https:\/\/www\.figma\.com\/embed\?embed_host=quickdraw&url=https%3A%2F%2F/)
    expect((await resolveEmbedUrl('https://www.google.com/maps/embed?pb=!1m18')).name).toBe('Google Maps')
  })

  it('refuses everything else', async () => {
    for (const url of [
      'http://www.youtube.com/watch?v=dQw4w9WgXcQ', // not https
      'https://evil.example/watch?v=x', // not allowed
      'https://www.youtube.com.evil.example/watch?v=x', // lookalike host
      'https://www.youtube.com/watch?v=a"><script>', // bad id
      'https://user:pass@www.youtube.com/watch?v=abc', // credentials
      'javascript:alert(1)', 'data:text/html,<b>x</b>', 'not a url', 42,
      'https://www.google.com/maps/place/Tokyo', // maps, but not an embed URL
    ]) expect(await resolveEmbedUrl(url), String(url)).toBeNull()
  })

  it('takes custom rules instead of the defaults', async () => {
    const rules = [{ name: 'Docs', embed: (u) => (u.hostname === 'docs.example.com' ? u.href : null) }]
    expect((await resolveEmbedUrl('https://docs.example.com/a', rules)).name).toBe('Docs')
    expect(await resolveEmbedUrl('https://www.youtube.com/watch?v=abc', rules)).toBeNull()
  })

  it('awaits async rules, in order, and treats failures as not allowed', async () => {
    const allowList = new Set(['wiki.example.com']) // e.g. read from a file or IndexedDB
    const rules = [
      { name: 'Broken', embed: async () => { throw new Error('db down') } },
      { name: 'Store', embed: async (u) => (allowList.has(u.hostname) ? u.href : null) },
    ]
    expect(await resolveEmbedUrl('https://wiki.example.com/p', rules)).toEqual({ src: 'https://wiki.example.com/p', name: 'Store' })
    expect(await resolveEmbedUrl('https://other.example.com/p', rules)).toBeNull()
    expect(await resolveEmbedUrl('https://x.example/', [{ name: 'Only broken', embed: () => { throw new Error() } }])).toBeNull()
  })

  it('never lets a rule return a non-https URL, or edit the URL it was given', async () => {
    const rules = [
      { name: 'Sneaky', embed: (u) => { u.hostname = 'evil.example'; return 'http://' + u.host } },
      { name: 'Echo', embed: (u) => u.href },
    ]
    expect(await resolveEmbedUrl('https://ok.example/', rules)).toEqual({ src: 'https://ok.example/', name: 'Echo' })
  })
})

describe('inline HTML', () => {
  it('runs scripts only, in an opaque origin, with no network', () => {
    expect(HTML_SANDBOX).toBe('allow-scripts')
    expect(URL_SANDBOX).not.toMatch(/top-navigation/)
    expect(HTML_CSP).toMatch(/default-src 'none'/)
    expect(HTML_CSP).not.toMatch(/connect-src|https?:/)
  })

  it('puts the CSP before the page, so the page can only tighten it', () => {
    const doc = htmlDocument('<meta http-equiv="Content-Security-Policy" content="default-src *"><p>hi</p>')
    expect(doc.indexOf(HTML_CSP)).toBeLessThan(doc.indexOf('default-src *'))
  })
})

describe('validateEmbed', () => {
  const rec = (props) => ({ props: { w: 400, h: 300, ...props } })
  it('accepts well-formed records, allowed or not (that is decided when rendering)', () => {
    expect(validateEmbed(rec({ kind: 'url', url: 'https://evil.example/' }))).toBeNull()
    expect(validateEmbed(rec({ kind: 'html', html: '<b>x</b>' }))).toBeNull()
  })
  it('rejects malformed ones', () => {
    expect(validateEmbed(rec({ kind: 'url', url: 'javascript:alert(1)' }))).toMatch(/url/)
    expect(validateEmbed(rec({ kind: 'html', html: 'x'.repeat(MAX_HTML_LENGTH + 1) }))).toMatch(/too long/)
    expect(validateEmbed(rec({ kind: 'script' }))).toMatch(/kind/)
    expect(validateEmbed(rec({ kind: 'html', html: '', w: 1e9 }))).toMatch(/size/)
  })
})

describe('embed shapes in the core', () => {
  it('have their size as bounds and hit inside', () => {
    const store = new Store()
    const id = createEmbed(store, { x: 10, y: 20, url: 'https://youtu.be/abc' })
    expect(pageBounds(store.get(id))).toEqual({ x: 10, y: 20, w: 480, h: 270 })
    expect(hitShape(store.get(id), 100, 100, 0)).toBe(true)
  })
})

describe('LINK_CARDS_ONLY', () => {
  it('allows no page and no HTML, and cannot be loosened by accident', async () => {
    expect(LINK_CARDS_ONLY).toEqual({ rules: [], html: false })
    expect(Object.isFrozen(LINK_CARDS_ONLY) && Object.isFrozen(LINK_CARDS_ONLY.rules)).toBe(true)
    expect(await resolveEmbedUrl('https://www.youtube.com/watch?v=abc', LINK_CARDS_ONLY.rules)).toBeNull()
  })
})
