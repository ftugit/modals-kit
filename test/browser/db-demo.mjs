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
  await Promise.all([
    page.waitForURL((u) => u.search.includes('/create'), { timeout: 15_000 }),
    page.locator('#db-create-form [data-testid="create"]').click(),
  ])
  release()
  await page.unroute('**/*', hold)
  await page.waitForLoadState('networkidle')

  const notice = page.locator('[data-testid="notice"]')
  const shown = (await notice.count()) ? await notice.textContent() : null
  ok('после POST без JS итог экшена показан', shown?.includes(title) ?? false, String(shown))

  // Метка на window живёт только при клиентской навигации: без неё тест не
  // отличил бы «уведомление снято» от «страница перезагрузилась целиком».
  await page.evaluate(() => {
    window.__dbDemoAlive = 1
  })
  await page.locator('a[href="/db-demo"]').first().click()
  await page.waitForURL((u) => u.pathname === '/db-demo' && !u.search.includes('/create'), {
    timeout: 15_000,
  })
  await page.waitForLoadState('networkidle')
  const spa = await page.evaluate(() => window.__dbDemoAlive === 1)
  ok('переход по ссылке шапки — клиентская навигация', spa)
  const after = (await notice.count()) ? await notice.textContent() : null
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
    const asof = new URL(reader.url()).searchParams.get('page.asof')
    ok('срез: первая загрузка кладёт page.asof в адрес', !!asof && firstIds.length === 3, String(asof))

    // Вторая страница того же среза на снимке «до записи» — чтобы сравнить с ней.
    const sliceUrl = (pageNo) => `${BASE}?page.size=3&page=${pageNo}&page.asof=${encodeURIComponent(asof ?? '')}`
    await reader.goto(sliceUrl(2), { waitUntil: 'networkidle' })
    const secondIds = await reader.locator('[data-testid="rows"] [data-testid="row-id"]').allInnerTexts()

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
    // срез открытой страницы, поэтому «новая» запись создаётся ПОСЛЕ неё (та,
    // что выше, уже вошла в срез и нового в ней нет — так и задумано).
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
    const asofBefore = new URL(reader.url()).searchParams.get('page.asof')
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
      ok('клик по пилюле — сброс: новая запись наверху, срез в адресе обновлён',
        afterIds[0] !== beforeIds[0] && !!asofAfter && asofAfter !== asofBefore,
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
