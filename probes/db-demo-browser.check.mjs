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
  await step('навигация живая: ссылки страниц отрисованы', async () => {
    const links = await page.$$eval('[data-testid="page-nav"] a', (els) => els.map((e) => e.getAttribute('href')))
    if (!links.some((h) => h && h.includes('db=2'))) throw new Error(`нет ссылки на страницу 2: ${links.join(',')}`)
    return links.filter((h) => h?.includes('db=')).join(' ')
  })

  const before = await rowIds()
  await step('клик по странице 2 меняет адрес и строки', async () => {
    await page.click('[data-testid="page-nav"] a[href*="db=2"]')
    await page.waitForURL(/db=2/, { timeout: 15_000 })
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
  await step('форма создания работает из браузера (notice + строка)', async () => {
    const title = 'браузер-' + Date.now().toString(36)
    await page.fill('input[name="title"]', title)
    // Статус собственного POST важен: 403 здесь — не отказ слоя, а CSRF-проверка
    // Kit (порт превью не в списке trusted origins), и без него шаг выглядел бы
    // как «форма не отвечает».
    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/db-demo'), {
      timeout: 15_000,
    })
    await page.click('button[data-testid="create"]')
    const res = await posted
    if (res.status() === 403)
      throw new Error(
        `403 на POST: порт ${new URL(BASE).port} не в списке trusted origins — ` +
          'перезапустите превью с PREVIEW_PORTS=<порт> или KIT_TRUSTED_ORIGINS=<origin>',
      )
    if (!res.ok()) throw new Error(`POST ?/create = ${res.status()}`)
    await page.waitForSelector('[data-testid="notice"]', { timeout: 15_000 })
    const text = await page.textContent('[data-testid="notice"]')
    const first = await page.textContent('[data-testid="row"]')
    if (!first?.includes(title)) throw new Error(`созданной записи нет первой в списке: ${first}`)
    return `notice «${text?.trim()}», строка первая`
  })
  await step('счётчик вырос после создания', async () => {
    const total = Number((await page.textContent('[data-testid="total"]'))?.trim())
    if (total !== totalBefore + 1) throw new Error(`total ${totalBefore} → ${total}`)
    return `${totalBefore} → ${total}`
  })
  await step('фильтр из адреса применяется в браузере', async () => {
    const flt = encodeURIComponent(JSON.stringify({ op: 'eq', field: 'title', value: 'несуществующий-заголовок' }))
    await page.goto(`${BASE}?db.flt=${flt}`, { waitUntil: 'networkidle' })
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
