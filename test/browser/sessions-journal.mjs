/**
 * Журнал сессий — самостоятельная единица (`user.sessions.journal`): роут и
 * ключ модалки, а не «список с флагом, до которого надо перейти».
 *   • из модалки меню журнал открывается слоем: слой `user.menu` жив;
 *   • из профиля — слоем поверх `user.profile`;
 *   • из своего списка и из списка аккаунтов — слоем, адрес страницы не меняется;
 *   • внутри журнала «Свои устройства» — слоем `user.sessions`, а не переходом;
 *   • без JS ссылки ведут на `/sessions` и `/user/sessions` (fallback пары);
 *   • у аккаунта без права читать чужие устройства входов нет вовсе.
 *
 * Зритель — администратор (`MODALS_ADMIN_SECRET`), второй аккаунт — свежий:
 * права на чужие сессии у него нет, Negative-кейс проверяется на нём.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function registerNoJs(browser, nickname) {
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/user/auth?stage=register`, { waitUntil: 'load' })
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
    await sleep((Number(retry[1]) + 1) * 1000)
  }
  await page.locator('input[name=nickname]').fill(nickname)
  await page.locator('#user-profile').getByRole('button', { name: 'Сохранить' }).click()
  await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
  const cookies = await ctx.cookies(BASE)
  await ctx.close()
  return cookies
}

async function loginNoJs(browser, seed) {
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/user/auth`, { waitUntil: 'load' })
  await page.fill('input[name=seed]', seed)
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }).click(),
  ])
  if (res.status() !== 303) throw new Error(`вход: HTTP ${res.status()}`)
  await page.locator('[data-testid=header-user],#user-profile').first().waitFor({ state: 'visible', timeout: 15000 })
  const cookies = await ctx.cookies(BASE)
  await ctx.close()
  return cookies
}

const chainOf = (url) => String(new URL(url).searchParams.get('modal') ?? '').split(',').filter(Boolean)

// Адрес стопки ставится асинхронно (клик → открытие слоя), поэтому ждём
// именно слой, а не появление строк: иначе проверка застаёт старый URL.
const waitLayer = (page, name) =>
  page.waitForFunction(
    (n) => String(new URL(location.href).searchParams.get('modal') ?? '').split(',').at(-1) === n,
    name,
    { timeout: 15000 },
  )

// Верхний слой: подпись диалога вида «user.sessions.journal (2 из 2)».
const topLabel = (page) =>
  page.locator('[role=dialog]').last().getAttribute('aria-label').then((v) => String(v ?? ''))

async function run() {
  if (!process.env.MODALS_ADMIN_SECRET) throw new Error('sessions-journal требует MODALS_ADMIN_SECRET')
  const browser = await chromium.launch({ headless: true })
  const out = []
  try {
    const admin = await loginNoJs(browser, process.env.MODALS_ADMIN_SECRET)
    const plain = await registerNoJs(browser, `journal-plain-${Date.now()}`)

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addCookies(admin)
    const page = await ctx.newPage()

    // Свой uid — из ссылки профиля в меню.
    await page.goto(`${BASE}/user/menu`, { waitUntil: 'networkidle' })
    const profileHref = await page.getByRole('link', { name: 'Профиль', exact: true }).getAttribute('href')
    const uid = String(profileHref).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0]
    assert.ok(uid, 'uid администратора из меню')

    // ── 1. Меню: журнал — слоем поверх меню ───────────────────────────────
    await page.goto(`${BASE}/user/menu?modal=user.menu`, { waitUntil: 'networkidle' })
    // `/user/menu` рисует тело меню и на странице, и в слое: вход берём в слое.
    const menuEntry = page.locator('[role=dialog] [data-testid=menu-journal-open]')
    await menuEntry.waitFor({ state: 'visible', timeout: 15000 })
    out.push(`меню: href входа = ${await menuEntry.getAttribute('href')}`)
    assert.equal(await menuEntry.getAttribute('href'), '/sessions', 'fallback-адрес входа в журнал')
    await menuEntry.click()
    await waitLayer(page, 'user.sessions.journal')
    await page.locator('[data-testid=session-row]').first().waitFor({ state: 'visible', timeout: 20000 })
    let chain = chainOf(page.url())
    out.push(`меню → журнал: ${chain.join(' > ')}`)
    assert.deepEqual(chain, ['user.menu', 'user.sessions.journal'], 'журнал открылся слоем поверх меню')
    // Меню — поповер: открывая слой, оно само закрывается (это его порядок),
    // но стопка в адресе цела — назад возвращает именно в меню.
    assert.match(await topLabel(page), /user\.sessions\.journal \(2 из 2\)/, 'журнал — второй слой')

    // ── 2. Внутри журнала: «Свои устройства» — слоем, а не переходом ───────
    const back = page.locator('[data-testid=sessions-own-open]')
    await back.waitFor({ state: 'visible', timeout: 15000 })
    out.push(`журнал: href возврата = ${await back.getAttribute('href')}`)
    assert.equal(await back.getAttribute('href'), '/user/sessions', 'fallback-адрес возврата')
    await back.click()
    await waitLayer(page, 'user.sessions')
    chain = chainOf(page.url())
    out.push(`журнал → свои: ${chain.join(' > ')}`)
    assert.deepEqual(chain, ['user.menu', 'user.sessions.journal', 'user.sessions'], 'свои — слоем поверх журнала')

    // Назад — по стопке, а не «заново открыть»: слои восстанавливаются.
    await page.goBack()
    await page.locator('[data-testid=sessions-own-open]').waitFor({ state: 'visible', timeout: 15000 })
    assert.deepEqual(chainOf(page.url()), ['user.menu', 'user.sessions.journal'], 'журнал восстановлен')
    await page.goBack()
    await page.locator('[role=dialog] [data-testid=menu-journal-open]').waitFor({ state: 'visible', timeout: 15000 })
    assert.deepEqual(chainOf(page.url()), ['user.menu'], 'слой меню восстановлен')
    out.push('назад по стопке: меню ← журнал ← свои — слои восстанавливаются')

    // ── 3. Свой список: журнал слоем, адрес страницы не меняется ───────────
    await page.goto(`${BASE}/user/sessions`, { waitUntil: 'networkidle' })
    const listEntry = page.locator('[data-testid=sessions-journal-open]')
    await listEntry.waitFor({ state: 'visible', timeout: 15000 })
    await listEntry.click()
    await waitLayer(page, 'user.sessions.journal')
    await page.locator('[data-testid=session-row]').first().waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(new URL(page.url()).pathname, '/user/sessions', 'адрес страницы не сменился')
    out.push(`свой список → журнал: ${chainOf(page.url()).join(' > ')}`)
    assert.equal(chainOf(page.url()).at(-1), 'user.sessions.journal', 'журнал — слой, а не переход')

    // ── 4. Профиль: журнал слоем поверх профиля ────────────────────────────
    await page.goto(`${BASE}/user/${uid}?modal=user.profile&modal.0.id=${uid}`, { waitUntil: 'networkidle' })
    // Страница `/user/<id>` тоже рисует профиль: вход берём в слое модалки.
    const profileEntry = page.locator('[role=dialog] [data-testid=profile-journal-open]')
    await profileEntry.waitFor({ state: 'visible', timeout: 15000 })
    await profileEntry.click()
    await waitLayer(page, 'user.sessions.journal')
    await page.locator('[data-testid=session-row]').first().waitFor({ state: 'visible', timeout: 20000 })
    chain = chainOf(page.url())
    out.push(`профиль → журнал: ${chain.join(' > ')}`)
    assert.deepEqual(chain, ['user.profile', 'user.sessions.journal'], 'журнал — слоем поверх профиля')
    // Хост рисует диалогом только верхний слой, поэтому «жив ли previous»
    // проверяем счётчиком в подписи слоя: «(2 из 2)» — стек не оборван.
    assert.match(await topLabel(page), /user\.sessions\.journal \(2 из 2\)/, 'стопка профиль → журнал цела')

    // ── 5. Список аккаунтов: журнал слоем ──────────────────────────────────
    await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' })
    const seedEntry = page.locator('[data-testid=seed-users-sessions-open]')
    await seedEntry.waitFor({ state: 'visible', timeout: 15000 })
    await seedEntry.click()
    await waitLayer(page, 'user.sessions.journal')
    await page.locator('[data-testid=session-row]').first().waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(new URL(page.url()).pathname, '/users', 'список аккаунтов остался на месте')
    out.push(`аккаунты → журнал: ${chainOf(page.url()).join(' > ')}`)
    assert.equal(chainOf(page.url()).at(-1), 'user.sessions.journal', 'журнал — слой над списком аккаунтов')
    await ctx.close()

    // ── 6. Без права на чужие устройства входов нет вовсе ──────────────────
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx2.addCookies(plain)
    const p2 = await ctx2.newPage()
    await p2.goto(`${BASE}/user/menu?modal=user.menu`, { waitUntil: 'networkidle' })
    await p2.locator('[role=dialog] [data-testid=menu-sessions-open]').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(
      await p2.locator('[role=dialog] [data-testid=menu-journal-open]').count(),
      0,
      'в меню входа в журнал нет',
    )
    await p2.goto(`${BASE}/user/sessions`, { waitUntil: 'networkidle' })
    await p2.locator('[data-testid=session-row]').first().waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(
      await p2.locator('[data-testid=sessions-journal-open]').count(),
      0,
      'в своём списке входа в журнал нет',
    )
    out.push('без права на чужие устройства: входов в журнал нет (меню и список)')
    await ctx2.close()

    console.log(out.map((l) => '  · ' + l).join('\n'))
    console.log('\nжурнал — самостоятельная единица: входы слоем, стопка цела')
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
