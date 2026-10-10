/**
 * Проверка демо БД в РЕАЛЬНОМ браузере: SSR + гидрация + клик по навигации.
 *
 * Зачем отдельная проба, если есть `db-demo-http.check.mjs`: у класса ошибок
 * «на сервере всё хорошо, в браузере — белый экран» HTTP-проба не видит.
 * Реальный прогон этого демо так и провалился: пагинатор регистрировался только
 * в серверном бандле (лоадер → `ensureDbListPaginator`), а клиентский модуль
 * импортировал из определения лишь тип, то есть регистрация в браузере не
 * выполнялась вовсе → `Unknown paginator "db-demo"` на гидрации и пустая
 * страница. SSR при этом отдавал готовые строки, и проба без JS была зелёной.
 *
 * Запуск: `npm run build && npm run preview -- --port 5173`, затем
 *   node probes/db-demo-browser.check.mjs
 * Порт обязан быть в списке `PREVIEW_PORTS` (см. `svelte.config.js`: по умолчанию
 * 5173 и 5174) — иначе Kit отсекает POST формы по origin, и проверка создания
 * записи отвечает 403. Чужой порт задают так: PREVIEW_PORTS=5188 npm run preview.
 * Нужен Chromium из Playwright (`npx playwright install chromium`); в песочнице
 * он ставится отдельно, поэтому проба не входит в `npm run test`.
 */
import { chromium } from 'playwright'

const BASE = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/db-demo'
const results = []
let failed = 0
const problems = []

const step = async (name, fn) => {
  try {
    console.log(`  ✓ ${name.padEnd(52)} → ${await fn()}`)
    results.push(name)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name.padEnd(52)} → ${String(e).split('\n')[0]}`)
  }
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.split('\n')[0]}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text().split('\n')[0]}`)
})

