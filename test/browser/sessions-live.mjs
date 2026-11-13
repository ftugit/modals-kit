// Изолированный браузерный тест: живой статус, серверный набор по фильтру,
// удержание реальным нажатием и выход со всех устройств. Требует живой сервер
// и MODALS_ADMIN_SECRET не нужен: аккаунт создаётся регистрацией.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { hold } from './hold.mjs'

const origin = (process.env.MODALS_ORIGIN ?? process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`).replace(/\/$/, '')
const browser = await chromium.launch({ headless: true })
const contexts = []
async function page() {
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } })
  contexts.push(context)
  return context.newPage()
}
const isPost = (url) => (r) => r.request().method() === 'POST' && r.url().includes(url)
try {
  const current = await page()
  await current.goto(`${origin}/user/auth?stage=auth.register`, { waitUntil: 'networkidle' })
  const seed = await current.locator('input[name=seed]').inputValue()
  assert.ok(seed.length >= 43)
  await hold(
    current,
    current.locator('#user-auth button[type=submit]:has-text("Удерживайте")'),
    current.waitForResponse(isPost('/user/auth'), { timeout: 20000 }),
    { massHold: false },
  )
  await current.locator('#user-profile input[name=nickname]').fill(`session-test-${Date.now()}`)
  await current.locator('#user-profile').getByRole('button', { name: 'Сохранить' }).click()
  await current.waitForURL((url) => !url.pathname.includes('/user/auth'), { timeout: 15000 })

  const other = await page()
  await other.goto(`${origin}/user/auth`, { waitUntil: 'networkidle' })
  await other.locator('input[name=seed]').fill(seed)
  await other.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }).click()
  await other.waitForURL((url) => !url.pathname.includes('/user/auth'), { timeout: 15000 })

  await current.goto(`${origin}/user/sessions`, { waitUntil: 'networkidle' })
  assert.equal(await current.locator('[data-testid=session-row]').count(), 2)

  // Шаг подтверждения — ссылка, а не кнопка удержания: сначала переводим шаг.
  await current.locator('[data-testid=sessions-revoke-others]').click()
  await current.waitForURL((url) => url.searchParams.get('sessions-exit') === 'confirm', { timeout: 15000 })
  const holdBtn = current.locator('[data-testid=bulk-exit-hold]')
  if (await holdBtn.count()) {
    await hold(current, holdBtn, current.waitForResponse(isPost('?/others'), { timeout: 20000 }))
  } else {
    await current.locator('[data-testid=bulk-exit-submit]').click()
  }
  await current.waitForFunction(() => document.querySelectorAll('[data-testid=session-row]').length === 1, null, { timeout: 15000 })
  const remaining = await current.locator('[data-testid=session-row]').innerText()
  assert.match(remaining, /Это устройство/)
  assert.match(remaining, /Активна/)

  // Живой статус: метка истечения обновляется без reload.
  await current.clock.install()
  await current.clock.setSystemTime(Date.now() + 366 * 24 * 60 * 60 * 1000)
  await current.clock.fastForward(31_000)
  await current.getByText('Истекла', { exact: true }).first().waitFor({ state: 'visible' })

  // Второй сценарий: чекбокс «включая текущую» → удержание → редирект на вход,
  // куки сняты. Набор снова серверный, клиентские ids не участвуют.
  await current.goto(`${origin}/user/sessions?sessions.state=all&sessions-exit=confirm`, { waitUntil: 'networkidle' })
  await current.locator('input[name=include_current]').check()
  const exitHold = current.locator('[data-testid=bulk-exit-hold]')
  if (await exitHold.count()) {
    await hold(current, exitHold, current.waitForURL((url) => url.pathname === '/user/auth', { timeout: 20000 }))
  } else {
    await current.locator('[data-testid=bulk-exit-submit]').click()
    await current.waitForURL((url) => url.pathname === '/user/auth', { timeout: 20000 })
  }
  const cookies = await current.context().cookies(origin)
  assert.equal(cookies.some((c) => c.name === 'auth_tmp' || c.name === 'auth_sid'), false, 'куки текущей сессии сняты')

  console.log('sessions-live: серверный набор, удержание, истечение и выход со всех — ОК')
} finally {
  await Promise.all(contexts.map((context) => context.close()))
  await browser.close()
}
