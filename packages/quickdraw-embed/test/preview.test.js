import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { parseOpenGraph, cleanPreview, checkPreview, validateEmbed, createEmbed, addPreview, fitLines, PREVIEW_LIMITS } from '../src/index.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('parseOpenGraph', () => {
  it('reads og tags, resolving the image against the page', () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Quick &amp; draw">
      <meta content='A &quot;whiteboard&quot;' property='og:description'>
      <meta property="og:site_name" content="Example">
      <meta property="og:image" content="/img/card.png"></head></html>`
    expect(parseOpenGraph(html, 'https://example.com/post/1')).toEqual({
      title: 'Quick & draw', description: 'A "whiteboard"', siteName: 'Example', image: 'https://example.com/img/card.png',
    })
  })

  it('falls back to <title> and meta description, and drops non-https images', () => {
    const html = '<title> Just   a title </title><meta name="description" content="Plain"><meta name="twitter:image" content="http://x.test/a.png">'
    expect(parseOpenGraph(html, 'https://x.test/')).toEqual({ title: 'Just a title', description: 'Plain', siteName: undefined, image: undefined })
  })

  it('keeps text as text, and bounds it', () => {
    const p = parseOpenGraph(`<meta property="og:title" content="&lt;script&gt;${'x'.repeat(500)}">`, 'https://x.test/')
    expect(p.title.startsWith('<script>')).toBe(true)
    expect(p.title).toHaveLength(PREVIEW_LIMITS.title)
  })
})

describe('cleanPreview / checkPreview', () => {
  it('keeps only bounded text and inline raster images', () => {
    expect(cleanPreview({ title: ' T ', image: PNG, extra: 'x' })).toEqual({ title: 'T', image: PNG })
    expect(cleanPreview({ image: 'https://tracker.example/pixel.png' })).toBeUndefined()
    expect(cleanPreview({ image: 'data:image/svg+xml;base64,PHN2Zz4=' })).toBeUndefined()
    expect(cleanPreview(null)).toBeUndefined()
  })

  it('rejects malformed previews in records', () => {
    expect(checkPreview(undefined)).toBeNull()
    expect(checkPreview({ title: 'ok', image: PNG })).toBeNull()
    expect(checkPreview({ image: 'https://tracker.example/p.png' })).toMatch(/image/)
    expect(checkPreview({ onload: 'x' })).toMatch(/unknown/)
    expect(checkPreview({ title: 'x'.repeat(PREVIEW_LIMITS.title + 1) })).toMatch(/title/)
    expect(validateEmbed({ props: { kind: 'link', url: 'http://plain.example/', w: 320, h: 260 } })).toBeNull()
    expect(validateEmbed({ props: { kind: 'link', url: 'javascript:alert(1)', w: 320, h: 260 } })).toMatch(/url/)
    expect(validateEmbed({ props: { kind: 'url', url: 'https://a.example/', w: 320, h: 260, preview: { image: 'https://t.example/' } } })).toMatch(/image/)
  })
})

describe('addPreview', () => {
  it("stores what the app's fetchPreview returns, cleaned", async () => {
    const store = new Store()
    const id = createEmbed(store, { x: 0, y: 0, kind: 'link', url: 'https://example.com/' })
    const preview = await addPreview(store, id, async (url) => ({ title: `Title of ${url}`, image: PNG, junk: 1 }))
    expect(preview).toEqual({ title: 'Title of https://example.com/', image: PNG })
    expect(store.get(id).props.preview).toEqual(preview)
  })

  it('stores nothing when fetching fails, or the card changed meanwhile', async () => {
    const store = new Store()
    const id = createEmbed(store, { x: 0, y: 0, kind: 'link', url: 'https://example.com/' })
    expect(await addPreview(store, id, async () => { throw new Error('offline') })).toBeNull()
    const slow = addPreview(store, id, async () => ({ title: 'old' }))
    store.update(id, { props: { url: 'https://other.example/' } })
    expect(await slow).toBeNull()
    expect(store.get(id).props.preview).toBeUndefined()
  })
})

describe('fitLines', () => {
  const ctx = { measureText: (t) => ({ width: [...t].length * 10 }) } // 10px per character

  it('wraps English at spaces, not inside words', () => {
    expect(fitLines(ctx, 'Change is constant here', 100, 3)).toEqual(['Change is', 'constant', 'here'])
  })
  it('wraps Japanese between characters', () => {
    expect(fitLines(ctx, 'あいうえおかきくけこさし', 50, 3)).toEqual(['あいうえお', 'かきくけこ', 'さし'])
  })
  it('ellipsizes only when text is cut', () => {
    expect(fitLines(ctx, 'one two three four', 90, 2)).toEqual(['one two', 'three…'])
    expect(fitLines(ctx, 'one two', 90, 1)).toEqual(['one two'])
    expect(fitLines(ctx, 'one two ', 70, 1)).toEqual(['one two'])
  })
  it('breaks a word longer than the line', () => {
    expect(fitLines(ctx, 'abcdefghijkl', 50, 3)).toEqual(['abcde', 'fghij', 'kl'])
    expect(fitLines(ctx, 'abcdefghijkl', 50, 2)).toEqual(['abcde', 'fghi…'])
  })
})
