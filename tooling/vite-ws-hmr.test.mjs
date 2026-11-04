import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { WebSocket } from 'ws'
import { existsSync } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

async function freePort() {
  const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r))
  const port = s.address().port; await new Promise(r => s.close(r)); return port
}
function openWs(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options.protocol, { headers: { origin: options.origin }, handshakeTimeout: 10_000 })
    ws.testMessages = []
    ws.on('message', raw => ws.testMessages.push(JSON.parse(raw.toString())))
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS timeout')) }, 12_000)
    ws.once('open', () => { clearTimeout(timer); resolve(ws) })
    ws.once('unexpected-response', (_req, res) => { clearTimeout(timer); reject(new Error(`WS HTTP ${res.statusCode}`)) })
    ws.once('error', e => { clearTimeout(timer); reject(e) })
  })
}
function nextMessage(ws) {
  if (ws.testMessages.length) return Promise.resolve(ws.testMessages.shift())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), 10_000)
    ws.once('message', () => { clearTimeout(timer); resolve(ws.testMessages.shift()) })
    ws.once('close', () => { clearTimeout(timer); reject(new Error('closed before message')) })
  })
}

test('actual Vite dev: HMR and upload upgrade coexist; rejecting one does not break the other', { skip: !existsSync('node_modules/vite/bin/vite.js'), timeout: 60_000 }, async t => {
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`
  const name = `.kit-hmr-test-${randomBytes(8).toString('hex')}.js`
  const path = `src/${name}`
  t.after(() => rm(path, { force: true }))
  // Create before Vite starts, so its watcher has enrolled the file before editing.
  await writeFile(path, 'export const value = 1; if (import.meta.hot) import.meta.hot.accept();\n')
  const env = { ...process.env, NODE_ENV: 'development' }
  for (const key of ['DATABASE_URL','DATABASE_RESET','DATABASE_DIR','HYPERDRIVE_CONNECTION_STRING','MODULES','VERCEL']) delete env[key]
  const child = spawn(process.execPath, ['--no-liftoff','node_modules/vite/bin/vite.js','dev','--host','127.0.0.1','--port',String(port),'--strictPort'], { env, stdio: ['ignore','pipe','pipe'] })
  let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
  t.after(async () => { if (child.exitCode === null) { const exited = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await exited } })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Vite startup timeout: ${output.slice(-2000)}`)), 40_000)
    child.stdout.on('data', c => { if (String(c).includes('Local:')) { clearTimeout(timeout); resolve() } })
    child.once('exit', c => { clearTimeout(timeout); reject(new Error(`Vite exit ${c}: ${output.slice(-2000)}`)) })
  })
  // /@vite/client contains a per-server token on recent Vite. The token is not
  // a secret from clients; extract it rather than disabling HMR CSRF protection.
  const client = await (await fetch(`${origin}/@vite/client`)).text()
  const token = /const wsToken = ("[^"\\]*(?:\\.[^"\\]*)*")/.exec(client)?.[1]
  const hmrUrl = token ? `ws://127.0.0.1:${port}/?token=${encodeURIComponent(JSON.parse(token))}` : `ws://127.0.0.1:${port}/`
  const hmr = await openWs(hmrUrl, { protocol: 'vite-hmr', origin })
  t.after(() => hmr.terminate())
  // Attach the listener immediately: Vite sends this directly after upgrade.
  const connected = await nextMessage(hmr)
  assert.equal(connected.type, 'connected')
  // Cold demo route compilation can exceed the handshake deadline. Warm the
  // HTTP route first; the HMR socket is already open and must remain usable.
  const warmup = await fetch(`${origin}/api/form-upload`, { headers: { origin } })
  assert.equal(warmup.status, 426)
  const upload = await openWs(`ws://127.0.0.1:${port}/api/form-upload`, { origin })
  t.after(() => upload.terminate())
  const fault = nextMessage(upload)
  upload.send(JSON.stringify({ type: 'init', target: '/', fields: [], files: 'invalid' }))
  const message = await fault
  assert.equal(message.type, 'fault'); assert.equal(message.status, 400)
  assert.equal(hmr.readyState, WebSocket.OPEN)
  const response = await fetch(`${origin}/@vite/client`)
  assert.equal(response.status, 200)
  assert.equal((await fetch(`${origin}/${path}`)).status, 200)
  // Give the watcher time to settle after its initial scan and module registration.
  await new Promise(resolve => setTimeout(resolve, 400))
  const update = (async () => {
    for (;;) {
      const message = await nextMessage(hmr)
      if (message.type === 'update' && message.updates.some(entry => entry.path.includes(name))) return message
    }
  })()
  await writeFile(path, 'export const value = 2; if (import.meta.hot) import.meta.hot.accept();\n')
  const updateMessage = await update
  assert.equal(updateMessage.type, 'update')
  assert.ok(updateMessage.updates.some(entry => entry.path.includes(name)))
})
