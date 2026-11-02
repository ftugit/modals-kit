/** Проверка входа с частичными ограничениями через модалку после смены сессии. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
const secret = process.env.MODALS_ADMIN_SECRET
if (!secret) throw new Error('stage2-auth-modal requires MODALS_ADMIN_SECRET')
const browser = await chromium.launch({ headless: true })
let debugPage
async function submitNoJs(page, name, seed) {
  for (let attempt = 0; ; attempt++) {
    if (seed) await page.locator('input[name=seed]').fill(seed)
    const submittedSeed = await page.locator('input[name=seed]').inputValue()
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      page.locator('#user-auth').getByRole('button', { name, exact: true }).click(),
    ])
    if (response.status() === 303) return submittedSeed
    const errors = (await page.locator('[role=alert]').allTextContents()).join(' ').replace(/\s+/g, ' ')
    const retry = /Слишком много попыток.*?через\s+(\d+)\s*с/.exec(errors)
    if (!retry || attempt >= 3) throw new Error(`auth HTTP ${response.status()}: ${errors}`)
    await page.waitForTimeout((Number(retry[1]) + 1) * 1000)
  }
}
async function submitModalLogin(page, auth, seed, uid) {
  for (let attempt = 0; ; attempt++) {
    await auth.locator('input[name=seed]').fill(seed)
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      auth.getByRole('button', { name: 'Авторизация', exact: true }).click(),
    ])
    if (response.status() !== 429) {
      assert.ok(response.status() < 400, `auth HTTP ${response.status()}`)
      const result = (await response.json())?.data?.result
      assert.equal(result?.data?.user?.sub, uid, `логин должен быть в созданный аккаунт: ${JSON.stringify({ step: result?.data?.step, actual: result?.data?.user?.sub, expected: uid })}`)
      assert.equal(result?.data?.step, 'restrictions', `ожидался экран ограничений: ${JSON.stringify({ ok: result?.ok, step: result?.data?.step, errors: result?.errors })}`)
      break
    }
    const result = (await response.json())?.data?.result
    const error = result?.errors?.find((e) => e.code === 'rate.limited')
    if (!error || attempt >= 3) throw new Error('auth action exceeded retry budget')
    await page.waitForTimeout(Math.ceil(Number(error.params?.retryAfterMs ?? 60_000) / 1000) * 1000 + 1000)
  }
}
async function submitAction(page, button) {
  for (let attempt = 0; ; attempt++) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      button.click(),
    ])
    if (response.status() !== 429) {
      assert.ok(response.status() < 400, `action HTTP ${response.status()}`)
      return
    }
    const error = (await response.json())?.data?.result?.errors?.find((e) => e.code === 'rate.limited')
    if (!error || attempt >= 3) throw new Error('action exceeded retry budget')
    await page.waitForTimeout(Math.ceil(Number(error.params?.retryAfterMs ?? 60_000) / 1000) * 1000 + 1000)
  }
}
try {
  const fixture = await browser.newContext({ javaScriptEnabled: false })
  const p = await fixture.newPage()
  await p.goto(`${BASE}/user/auth?stage=register`)
  const seed = await submitNoJs(p, 'Создать аккаунт')
  await p.waitForURL(/stage=(auth\.)?profile/, { timeout: 15000 })
  await p.locator('#user-profile input[name=nickname]').fill(`restricted-${Date.now().toString(36)}`)
  await p.locator('#user-profile').getByRole('button', { name: 'Сохранить', exact: true }).click()
  await p.waitForURL((url) => url.pathname === '/', { timeout: 15000 })
  await p.goto(`${BASE}/user/menu`)
  const href = await p.getByRole('link', { name: 'Профиль', exact: true }).getAttribute('href')
  const uid = new URL(href, p.url()).pathname.split('/').pop()
  assert.match(uid, /^[0-9a-f-]{36}$/i)
  await fixture.close()

  const admin = await browser.newContext({ javaScriptEnabled: false })
  const a = await admin.newPage()
  await a.goto(`${BASE}/user/auth`)
  await submitNoJs(a, 'Авторизация', secret)
  await a.goto(`${BASE}/user/${uid}/blocks/new`)
  const form = a.locator('[data-testid=block-form-create]')
  await form.locator('select[name=scope]').selectOption('profile.delete')
  await form.locator('textarea[name=reason]').fill('Тест ограничения входа')
  await form.locator('[data-testid=block-create-submit]').click()
  await a.waitForURL((url) => !url.pathname.endsWith('/new'), { timeout: 15000 })
  await admin.close()

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  debugPage = page
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('[data-testid=header-auth]').click()
  const auth = page.locator('[role=dialog] #user-auth')
  await submitModalLogin(page, auth, seed, uid)
  const dialog = page.locator('[role=dialog]')
  await dialog.getByText('Тест ограничения входа', { exact: false }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await dialog.locator('[data-acl-code=guest_only]').count(), 0)
  // Выход из соседней вкладки не должен оставить старую причину в открытом
  // носителе, в том числе пока его loader перезапрашивается.
  const other = await ctx.newPage()
  await other.goto(`${BASE}/user/menu`, { waitUntil: 'networkidle' })
  await submitAction(other, other.getByRole('button', { name: 'Выйти', exact: true }))
  await page.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
  await dialog.getByText('Тест ограничения входа', { exact: false }).waitFor({ state: 'hidden', timeout: 15000 })
  await auth.locator('input[name=seed]').waitFor({ state: 'visible', timeout: 15000 })
  await submitModalLogin(page, auth, seed, uid)
  await dialog.getByText('Тест ограничения входа', { exact: false }).waitFor({ state: 'visible', timeout: 15000 })
  await submitAction(page, dialog.getByRole('button', { name: 'Принято', exact: true }))
  await dialog.waitFor({ state: 'hidden', timeout: 15000 })
  await page.locator('[data-testid=header-user]').waitFor({ state: 'visible', timeout: 15000 })
  console.log('  ok: AuthModal сохраняет ограничения после hard-инвалидации и закрывается по подтверждению')
  await ctx.close()
} catch (error) {
  if (debugPage) console.error('❌ dialog:', JSON.stringify((await debugPage.locator('[role=dialog]').allTextContents().catch(() => [])).map((s) => s.replace(/\s+/g, ' ').slice(0, 160))))
  console.error('❌', String(error))
  console.error('❌', String(error?.stack ?? '').split('\n').find((line) => line.includes('stage2-auth-modal.mjs:')))
  process.exitCode = 1
} finally { await browser.close() }
