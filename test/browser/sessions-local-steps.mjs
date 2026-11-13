/**
 * Локальный шаг подтверждения в модалке выхода (P0-9.5 + Logout).
 * Модалка открывается поверх произвольного носителя; «Далее» не пишет
 * `logout.step` в адрес, закрытие/повторное открытие стартует со сводки.
 * Нужен MODALS_ADMIN_SECRET (seed администратора) и собранный preview.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`

async function run() {
  if (!process.env.MODALS_ADMIN_SECRET) throw new Error('sessions-local-steps требует MODALS_ADMIN_SECRET')
  const browser = await chromium.launch({ headless: true })
  try {
    const nojs = await browser.newContext({ javaScriptEnabled: false })
    const login = await nojs.newPage()
    await login.goto(`${BASE}/user/auth`, { waitUntil: 'load' })
    await login.fill('input[name=seed]', process.env.MODALS_ADMIN_SECRET)
    const [res] = await Promise.all([
      login.waitForResponse((r) => r.request().method() === 'POST'),
      login.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }).click(),
    ])
    assert.equal(res.status(), 303, 'вход администратора')
    const cookies = await nojs.cookies(BASE)
    await nojs.close()

    const ctx = await browser.newContext()
    await ctx.addCookies(cookies)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/?modal=user.logout`, { waitUntil: 'networkidle' })
    const next = page.locator('[role=dialog] [data-testid=logout-exit-next]')
    await next.waitFor({ state: 'visible', timeout: 15000 })
    await next.click()
    await page.locator('[role=dialog] [data-testid=logout-exit-submit]').waitFor({ state: 'visible', timeout: 15000 })
    let url = new URL(page.url())
    assert.equal(url.searchParams.get('logout.step'), null, 'шаг модалки не пишется в адрес носителя')
    assert.equal(url.searchParams.get('modal'), 'user.logout', 'слой выхода открыт')

    // Закрытие слоя и повторное открытие: подтверждение не наследуется.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.goto(`${BASE}/?modal=user.logout`, { waitUntil: 'networkidle' })
    await page.locator('[role=dialog] [data-testid=logout-exit-next]').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.locator('[role=dialog] [data-testid=logout-exit-submit]').count(), 0)
    url = new URL(page.url())
    assert.equal(url.searchParams.get('logout.step'), null)
    console.log('ok browser: logout modal step local, carrier URL clean, reopen starts summary')
    await ctx.close()
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
