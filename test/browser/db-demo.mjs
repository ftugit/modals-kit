/**
 * Браузерные проверки демо БД (/db-demo). Идут на УЖЕ работающий сервер, как
 * остальные тесты репозитория: адрес в DB_DEMO_BASE.
 *
 *   npm run dev            # или: npm run build && npm run preview -- --port 5173
 *   node test/browser/db-demo.mjs
 *
 * Порт обязан быть в PREVIEW_PORTS (по умолчанию 5173 и 5174, см.
 * `#lib/server/form-security.ts`): иначе слой origin отвечает на POST формы 403.
 * Поэтому адрес по умолчанию — 5173, как у forms.mjs.
 *
 * Что проверяется:
 *   1. итог серверного экшена (`form`) — ЖИВОЙ пропс: после клиентской навигации
 *      SvelteKit обнуляет `form`, и уведомление «создано: …» исчезает.
 *      Регрессия: результат копировался в const при монтировании и оставался
 *      на странице после навигации.
 *
 * Сценарий реальный, без подделки DOM: форма отправляется ДО гидрации (скрипты
 * придержаны), то есть обычным POST без JS — именно этот путь даёт `form`. Затем
 * скрипты отпускаются, страница гидратируется, и переход идёт по ссылке шапки.
 * Тест пишет одну запись в демо-базу (заголовок с отметкой времени).
 *
 *   2. строка ошибки списка выбирает действие по коду отказа: истёкший токен
 *      курсора — «Начать сначала» (повтор отправил бы тот же токен), прочие —
 *      «Повторить». Регрессия: всегда «Повторить», ошибка повторялась бесконечно.
 */
import { chromium } from 'playwright'

