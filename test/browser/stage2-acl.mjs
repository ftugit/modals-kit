/** ACL error pages and no-JS return paths for nonexistent user targets. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
if (!process.env.MODALS_ADMIN_SECRET) throw new Error('stage2-acl requires MODALS_ADMIN_SECRET')
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ javaScriptEnabled: false })
const page = await ctx.newPage()
async function submitNoJs(target, label, seed) {
  for (let attempt = 0; ; attempt++) {
    if (seed) await target.fill('input[name=seed]', seed)
    const [res] = await Promise.all([
      target.waitForResponse((response) => response.request().method() === 'POST'),
      target.locator('#user-auth').getByRole('button', { name: label, exact: true }).click(),
    ])
    if (res.status() === 303) return
    const errors = (await target.locator('[role=alert]').allTextContents()).join(' ').replace(/\s+/g, ' ')
    const retry = /Слишком много попыток.*?через\s+(\d+)\s*с/.exec(errors)
    if (!retry || attempt >= 3) throw new Error(`auth HTTP ${res.status()}: ${errors}`)
    await target.waitForTimeout((Number(retry[1]) + 1) * 1000)
  }
}
try {
  await page.goto(`${BASE}/user/auth`)
  await submitNoJs(page, 'Авторизация', process.env.MODALS_ADMIN_SECRET)
  await page.locator('[data-testid=header-user],#user-profile').first().waitFor({ state: 'visible', timeout: 15000 })
  const missing = '11111111-1111-4111-8111-111111111111'
  const block = '22222222-2222-4222-8222-222222222222'
  const routes = [
    `/user/${missing}/blocks`,
    `/user/${missing}/blocks/new`,
    `/user/${missing}/blocks/${block}`,
    `/user/${missing}/blocks/${block}/delete`,
    `/user/${missing}/config`,
  ]
  for (const path of routes) {
    await page.goto(BASE + path)
    const acl = page.locator('[data-acl-code=not_found]')
    assert.equal(await acl.count(), 1, `${path}: not_found`)
    assert.equal(await acl.locator('a[href="/"]').count(), 1, `${path}: return to /`)
  }
  console.log('  ok: no-JS unknown user routes show not_found with home return')
  const js = await browser.newContext()
  try {
    await js.addCookies(await ctx.cookies(BASE))
    const modalPage = await js.newPage()
    const modals = [
      `user.blocks.edit&modal.0.blockId=${block}&modal.0.uid=${missing}`,
      `user.blocks.delete&modal.0.blockId=${block}&modal.0.uid=${missing}`,
      `user.config.edit&modal.0.id=${missing}`,
    ]
    for (const modal of modals) {
      await modalPage.goto(`${BASE}/?modal=${modal}`, { waitUntil: 'networkidle' })
      await modalPage.locator('[role=dialog] [data-acl-code=not_found]').waitFor({ state: 'visible', timeout: 15000 })
      assert.equal(await modalPage.locator('[role=dialog] #user-block-delete').count(), 0, `${modal}: no mutation form`)
    }
    console.log('  ok: missing target in JS modals uses same not_found ACL')
  } finally { await js.close() }
  await page.goto(`${BASE}/user/menu`)
  const adminHref = await page.getByRole('link', { name: 'Профиль', exact: true }).getAttribute('href')
  const adminUid = adminHref?.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0]
  assert.ok(adminUid, 'admin UUID')
  const regular = await browser.newContext({ javaScriptEnabled: false })
  try {
    const r = await regular.newPage()
    await r.goto(`${BASE}/user/auth?stage=register`)
    await submitNoJs(r, 'Создать аккаунт')
    await r.waitForURL(/stage=(auth\.)?profile/, { timeout: 15000 })
    await r.locator('input[name=nickname]').fill(`acl-${Date.now()}`)
    await r.locator('#user-profile').getByRole('button', { name: 'Сохранить' }).click()
    await r.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
    for (const action of ['edit', 'delete']) {
      await r.goto(`${BASE}/user/${adminUid}/${action}`)
      assert.equal(await r.locator('[data-acl-code=role_forbidden]').count(), 1, `foreign ${action}: forbidden`)
      assert.equal(await r.locator('#user-profile-delete,#user-profile').count(), 0, `foreign ${action}: no mutation form`)
    }
    console.log('  ok: no-JS regular user cannot edit/delete another profile')
  } finally { await regular.close() }
} catch (error) {
  console.error('❌', String(error))
  console.error('❌', `URL ${page.url()}`)
  console.error('❌', String(error?.stack ?? '').split('\n').find((line) => line.includes('stage2-acl.mjs:')))
  process.exitCode = 1
} finally {
  await ctx.close()
  await browser.close()
}
