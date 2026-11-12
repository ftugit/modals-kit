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
// Выход — два шага: меню открывает экран выхода, намерение подтверждается
// на нём (набор сессий, а не мгновенное действие). Возвращает кнопку
// подтверждения, чтобы отправить её через `submitAuth` с теми же
// ожиданиями POST и повторами на 429.
async function openLogoutConfirm(page) {
  await page.locator('[data-testid=menu-logout-open]').click()
  await page.locator('[data-testid=logout-exit]').waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('[data-testid=logout-exit-next]').click()
  const submit = page.locator('[data-testid=logout-exit-submit]')
  await submit.waitFor({ state: 'visible', timeout: 15000 })
  return submit
}

async function submitAuth(button, target = actor) {
  for (let attempt = 0; ; attempt++) {
    const [response] = await Promise.all([
      target.waitForResponse((r) => r.request().method() === 'POST'),
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
    await target.waitForTimeout(Math.ceil(ms / 1000) * 1000 + 1000)
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
  await submitAuth(await openLogoutConfirm(actor))
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
  await submitAuth(await openLogoutConfirm(actor))
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
  await submitAuth(await openLogoutConfirm(actor))
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
  await submitAuth(await openLogoutConfirm(actor))
  await observer.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
  await waitStarted('blocks logout refresh did not start')
  assert.equal(await observer.locator('[data-testid=blocks-list]:visible').count(), 0, 'blocks hidden while refresh is blocked')
  release()
  await observer.waitForTimeout(1000)
  assert.equal(await observer.locator('[data-testid=blocks-list]:visible').count(), 0, 'blocks stay hidden after refresh')
  console.log('  ok: existing private page follows login/logout across tabs, including delayed and stale refresh')

  // Проверяем не только отдельный маршрут /user/auth: вход в модалке и выход
  // из MenuModal должны обновить уже открытую страницу и её пагинатор.
  await observer.goto(`${BASE}/users`, { waitUntil: 'networkidle' })
  await observer.locator('[data-testid=header-auth]').click()
  const authModal = observer.locator('[role=dialog] #user-auth')
  await authModal.locator('input[name=seed]').waitFor({ state: 'visible', timeout: 15000 })
  await authModal.locator('input[name=seed]').fill(secret)
  await submitAuth(authModal.getByRole('button', { name: 'Авторизация', exact: true }), observer)
  const profile = observer.locator('[role=dialog] #user-profile')
  await observer.waitForFunction(() =>
    !document.querySelector('[role=dialog]') ||
    Boolean(document.querySelector('[role=dialog] #user-profile')), null, { timeout: 15000 })
  if (await profile.isVisible()) {
    await profile.locator('input[name=nickname]').fill('stage2-admin')
    await submitAuth(profile.getByRole('button', { name: 'Сохранить', exact: true }), observer)
  }
  await observer.locator('[role=dialog]').waitFor({ state: 'hidden', timeout: 15000 })
  await observer.locator('[data-testid=header-user]').waitFor({ state: 'visible', timeout: 15000 })
  await observer.locator('[data-testid=seed-user-row]').first().waitFor({ state: 'visible', timeout: 15000 })
  await observer.goto(`${BASE}/users?modal=user.menu`, { waitUntil: 'networkidle' })
  const menu = observer.locator('[role=dialog]')
  await menu.locator('[data-testid=menu-logout-open]').waitFor({ state: 'visible', timeout: 15000 })
  await submitAuth(await openLogoutConfirm(observer), observer)
  await observer.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
  await observer.waitForFunction(() => !document.querySelector('[data-testid=seed-user-row]'), null, { timeout: 15000 })
  assert.equal(await observer.locator('[data-testid=seed-user-row]:visible').count(), 0, 'logout from MenuModal hides private list')
  // Выход уводит на шаг входа (`/user/auth`): список аккаунтов открываем сами,
  // но приватный срез должен прийти данными, а не перезагрузкой — это и проверяем.
  await observer.locator('[data-testid=header-auth]').click()
  await authModal.locator('input[name=seed]').waitFor({ state: 'visible', timeout: 15000 })
  await authModal.locator('input[name=seed]').fill(secret)
  await submitAuth(authModal.getByRole('button', { name: 'Авторизация', exact: true }), observer)
  await observer.locator('[role=dialog]').waitFor({ state: 'hidden', timeout: 15000 })
  await observer.goto(`${BASE}/users`, { waitUntil: 'networkidle' })
  await observer.locator('[data-testid=seed-user-row]').first().waitFor({ state: 'visible', timeout: 15000 })
  await observer.getByRole('link', { name: 'Главная', exact: true }).first().click()
  await observer.waitForURL((url) => url.pathname === '/', { timeout: 15000 })
  await observer.locator('[data-testid=header-user]').click()
  const popover = observer.locator('[data-user-menu-popover]')
  await popover.locator('[data-testid=menu-logout-open]').waitFor({ state: 'visible', timeout: 15000 })
  await submitAuth(await openLogoutConfirm(observer), observer)
  await observer.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
  // Назад со шага входа ведёт на страницу выхода, а не в список: список
  // открываем сами и требуем, чтобы частных строк в нём не было.
  await observer.goBack({ waitUntil: 'networkidle' })
  assert.equal(await observer.locator('[data-testid=header-user]').count(), 0, 'после выхода назад не возвращает вошедшего')
  await observer.goto(`${BASE}/users`, { waitUntil: 'networkidle' })
  assert.equal(await observer.locator('[data-testid=seed-user-row]:visible').count(), 0, 'popover logout prevents stale users')
  console.log('  ok: AuthModal profile and done login, MenuModal and popover logout refresh the users page')
} catch (error) {
  console.error('❌ observer:', observer.url(), JSON.stringify((await observer.locator('[role=dialog]').allTextContents().catch(() => [])).map((s) => s.replace(/\s+/g, ' ').slice(0, 100))))
  console.error('❌', String(error))
  console.error('❌', String(error?.stack ?? '').split('\n').find((line) => line.includes('stage2-scope.mjs:')))
  process.exitCode = 1
} finally {
  await ctx.close()
  await browser.close()
}
