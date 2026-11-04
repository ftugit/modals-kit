import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import http from 'node:http'
import { WebSocket } from 'ws'

const built = existsSync('build/handler.js')
async function freePort() {
  const s = createServer()
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))
  const port = s.address().port
  await new Promise((resolve) => s.close(resolve))
  return port
}
function request(port, path, headers = {}, method = 'GET', body = '') {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    r.on('error', reject)
    r.end(body)
  })
}
async function start(env = {}) {
  const port = await freePort()
  const clean = { ...process.env, ...env, HOST: '127.0.0.1', PORT: String(port) }
  for (const key of ['DATABASE_URL', 'DATABASE_RESET', 'DATABASE_DIR', 'HYPERDRIVE_CONNECTION_STRING', 'ORIGIN']) delete clean[key]
  const child = spawn(process.execPath, ['server.mjs'], { env: clean, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (c) => { output += c })
  child.stderr.on('data', (c) => { output += c })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 15000)
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('Listening on')) { clearTimeout(timer); resolve() } })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)) })
  })
  return { port, child }
}
async function stop(child) {
  if (child.exitCode !== null) return
  const done = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await done
}

test('Node: host, локальный HTTP, статика, формат NF env и same-origin POST', { skip: !built }, async () => {
  const { child, port } = await start({
    NF_OBJECT_ID: 'a', NF_PROJECT_ID: 'b', NF_HOSTS: 'example.code.run',
    NF_DEPLOYMENT_REPO: 'd', NF_DEPLOYMENT_BRANCH: 'e', NF_PLAN_ID: 'f', NF_CPU_RESOURCES: 'g',
  })
  try {
    const host = `127.0.0.1:${port}`
    const staticResponse = await request(port, '/robots.txt', { Host: host })
    assert.equal(staticResponse.status, 200)
    assert.equal(staticResponse.headers['x-content-type-options'], 'nosniff')
    assert.equal((await request(port, '/robots.txt', { Host: 'evil.example' })).status, 421)
    assert.equal((await request(port, '/robots.txt', { Host: 'example.code.run:443' })).status, 200)
    const localPage = await request(port, '/', { Host: host })
    assert.equal(localPage.headers['strict-transport-security'], undefined)
    const untrustedForwarded = await request(port, '/', { Host: host, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example', 'x-envoy-external-address': '203.0.113.42' })
    assert.equal(untrustedForwarded.status, 200)
    assert.equal(untrustedForwarded.headers['strict-transport-security'], undefined)
    const httpsPage = await request(port, '/', { Host: 'example.code.run' })
    assert.match(httpsPage.headers['strict-transport-security'] ?? '', /max-age=/)
    const post = await request(port, '/', { Host: host, Origin: `http://${host}`, 'content-type': 'application/x-www-form-urlencoded' }, 'POST', 'x=y')
    assert.notEqual(post.status, 403, post.body)
    assert.doesNotMatch(post.body, /body\.unreadable/)
    const spoof = await request(port, '/', { Host: host, Origin: `http://${host}`, 'content-type': 'application/x-www-form-urlencoded', 'x-kit-internal-host': 'evil.example', 'x-kit-internal-proto': 'https' }, 'POST', 'x=y')
    assert.notEqual(spoof.status, 403, spoof.body)
    assert.equal(child.exitCode, null)
  } finally { await stop(child) }
})

function rawUpgrade(port, host) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let data = ''
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('upgrade timeout')) })
    socket.on('connect', () => socket.write(`GET /api/form-upload HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`))
    socket.on('data', (chunk) => { data += chunk; if (data.includes('\r\n\r\n')) { socket.destroy(); resolve(data) } })
    socket.on('error', reject)
    socket.on('end', () => resolve(data))
  })
}

test('Node: WS host и быстрые обрывы не убивают процесс', { skip: !built }, async () => {
  const { child, port } = await start()
  try {
    assert.match(await rawUpgrade(port, 'evil.example'), /^HTTP\/1\.1 421 /)
    const accepted = await rawUpgrade(port, `127.0.0.1:${port}`)
    assert.match(accepted, /^HTTP\/1\.1 101 /)
    await Promise.all(Array.from({ length: 25 }, () => new Promise((resolve) => {
      const s = connect(port, '127.0.0.1')
      s.on('error', () => resolve())
      s.on('connect', () => { s.write(`GET /api/form-upload HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`); s.destroy(); resolve() })
    })))
    assert.equal((await request(port, '/robots.txt')).status, 200)
    assert.equal(child.exitCode, null)
  } finally { await stop(child) }
})


test('Node: chunked boundary returns an HTTP response rather than resetting the connection', { skip: !built }, async () => {
  const { child, port } = await start({ FORM_BODY_LIMIT: '65536' })
  try {
    const host = `127.0.0.1:${port}`
    const headers = { Host: host, Origin: `http://${host}`, 'content-type': 'application/x-www-form-urlencoded', 'transfer-encoding': 'chunked', accept: 'application/json' }
    const within = await request(port, '/', headers, 'POST', `x=${'a'.repeat(32766)}`)
    assert.notEqual(within.status, 413)
    const above = await request(port, '/', headers, 'POST', `x=${'a'.repeat(32767)}`)
    assert.equal(above.status, 413)
    assert.equal(child.exitCode, null)
  } finally { await stop(child) }
})

test('Node: unfinished oversized chunked request receives 413 and connection closes', { skip: !built }, async () => {
  const { child, port } = await start({ FORM_BODY_LIMIT: '65536' })
  try {
    const host = `127.0.0.1:${port}`
    const response = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'POST', headers: {
        host, origin: `http://${host}`, 'content-type': 'application/x-www-form-urlencoded', 'transfer-encoding': 'chunked', accept: 'application/json',
      } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
      req.on('error', reject)
      req.setTimeout(4000, () => req.destroy(new Error('response timeout')))
      req.write(`x=${'a'.repeat(32767)}`)
      // Deliberately do not send the final chunk.
    })
    assert.equal(response, 413)
    assert.equal((await request(port, '/robots.txt')).status, 200)
    assert.equal(child.exitCode, null)
  } finally { await stop(child) }
})

test('Node: registered form chunked limit returns 413 at the configured boundary', { skip: !built }, async () => {
  const { child, port } = await start({ FORM_BODY_LIMIT: '65536' })
  try {
    const host = `127.0.0.1:${port}`
    const headers = { host, origin: `http://${host}`, 'content-type': 'application/x-www-form-urlencoded', 'transfer-encoding': 'chunked', accept: 'application/json', 'x-form-id': 'user-auth' }
    const response = await request(port, '/', headers, 'POST', `x=${'a'.repeat(65535)}`)
    assert.equal(response.status, 413)
    assert.equal(child.exitCode, null)
  } finally { await stop(child) }
})


test('Node: SIGTERM closes an upgraded WebSocket cleanly instead of hanging indefinitely', { skip: !built }, async () => {
  const { child, port } = await start()
  let ws
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/api/form-upload`, { headers: { origin: `http://127.0.0.1:${port}` } })
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)))
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    assert.equal(await closed, 1001)
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), 7000))])
  } finally { ws?.terminate(); await stop(child) }
})
