// Static file server for the example: serves the workspace root so the page
// can import the vendored core and the package source without a build step.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }
const port = Number(process.env.PORT || 8080)

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const file = join(root, path.endsWith('/') ? path + 'index.html' : path)
  if (!file.startsWith(root)) return res.writeHead(403).end()
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Quickdraw Yjs example: http://localhost:${port}/examples/quickdraw-yjs/ (open in two tabs)`)
})
