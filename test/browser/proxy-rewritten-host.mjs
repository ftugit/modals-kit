/**
 * Explicit integration test for an isolated proxy whose upstream Host differs
 * from the browser origin (e.g. HTTPS edge -> provider ingress -> Node).
 *
 * Requires a demo build with the exact EDGE_TEST_BASE origin in BOTH the build
 * and runtime KIT_TRUSTED_ORIGINS. The test writes a small file and note to
 * the demo's in-memory storage; never point it at an unapproved environment.
 *
 * EDGE_TEST_BASE=https://edge.localhost:48501 EDGE_TEST_ALLOW_WRITES=yes \
 *   EDGE_TEST_INSECURE_TLS=1 node test/browser/proxy-rewritten-host.mjs
 *
 * EDGE_TEST_INSECURE_TLS is for isolated self-signed test certificates only.
 * A production-facing test must leave certificate verification enabled.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { WebSocket } from 'ws'
import { chromium } from 'playwright'

const base = process.env.EDGE_TEST_BASE
if (!base || process.env.EDGE_TEST_ALLOW_WRITES !== 'yes') {
  throw new Error('Set EDGE_TEST_BASE and EDGE_TEST_ALLOW_WRITES=yes for an explicitly approved test environment')
}
const url = new URL(base)
if (url.origin !== base || !['https:', 'http:'].includes(url.protocol)) {
  throw new Error('EDGE_TEST_BASE must be an exact HTTP(S) origin without a path or trailing slash')
}
const insecure = process.env.EDGE_TEST_INSECURE_TLS === '1'
const title = `proxy-e2e-${randomBytes(8).toString('hex')}`
const note = `proxy-nojs-${randomBytes(8).toString('hex')}`
const filename = `${title}.bin`
// Chromium resolves *.localhost itself; Node needs an explicit loopback lookup.
const loopbackLookup = (host, options, callback) => options.all
  ? callback(null, [{ address: '127.0.0.1', family: 4 }])
  : callback(null, '127.0.0.1', 4)
const networkOptions = {
  ...(url.hostname.endsWith('.localhost') ? { lookup: loopbackLookup } : {}),
  ...(url.protocol === 'https:' ? { rejectUnauthorized: !insecure } : {}),
}
async function deniedHttpOrigin() {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const req = transport.request(new URL('/upload-demo?server=memory', url), {
      ...networkOptions,
      method: 'POST',
      headers: { origin: 'https://untrusted.invalid', 'content-type': 'application/x-www-form-urlencoded' },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
    req.end('x=y')
  })
}
async function deniedWsOrigin() {
  return new Promise((resolve, reject) => {
    const wsUrl = new URL('/api/form-upload', url)
    wsUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(wsUrl, { ...networkOptions, origin: 'https://untrusted.invalid' })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('WS origin test timed out')) }, 10000)
    socket.on('unexpected-response', (_request, response) => {
      clearTimeout(timer); response.resume(); resolve(response.statusCode); socket.terminate()
    })
    socket.on('open', () => { clearTimeout(timer); socket.terminate(); resolve(101) })
    socket.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}
const bytes = Buffer.alloc(65536)
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
const browser = await chromium.launch()

try {
  assert.equal(await deniedHttpOrigin(), 403, 'cross-origin POST is denied')
  assert.equal(await deniedWsOrigin(), 403, 'cross-origin WS is denied')
  const context = await browser.newContext({ ignoreHTTPSErrors: insecure })
  const page = await context.newPage()
  const pageErrors = []
  const sockets = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })
  page.on('websocket', (socket) => {
    const entry = { url: socket.url(), binary: 0 }
    sockets.push(entry)
    socket.on('framesent', ({ payload }) => { if (typeof payload !== 'string') entry.binary += payload.length })
    socket.on('socketerror', (e) => pageErrors.push(String(e)))
  })
  const response = await page.goto(`${base}/upload-demo?server=memory`, { waitUntil: 'networkidle' })
  assert.equal(response?.status(), 200, 'SSR')
  await page.locator('input[name=title]').fill(title)
  await page.locator('input[name=bundle]').setInputFiles({ name: filename, mimeType: 'application/octet-stream', buffer: bytes })
  await page.locator('input[name=verify_integrity]').check()
  await page.locator('[data-testid=submit-upload]').click()
  await page.getByText(title, { exact: true }).first().waitFor({ timeout: 30000 })
  assert.ok(sockets.some((s) => s.url.startsWith(`${base.replace(/^http/, 'ws')}/api/form-upload`) && s.binary >= bytes.length), 'browser sends actual file via WSS/WS')
  const link = await page.locator('a[href*="/api/files/"]').evaluateAll((anchors, name) => anchors.find((a) => a.href.includes(name))?.href, filename)
  assert.ok(link, 'download link found')
  assert.equal(new URL(link).origin, base, 'download stays on the external origin')
  const download = await page.evaluate(async (href) => {
    const res = await fetch(href)
    return { status: res.status, bytes: Array.from(new Uint8Array(await res.arrayBuffer())) }
  }, link)
  assert.equal(download.status, 200)
  assert.deepEqual(Buffer.from(download.bytes), bytes, 'download byte-identical')
  assert.deepEqual(pageErrors, [], 'no browser or CSP errors')
  await context.close()

  const noJsContext = await browser.newContext({ ignoreHTTPSErrors: insecure, javaScriptEnabled: false })
  const noJs = await noJsContext.newPage()
  assert.equal((await noJs.goto(`${base}/upload-demo?server=memory`))?.status(), 200)
  await noJs.locator('input[name=message]').fill(note)
  const navigation = noJs.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 })
  await noJs.locator('[data-testid=submit-note]').click()
  assert.equal((await navigation)?.status(), 200, 'native no-JS POST')
  assert.ok(await noJs.getByText(note, { exact: true }).count(), 'native POST committed in memory')
  await noJsContext.close()
  console.log('PASS: SSR, native POST, WSS upload/download, and cross-origin rejection through rewritten Host')
} finally {
  await browser.close()
}
