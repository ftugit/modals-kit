// Медленная регрессия: POST формы, полученной до перезапуска, первым запросом
// попадает в новый процесс (без предварительного GET, прогревающего пагинатор).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'

const port = Number(process.env.COLD_SEARCH_PORT ?? 5187)
const origin = `http://127.0.0.1:${port}`
let server
let browser

async function start() {
  server = spawn(process.execPath, ['--no-liftoff', 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, KIT_ADAPTER: 'node' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.on('data', (chunk) => { output += chunk })
  server.stderr.on('data', (chunk) => { output += chunk })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`preview завершился: ${output.slice(-1500)}`)
    // Ждём именно собственный процесс, а не чужой сервер на занятом порту.
    if (output.includes('Local:')) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`preview не поднялся: ${output.slice(-1500)}`)
}

async function stop() {
  if (!server) return
  const child = server
  server = undefined
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit')
}

try {
  await start()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const response = await page.goto(`${origin}/paginator?page.src=products`)
  assert.equal(response?.status(), 200)
  const form = await page.locator('[data-testid="search-form"]').evaluate((el) => {
    const data = new FormData(el)
    data.set('q', 'Product 29')
    return { action: el.action, entries: [...data.entries()] }
  })
  await context.close()
  await stop()
  await start()
  const data = new FormData()
  for (const [key, value] of form.entries) data.append(key, value)
  const post = await fetch(form.action, {
    method: 'POST', body: data, redirect: 'manual',
    headers: { origin, referer: `${origin}/paginator?page.src=products`, accept: 'text/html' },
  })
  assert.equal(post.status, 303, `холодный POST вернул ${post.status}`)
  const location = post.headers.get('location')
  assert.ok(location, 'нет адреса перенаправления')
  const target = new URL(location, origin)
  assert.equal(target.searchParams.get('page.src'), 'products')
  assert.equal(target.searchParams.get('page.q'), 'Product 29')
  console.log('search-cold: POST 303 до первого GET нового процесса; источник и запрос сохранены')
} finally {
  await browser?.close()
  await stop()
}
