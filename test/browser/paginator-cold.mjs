// Отдельный медленный integration test: настоящий no-JS POST первым HTTP
// запросом после рестарта preview. Тестовая БД изолирована и удаляется в finally.
// Требуется готовая production-сборка Node и установленный Chromium.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { chromium } from 'playwright'

const port = Number(process.env.COLD_PAGINATOR_PORT ?? 5188)
const origin = `http://127.0.0.1:${port}`
const databaseDir = await mkdtemp(join(tmpdir(), 'paginator-cold-'))
const seed = randomBytes(32).toString('base64url')
const env = {
  ...process.env, KIT_ADAPTER: 'node', DATABASE_URL: '', DATABASE_RESET: '', DATABASE_DIR: databaseDir,
  ADMIN_SEED: seed, AUTH_SEAL_SECRET: 'paginator-cold-test-auth-seal-secret-32-bytes',
  DB_CURSOR_SECRET: 'paginator-cold-test-cursor-secret-32-bytes',
}
let server, browser

async function start() {
  server = spawn(process.execPath, ['--no-liftoff', 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { log += chunk })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`preview завершился: ${log.slice(-1500)}`)
    // Проверка вывода, а не HTTP: первый запрос после рестарта будет POST.
    if (log.includes('Local:')) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`preview не поднялся: ${log.slice(-1500)}`)
}
async function stop() {
  if (!server) return
  const child = server
  server = undefined
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await exited
}

try {
  await start()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(`${origin}/user/auth`)
  await page.locator('input[name=seed]').fill(seed)
  const [login] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }).click(),
  ])
  assert.equal(login.status(), 303, 'вход администратора')
  const cases = [
    { path: '/users', id: 'paginator-search', from: '/users?keep=cold', key: 'q', value: 'cold query', expected: 'users.q' },
    { path: '/users/filters', id: 'seed-users-filters', from: '/users?keep=cold', key: 'ord', value: 'created-asc', expected: 'users.ord' },
    { path: '/blocks/filters', id: 'user-blocks-filters', from: '/blocks?keep=cold', key: 'ord', value: 'created-asc', expected: 'blocks.ord' },
  ]
  for (const c of cases) {
    assert.equal((await page.goto(origin + c.path))?.status(), 200, c.path)
    const form = page.locator('form').filter({ has: page.locator(`input[name="__form_id"][value="${c.id}"]`) })
    assert.equal(await form.count(), 1, `${c.id}: форма доступна администратору`)
    c.form = await form.evaluate((el, data) => {
      const body = new FormData(el)
      body.set('from', data.from)
      body.set(data.key, data.value)
      return { action: el.action, entries: [...body.entries()] }
    }, c)
  }
  const cookie = (await context.cookies(origin)).map((c) => `${c.name}=${c.value}`).join('; ')
  assert.ok(cookie, 'cookie авторизованного администратора')
  await context.close()
  for (const c of cases) {
    await stop()
    await start()
    const body = new FormData()
    for (const [key, value] of c.form.entries) body.append(key, value)
    const post = await fetch(c.form.action, { method: 'POST', body, redirect: 'manual', headers: { origin, cookie, accept: 'text/html' } })
    assert.equal(post.status, 303, `${c.id}: холодный POST`)
    const location = post.headers.get('location')
    assert.ok(location, `${c.id}: отсутствует Location`)
    const target = new URL(location, origin)
    assert.equal(target.pathname, new URL(c.from, origin).pathname)
    assert.equal(target.searchParams.get('keep'), 'cold')
    assert.equal(target.searchParams.get(c.expected), c.value)
    console.log(`ok ${c.id}: холодный POST 303, адрес и параметры сохранены`)
  }
} finally {
  await browser?.close()
  await stop()
  await rm(databaseDir, { recursive: true, force: true })
}
