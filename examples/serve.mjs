// Serves the repository as static files, so each example can import the
// vendored core and the package sources without a build. Nothing else: the
// examples need no server of their own.
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }

const server = createServer(async (req, res) => {
  let path
  try { path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)) } catch { return res.writeHead(400).end() }
  const file = join(root, path.endsWith('/') ? path + 'index.html' : path)
  if (!file.startsWith(root + sep)) return res.writeHead(403).end()
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})

const port = Number(process.env.PORT || 8790)
server.listen(port, '127.0.0.1', async () => {
  const examples = (await readdir(import.meta.dirname, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== 'node_modules')
  for (const { name } of examples) console.log(`http://localhost:${port}/examples/${name}/`)
})
