/** Session scope: guest → admin → guest on an already open private page. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
const secret = process.env.MODALS_ADMIN_SECRET
if (!secret) throw new Error('stage2-scope requires MODALS_ADMIN_SECRET from the browser runner')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const actor = await ctx.newPage()
const observer = await ctx.newPage()
async function submitAuth(button) {
  for (let attempt = 0; ; attempt++) {
    const [response] = await Promise.all([
      actor.waitForResponse((r) => r.request().method() === 'POST'),
      button.click(),
    ])
    if (response.status() !== 429) {
      assert.ok(response.status() < 400, `auth action HTTP ${response.status()}`)
      return
    }
    const result = (await response.json())?.data?.result
    const error = result?.errors?.find((e) => e.code === 'rate.limited')
    if (!error || attempt >= 3) throw new Error('auth action exceeded retry budget')
    const ms = Number(error.params?.retryAfterMs ?? 60_000)
    await actor.waitForTimeout(Math.ceil(ms / 1000) * 1000 + 1000)
  }
}
try {
  await observer.goto(`${BASE}/users`, { waitUntil: 'networkidle' })
  await observer.locator('[data-testid=header-auth]').waitFor({ state: 'visible' })
  assert.equal(await observer.locator('[data-testid=seed-user-row]').count(), 0)

  let release
  let started
  let waiting
  let gate
  let trackedPath = '/users/__data.json'
  function holdNextRefresh() {
    waiting = new Promise((resolve) => { started = resolve })
    gate = new Promise((resolve) => { release = resolve })
  }
  async function waitStarted(message) {
    let timer
    try {
      await Promise.race([waiting, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 15000) })])
    } finally { clearTimeout(timer) }
  }
  holdNextRefresh()
  await observer.route('**/__data.json?**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === trackedPath && gate) {
      const current = gate
      gate = null
      started()
      await current
    }
    await route.continue()
  })

  await actor.goto(`${BASE}/user/auth`, { waitUntil: 'networkidle' })
  await actor.fill('input[name=seed]', secret)
  await submitAuth(actor.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }))
  await actor.locator('[data-testid=header-user],#user-profile').first().waitFor({ state: 'visible', timeout: 15000 })
  await observer.locator('[data-testid=header-user]').waitFor({ state: 'visible', timeout: 15000 })
  await waitStarted('login refresh did not start')
  release()
  await observer.locator('[data-testid=seed-user-row]').first().waitFor({ state: 'visible', timeout: 15000 })

  await actor.goto(`${BASE}/user/menu`, { waitUntil: 'networkidle' })
  holdNextRefresh()
  await submitAuth(actor.getByRole('button', { name: 'Выйти', exact: true }))
  await observer.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
  await waitStarted('logout refresh did not start')
  assert.equal(await observer.locator('[data-testid=seed-user-row]:visible').count(), 0, 'private list hidden while guest refresh is blocked')
  // Пока первый ответ гостевого refresh задержан, снова входим тем же
  // администратором: запоздавший ответ гостя не должен отменить новый вход.
  const releaseStaleGuest = release
  await actor.goto(`${BASE}/user/auth`, { waitUntil: 'networkidle' })
  await actor.fill('input[name=seed]', secret)
  await submitAuth(actor.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }))
  await observer.locator('[data-testid=header-user]').waitFor({ state: 'visible', timeout: 15000 })
  await observer.locator('[data-testid=seed-user-row]').first().waitFor({ state: 'visible', timeout: 15000 })
  releaseStaleGuest()
  await observer.waitForTimeout(1000)
  assert.equal(await observer.locator('[data-testid=header-user]').isVisible(), true, 'stale guest response cannot undo newer login')
  assert.ok(await observer.locator('[data-testid=seed-user-row]:visible').count() > 0, 'new principal data retained')

  await actor.goto(`${BASE}/user/menu`, { waitUntil: 'networkidle' })
  holdNextRefresh()
  await submitAuth(actor.getByRole('button', { name: 'Выйти', exact: true }))
  await observer.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
  await waitStarted('second logout refresh did not start')
  assert.equal(await observer.locator('[data-testid=seed-user-row]:visible').count(), 0, 'private list hidden on second logout')
  release()
  await observer.waitForTimeout(1000)
  assert.equal(await observer.locator('[data-testid=seed-user-row]:visible').count(), 0, 'private list remains hidden after refresh')
  await observer.reload({ waitUntil: 'networkidle' })
  assert.equal(await observer.locator('[data-testid=seed-user-row]:visible').count(), 0, 'private list remains hidden after reload')

  // Список был смонтирован, затем скрыт переходом на другую страницу.
  // Выход там не должен позволить восстановить его старый пагинатор по Back.
  await actor.goto(`${BASE}/user/auth`, { waitUntil: 'networkidle' })
  await actor.fill('input[name=seed]', secret)
  await submitAuth(actor.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }))
  await observer.locator('[data-testid=header-user]').waitFor({ state: 'visible', timeout: 15000 })
  await observer.locator('[data-testid=seed-user-row]').first().waitFor({ state: 'visible', timeout: 15000 })
  await observer.getByRole('link', { name: 'Главная', exact: true }).first().click()
  await observer.waitForURL((url) => url.pathname === '/', { timeout: 15000 })
  await actor.goto(`${BASE}/user/menu`, { waitUntil: 'networkidle' })
  await submitAuth(actor.getByRole('button', { name: 'Выйти', exact: true }))
  await observer.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
  await observer.goBack({ waitUntil: 'networkidle' })
  await observer.waitForURL((url) => url.pathname === '/users', { timeout: 15000 })
  assert.equal(await observer.locator('[data-testid=seed-user-row]:visible').count(), 0, 'offscreen paginator not restored after logout')

  // То же для второго принадлежащего домену списка — журнала блокировок.
  await actor.goto(`${BASE}/user/auth`, { waitUntil: 'networkidle' })
  await actor.fill('input[name=seed]', secret)
  await submitAuth(actor.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }))
  await observer.locator('[data-testid=header-user]').waitFor({ state: 'visible', timeout: 15000 })
  await observer.goto(`${BASE}/blocks`, { waitUntil: 'networkidle' })
  await observer.locator('[data-testid=blocks-list]').first().waitFor({ state: 'visible', timeout: 15000 })
  await actor.goto(`${BASE}/user/menu`, { waitUntil: 'networkidle' })
  trackedPath = '/blocks/__data.json'
  holdNextRefresh()
  await submitAuth(actor.getByRole('button', { name: 'Выйти', exact: true }))
  await observer.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
  await waitStarted('blocks logout refresh did not start')
  assert.equal(await observer.locator('[data-testid=blocks-list]:visible').count(), 0, 'blocks hidden while refresh is blocked')
  release()
  await observer.waitForTimeout(1000)
  assert.equal(await observer.locator('[data-testid=blocks-list]:visible').count(), 0, 'blocks stay hidden after refresh')
  console.log('  ok: existing private page follows login/logout across tabs, including delayed and stale refresh')
} catch (error) {
  console.error('❌', String(error))
  console.error('❌', String(error?.stack ?? '').split('\n').find((line) => line.includes('stage2-scope.mjs:')))
  process.exitCode = 1
} finally {
  await ctx.close()
  await browser.close()
}
