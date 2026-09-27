import { describe, it, expect, vi } from 'vitest'
import { Store } from '@quickdrawjs/core'

// the upstream core: everything but registerShapeType. A real module
// namespace reads a missing export as undefined; vitest's mock would throw,
// so spell that out.
vi.mock('@quickdrawjs/core', async (importOriginal) => ({ ...(await importOriginal()), registerShapeType: undefined }))

const md = await import('../src/index.js')

describe('on a core without registerShapeType', () => {
  it('loads, reports no support, and refuses to create cards', () => {
    expect(md.isMarkdownSupported()).toBe(false)
    expect(md.registerMarkdown()).toBe(false)
    expect(() => md.createMarkdown(new Store(), { x: 0, y: 0 })).toThrow(/registerShapeType is missing/)
    expect(md.bindMarkdownEditing({})).toBeTypeOf('function')
  })

  it('still parses and validates', () => {
    expect(md.parseMarkdown('# a')[0].type).toBe('heading')
    expect(md.validateMarkdown({ props: { md: '# a', w: 300 } })).toBeNull()
  })
})
