// A headless Chrome that is kind to the machine it runs on:
// - driven over a pipe (--remote-debugging-pipe): no DevTools port is opened
// - a throwaway profile, removed on close; no extensions, sync, background
//   networking or first-run work, so the user's own Chrome is never touched
// - killed when this process exits, however it exits: Chrome outlives a
//   closed pipe, so a tiny shell watchdog ends it (and removes the profile)
//   if this process dies without cleaning up — even on SIGKILL
// No window is shown; the user's mouse, keyboard and focus are left alone.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
  win32: [
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
}

// Checks once a second that both this process and Chrome are alive; when this
// one is gone, kills Chrome's process group and removes the profile. Ends by
// itself once Chrome is gone. POSIX only (Windows: cleanup on normal exit).
function watch(chromePid, profile) {
  if (process.platform === 'win32') return
  const script = 'while kill -0 "$1" 2>/dev/null && kill -0 "$2" 2>/dev/null; do sleep 1; done; kill -9 -"$2" 2>/dev/null; rm -rf "$3"'
  spawn('/bin/sh', ['-c', script, 'quickdraw-chrome-watchdog', String(process.pid), String(chromePid), profile], { stdio: 'ignore', detached: true }).unref()
}

export function findChrome() {
  if (process.env.QUICKDRAW_CHROME) return process.env.QUICKDRAW_CHROME
  for (const c of CANDIDATES[process.platform] ?? []) {
    if (c.includes('/') || c.includes('\\')) { if (existsSync(c)) return c; continue }
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [c], { encoding: 'utf8' })
    if (which.status === 0) return which.stdout.split('\n')[0].trim()
  }
  return null
}

// profiles left by a process that was killed outright: ours, and a day old
function sweepStaleProfiles() {
  const dir = tmpdir()
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('quickdraw-chrome-')) continue
    try {
      const p = join(dir, name)
      if (Date.now() - statSync(p).mtimeMs > 86_400_000) rmSync(p, { recursive: true, force: true })
    } catch {}
  }
}

const FLAGS = [
  '--headless=new', '--remote-debugging-pipe',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-component-extensions-with-background-pages',
  '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps',
  '--disable-client-side-phishing-detection', '--disable-domain-reliability', '--metrics-recording-only',
  '--password-store=basic', '--use-mock-keychain', // never prompt for or touch the system keychain
  '--mute-audio', '--hide-scrollbars',
  // a smaller footprint (measured with footprint(1): ~340 → ~320 MB): no GPU process
  // (the canvas renders in software), one renderer, no background features
  '--disable-gpu', '--renderer-process-limit=1', '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider',
  'about:blank',
]

// Launches Chrome and resolves to { send(method, params, sessionId), on(event, fn), close() }.
export async function launchChrome({ path = findChrome() } = {}) {
  if (!path) throw new Error('PNG export needs Chrome, Chromium, Edge or Brave installed (or QUICKDRAW_CHROME set to one)')
  sweepStaleProfiles()
  const profile = mkdtempSync(join(tmpdir(), 'quickdraw-chrome-'))
  // fd 3: our commands to Chrome, fd 4: its replies; stdout/stderr discarded.
  // Its own process group, so the watchdog can end it with its helpers.
  const child = spawn(path, [`--user-data-dir=${profile}`, ...FLAGS], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  const [, , , toChrome, fromChrome] = child.stdio

  let nextId = 1
  const pending = new Map()
  const listeners = new Map()
  let buffer = ''
  let closed = false
  fromChrome.setEncoding('utf8')
  fromChrome.on('data', (chunk) => {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, method } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)
      } else if (msg.method) {
        for (const fn of listeners.get(msg.method) ?? []) fn(msg.params, msg.sessionId)
      }
    }
  })

  const cleanup = () => {
    if (closed) return
    closed = true
    for (const { reject, method } of pending.values()) reject(new Error(`${method}: Chrome closed`))
    pending.clear()
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL') } catch {} // with its helpers
    }
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
    process.off('exit', cleanup)
  }
  // this process may end any way it likes: Chrome and its profile go with it
  process.on('exit', cleanup)
  child.on('exit', cleanup)
  const exited = new Promise((ok) => child.once('exit', ok))
  await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail) })
  watch(child.pid, profile)

  const chrome = {
    get closed() { return closed },
    pid: child.pid,
    profile,
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error(`${method}: Chrome closed`))
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method })
        toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
      })
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(fn)
      return () => listeners.get(event).delete(fn)
    },
    // resolves once Chrome has really exited and its profile is gone
    async close() {
      if (!closed) {
        chrome.send('Browser.close').catch(() => {})
        const t = setTimeout(cleanup, 2000) // a Chrome that will not quit is killed
        await exited
        clearTimeout(t)
      }
      await exited
      cleanup()
    },
  }
  return chrome
}