const rowIds = () => page.$$eval('[data-testid="row-id"]', (els) => els.map((e) => e.textContent.trim()))
const rowCount = () => page.$$eval('[data-testid="row"]', (els) => els.length)

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })

  await step('гидрация без ошибок (нет «Unknown paginator»)', async () => {
    if (problems.length) throw new Error(problems.join(' | ').slice(0, 220))
    return 'чисто'
  })
  await step('список на месте после гидрации (снапшот не стёрт)', async () => {
    const n = await rowCount()
    if (n < 1) throw new Error(`${n} строк — SSR-снапшот потерян при гидрации`)
    return `${n} строк`
  })
  await step('навигация живая: ссылки страниц отрисованы (ключ ?page)', async () => {
    const links = await page.$$eval('[data-testid="page-nav"] a', (els) => els.map((e) => e.getAttribute('href')))
    if (!links.some((h) => h && h.includes('page=2'))) throw new Error(`нет ссылки на страницу 2: ${links.join(',')}`)
    if (links.some((h) => h?.includes('db='))) throw new Error(`в адресе остался свой ключ: ${links.join(',')}`)
    return links.filter((h) => h?.includes('page=')).join(' ')
  })

  const before = await rowIds()
  await step('клик по странице 2 меняет адрес и строки', async () => {
    await page.click('[data-testid="page-nav"] a[href*="page=2"]')
    await page.waitForURL(/page=2/, { timeout: 15_000 })
    await page.waitForFunction(
      (prev) => {
        const now = [...document.querySelectorAll('[data-testid="row-id"]')].map((e) => e.textContent.trim())
        return now.length > 0 && now.join() !== prev
      },
      before.join(),
      { timeout: 15_000 },
    )
    return `${new URL(page.url()).search} → ${(await rowIds()).length} других строк`
  })

  const totalBefore = Number((await page.textContent('[data-testid="total"]'))?.trim())
  // `total` рисуется `ListMeta` из состояния пагинатора: после точечного
  // обновления он меняется, серверная шапка страницы — нет.
  await step('форма создаёт запись БЕЗ перезагрузки страницы (fetch-транспорт)', async () => {
    // Начало с первой страницы: созданный запись попадает в неё (порядок —
    // created_at DESC), а на ?page=2 её не было бы — это проверка списка, а не адреса.
    await page.goto(BASE, { waitUntil: 'networkidle' })
    // Метка на window: перезагрузка (в т.ч. form-submit с навигацией) стирает её,
    // а точечное обновление списка — нет. Это и есть проверяемое свойство.
    await page.evaluate(() => {
      window.__probe = 'alive'
      window.__nav = 0
      addEventListener('beforeunload', () => {
        window.__nav = (window.__nav ?? 0) + 1
      })
    })
    const total = Number((await page.textContent('[data-testid="total"]'))?.trim())
    await page.waitForFunction(() => window.__probe === 'alive')
    const title = 'браузер-' + Date.now().toString(36)
    await page.fill('input[name="title"]', title)
    // Статус собственного POST важен: 403 здесь — не отказ слоя, а CSRF-проверка
    // Kit (порт превью не в списке trusted origins), и без него шаг выглядел бы
    // как «форма не отвечает».
    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/db-demo/submit'), {
      timeout: 15_000,
    })
    await page.click('button[data-testid="create"]')
    const res = await posted
    if (res.status() === 403)
      throw new Error(
        `403 на POST: порт ${new URL(BASE).port} не в списке trusted origins — ` +
          'перезапустите превью с PREVIEW_PORTS=<порт> или KIT_TRUSTED_ORIGINS=<origin>',
      )
    if (!res.ok()) throw new Error(`POST /db-demo/submit = ${res.status()}`)
    const type = res.headers()['content-type'] ?? ''
    if (!type.includes('application/json')) throw new Error(`не-JSON ответ (${type}): страница ушла на навигацию`)
    // Обновлённый список — это и есть «точечно»: строка появилась, total вырос,
    // при этом страница не перезагружалась (метка ниже жива).
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-testid="total"]')?.textContent.trim()) === n + 1,
      total,
      { timeout: 15_000 },
    )
    await page.waitForFunction(
      (t) => [...document.querySelectorAll('[data-testid="row"]')].some((e) => e.textContent.includes(t)),
      title,
      { timeout: 15_000 },
    )
    const alive = await page.evaluate(() => window.__probe)
    if (alive !== 'alive') throw new Error(`страница перезагрузилась (метка пропала): ${alive}`)
    const first = await page.textContent('[data-testid="row"]')
    if (!first?.includes(title)) throw new Error(`созданная запись не первая в списке: ${first}`)
    return `метка жива, ответ ${type.split(';')[0]}, строка первая`
  })
  await step('сводка обновилась без навигации, notice не нужен (fetch-путь)', async () => {
    const total = Number((await page.textContent('[data-testid="total"]'))?.trim())
    if (total !== totalBefore + 1) throw new Error(`total ${totalBefore} → ${total} — источник не перезапрошен`)
    const alive = await page.evaluate(() => window.__probe)
    const nav = await page.$$eval('[data-testid="page-nav"] a', (e) => e.length)
    return `${totalBefore} → ${total}, ссылок страниц: ${nav}, метка жива: ${alive === 'alive'}`
  })
  await step('панель включает курсор: тумблер → ?page.cur, номеров больше нет', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    // Имя контрола панели = адресный ключ (`page.<key>`, см. compile.ts), поэтому
    // поле находится без гадания на разметку.
    await page.locator('input[name="page.cur"]').check()
    await page.waitForURL(/page\.cur=(true|1)/, { timeout: 15_000 })
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="page-nav"]') && !!document.querySelector('[data-testid="load-next"]'),
      undefined,
      { timeout: 15_000 },
    )
    const mode = await page.textContent('[data-testid="list-mode"]')
    const rows0 = await rowCount()
    await page.click('[data-testid="load-next"]')
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="row"]').length > n, rows0, { timeout: 15_000 })
    const rows1 = await rowCount()
    const ids1 = await rowIds()
    if (new Set(ids1).size !== ids1.length) throw new Error('подгрузка повторила строки: ' + ids1.join(','))
    return `режим «${mode?.trim()}», строк ${rows0} → ${rows1}, id уникальны`
  })
  await step('продолжение держится на токене: клик выдаёт новый указатель', async () => {
    // Свой заход, а не «продолжение предыдущего шага»: в прошлом шаге список дошёл
    // до конца, указателя следующего шага больше нет, и `EndRow` законно заменил
    // ссылку. Размер 3 при 9 записях оставляет запас в два шага.
    await page.goto(`${BASE}?page.cur=1&page.size=3`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="load-next"]', { timeout: 15_000 })
    const pointer = async () =>
      decodeURIComponent(/page\.after=([^&#"]+)/.exec((await page.getAttribute('[data-testid="load-next"]', 'href')) ?? '')?.[1] ?? '')
    const before = await pointer()
    if (!before) throw new Error('в ссылке нет указателя: ' + (await page.getAttribute('[data-testid="load-next"]', 'href')))
    const rows0 = await rowCount()
    await page.click('[data-testid="load-next"]')
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="row"]').length > n, rows0, { timeout: 15_000 })
    const after = await pointer()
    if (after === before) throw new Error('ссылка «дальше» не продвинулась: тот же токен')
    // Адрес состояния держит УКАЗАТЕЛЬ ПОСЛЕДНЕГО ответа — тот же, что и в ссылке:
    // позиция списка и ссылка «дальше» обязаны быть одним значением, иначе
    // перезагрузка страницы вернула бы не туда, куда ведёт ссылка.
    const search = decodeURIComponent(new URL(page.url()).search)
    if (!search.includes('page.after=' + after))
      throw new Error(`в адресе не тот указатель: ${search.slice(0, 60)}… / ссылка ${after.slice(0, 12)}…`)
    return `токен сменился (${before.slice(0, 8)}… -> ${after.slice(0, 8)}…), он же — в адресе`
  })
  await step('без указателя список снова с начала (токен = позиция)', async () => {
    const seen = await rowIds()
    await page.goto(`${BASE}?page.cur=1`, { waitUntil: 'networkidle' })
    await page.waitForFunction((prev) => {
      const now = [...document.querySelectorAll('[data-testid="row-id"]')].map((e) => e.textContent.trim())
      return now.length > 0 && now.join() === prev.slice(0, now.length).join()
    }, seen, { timeout: 15_000 })
    const first = await rowIds()
    if (first[0] !== seen[0]) throw new Error(`первая строка не вернулась к началу: ${first[0]} / ${seen[0]}`)
    return `${first.length} строк — те же, с которых начали`
  })
  await step('тумблер выключается: ?page.cur снят, номера страниц вернулись', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    // Первый шаг — включённый тумблер, второй — снятый: `toPatch` для toggle пишет
    // и `false` (в отличие от select, где пустое значение = «ключ не трогаем»),
    // иначе режим нельзя было бы выключить панелью.
    await page.locator('input[name="page.cur"]').check()
    await page.waitForURL(/page\.cur=/, { timeout: 15_000 })
    await page.locator('input[name="page.cur"]').uncheck()
    await page.waitForFunction(() => !!document.querySelector('[data-testid="page-nav"]'), undefined, { timeout: 15_000 })
    const search = new URL(page.url()).search
    if (/page\.cur=/.test(search)) throw new Error(`ключ режима остался в адресе: ${search}`)
    return search || 'адрес чистый, PageNav снова есть'
  })
  await step('фильтр из адреса применяется в браузере', async () => {
    const flt = encodeURIComponent(JSON.stringify({ op: 'eq', field: 'title', value: 'несуществующий-заголовок' }))
    await page.goto(`${BASE}?page.flt=${flt}`, { waitUntil: 'networkidle' })
    const n = await rowCount()
    if (n !== 0) throw new Error(`${n} строк вместо нуля`)
    const empty = await page.$eval('[data-testid="rows"]', (el) => el.textContent.includes('записей нет'))
    return `пусто, EmptyState показан: ${empty}`
  })
  await step('итог: за всю сессию ошибок в консоли нет', async () => {
    if (problems.length) throw new Error(problems.slice(0, 3).join(' | ').slice(0, 260))
    return 'чисто'
  })
} finally {
  await browser.close()
}

console.log(failed ? `\nDB_DEMO_BROWSER_FAIL: ${failed}` : `\nDB_DEMO_BROWSER_OK (${results.length} проверок)`)
process.exit(failed ? 1 : 0)
