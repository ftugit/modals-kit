/** Session regression: successful deletion closes the stack and synchronizes both tabs. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
let debugPage
let lastPost = ''
async function makeAccount(browser, suffix) {
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/user/auth?stage=register`, { waitUntil: 'load' })
  // Несколько сьютов делят один preview и честный серверный IP-throttle.
  // Если соседний сьют исчерпал окно, ждём срок из ответа, а не выключаем
  // ограничитель и не считаем отказ успехом регистрации.
  for (let attempt = 0; ; attempt++) {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      page.locator('#user-auth').getByRole('button', { name: 'Создать аккаунт' }).click(),
    ])
    if (res.status() === 303) {
      await page.waitForURL(/stage=(auth\.)?profile/, { timeout: 15000 })
      break
    }
    const alerts = (await page.locator('[role=alert]').allTextContents()).join(' ').replace(/\s+/g, ' ')
    const retry = /Слишком много попыток.*?через\s+(\d+)\s*с/.exec(alerts)
    if (!retry || attempt >= 3) throw new Error(`регистрация: HTTP ${res.status()}, ${alerts}`)
    await page.waitForTimeout((Number(retry[1]) + 1) * 1000)
  }
  await page.locator('input[name=nickname]').fill(`s2-delete-${suffix}`)
  await page.locator('#user-profile').getByRole('button', { name: 'Сохранить' }).click()
  await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
  const cookies = await ctx.cookies(BASE)
  await ctx.close()
  return cookies
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const { withSeed, failRefresh, storageOnly = false } of [
      { withSeed: false, failRefresh: false },
      { withSeed: true, failRefresh: false },
      { withSeed: true, failRefresh: true, storageOnly: true },
    ]) {
      const cookies = await makeAccount(browser, `${Date.now()}-${Number(withSeed)}-${Number(failRefresh)}`)
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      await ctx.addCookies(cookies)
      if (storageOnly) await ctx.addInitScript(() => { window.BroadcastChannel = undefined })
      const a = await ctx.newPage()
      const b = await ctx.newPage()
      debugPage = a
      await a.goto(`${BASE}/user/menu`, { waitUntil: 'networkidle' })
      await b.goto(`${BASE}/`, { waitUntil: 'networkidle' })
      await b.locator('[data-testid=header-user]').waitFor({ state: 'visible' })
      const href = await a.getByRole('link', { name: 'Профиль', exact: true }).getAttribute('href')
      const uid = href?.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0]
      assert.ok(uid, 'UUID текущего профиля в ссылке меню')
      if (withSeed) {
        await b.goto(`${BASE}/?modal=user.profile.delete&modal.0.id=${uid}`, { waitUntil: 'networkidle' })
        await b.locator('#user-profile-delete').waitFor({ state: 'visible' })
      }
      await a.goto(`${BASE}/?modal=user.list,user.profile.delete&modal.1.id=${uid}`, { waitUntil: 'networkidle' })
      const form = a.locator('#user-profile-delete')
      await form.waitFor({ state: 'visible', timeout: 10000 })
      if (withSeed) await form.locator('input[name=with_seed]').check()
      const button = form.locator('button[type=submit]')
      let releaseRefresh
      let refreshStarted
      let refreshObserved
      if (withSeed) {
        refreshObserved = new Promise((resolve) => { refreshStarted = resolve })
        const blocked = new Promise((resolve) => { releaseRefresh = resolve })
        await b.route('**/__data.json?**', async (route) => {
          if (new URL(route.request().url()).pathname === '/__data.json') {
            refreshStarted()
            await blocked
            if (failRefresh) return route.abort('failed')
          }
          await route.continue()
        })
      }
      let posts = 0
      a.on('request', (r) => { if (r.method() === 'POST') posts++ })
      const post = a.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 })
      await button.hover({ force: true })
      const response = await post
      const responseText = await response.text().catch(() => '')
      const result = JSON.parse(responseText)?.data?.result
      lastPost = JSON.stringify({ status: response.status(), ok: result?.ok, data: result?.data, errors: result?.errors })
      assert.equal(response.status(), 200)
      assert.equal(result?.ok, true)
      await a.waitForURL((u) => !u.searchParams.has('modal'), { timeout: 15000 })
      await a.locator('#user-profile-delete').waitFor({ state: 'hidden', timeout: 15000 })
      await a.locator('[data-modal-popup]').waitFor({ state: 'hidden', timeout: 15000 })
      if (withSeed) {
        await a.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
        await b.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 15000 })
        await Promise.race([refreshObserved, new Promise((_, reject) => setTimeout(() => reject(new Error('refresh не начался')), 15000))])
        await b.locator('#user-profile-delete').waitFor({ state: 'hidden', timeout: 15000 })
        assert.equal(await b.locator('#user-profile-delete').isVisible(), false, 'старые данные скрыты до ответа refresh')
        releaseRefresh()
        if (!failRefresh) await b.getByText('Сессия завершена', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
        else await b.waitForTimeout(1500)
        assert.equal(await b.locator('#user-profile-delete').isVisible(), false, 'старые данные не вернулись после refresh')
      } else {
        await a.locator('[data-testid=header-user]').waitFor({ state: 'visible', timeout: 15000 })
        await b.locator('[data-testid=header-user]').waitFor({ state: 'visible', timeout: 15000 })
        const label = await b.locator('[data-testid=header-user]').getAttribute('aria-label')
        assert.doesNotMatch(label ?? '', /s2-delete-/)
      }
      await a.waitForTimeout(2500) // указатель остаётся на месте: не должно быть повторного POST
      assert.equal(posts, 1, 'успешное удаление отправлено ровно один раз')
      assert.equal(await a.locator('#user-profile-delete').count(), 0)
      console.log(`  ok self-delete with_seed=${withSeed}, failRefresh=${failRefresh}, storageOnly=${storageOnly}, обе вкладки и закрытие всей стопки`)
      await ctx.close()
    }
    for (const withSeed of [false, true]) {
      const cookies = await makeAccount(browser, `nojs-${Date.now()}-${Number(withSeed)}`)
      const ctx = await browser.newContext({ javaScriptEnabled: false })
      await ctx.addCookies(cookies)
      const p = await ctx.newPage()
      await p.goto(`${BASE}/user/menu`)
      const href = await p.getByRole('link', { name: 'Профиль', exact: true }).getAttribute('href')
      const uid = href?.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0]
      assert.ok(uid)
      await p.goto(`${BASE}/user/${uid}/delete`)
      const form = p.locator('#user-profile-delete')
      if (withSeed) await form.locator('input[name=with_seed]').check()
      const [res] = await Promise.all([
        p.waitForResponse((r) => r.request().method() === 'POST'),
        form.locator('button[type=submit]').click(),
      ])
      assert.equal(res.status(), 303)
      assert.equal(res.headers().location, '/')
      await p.waitForURL(`${BASE}/`)
      assert.equal((await ctx.cookies(BASE)).some((c) => c.name === 'auth_sid'), !withSeed)
      await ctx.close()
      console.log(`  ok no-JS with_seed=${withSeed}, redirect /`)
    }
  } catch (error) {
    if (debugPage) {
      if (lastPost) console.error('❌ POST:', lastPost)
      console.error('❌ URL:', debugPage.url())
      console.error('❌ FORM:', (await debugPage.locator('#user-profile-delete').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 150))
    }
    throw error
  } finally { await browser.close() }
}
run().catch((e) => {
  console.error('❌', String(e))
  console.error('❌', String(e?.stack ?? e).split('\n').find((l) => l.includes('stage2-session.mjs:')) ?? String(e))
  process.exit(1)
})
