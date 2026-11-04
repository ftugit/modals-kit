import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, connect } from 'node:net'
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import http from 'node:http'

async function fixture(t, trustedIp) {
  const dir = await mkdtemp(join(tmpdir(), 'kit-proxy-process-'))
  await mkdir(join(dir, 'build')); await mkdir(join(dir, 'tooling'))
  for (const file of ['server.mjs', 'tooling/node-request-bridge.mjs', 'tooling/trusted-proxy-address.mjs']) {
    await cp(resolve(file), join(dir, file))
  }
  await writeFile(join(dir, 'package.json'), '{"type":"module"}')
  // Local test-only adapter; never deployed and does not expose an IP endpoint in the app.
  await writeFile(join(dir, 'build/handler.js'), `export function handler(req,res) {
    const addr = req.socket.remoteAddress;
    if (req.url === '/api/form-upload') { res.statusCode=403; res.statusMessage=addr; res.end(); }
    else { res.setHeader('content-type','text/plain'); res.end(addr); }
  }`)
  const tmp = createServer(); await new Promise(r => tmp.listen(0, '127.0.0.1', r));
  const port = tmp.address().port; await new Promise(r => tmp.close(r))
  const child = spawn(process.execPath, ['server.mjs'], { cwd: dir, env: {
    PATH: process.env.PATH, HOST: '127.0.0.1', PORT: String(port),
    KIT_TRUST_PROXY_HEADERS: 'true', KIT_TRUSTED_PROXY_IPS: trustedIp,
  }, stdio: ['ignore','pipe','pipe'] })
  let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
  t.after(async () => {
    if (child.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await done }
    await rm(dir, { recursive: true, force: true })
  })
  await new Promise((resolveStart, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timeout ${output}`)), 10_000)
    child.stdout.on('data', c => { if (String(c).includes('Listening on')) { clearTimeout(timer); resolveStart() } })
    child.once('exit', c => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${output}`)) })
  })
  return port
}

function get(port, headers) {
  return new Promise((resolveReq, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/', headers }, res => {
      let body = ''; res.on('data', c => { body += c }); res.on('end', () => resolveReq({ code: res.statusCode, body }))
    }); req.on('error', reject)
  })
}
function upgrade(port, headers) {
  return new Promise((resolveWs, reject) => {
    const socket = connect(port, '127.0.0.1'); let data = ''
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('upgrade timeout')) })
    socket.on('connect', () => socket.write(`GET /api/form-upload HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${Object.entries(headers).map(([k,v]) => `${k}: ${v}\r\n`).join('')}\r\n`))
    socket.on('data', c => { data += c; if (data.includes('\r\n\r\n')) { socket.destroy(); resolveWs(data) } })
    socket.on('error', reject)
  })
}

test('actual Node server: trusted peer uses appended XFF, not forged Envoy header, for HTTP and WS', async t => {
  const port = await fixture(t, '127.0.0.1')
  const spoof = { 'x-envoy-external-address': '203.0.113.10', 'x-forwarded-for': '203.0.113.10, 198.51.100.27' }
  assert.deepEqual(await get(port, spoof), { code: 200, body: '198.51.100.27' })
  assert.match(await upgrade(port, spoof), /^HTTP\/1\.1 403 198\.51\.100\.27\r\n/)
  assert.deepEqual(await get(port, { 'x-envoy-external-address': '203.0.113.10' }), { code: 200, body: '127.0.0.1' })
  assert.deepEqual(await get(port, { 'x-forwarded-for': '203.0.113.10,' }), { code: 200, body: '127.0.0.1' })
})

test('actual Node server: forwarded headers are ignored for a non-allowlisted TCP peer', async t => {
  const port = await fixture(t, '192.0.2.50')
  const spoof = { 'x-envoy-external-address': '203.0.113.10', 'x-forwarded-for': '198.51.100.27' }
  assert.deepEqual(await get(port, spoof), { code: 200, body: '127.0.0.1' })
  assert.match(await upgrade(port, spoof), /^HTTP\/1\.1 403 127\.0\.0\.1\r\n/)
})
