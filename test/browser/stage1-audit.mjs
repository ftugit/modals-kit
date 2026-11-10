/**
 * Браузер-тесты аудита Этапа 1 (п. 6.3 плана c886da4..d099248):
 *
 * Сценарии с JS:
 *   1. `/blocks` → «Фильтры» → `user.picker` (в URL нет `user.picker` и его пагинатора) →
 *      подтверждение `u1,u2` (в URL `modal.0.uids=u1,u2`) → «Применить» фильтра (`/blocks?blocks.uids=u1,u2`, выживает после F5).
 *   2. `/?modal=user.blocks` → «Фильтры» → `user.picker` → подтверждение → «Применить»
 *      (`/?modal=user.blocks&m0.blocks.uids=u1,u2` или эквивалентный порядок query, выживает после F5 без мигания;
 *      закрытие `user.blocks` оставляет чистый `/`).
 *   3. `/?modal=user.blocks.create` + ввод `reason` → `user.picker` → выбор `u1,u2` →
 *      в URL `/?modal=user.blocks.create&modal.0.uids=u1,u2`, поле `reason` цело, F5 сохраняет `u1,u2`.
 *   4. `/blocks/new` + ввод `reason` → `user.picker` → выбор `u1,u2` →
 *      в URL `/blocks/new?uids=u1,u2`, поле `reason` цело, F5 сохраняет `u1,u2`.
 *   5. Независимая работа `/users?users.q=...` и открытой поверх модалки `user.list` (`m0.users.q=...`).
 *
 * Сценарии без JS (`javaScriptEnabled: false`, N1–N7):
 *   1. `/users` → `/users/filters` → `users.size=50` → «Применить» (`/users?users.size=50`) →
 *      `/users/filters` → `users.size=40` и «Сбросить» (`N1`).
 *   2. `/blocks/new` → `/users/pick` → `/users/filters` → «Применить» → сохранение `from=/blocks/new` →
 *      выбор `u1,u2` → вкладка «Выбранные» и обратно «Выбор пользователей» (`N2`, `N3`) →
 *      «Применить» → `/blocks/new?uids=u1,u2` → повторный пикер и снятие `u1` → `/blocks/new?uids=u2` (`N5`).
 *   3. `/blocks/new?uids=u1,u2` без JS: снятие галочки «Бессрочно», заполнение видимого `until` и `reason`,
 *      отправка через `HoldButton` одним кликом без `aria-disabled` (`N5`, `N6`).
 *   4. `/blocks` → «Фильтры» → выбор `u1` в `/users/pick` → кнопка «Сбросить пользователей» без JS и
 *      снятие всех пользователей через `/users/pick` без воскрешения `u1` (`N4`).
 *   5. `/storage-servers` без JS: создание слота, клик по ссылке «Изменить» (`?edit=<id>`),
 *      обновление приоритета/квоты и удаление (`N7`).
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const PORT = Number(process.env.MODALS_PORT ?? 5173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`
const ADMIN_SECRET = process.env.MODALS_ADMIN_SECRET ?? ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let passed = 0
const ok = (name) => {
  passed++
  console.log('  ok  ' + name)
}

async function waitPreview() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + '/user/auth')).ok) return
    } catch {}
    await sleep(500)
  }
  throw new Error(`сервер не отвечает: ${BASE}`)
}

/** Локальный in-memory WebDAV-стенд для проверки `/storage-servers` (`probeStorageVaultEntry`). */
async function startMockWebdav() {
  const files = new Map()
  const dirs = new Set(['/', '/pool'])

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/'
    const method = (req.method ?? 'GET').toUpperCase()

    if (method === 'MKCOL') {
      dirs.add(pathname)
      res.writeHead(201).end()
      return
    }
    if (method === 'PROPFIND') {
      if (dirs.has(pathname) || files.has(pathname)) {
        const file = files.get(pathname)
        const props = file
          ? `<d:resourcetype/><d:getcontentlength>${file.length}</d:getcontentlength><d:getcontenttype>application/octet-stream</d:getcontenttype>`
          : '<d:resourcetype><d:collection/></d:resourcetype>'
        const href = pathname.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' })
        res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop>${props}</d:prop></d:propstat></d:response></d:multistatus>`)
      } else {
        res.writeHead(404).end()
      }
      return
    }
    if (method === 'PUT') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      files.set(pathname, Buffer.concat(chunks))
      res.writeHead(201).end()
      return
    }
    if (method === 'HEAD') {
      const buf = files.get(pathname)
      if (!buf) {
        if (dirs.has(pathname)) {
          res.writeHead(200, { 'accept-ranges': 'bytes' }).end()
          return
        }
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, {
        'content-length': String(buf.length),
        'content-type': 'application/octet-stream',
        'accept-ranges': 'bytes',
      }).end()
      return
    }
    if (method === 'GET') {
      const buf = files.get(pathname)
      if (!buf) {
        res.writeHead(404).end()
        return
      }
      const range = req.headers.range
      const m = range && /^bytes=(\d+)-(\d*)$/.exec(range)
      if (m) {
        const start = Number(m[1])
        const end = m[2] ? Math.min(buf.length - 1, Number(m[2])) : buf.length - 1
        const slice = buf.subarray(start, end + 1)
        res.writeHead(206, {
          'content-length': String(slice.length),
          'content-range': `bytes ${start}-${end}/${buf.length}`,
          'accept-ranges': 'bytes',
        })
        res.end(slice)
        return
      }
      res.writeHead(200, { 'content-length': String(buf.length) })
      res.end(buf)
      return
    }
    if (method === 'DELETE') {
      files.delete(pathname)
      res.writeHead(204).end()
      return
    }
    res.writeHead(405).end()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  return {
    port: typeof addr === 'object' && addr ? addr.port : 0,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

async function createGuestUser(browser, nickname) {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  try {
    await page.goto(BASE + '/user/auth?stage=register', { waitUntil: 'load' })
    await page.locator('#user-auth').getByRole('button', { name: 'Создать аккаунт' }).click()
    await page.waitForURL(/stage=(auth\.)?profile/, { timeout: 15000 })
    await page.fill('input[name=nickname]', nickname)
    await page.locator('#user-profile').getByRole('button', { name: 'Сохранить' }).click()
    await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
  } finally {
    await ctx.close()
  }
}

async function run() {
  if (!ADMIN_SECRET) {
    throw new Error('stage1-audit требует MODALS_ADMIN_SECRET (запускайте через test/browser/run-all.mjs)')
  }
  await waitPreview()
  const dav = await startMockWebdav()
  const browser = await chromium.launch({ headless: true })
  const tag = Date.now().toString(36)
  const nickAlice = `s1-alice-${tag}`
  const nickBob = `s1-bob-${tag}`

  let debugPage = null
  try {
    // Создаём двух изолированных пользователей специально для сценариев Stage 1
    await createGuestUser(browser, nickAlice)
    await createGuestUser(browser, nickBob)

    let adminCookies = []
    let u1 = ''
    let u2 = ''

    console.log('— с JS: матрица сценариев 1–5 (п. 6.3) —')
    {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } })
      const page = await ctx.newPage()
      debugPage = page
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      await page.fill('input[name=seed]', ADMIN_SECRET)
      await page.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.locator('[data-testid="header-user"], #user-profile').first().waitFor({ state: 'visible', timeout: 15000 })
      adminCookies = await ctx.cookies(BASE)

      // Находим двух изолированных не-admin пользователей на /users (первые две свежие строки в desc-сортировке)
      await page.goto(BASE + '/users', { waitUntil: 'networkidle' })
      const nonAdminRows = page.locator('[data-testid="seed-user-row"]').filter({ hasNotText: 'admin' })
      await nonAdminRows.nth(1).waitFor({ state: 'visible', timeout: 10000 })
      u1 = (await nonAdminRows.nth(0).getAttribute('data-id')) ?? ''
      u2 = (await nonAdminRows.nth(1).getAttribute('data-id')) ?? ''
      const seed1 = ((await nonAdminRows.nth(0).locator('[data-testid="seed-user-cell"]').first().textContent()) ?? '').trim()
      const seed2 = ((await nonAdminRows.nth(1).locator('[data-testid="seed-user-cell"]').first().textContent()) ?? '').trim()
      assert.ok(u1 && u2 && u1 !== u2, 'UUID тестовых пользователей получены')
      assert.ok(seed1 && seed2 && seed1 !== seed2, 'seed тестовых пользователей получены')

      const rowById = (root, id) => root.locator(`[data-testid="seed-user-row"][data-id="${id}"]`)

      // JS-1: /blocks → «Фильтры» → user.picker (memory: нет в URL) → u1,u2 (modal.0.uids=u1,u2) → «Применить» → F5
      await page.goto(BASE + '/blocks', { waitUntil: 'networkidle' })
      await page.locator('[data-testid="blocks-filters-open"]').first().click()
      const filtersModal = page.locator('[data-testid="blocks-filters-form"]').last()
      await filtersModal.waitFor({ state: 'visible', timeout: 10000 })
      await filtersModal.locator('[data-testid="blocks-filters-pick-users"]').click()

      const picker1 = page.locator('[data-testid="user-picker"]').last()
      await picker1.waitFor({ state: 'visible', timeout: 10000 })
      assert.doesNotMatch(page.url(), /user\.picker/, 'memory-модалка user.picker не попадает в URL')
      await picker1.locator('input[type="search"]').first().fill(u1.slice(0, 8))
      await sleep(350)
      assert.doesNotMatch(page.url(), /users\.q=/, 'поиск внутри user.picker не утекает в URL страницы')
      await picker1.locator('input[type="search"]').first().fill('')
      await rowById(picker1, u1).waitFor({ state: 'visible', timeout: 10000 })
      await rowById(picker1, u2).waitFor({ state: 'visible', timeout: 10000 })
      await rowById(picker1, u1).click()
      await rowById(picker1, u2).click()
      await picker1.locator('[data-testid="user-picker-apply"]').click()
      await picker1.waitFor({ state: 'hidden', timeout: 10000 })

      await page.waitForFunction(
        ([a, b]) => new URL(location.href).searchParams.get('modal.0.uids') === `${a},${b}`,
        [u1, u2],
        { timeout: 10000 },
      )
      await filtersModal.locator('[data-testid="blocks-filters-apply"]').click()
      await filtersModal.waitFor({ state: 'hidden', timeout: 10000 })
      await page.waitForFunction(
        ([a, b]) => new URL(location.href).searchParams.get('blocks.uids') === `${a},${b}`,
        [u1, u2],
        { timeout: 10000 },
      )
      await page.reload({ waitUntil: 'networkidle' })
      assert.equal(new URL(page.url()).searchParams.get('blocks.uids'), `${u1},${u2}`, 'фильтр blocks.uids выживает после F5')
      ok('JS-1: /blocks → Фильтры → user.picker (без утечки в URL) → modal.0.uids → blocks.uids + F5')

      // JS-2: /?modal=user.blocks → Фильтры → user.picker → Применить → m0.blocks.uids=u1,u2 → F5 → закрытие очищает /
      await page.goto(BASE + '/?modal=user.blocks', { waitUntil: 'networkidle' })
      const modalBlocksList = page.locator('[data-testid="blocks-list"]').last()
      await modalBlocksList.waitFor({ state: 'visible', timeout: 10000 })
      await modalBlocksList.locator('[data-testid="blocks-filters-open"]').click()
      const modalBlocksFilters = page.locator('[data-testid="blocks-filters-form"]').last()
      await modalBlocksFilters.waitFor({ state: 'visible', timeout: 10000 })
      await modalBlocksFilters.locator('[data-testid="blocks-filters-pick-users"]').click()

      const picker2 = page.locator('[data-testid="user-picker"]').last()
      await picker2.waitFor({ state: 'visible', timeout: 10000 })
      await rowById(picker2, u1).click()
      await rowById(picker2, u2).click()
      await picker2.locator('[data-testid="user-picker-apply"]').click()
      await picker2.waitFor({ state: 'hidden', timeout: 10000 })

      await modalBlocksFilters.locator('[data-testid="blocks-filters-apply"]').click()
      await modalBlocksFilters.waitFor({ state: 'hidden', timeout: 10000 })
      await page.waitForFunction(
        ([a, b]) => {
          const sp = new URL(location.href).searchParams
          return sp.get('modal') === 'user.blocks' && sp.get('m0.blocks.uids') === `${a},${b}`
        },
        [u1, u2],
        { timeout: 10000 },
      )

      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('[data-testid="blocks-list"]').last().waitFor({ state: 'visible', timeout: 10000 })
      assert.equal(new URL(page.url()).searchParams.get('m0.blocks.uids'), `${u1},${u2}`, 'm0.blocks.uids выживает после F5')

      await page.keyboard.press('Escape')
      await page.waitForFunction(() => location.pathname === '/' && location.search === '', null, { timeout: 10000 })
      ok('JS-2: /?modal=user.blocks → m0.blocks.uids=u1,u2 + F5 + чистый / после закрытия')

      // JS-3: /?modal=user.blocks.create + ввод reason → user.picker → u1,u2 → modal.0.uids=u1,u2, reason цело, F5 сохраняет u1,u2
      const draftModalReason = `Черновик модалки ${tag}`
      await page.goto(BASE + '/?modal=user.blocks.create', { waitUntil: 'networkidle' })
      const createInModal = page.locator('[data-testid="block-form-create"]').last()
      await createInModal.waitFor({ state: 'visible', timeout: 10000 })
      await createInModal.locator('textarea[name="reason"]').fill(draftModalReason)
      await createInModal.locator('[data-testid="block-create-pick-user"]').click()

      const picker3 = page.locator('[data-testid="user-picker"]').last()
      await picker3.waitFor({ state: 'visible', timeout: 10000 })
      await rowById(picker3, u1).click()
      await rowById(picker3, u2).click()
      await picker3.locator('[data-testid="user-picker-apply"]').click()
      await picker3.waitFor({ state: 'hidden', timeout: 10000 })

      await page.waitForFunction(
        ([a, b]) => new URL(location.href).searchParams.get('modal.0.uids') === `${a},${b}`,
        [u1, u2],
        { timeout: 10000 },
      )
      assert.equal(
        await createInModal.locator('textarea[name="reason"]').inputValue(),
        draftModalReason,
        'введённый reason не сбросился при синхронизации modal.0.uids',
      )

      await page.reload({ waitUntil: 'networkidle' })
      const createAfterReload = page.locator('[data-testid="block-form-create"]').last()
      await createAfterReload.waitFor({ state: 'visible', timeout: 10000 })
      const reloadedModalSubjects = await createAfterReload
        .locator('select[name="subjects"] option:checked')
        .evaluateAll((els) => els.map((el) => el.value))
      assert.deepEqual(reloadedModalSubjects, [u1, u2], 'выбранные u1,u2 пережили F5 в модалке user.blocks.create')
      ok('JS-3: /?modal=user.blocks.create сохраняет черновик reason и синхронизирует modal.0.uids через F5')

      // JS-4: /blocks/new + ввод reason → user.picker → u1,u2 → /blocks/new?uids=u1,u2, reason цело, F5 сохраняет u1,u2
      const draftPageReason = `Черновик страницы ${tag}`
      await page.goto(BASE + '/blocks/new', { waitUntil: 'networkidle' })
      const createOnPage = page.locator('[data-testid="block-form-create"]').first()
      await createOnPage.waitFor({ state: 'visible', timeout: 10000 })
      await createOnPage.locator('textarea[name="reason"]').fill(draftPageReason)
      await createOnPage.locator('[data-testid="block-create-pick-user"]').click()

      const picker4 = page.locator('[data-testid="user-picker"]').last()
      await picker4.waitFor({ state: 'visible', timeout: 10000 })
      await rowById(picker4, u1).click()
      await rowById(picker4, u2).click()
      await picker4.locator('[data-testid="user-picker-apply"]').click()
      await picker4.waitFor({ state: 'hidden', timeout: 10000 })

      await page.waitForFunction(
        ([a, b]) => location.pathname === '/blocks/new' && new URL(location.href).searchParams.get('uids') === `${a},${b}`,
        [u1, u2],
        { timeout: 10000 },
      )
      assert.equal(
        await createOnPage.locator('textarea[name="reason"]').inputValue(),
        draftPageReason,
        'введённый reason на /blocks/new сохранился без серверного reload',
      )

      await page.reload({ waitUntil: 'networkidle' })
      const pageAfterReload = page.locator('[data-testid="block-form-create"]').first()
      await pageAfterReload.waitFor({ state: 'visible', timeout: 10000 })
      const reloadedPageSubjects = await pageAfterReload
        .locator('select[name="subjects"] option:checked')
        .evaluateAll((els) => els.map((el) => el.value))
      assert.deepEqual(reloadedPageSubjects, [u1, u2], 'выбранные u1,u2 пережили F5 на /blocks/new?uids=…')
      ok('JS-4: /blocks/new сохраняет черновик reason и синхронизирует ?uids=u1,u2 через F5')

      // JS-5: независимость /users?users.q=<seed1> и открытой поверх модалки user.list (m0.users.q=<seed2>)
      await page.goto(
        `${BASE}/users?users.q=${encodeURIComponent(seed1)}&modal=user.list`,
        { waitUntil: 'networkidle' },
      )
      const pageMain = page.locator('main')
      const modalDialog = page.locator('[data-modal-layer][data-active="true"]').last()
      await modalDialog.waitFor({ state: 'visible', timeout: 10000 })

      const modalSearch = modalDialog.locator('input[type="search"]').first()
      await modalSearch.fill(seed2)
      await page.waitForFunction(
        ([a, b]) => {
          const sp = new URL(location.href).searchParams
          return sp.get('users.q') === a && sp.get('m0.users.q') === b
        },
        [seed1, seed2],
        { timeout: 10000 },
      )
      await rowById(modalDialog, u2).waitFor({ state: 'visible', timeout: 10000 })
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-modal-layer][data-active="true"] [data-testid="seed-user-row"][data-id="${id}"]`),
        u1,
        { timeout: 10000 },
      )
      assert.equal(await rowById(pageMain, u1).count(), 1, 'фоновая страница /users сохранила собственный срез users.q=seed1')
      assert.equal(await rowById(pageMain, u2).count(), 0, 'поиск модалки не перетёр фоновую страницу /users')
      ok('JS-5: изолированная работа /users?users.q=seed1 и модалки user.list с m0.users.q=seed2')

      await ctx.close()
    }

    console.log('— без JS (javaScriptEnabled: false): матрица N1–N7 (п. 6.3) —')
    {
      const ctx = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 900, height: 900 },
      })
      await ctx.addCookies(adminCookies)
      const page = await ctx.newPage()
      debugPage = page

      // NoJS-1 (N1): /users → Фильтры → users.size=50 → Применить → Фильтры (предвыбрано 50) → Сбросить
      await page.goto(BASE + '/users', { waitUntil: 'load' })
      await page.locator('[data-testid="seed-users-filters-open"]').click()
      await page.waitForURL((u) => u.pathname === '/users/filters', { timeout: 10000 })
      await page.locator('input[name="size"]').fill('50')
      await page.getByRole('button', { name: 'Применить' }).click()
      await page.waitForURL((u) => u.pathname === '/users' && u.searchParams.get('users.size') === '50', {
        timeout: 10000,
      })
      await page.locator('[data-testid="seed-users-filters-open"]').click()
      await page.waitForURL((u) => u.pathname === '/users/filters', { timeout: 10000 })
      assert.equal(await page.locator('input[name="size"]').inputValue(), '50', 'users.size=50 сохранён в FILTER_KEYS')
      await page.locator('input[name="size"]').fill('40')
      await page.getByRole('link', { name: 'Сбросить' }).click()
      await page.waitForURL((u) => u.pathname === '/users' && !u.searchParams.has('users.size'), {
        timeout: 10000,
      })
      ok('NoJS-1 (N1): users.size сохраняется через /users/filters и очищается по «Сбросить»')

      const rowById = (id) => page.locator(`[data-testid="seed-user-row"][data-id="${id}"]`)

      // NoJS-2 (N2, N3, N5): /blocks/new → /users/pick → /users/filters (сохранение from=/blocks/new) →
      // выбор u1,u2 → вкладка «Выбранные (2)» и обратно «Выбор пользователей» → Применить → /blocks/new?uids=u1,u2 → снятие u1 → ?uids=u2
      await page.goto(BASE + '/blocks/new', { waitUntil: 'load' })
      await page.locator('[data-testid="block-create-pick-user"]').click()
      await page.waitForURL((u) => u.pathname === '/users/pick', { timeout: 10000 })
      await page.locator('[data-testid="seed-users-filters-open"]').click()
      await page.waitForURL((u) => u.pathname === '/users/filters', { timeout: 10000 })
      await page.locator('select[name="ord"]').selectOption('created-desc')
      await page.getByRole('button', { name: 'Применить' }).click()
      await page.waitForURL(
        (u) => u.pathname === '/users/pick' && u.searchParams.get('from') === '/blocks/new',
        { timeout: 10000 },
      )

      await rowById(u1).click()
      await page.waitForURL((u) => u.searchParams.get('picked') === u1, { timeout: 10000 })
      await rowById(u2).click()
      await page.waitForURL((u) => u.searchParams.get('picked') === `${u1},${u2}`, { timeout: 10000 })

      // Верхняя ссылка шага «Выбранные (2)» и обратно «Выбор пользователей» (N3)
      await page.locator('nav').getByRole('link', { name: 'Выбранные (2)' }).click()
      await page.waitForURL((u) => u.searchParams.get('upicks') === 'chosen', { timeout: 10000 })
      assert.equal(await page.locator('[data-testid="seed-user-row"]').count(), 2, 'на шаге chosen показаны ровно 2 выбранных')

      await page.locator('nav').getByRole('link', { name: 'Выбор пользователей' }).click()
      await page.waitForURL((u) => u.searchParams.get('upicks') !== 'chosen', { timeout: 10000 })
      assert.ok((await page.locator('[data-testid="seed-user-row"]').count()) >= 3, 'возврат на шаг pick показывает полный список (включая admin)')

      await page.locator('[data-testid="user-picker-apply"]').click()
      await page.waitForURL(
        (u) => u.pathname === '/blocks/new' && u.searchParams.get('uids') === `${u1},${u2}`,
        { timeout: 10000 },
      )

      // Повторный заход в пикер и снятие u1 → остаётся только u2 (без старого ?uids=u1,u2 из from!)
      await page.locator('[data-testid="block-create-pick-user"]').click()
      await page.waitForURL((u) => u.pathname === '/users/pick', { timeout: 10000 })
      await rowById(u1).click()
      await page.waitForURL((u) => u.searchParams.get('picked') === u2, { timeout: 10000 })
      await page.locator('[data-testid="user-picker-apply"]').click()
      await page.waitForURL(
        (u) => u.pathname === '/blocks/new' && u.searchParams.get('uids') === u2,
        { timeout: 10000 },
      )
      ok('NoJS-2 (N2, N3, N5): вложенный from=/blocks/new, вкладки chosen/pick и снятие u1 → /blocks/new?uids=u2')

      // NoJS-3 (N5, N6): /blocks/new?uids=u1,u2 без JS — видимое поле until, снятие forever, клик HoldButton без aria-disabled
      await page.goto(`${BASE}/blocks/new?uids=${encodeURIComponent(`${u1},${u2}`)}`, { waitUntil: 'load' })
      const untilInput = page.locator('input[name="until"]')
      assert.equal(await untilInput.count(), 1, 'поле until отрендерено в SSR HTML для no-JS (N5)')
      const massBtn = page.locator('[data-testid="block-create-submit"]')
      assert.equal(await massBtn.getAttribute('aria-disabled'), null, 'у HoldButton нет SSR aria-disabled="true" (N6)')

      await page.locator('input[name="forever"]').uncheck()
      const futureIso = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16)
      await untilInput.fill(futureIso)
      const rMassNoJs = `Массовый бан без JS ${tag}`
      await page.locator('select[name="scope"]').selectOption('auth')
      await page.locator('textarea[name="reason"]').fill(rMassNoJs)
      await massBtn.click()
      await page.waitForURL((u) => u.pathname === '/blocks', { timeout: 10000 })
      assert.equal(
        await page.locator('[data-testid="block-row"]').filter({ hasText: rMassNoJs }).count(),
        2,
        'HoldButton отправил массовую блокировку одним нативным кликом без JS',
      )
      ok('NoJS-3 (N5, N6): заполнение until без JS и отправка HoldButton одним кликом для N=2')

      // NoJS-4 (N4): /blocks → Фильтры → выбор u1 → снятие через /users/pick И через «Сбросить пользователей»
      await page.goto(BASE + '/blocks', { waitUntil: 'load' })
      await page.locator('[data-testid="blocks-filters-open"]').click()
      await page.waitForURL((u) => u.pathname === '/blocks/filters', { timeout: 10000 })
      await page.locator('[data-testid="blocks-filters-pick-users"]').click()
      await page.waitForURL((u) => u.pathname === '/users/pick', { timeout: 10000 })
      await rowById(u1).click()
      await page.waitForURL((u) => u.searchParams.get('picked') === u1, { timeout: 10000 })
      await page.locator('[data-testid="user-picker-apply"]').click()
      await page.waitForURL(
        (u) => u.pathname === '/blocks/filters' && u.searchParams.get('blocks.uids') === u1,
        { timeout: 10000 },
      )

      // 4а: Снятие всех пользователей через /users/pick не воскрешает u1 из from
      await page.locator('[data-testid="blocks-filters-pick-users"]').click()
      await page.waitForURL((u) => u.pathname === '/users/pick', { timeout: 10000 })
      await rowById(u1).click()
      await page.waitForURL((u) => (u.searchParams.get('picked') ?? '') === '', { timeout: 10000 })
      await page.locator('[data-testid="user-picker-apply"]').click()
      await page.waitForURL((u) => u.pathname === '/blocks/filters', { timeout: 10000 })
      assert.equal(
        await page.locator('[data-testid="blocks-filters-clear-users"]').count(),
        0,
        'снятие всех в /users/pick очистило выбранных пользователей без воскрешения u1',
      )

      // 4б: Повторный выбор u1 и клик «Сбросить пользователей» без JS + Применить → /blocks без blocks.uids
      await page.locator('[data-testid="blocks-filters-pick-users"]').click()
      await page.waitForURL((u) => u.pathname === '/users/pick', { timeout: 10000 })
      await rowById(u1).click()
      await page.waitForURL((u) => u.searchParams.get('picked') === u1, { timeout: 10000 })
      await page.locator('[data-testid="user-picker-apply"]').click()
      await page.waitForURL(
        (u) => u.pathname === '/blocks/filters' && u.searchParams.get('blocks.uids') === u1,
        { timeout: 10000 },
      )
      await page.locator('[data-testid="blocks-filters-clear-users"]').click()
      await page.waitForURL((u) => u.pathname === '/blocks/filters' && u.searchParams.get('blocks.uids') === '', {
        timeout: 10000,
      })
      await page.locator('[data-testid="blocks-filters-apply"]').click()
      await page.waitForURL(
        (u) => u.pathname === '/blocks' && !u.searchParams.get('blocks.uids'),
        { timeout: 10000 },
      )
      ok('NoJS-4 (N4): снятие пользователей через /users/pick и кнопка «Сбросить пользователей» работают без JS')

      // NoJS-5 (N7): /storage-servers без JS — создание слота, клик «Изменить» (?edit=<id>), обновление квоты/приоритета и удаление
      const slotName = `s1_${tag.slice(-5)}`
      const davDsn = `webdav+http://davuser:davpass@127.0.0.1:${dav.port}/pool`
      await page.goto(BASE + '/storage-servers', { waitUntil: 'load' })
      await page.fill('input[name="slot"]', slotName)
      await page.fill('input[name="url"]', davDsn)
      await page.fill('input[name="storage_mb"]', '128')
      await page.fill('input[name="file_mb"]', '32')
      await page.fill('input[name="priority"]', '100')
      await page.locator('[data-testid="storage-server-save"]').click()
      await page.waitForLoadState('load')

      const card = page.locator(`[data-testid="storage-server-card-${slotName}"]`)
      await card.waitFor({ state: 'visible', timeout: 10000 })

      const editLink = page.locator(`[data-testid="storage-server-edit-${slotName}"]`)
      assert.match((await editLink.getAttribute('href')) ?? '', /\?edit=/, 'ссылка «Изменить» содержит ?edit=<id>')
      await editLink.click()
      await page.waitForURL((u) => u.pathname === '/storage-servers' && Boolean(u.searchParams.get('edit')), {
        timeout: 10000,
      })
      assert.equal(await page.locator('input[name="storage_mb"]').inputValue(), '128', 'SSR засеял storage_mb из ?edit=<id>')
      assert.equal(await page.locator('input[name="priority"]').inputValue(), '100', 'SSR засеял priority из ?edit=<id>')

      await page.fill('input[name="url"]', davDsn)
      await page.fill('input[name="storage_mb"]', '256')
      await page.fill('input[name="priority"]', '42')
      await page.locator('[data-testid="storage-server-save"]').click()
      await page.waitForLoadState('load')
      assert.match(await card.textContent(), /42/, 'обновлённый приоритет 42 отображается в карточке')

      await page.locator(`[data-testid="storage-server-delete-${slotName}"]`).click()
      await page.waitForLoadState('load')
      assert.equal(await card.count(), 0, 'слот удалён без JS')
      ok('NoJS-5 (N7): создание, редактирование по ?edit=<id> и удаление сервера хранилища без JS')

      await ctx.close()
    }

    console.log(`\n✓ browser/stage1-audit: ${passed} проверок пройдено`)
  } catch (err) {
    if (debugPage) {
      try {
        err._debugUrl = debugPage.url()
        err._debugBody = (await debugPage.locator('body').innerText()).replace(/\s+/g, ' ').slice(-500)
      } catch {}
    }
    throw err
  } finally {
    await browser.close()
    await dav.close()
  }
}

run().catch((e) => {
  const lines = String(e?.stack || e).split('\n')
  console.error('❌', lines[0])
  console.error('❌ AT:', lines.find((l) => l.includes('stage1-audit.mjs')) ?? '')
  if (e?._debugUrl) console.error('❌ URL:', e._debugUrl)
  if (e?._debugBody) console.error('❌ BODY:', e._debugBody)
  process.exit(1)
})
