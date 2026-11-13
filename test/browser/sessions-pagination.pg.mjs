/**
 * Реальная пагинация устройств в браузере с выделенной PostgreSQL.
 * Нужны заранее собранный preview и отдельная тестовая БД этого preview.
 * KIT_TEST_SESSION_DATABASE_URL обязан указывать на loopback и БД с именем
 * kit_test_sessions_…; без явного opt-in тест пропускается. Тест создаёт
 * новый аккаунт и удаляет только дополнительные строки, которые вставил сам.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chromium } from 'playwright'
import pg from 'pg'

const connectionString = process.env.KIT_TEST_SESSION_DATABASE_URL
if (!connectionString) {
  console.log('SKIP sessions-pagination.pg: нужна отдельная KIT_TEST_SESSION_DATABASE_URL')
  process.exit(0)
}
const database = new URL(connectionString)
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol))
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname), 'только локальная PostgreSQL')
assert.equal(database.search, '', 'параметры URL запрещены')
assert.equal(database.hash, '', 'фрагменты URL запрещены')
assert.match(database.pathname, /^\/kit_test_sessions_[a-z0-9_]+$/i, 'нужна выделенная тестовая база')
const origin = new URL(process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`)
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'только локальный preview')
assert.equal(origin.pathname, '/')
assert.equal(origin.search, '')
const base = origin.origin
const db = new pg.Client({ connectionString })
const browser = await chromium.launch({ headless: true })
let uid
let inserted = []
try {
  const nojs = await browser.newContext({ javaScriptEnabled: false })
  const page = await nojs.newPage()
  const initial = await page.goto(`${base}/user/auth?stage=register`, { waitUntil: 'load' })
  assert.equal(initial?.status(), 200)
  const [register] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.locator('#user-auth').getByRole('button', { name: 'Создать аккаунт' }).click(),
  ])
  assert.equal(register.status(), 303)
  await page.waitForURL(/stage=(auth\.)?profile/)
  await page.locator('input[name=nickname]').fill('Pagination test')
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/user/auth')),
    page.locator('#user-profile').getByRole('button', { name: 'Сохранить' }).click(),
  ])
  await page.goto(`${base}/user/menu`)
  const href = await page.getByRole('link', { name: 'Профиль', exact: true }).getAttribute('href')
  uid = href?.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0]
  assert.ok(uid, 'UUID только что созданного аккаунта')
  await db.connect()
  const marker = `pagination-${randomBytes(12).toString('hex')}-`
  const result = await db.query(`
    INSERT INTO public.user_session (auth_id, jti, device_name, expires_at, created_at)
    SELECT $1, $2 || lpad(n::text, 4, '0'), 'Устройство ' || n,
      now() + interval '1 hour', now() - (n || ' seconds')::interval
    FROM generate_series(1, 31) n RETURNING id
  `, [uid, marker])
  inserted = result.rows.map((row) => row.id)
  const current = await db.query('SELECT id FROM public.user_session WHERE auth_id=$1 AND NOT (id = ANY($2::uuid[])) AND deleted_at IS NULL', [uid, inserted])
  assert.equal(current.rowCount, 1, 'аккаунт создан с единственной реальной сессией')
  const expected = new Set([...inserted, current.rows[0].id])
  const rows = (root) => root.locator('[data-testid="session-row"]')
  const ids = async (root) => (await rows(root).evaluateAll((nodes) => nodes.map((el) => el.getAttribute('data-id'))))

  await page.goto(`${base}/user/sessions`)
  const first = await ids(page)
  assert.equal(first.length, 30)
  assert.equal(await page.getByRole('link', { name: 'Вперёд' }).getAttribute('href'), '/user/sessions?sessions=2')
  await page.getByRole('link', { name: 'Вперёд' }).click()
  assert.equal(new URL(page.url()).searchParams.get('page'), '2')
  const second = await ids(page)
  assert.equal(second.length, 2)
  assert.deepEqual(new Set([...first, ...second]), expected)
  assert.equal(await page.getByRole('link', { name: 'Назад' }).getAttribute('href'), '/user/sessions?sessions=1')
  assert.ok(!(await page.content()).includes(marker), 'токены сессий не выведены в HTML')
  await page.goto(`${base}/user/sessions?sessions=999`)
  assert.equal(await rows(page).count(), 0)
  assert.match(await page.locator('[data-testid="sessions-empty"]').innerText(), /На этой странице сессий нет/)
  assert.equal(await page.getByRole('link', { name: 'Назад' }).getAttribute('href'), '/user/sessions?sessions=2')
  await page.getByRole('link', { name: 'Назад' }).click()
  assert.deepEqual(new Set(await ids(page)), new Set(second))
  const cookies = await nojs.cookies()
  await nojs.close()
  console.log('ok no-JS: 32 сессии на двух страницах, без потерь и секретов')

  const js = await browser.newContext()
  await js.addCookies(cookies)
  const live = await js.newPage()
  await live.goto(`${base}/?modal=user.sessions`, { waitUntil: 'networkidle' })
  const dialog = live.locator('[role="dialog"] [data-testid="sessions-list"]')
  await dialog.waitFor({ state: 'visible' })
  assert.deepEqual(new Set(await ids(dialog)), new Set(first))
  await dialog.getByRole('link', { name: 'Вперёд' }).click()
  // Модалка списка — память-онли пагинатор: адрес носителя не получает ключ
  // порции, вторая страница догружается в том же слое.
  await live.waitForFunction(() => document.querySelectorAll('[role="dialog"] [data-testid="session-row"]').length === 2)
  const modalUrl = new URL(live.url())
  assert.equal(modalUrl.searchParams.get('sessions'), null, 'пагинатор модалки не пишет адрес носителя')
  assert.equal(modalUrl.searchParams.get('page'), null, 'пагинатор модалки не пишет адрес носителя')
  assert.deepEqual(new Set(await ids(dialog)), new Set(second))
  await js.close()
  console.log('ok JS: модалка листает сессии в памяти, адрес носителя чист')
} finally {
  if (uid && inserted.length) await db.query('DELETE FROM public.user_session WHERE auth_id=$1 AND id=ANY($2::uuid[])', [uid, inserted])
  await db.end().catch(() => {})
  await browser.close()
}
