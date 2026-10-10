import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A page that imports a package the page's import map does not name is blank in the browser
// (the server and the CLI do not notice): every bare import of the board page must be mapped.
describe('the board page', () => {
  it('maps every package it imports', () => {
    const html = readFileSync(fileURLToPath(new URL('../web/board.html', import.meta.url)), 'utf8')
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]).imports as Record<string, string>
    const imported = [...html.matchAll(/from '([^'./][^']*)'/g)].map((m) => m[1])
    expect(imported.length).toBeGreaterThan(10)
    expect(imported.filter((name) => !(name in map))).toEqual([])
  })
})
