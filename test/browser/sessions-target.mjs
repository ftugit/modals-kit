/**
 * Сессии чужого аккаунта: цель не теряется ни в одном звене.
 *   • профиль → «Сессии» — модалкой поверх профиля, а не страницей;
 *   • строка чужого списка ведёт на `/user/<uid>/sessions/<id>`, а не на свой путь;
 *   • карточка помнит `uid`: возврат — в список того же аккаунта;
 *   • фильтры несут `uid`: срез стран и прав берётся по целевому аккаунту, а не
 *     по адресу страницы-носителя (`from` в модалке — это адрес носителя);
 *   • устройство чужого аккаунта под чужим адресом — отказ, а не карточка;
 *   • страницы-фолбэк карточек (своей и чужой) открываются без JS.
 *
 * Зритель — администратор: у свежего аккаунта нет прав читать чужие устройства.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Регистрация без JS: надёжнее HoldButton и не зависит от клиента.
async function makeAccount(browser, suffix) {
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
  await page.locator('input[name=nickname]').fill(`tgt-${suffix}`)
  await page.locator('#user-profile').getByRole('button', { name: 'Сохранить' }).click()
  await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
  const cookies = await ctx.cookies(BASE)
  await ctx.close()
  return cookies
}

// Вход администратора по ключу (`ADMIN_SEED`): у свежего аккаунта нет прав
// читать чужие устройства, а сценарий — именно про чужой аккаунт.
async function adminCookies(browser, seed) {
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/user/auth`, { waitUntil: 'load' })
  await page.fill('input[name=seed]', seed)
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }).click(),
  ])
  if (res.status() !== 303) {
    throw new Error(`вход администратора: HTTP ${res.status()}`)
  }
  await page.locator('[data-testid=header-user],#user-profile').first().waitFor({ state: 'visible', timeout: 15000 })
  const cookies = await ctx.cookies(BASE)
  await ctx.close()
  return cookies
}

async function uidOf(browser, cookies) {
  const ctx = await browser.newContext()
  await ctx.addCookies(cookies)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/user/menu`, { waitUntil: 'networkidle' })
  const href = await page.getByRole('link', { name: 'Профиль', exact: true }).getAttribute('href')
  await ctx.close()
  return String(href).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0] ?? ''
}

async function run() {
  if (!process.env.MODALS_ADMIN_SECRET) throw new Error('sessions-target требует MODALS_ADMIN_SECRET')
  const browser = await chromium.launch({ headless: true })
  const out = []
  try {
    const a = await adminCookies(browser, String(process.env.MODALS_ADMIN_SECRET ?? ''))
    const b = await makeAccount(browser, `b-${Date.now()}`)
    const uidA = await uidOf(browser, a)
    const uidB = await uidOf(browser, b)
    assert.ok(uidA && uidB && uidA !== uidB, `два аккаунта: ${uidA} / ${uidB}`)

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addCookies(a)
    const page = await ctx.newPage()
    const requests = []
    page.on('request', (r) => {
      if (r.url().includes('/sessions')) requests.push(r.url().replace(BASE, ''))
    })

    // ── 1. Свои устройства: карточка строки без цели ───────────────────────
    await page.goto(`${BASE}/user/sessions`, { waitUntil: 'networkidle' })
    const ownRow = page.locator('[data-testid=session-row]').first()
    await ownRow.waitFor({ state: 'visible', timeout: 15000 })
    const ownHref = await ownRow.evaluate((el) => el.getAttribute('href'))
    out.push(`свои: href строки = ${ownHref}`)
    assert.match(String(ownHref), /^\/user\/sessions\/[0-9a-f-]{36}$/, 'своя строка — свой путь')

    // ── 2. Чужой аккаунт: модалка сессий из профиля ────────────────────────
    await page.goto(`${BASE}/user/${uidB}?modal=user.profile&modal.0.id=${uidB}`, {
      waitUntil: 'networkidle',
    })
    const sessionsBtn = page.getByRole('link', { name: 'Сессии', exact: true }).first()
    await sessionsBtn.waitFor({ state: 'visible', timeout: 15000 })
    const sessionsHref = await sessionsBtn.getAttribute('href')
    out.push(`чужой профиль: «Сессии» href = ${sessionsHref}`)
    assert.equal(sessionsHref, `/user/${uidB}/sessions`, 'fallback-адрес кнопки «Сессии»')
    await sessionsBtn.click()
    await page
      .locator('[data-testid=session-row]')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
    const url = new URL(page.url())
    const chain = String(url.searchParams.get('modal')).split(',')
    out.push(`модалка: ${url.pathname}?${url.searchParams}`)
    // Стопка сохраняется: профиль остался под списком (до правки уходили
    // страницей и теряли её).
    assert.deepEqual(chain, ['user.profile', 'user.sessions'], 'модалка поверх профиля, а не страница')
    assert.equal(url.searchParams.get(`modal.${chain.length - 1}.id`), uidB, 'цель модалки — чужой аккаунт')

    // ── 3. Строка чужого списка: адрес карточки с целью ────────────────────
    const row = page.locator('[data-testid=session-row]').first()
    const foreignHref = await row.evaluate((el) => el.getAttribute('href'))
    const sid = String(foreignHref).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/g)?.pop() ?? ''
    out.push(`чужой список: href строки = ${foreignHref}`)
    assert.equal(foreignHref, `/user/${uidB}/sessions/${sid}`, 'строка чужого списка несёт цель')

    // ── 4. Карточка: модалка с uid, возврат — в список того же аккаунта ────
    await row.click()
    await page.locator('text=Устройство').first().waitFor({ state: 'visible', timeout: 15000 })
    const cardUrl = new URL(page.url())
    const cardChain = String(cardUrl.searchParams.get('modal')).split(',')
    out.push(`карточка: ${cardUrl.searchParams}`)
    assert.equal(cardChain.at(-1), 'user.session', 'карточка — модалка поверх списка')
    assert.equal(
      cardUrl.searchParams.get(`modal.${cardChain.length - 1}.uid`),
      uidB,
      'карточка помнит цель',
    )
    const backHref = await page
      .locator('a[href="/user/' + uidB + '/sessions"]')
      .first()
      .getAttribute('href')
      .catch(() => null)
    out.push(`карточка: возврат = ${backHref}`)
    assert.equal(backHref, `/user/${uidB}/sessions`, 'возврат из карточки — в список аккаунта')

    // ── 5. Фильтры чужого списка: запрос данных с uid ──────────────────────
    await page.goBack()
    await page.locator('[data-testid=sessions-filters-open]').first().waitFor({ state: 'visible', timeout: 15000 })
    const filtersHref = await page.locator('[data-testid=sessions-filters-open]').first().getAttribute('href')
    out.push(`фильтры: href кнопки = ${String(filtersHref).replace(BASE, '')}`)
    assert.match(String(filtersHref), /uid=/, 'fallback-адрес фильтров несёт uid')
    requests.length = 0
    await page.locator('[data-testid=sessions-filters-open]').first().click()
    await sleep(1200)
    const filtersUrl = new URL(page.url())
    const filterChain = String(filtersUrl.searchParams.get('modal')).split(',')
    assert.equal(filterChain.at(-1), 'user.sessions.filters', 'фильтры — модалка')
    assert.equal(
      filtersUrl.searchParams.get(`modal.${filterChain.length - 1}.uid`),
      uidB,
      'фильтры помнят цель',
    )
    out.push(`фильтры: модалка ${filterChain.join(' > ')}`)
    const filterReq = requests.find((u) => u.includes('/user/sessions/filters'))
    out.push(`фильтры: запрос данных = ${filterReq ?? '(нет)'}`)
    assert.ok(filterReq && filterReq.includes(`uid=${uidB}`), 'срез фильтров — по uid аккаунта')

    // ── 6. Чужое устройство под чужим адресом: отказ ───────────────────────
    await page.goto(`${BASE}/user/${uidB}/sessions/${ownHref.split('/').pop()}`, {
      waitUntil: 'networkidle',
    })
    const body = await page.locator('body').innerText()
    out.push(`подмена адреса: ${body.replace(/\s+/g, ' ').slice(0, 80)}`)
    // `auth.session-unknown` — тот же код, что у «устройства нет»: экран
    // стандартный (`Acl`), своего текста под этот случай не заводим.
    assert.match(body, /Сессия завершена|не найден/, 'чужое устройство под чужим адресом — отказ')
    assert.ok(!body.includes('Название устройства'), 'карточка при подмене адреса не открывается')

    // ── 7. Страница-фолбэк карточки чужого устройства ──────────────────────
    await page.goto(`${BASE}/user/${uidB}/sessions/${sid}`, { waitUntil: 'networkidle' })
    const page2 = await page.locator('body').innerText()
    out.push(`фолбэк: ${page2.replace(/\s+/g, ' ').slice(0, 90)}`)
    assert.ok(page2.includes('Название устройства'), 'карточка устройства открылась страницей')
    const listLink = await page.locator(`a[href="/user/${uidB}/sessions"]`).count()
    assert.ok(listLink > 0, 'со страницы карточки есть возврат в список аккаунта')

    // ── 8. Своя карточка страницей: без цели, возврат в свой список ─────────
    await page.goto(`${BASE}${ownHref}`, { waitUntil: 'networkidle' })
    const ownCard = await page.locator('body').innerText()
    out.push(`своя карточка: ${ownCard.replace(/\s+/g, ' ').slice(0, 60)}`)
    assert.ok(ownCard.includes('Название устройства'), 'своя карточка открылась страницей')
    assert.ok((await page.locator('a[href="/user/sessions"]').count()) > 0, 'возврат — в свой список')

    await ctx.close()
    console.log(out.map((l) => '  · ' + l).join('\n'))
    console.log('\nцель аккаунта: карточка строки, возврат и фильтры — ОК')
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
