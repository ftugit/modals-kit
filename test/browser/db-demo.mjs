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
} finally {
  await browser.close()
}

console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