const BASE = process.env.DB_DEMO_BASE ?? 'http://127.0.0.1:5173/db-demo'
let failed = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failed++
}

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] })
try {
  const page = await browser.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.split('\n')[0]}`))

  // Скрипты приложения держатся, пока форма не отправлена: так POST гарантированно
  // уходит без перехвата, как у пользователя, нажавшего кнопку до гидрации.
  let release
  const gate = new Promise((r) => (release = r))
  // По типу ресурса, а не по пути: у preview скрипты в /_app/, у dev — в /src/, /@fs/ и т.д.
  const hold = async (route) => {
    if (route.request().resourceType() === 'script') await gate
    // Скрипты ПЕРВОЙ страницы к этому моменту отменены: POST её выгрузил.
    // Продолжать их некому — это не ошибка приложения.
    await route.continue().catch(() => {})
  }
  await page.route('**/*', hold)

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const title = `db-demo notice ${Date.now()}`
  await page.locator('#db-create-form input[name="title"]').fill(title)
  await page.locator('#db-create-form input[name="agree"]').check()
  // Приём — общий приёмник встраиваемых форм: POST идёт на адрес самой
  // страницы (форму называет конверт `__form_id`), поэтому адресной метки
  // `?/create` в URL больше нет. Ждём сам POST и полную загрузку ответа.
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/db-demo',
      { timeout: 15_000 },
    ),
    page.locator('#db-create-form [data-testid="create"]').click(),
  ])
  release()
  await page.unroute('**/*', hold)
  // Ждём ГИДРАЦИЮ, а не «тишину в сети»: у страницы живут опросы и задача формы
  // (`watch`), поэтому `networkidle` на них может не наступить вовсе — ожидание
  // падало по таймауту, хотя страница уже была готова. Глобал `__sveltekit_<hash>`
  // ставит стартовый скрипт Kit — это и есть признак «клиент поднялся».
  await page.waitForFunction(
    () => Object.keys(window).some((k) => k.startsWith('__sveltekit_')),
    null,
    { timeout: 30_000 },
  )
  await page.waitForTimeout(300)

  const notice = page.locator('[data-testid="notice"]')
  const shown = (await notice.count()) ? await notice.textContent() : null
  ok('после POST без JS итог экшена показан', shown?.includes(title) ?? false, String(shown))

  // Метка на window живёт только при клиентской навигации: без неё тест не
  // отличил бы «уведомление снято» от «страница перезагрузилась целиком».
  await page.evaluate(() => {
    window.__dbDemoAlive = 1
  })
  await page.locator('a[href="/db-demo"]').first().click()
  // Уходим на другой раздел и возвращаемся: результат принадлежит ОТВЕТУ, а не
  // странице, поэтому на возврате его уже нет (как и `form` у прежних экшенов).
  await page.waitForURL((u) => u.pathname === '/db-demo', { timeout: 15_000 })
  await page.locator('a[href="/fields"]').first().click()
  await page.waitForURL((u) => u.pathname === '/fields', { timeout: 15_000 })
  await page.locator('a[href="/db-demo"]').first().click()
  await page.waitForURL((u) => u.pathname === '/db-demo', { timeout: 15_000 })
  await page.waitForLoadState('networkidle')
  const spa = await page.evaluate(() => window.__dbDemoAlive === 1)
  ok('переход по ссылке шапки — клиентская навигация', spa)
  // Уведомление живёт до первого рендера после навигации. Ждём именно «пусто»:
  // «нет элемента» и «элемент без текста» — один и тот же ответ.
  const after = await cur_pollText(page, '[data-testid="notice"]')

  /** Текст элемента после навигации: `null`, если он исчез. */
  async function cur_pollText(page_, selector) {
    for (let i = 0; i < 25; i++) {
      const text = await page_.locator(selector).textContent().catch(() => null)
      if (!text) return null
      await page_.waitForTimeout(200)
    }
    return (await page_.locator(selector).textContent().catch(() => null)) ?? null
  }
  ok('после клиентской навигации уведомление снято (form обнулён)', after === null, String(after))
  ok('без ошибок страницы', problems.length === 0, problems.join(' | '))

  /* Ошибка сервера закреплена за значением поля (lib/form, pins): «,» проходит
     проверку клиента (поле не пустое), но сервер не находит в нём ни одного id. */
  const pinPage = await browser.newPage()
  await pinPage.goto(BASE, { waitUntil: 'networkidle' })
  await pinPage.waitForFunction(() => document.querySelector('[name="ids"]')?.form?.hasAttribute('novalidate'),
    null, { timeout: 20_000 })
  const ids = pinPage.locator('[name="ids"]')
  const pinError = () => pinPage.evaluate(() => {
    const input = document.querySelector('[name="ids"]')
    if (input?.getAttribute('aria-invalid') !== 'true') return null
    const ref = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    return ref.map((id) => document.getElementById(id)).find((n) => n?.matches('.text-destructive'))?.textContent?.trim()
      ?? 'aria-invalid'
  })
  await ids.fill(',')
  await pinPage.locator('[data-testid="remove"]').click()
  await pinPage.waitForFunction(() => document.querySelector('[name="ids"]')?.getAttribute('aria-invalid') === 'true',
    null, { timeout: 10_000 }).catch(() => {})
  const pinned = await pinError()
  ok('закреп: ошибка сервера под полем', pinned === 'скопируйте id из таблицы ниже', String(pinned))
  await ids.press('End')
  await ids.press('x')
  await pinPage.waitForTimeout(100)
  ok('закреп: правка значения снимает ошибку во время ввода', await pinError() === null, String(await pinError()))
  await ids.press('Backspace')
  await pinPage.waitForTimeout(100)
  ok('закреп: возврат к отправленному значению показывает её снова', await pinError() === pinned, String(await pinError()))
  ok('закреп: всё это без ухода с поля', await ids.evaluate((el) => el === document.activeElement))
  await pinPage.close()

  /* Код отказа решает, что предложить. Токен — правдоподобный по форме, но не
     подписанный этим сервером: слой отвечает кодом `cursor` уже в SSR-снимке. */
  const curPage = await browser.newPage()
  const curProblems = []
  curPage.on('pageerror', (e) => curProblems.push(e.message))
  await curPage.goto(`${BASE}?page.cur=1&page.after=bogusToken123`, { waitUntil: 'networkidle' })
  const errRow = curPage.locator('[data-testid="error-row"]')
  // Без DB_CURSOR_SECRET курсор выключен (код `unsupported`) — проверять нечего.
  if (await errRow.getAttribute('data-error-code') === 'unsupported') {
    console.log('  SKIP курсор: на сервере не задан DB_CURSOR_SECRET')
  } else {
  ok('курсор: истёкший токен — код cursor и «Начать сначала» (ссылка от URL-адаптера)',
    await errRow.getAttribute('data-error-code') === 'cursor'
      && (await errRow.locator('a, button').allInnerTexts()).join() === 'Начать сначала'
      && await errRow.locator('a').count() === 1,
    (await errRow.allInnerTexts()).join(' | '))
  // Прочий отказ (база упала) — повтор осмыслен. Ответ подменяется один раз.
  const asked = []
  await curPage.route('**/api/db-posts?*', async (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('after'))
    await route.fulfill({ status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: 'База не смогла выполнить запрос.', code: 'database' }) })
  }, { times: 1 })
  await errRow.locator('a, button').click()
  await curPage.waitForFunction(() => document.querySelector('[data-testid="error-row"]')?.getAttribute('data-error-code') === 'database',
    null, { timeout: 10_000 }).catch(() => {})
  ok('курсор: «Начать сначала» идёт без токена и снимает его из адреса',
    asked.length === 1 && asked[0] === null && !new URL(curPage.url()).searchParams.has('page.after'),
    JSON.stringify({ asked, url: curPage.url() }))
  ok('прочий отказ — кнопка «Повторить»',
    (await errRow.locator('a, button').allInnerTexts()).join() === 'Повторить', (await errRow.allInnerTexts()).join(' | '))
  // Без якоря: адрес, отличный от текущего только якорем, браузер без JS не загружает
  // заново (прокрутка к якорю), и повтор ничего бы не сделал. Проверено и без JS:
  // отказ эмулировали на сервере (ход 247), ссылка загрузила список.
  const retryHref = await errRow.locator('a').getAttribute('href').catch(() => null)
  ok('«Повторить» — ссылка на текущий адрес без якоря', retryHref !== null && !retryHref.includes('#'), String(retryHref))
  await errRow.locator('a, button').click()
  await errRow.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  ok('«Повторить» загружает первую страницу', await errRow.count() === 0)
  ok('курсор: без ошибок страницы', curProblems.length === 0, curProblems.join(' | '))

  /* Без JS карточку видно (первая страница не загрузилась на сервере), и кнопки —
     ссылки от адаптера: «Начать сначала» ведёт на первую страницу без токена. */
  const nojs = await browser.newContext({ javaScriptEnabled: false })
  const np = await nojs.newPage()
  await np.goto(`${BASE}?page.cur=1&page.after=bogusToken123`, { waitUntil: 'domcontentloaded' })
  const nRow = np.locator('[data-testid="error-row"]')
  const restartLink = nRow.locator('a', { hasText: 'Начать сначала' })
  const restartHref = await restartLink.getAttribute('href').catch(() => null)
  ok('без JS: «Начать сначала» — ссылка без токена', restartHref !== null && !restartHref.includes('after='), String(restartHref))
  await restartLink.click()
  await np.waitForLoadState('domcontentloaded')
  ok('без JS: по ссылке — первая страница без ошибки, строки на месте',
    await np.locator('[data-testid="error-row"]').count() === 0
      && !new URL(np.url()).searchParams.has('page.after')
      && await np.locator('[data-testid="rows"]').count() === 1,
    np.url())
  await nojs.close()
  }
  await curPage.close()

  // 3a. Курсор: в адресе — ключ ВИДИМОЙ порции (live-update, шаг 4). Догрузка
  //     вторая порция не делает видимой; ключ появляется, когда читатель до неё
  //     долистал, а перезагрузка возвращает ровно эту порцию, а не следующую.
  {
    const cur = await browser.newPage({ viewport: { width: 900, height: 500 } })
    const curSliceProblems = []
    cur.on('pageerror', (e) => curSliceProblems.push(`pageerror: ${e.message.split('\n')[0]}`))
    await cur.goto(`${BASE}?page.cur=1&page.size=3`, { waitUntil: 'networkidle' })
    const disabled = await cur.getByText(/Курсор выключен/).count()
    if (disabled) {
      console.log('  SKIP курсор: на сервере не задан DB_CURSOR_SECRET')
    } else {
      const ids = cur.locator('[data-testid="rows"] [data-testid="row-id"]')
      const first = await ids.allInnerTexts()
      ok('курсор: первая порция открывается без ключа в адресе',
        first.length === 3 && !new URL(cur.url()).searchParams.has('page.after'), cur.url())

      for (let i = 0; i < 2; i++) {
        await cur.locator('[data-testid="cursor-next"]').click()
        await cur.waitForFunction((n) => document.querySelectorAll('[data-testid="rows"] [data-testid="row-id"]').length > n,
          first.length + i * 3, { timeout: 15_000 }).catch(() => {})
      }
      const loaded = await ids.allInnerTexts()
      ok('курсор: вторая порция догружена, окно не сдвинулось',
        loaded.length === 9 && loaded.slice(0, 3).join(',') === first.join(','), String(loaded.length))

      // Прокрутка к концу загруженного: видимой становится не первая порция —
      // ключ её начала уезжает в адрес, номер страницы при этом не пишется.
      await cur.locator('[data-paginator-host]').evaluate((h) => h.scrollTo({ top: h.scrollHeight, behavior: 'instant' }))
      await cur.waitForFunction(() => new URL(location.href).searchParams.has('page.after'), undefined, { timeout: 10_000 })
        .catch(() => {})
      const url = new URL(cur.url())
      ok('курсор: ключ видимой порции в адресе, номера страницы нет',
        url.searchParams.has('page.after') && !url.searchParams.has('page'), url.search.slice(0, 40))

      // Перезагрузка — «дай порцию от этого ключа»: не голову списка и не
      // следующую порцию, а одну из УЖЕ прочитанных целиком (какую именно —
      // решил трекер якорей, его гистерезис здесь не пересчитываем).
      await cur.reload({ waitUntil: 'networkidle' })
      await cur.waitForTimeout(800)
      const afterReload = await ids.allInnerTexts()
      // Текст ключа после перезагрузки ДРУГОЙ: ответ переподписывает закладку
      // (скользящее продление, live-update шаг 6), и адрес получает свежий.
      // Проверяем смысл: ключ на месте и ведёт в ту же порцию.
      const reloadedUrl = new URL(cur.url())
      const at = loaded.findIndex((_, i) => loaded.slice(i, i + 3).join(',') === afterReload.join(','))
      ok('курсор: перезагрузка отдаёт ту же порцию, а не следующую',
        reloadedUrl.searchParams.has('page.after') &&
          reloadedUrl.searchParams.has('page.beg') &&
          afterReload.length === 3 &&
          at > 0 && at % 3 === 0,
        `${afterReload.length}: ${afterReload[0]?.slice(0, 8)} | место в загруженном: ${at}`)

      // Догрузка с восстановленной страницы: адрес хранит ключ ВИДИМОЙ порции, а
      // указатель следующей приходит из ответа. Если адресный ключ перетрёт его в
      // состоянии, «дальше» приклеит ту же порцию — проверяем, что приходит новая.
      await cur.locator('[data-testid="cursor-next"]').click()
      await cur.waitForFunction((n) => document.querySelectorAll('[data-testid="rows"] [data-testid="row-id"]').length > n,
        3, { timeout: 15_000 }).catch(() => {})
      const afterNext = await ids.allInnerTexts()
      const third = afterNext.slice(3, 6)
      ok('курсор: догрузка после перезагрузки даёт следующую порцию, а не ту же',
        afterNext.length === 6 && third.length === 3 && third.every((id) => !afterReload.includes(id)),
        `${afterNext.length}: ${third[0]?.slice(0, 8) ?? '—'}`)

      // Опрос новых живёт только у края: у второй порции его нет вовсе.
      // Порций нужно три: линия детекта стоит на 20% высоты контейнера, и
      // контента двух порций не хватает, чтобы вторая перешагнула её.
      await cur.goto(`${BASE}?page.cur=1&page.size=3&page.live=1`, { waitUntil: 'networkidle' })
      for (let i = 0; i < 2; i++) {
        await cur.locator('[data-testid="cursor-next"]').click()
        await cur.waitForFunction((n) => document.querySelectorAll('[data-testid="rows"] [data-testid="row-id"]').length > n,
          3 + i * 3, { timeout: 15_000 }).catch(() => {})
      }
      await cur.locator('[data-paginator-host]').evaluate((h) => h.scrollTo({ top: h.scrollHeight, behavior: 'instant' }))
      await cur.waitForTimeout(1500)
      ok('опрос: у края включён, на второй порции выключен',
        (await cur.locator('[data-testid="live-state"]').count()) === 0,
        await cur.locator('[data-testid="live-state"]').innerText().catch(() => 'нет'))
    }
    ok('курсор: без ошибок страницы', curSliceProblems.length === 0, curSliceProblems.join(' | '))
    await cur.close()
  }

  // 3b. Опрос изменённых и удалённых (live-update, шаг 5): правка и удаление
  //     ВИДИМОЙ строки доходят до соседнего читателя без перезагрузки, правка
  //     строки за пределами окна — нет (границы задаёт клиент, они только сужают).
  {
    const writerCtx = await browser.newContext()
    const writer = await writerCtx.newPage()
    await writer.goto(BASE, { waitUntil: 'networkidle' })

    const readerCtx = await browser.newContext()
    const reader = await readerCtx.newPage()
    const changeProblems = []
    reader.on('pageerror', (e) => changeProblems.push(`pageerror: ${e.message.split('\n')[0]}`))
    await reader.goto(`${BASE}?page.size=3&page.live=1`, { waitUntil: 'networkidle' })
    await reader.waitForTimeout(1500)

    const first = reader.locator('[data-testid="rows"] [data-testid="row-id"]').first()
    const visibleId = (await first.innerText()).trim()
    const rowText = async (id) =>
      (await reader.locator(`[data-testid="row-id"][title="${id}"]`).locator('..').innerText().catch(() => ''))

    // Правка ВИДИМОЙ строки: метка приходит опросом изменённых.
    const edited = `правка ${Date.now()}`
    await writer.locator('#db_demo_rename-id').fill(visibleId)
    await writer.locator('#db_demo_rename-title').fill(edited)
    await Promise.all([
      writer.waitForResponse((r) => r.url().includes('/db-demo') && r.request().method() === 'POST'),
      writer.locator('[data-testid="rename"]').click(),
    ])
    const editSeen = await reader.waitForFunction(
      (title) => document.querySelector('[data-testid="rows"]')?.textContent?.includes(title),
      edited,
      { timeout: 20_000 },
    ).then(() => true).catch(() => false)
    ok('опрос: правка видимой строки пришла без перезагрузки', editSeen, edited)

    // Правка ЗА ПРЕДЕЛАМИ окна (последняя строка выдачи): до читателя не доходит.
    // Четвёртая строка выдачи — первая из следующей страницы, то есть заведомо
    // вне окна читателя (у него показаны первые три).
    const outsideCtx = await browser.newContext()
    const outside = await outsideCtx.newPage()
    await outside.goto(`${BASE}?page.size=3&page=2`, { waitUntil: 'networkidle' })
    const lastId = (await outside.locator('[data-testid="row-id"]').first().innerText().catch(() => '')).trim()
    await outsideCtx.close()
    const outsideTitle = `вне окна ${Date.now()}`
    if (lastId && lastId !== visibleId) {
      await writer.locator('#db_demo_rename-id').fill(lastId)
      await writer.locator('#db_demo_rename-title').fill(outsideTitle)
      await Promise.all([
        writer.waitForResponse((r) => r.url().includes('/db-demo') && r.request().method() === 'POST'),
        writer.locator('[data-testid="rename"]').click(),
      ])
      await reader.waitForTimeout(7000)
      const leaked = (await reader.locator('[data-testid="rows"]').innerText()).includes(outsideTitle)
      const readerFirst = (await reader.locator('[data-testid="rows"] [data-testid="row-id"]').first().innerText()).trim()
      ok('опрос: правка строки вне окна не приходит и не подменяет видимую',
        !leaked && readerFirst === visibleId, leaked ? 'пришла' : 'не пришла')
    }

    // Удаление ВИДИМОЙ строки: она уходит из окна, соседние остаются.
    const beforeCount = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').count()
    await writer.locator('#db_demo_remove-ids').fill(visibleId)
    await Promise.all([
      writer.waitForResponse((r) => r.url().includes('/db-demo') && r.request().method() === 'POST'),
      writer.locator('[data-testid="remove"]').click(),
    ])
    const gone = await reader.waitForFunction(
      (id) => !document.querySelector(`[data-testid="row-id"][title="${id}"]`),
      visibleId,
      { timeout: 20_000 },
    ).then(() => true).catch(() => false)
    const afterCount = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').count()
    ok('опрос: удалённая строка убрана из окна (а не помечена)',
      gone && afterCount === beforeCount - 1, `${beforeCount}→${afterCount}`)

    ok('опрос изменённых: без ошибок страницы', changeProblems.length === 0, changeProblems.join(' | '))
    await readerCtx.close()
    await writerCtx.close()
  }

  // 3. Срез постраничной выдачи (live-update, шаг 3): новая строка не сдвигает
  //    открытую страницу, а на первой странице о ней говорит пилюля опроса;
  //    клик по пилюле сбрасывает список на новый срез.
  {
    // «Другой пользователь»: своя запись своему списку не «новая» (её видно
    // оптимистичной карточкой), поэтому пишет отдельный контекст.
    const writerCtx = await browser.newContext()
    const writer = await writerCtx.newPage()
    await writer.goto(BASE, { waitUntil: 'domcontentloaded' })

    const readerCtx = await browser.newContext()
    const reader = await readerCtx.newPage()
    const sliceProblems = []
    reader.on('pageerror', (e) => sliceProblems.push(`pageerror: ${e.message.split('\n')[0]}`))

    await reader.goto(`${BASE}?page.size=3`, { waitUntil: 'networkidle' })
    const firstIds = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()
    const cleanAsof = new URL(reader.url()).searchParams.get('page.asof')
    const page2LinkHref = await reader.locator('[data-testid="page-nav"] a', { hasText: '2' }).first().getAttribute('href')
    ok(
      'срез: чистая 1-я страница не пишет page.asof в URL и не рисует плашку среза/«страница 1», но ссылка на 2-ю несёт срез',
      cleanAsof === null &&
        firstIds.length === 3 &&
        (await reader.locator('[data-testid="page-slice"]').count()) === 0 &&
        (await reader.locator('[data-testid="page-divider-1"]').count()) === 0 &&
        Boolean(page2LinkHref && decodeURIComponent(page2LinkHref).includes('page.asof=')),
      JSON.stringify({ url: reader.url(), page2LinkHref }),
    )

    // Переход на 2-ю страницу фиксирует срез в состоянии и в URL и включает плашку среза (single-режим).
    await reader.locator('[data-testid="page-nav"] a', { hasText: '2' }).first().click()
    await reader.waitForFunction(() => new URL(location.href).searchParams.get('page') === '2', null, { timeout: 15_000 })
    const asof = new URL(reader.url()).searchParams.get('page.asof')
    const secondIds = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()
    const sliceOnPage2 = await reader.locator('[data-testid="page-slice"]').innerText().catch(() => '')
    ok(
      'срез: переход на 2-ю страницу кладёт page.asof в адрес и показывает плашку среза',
      !!asof && secondIds.length === 3 && sliceOnPage2.includes('Отображается срез от') && sliceOnPage2.includes('сбросить?'),
      JSON.stringify({ asof, sliceOnPage2 }),
    )
    const sliceUrl = (pageNo) => `${BASE}?page.size=3&page=${pageNo}&page.asof=${encodeURIComponent(asof ?? '')}`

    const title = `срез ${Date.now()}`
    await writer.locator('#db-create-form input[name="title"]').fill(title)
    await writer.locator('#db-create-form input[name="agree"]').check()
    // Экшен уходит с гидрацией (страница живая) — адрес на `/create` не меняется,
    // поэтому ждём ответ сервера, а не навигацию.
    await Promise.all([
      // Куда именно Kit отправит экшен (`?/create` или `/submit`), решает транспорт
      // формы; важно лишь, что это POST самой страницы.
      writer.waitForResponse((r) => r.url().includes('/db-demo') && r.request().method() === 'POST', { timeout: 15_000 }),
      writer.locator('#db-create-form button[type="submit"]').click(),
    ])

    // Та же вторая страница под ТЕМ ЖЕ срезом: новая запись в неё не вошла и
    // ничего не сдвинула.
    await reader.goto(sliceUrl(2), { waitUntil: 'networkidle' })
    const secondAfter = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()
    ok('срез: вторая страница под прежним срезом не сдвинулась',
      secondIds.length === 3 && secondAfter.join(',') === secondIds.join(','), secondAfter.join(','))

    // Возврат на 1-ю страницу сохраняет активный срез и показывает плашку вместо «страница 1».
    await reader.locator('[data-testid="page-nav"] a', { hasText: '1' }).first().click()
    await reader.waitForFunction(() => !new URL(location.href).searchParams.has('page'), null, { timeout: 15_000 })
    const back1Ids = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()
    const back1Asof = new URL(reader.url()).searchParams.get('page.asof')
    ok(
      'срез: возврат на 1-ю страницу сохраняет page.asof и плашку среза со старым набором строк',
      back1Asof === asof &&
        back1Ids.join(',') === firstIds.join(',') &&
        (await reader.locator('[data-testid="page-slice"]').count()) === 1 &&
        (await reader.locator('[data-testid="page-divider-1"]').count()) === 0,
      JSON.stringify({ back1Asof, back1Ids }),
    )

    // Клик по «сбросить?» в плашке очищает page.asof, прячет плашку и подгружает свежую запись.
    await reader.locator('[data-testid="page-slice-reset"]').click()
    await reader.waitForFunction(
      (prevHead) => {
        const rows = [...document.querySelectorAll('[data-testid="rows"] [data-testid="row-id"]')]
        return !new URL(location.href).searchParams.has('page.asof') && rows.length > 0 && rows[0].textContent.trim() !== prevHead
      },
      firstIds[0] ?? '',
      { timeout: 15_000 },
    )
    const afterResetIds = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()
    ok(
      'срез: клик «сбросить?» снимает page.asof, скрывает плашку и показывает новую запись',
      !new URL(reader.url()).searchParams.has('page.asof') &&
        (await reader.locator('[data-testid="page-slice"]').count()) === 0 &&
        !firstIds.includes(afterResetIds[0]),
      afterResetIds[0],
    )

    // А свежий заход (свой срез считается на «сейчас») новую запись видит —
    // значит срез действительно край, а не пустой ключ в адресе.
    const freshCtx = await browser.newContext()
    const fresh = await freshCtx.newPage()
    await fresh.goto(`${BASE}?page.size=3`, { waitUntil: 'networkidle' })
    const freshFirst = await fresh.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()
    ok('без среза свежая выдача начинается с новой записи',
      freshFirst.length === 3 && !firstIds.includes(freshFirst[0]) && freshFirst.join(',') !== firstIds.join(','),
      freshFirst[0])
    await freshCtx.close()

    // Пилюля: живой опрос на первой странице и сброс по клику. Отметка опроса —
    // край открытой страницы (`asofHead`), поэтому «новая» запись создаётся ПОСЛЕ неё.
    await reader.goto(`${BASE}?page.size=3&page.live=1`, { waitUntil: 'networkidle' })
    await reader.waitForFunction(
      () => (document.querySelector('[data-testid="live-state"]')?.textContent ?? '').includes('тиков'),
      undefined,
      { timeout: 15_000 },
    ).catch(() => {})
    await reader.waitForTimeout(1200)
    const second = await writerCtx.newPage()
    await second.goto(BASE, { waitUntil: 'domcontentloaded' })
    await second.locator('#db-create-form input[name="title"]').fill(`после ${Date.now()}`)
    await second.locator('#db-create-form input[name="agree"]').check()
    await Promise.all([
      second.waitForResponse((r) => r.url().includes('/db-demo') && r.request().method() === 'POST', { timeout: 15_000 }),
      second.locator('#db-create-form button[type="submit"]').click(),
    ])
    await second.close()
    const pill = reader.locator('[data-testid="live-pill"]')
    const pillShown = await pill.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)
    ok('пилюля: новая запись предложена первой странице', pillShown && (await pill.innerText()).includes('1'),
      pillShown ? await pill.innerText() : 'нет')
    const beforeIds = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()
    if (pillShown) {
      await pill.click()
      await reader.waitForFunction(
        (prev) => {
          const rows = [...document.querySelectorAll('[data-testid="rows"] [data-testid="row-id"]')]
          return rows.length > 0 && rows[0].textContent.trim() !== prev
        },
        beforeIds[0] ?? '',
        { timeout: 15_000 },
      ).catch(() => {})
      const afterIds = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()
      const asofAfter = new URL(reader.url()).searchParams.get('page.asof')
      ok('клик по пилюле — сброс: новая запись наверху, адрес чист без page.asof',
        afterIds[0] !== beforeIds[0] && asofAfter === null,
        String(asofAfter))
    }
    ok('срез: без ошибок страницы', sliceProblems.length === 0, sliceProblems.join(' | '))
    await readerCtx.close()
    await writerCtx.close()
  }
} finally {
  await browser.close()
}

console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
