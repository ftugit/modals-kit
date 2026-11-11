// Изолированный браузерный тест: живой статус и отзыв остальных устройств.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = (process.env.MODALS_ORIGIN ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`).replace(/\/$/, '')
const browser = await chromium.launch({ headless: true })
const contexts = []
async function page() {
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } })
  contexts.push(context)
  return context.newPage()
}
async function hold(page, locator) {
  await locator.focus()
  await page.keyboard.down(' ')
  await page.waitForTimeout(2600)
  await page.keyboard.up(' ')
}
try {
  const current = await page()
  await current.goto(`${origin}/user/auth?stage=auth.register`, { waitUntil: 'networkidle' })
  const seed = await current.locator('input[name=seed]').inputValue()
  assert.ok(seed.length >= 43)
  await hold(current, current.locator('#user-auth button[type=submit]:has-text("Удерживайте")'))
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
  await hold(current, current.locator('[data-testid=sessions-revoke-others]'))
  await current.waitForFunction(() => document.querySelectorAll('[data-testid=session-row]').length === 1, null, { timeout: 15000 })
  assert.equal(await current.locator('[data-current]').count(), 1)
  assert.match(await current.locator('[data-current]').innerText(), /Активна/)

  await current.clock.install()
  await current.clock.setSystemTime(Date.now() + 366 * 24 * 60 * 60 * 1000)
  await current.clock.fastForward(31_000)
  await current.getByText('Истекла', { exact: true }).first().waitFor({ state: 'visible' })
  console.log('sessions-live: остальные отозваны, текущая сохранена; метка истечения обновилась без reload')
} finally {
  await Promise.all(contexts.map((context) => context.close()))
  await browser.close()
}
