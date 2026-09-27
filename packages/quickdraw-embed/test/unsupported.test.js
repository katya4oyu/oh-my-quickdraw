import { describe, it, expect, vi } from 'vitest'
import { Store } from '@quickdrawjs/core'

// the upstream core: a real module namespace reads the missing export as
// undefined; vitest's mock would throw, so spell that out
vi.mock('@quickdrawjs/core', async (importOriginal) => ({ ...(await importOriginal()), registerShapeType: undefined }))

const embed = await import('../src/index.js')

describe('on a core without registerShapeType', () => {
  it('loads, reports no support, refuses to create embeds and binds nothing', () => {
    expect(embed.isEmbedSupported()).toBe(false)
    expect(() => embed.createEmbed(new Store(), { x: 0, y: 0, url: 'https://youtu.be/abc' })).toThrow(/registerShapeType is missing/)
    const c = embed.bindEmbeds({})
    expect(Object.keys(c).sort()).toEqual(['activate', 'deactivate', 'destroy', 'refresh', 'run'])
  })

  it('still resolves URLs and validates', async () => {
    expect((await embed.resolveEmbedUrl('https://youtu.be/abc')).name).toBe('YouTube')
    expect(embed.validateEmbed({ props: { kind: 'html', html: '', w: 100, h: 100 } })).toBeNull()
  })
})
