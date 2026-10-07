/**
 * Фокус-проба: подгрузка в раскладке «колонки» — что происходит по шагам.
 * Хронология: клик по «показать ещё» → состояние хоста → скелетоны → элементы.
 *
 * Запуск: node probes/pag-cols-timeline.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.PAGINATE_BASE ?? 'http://127.0.0.1:4173/paginator'
const Q = process.env.Q ?? 'page.size=8&page.kind=photos&page.layout=columns&page.bottomTrigger=manual&page.topTrigger=off'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

await page.goto(`${BASE}?${Q}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

const probe = () =>
  page.evaluate(() => {
    const host = document.querySelector('[data-paginator-host]')
    const cols = document.querySelector('[data-testid^="masonry-col-"]')?.parentElement
    return {
      busy: host?.getAttribute('aria-busy'),
      sr: document.querySelector('[data-paginator-host] .sr-only')?.textContent?.trim() ?? '',
      skel: document.querySelectorAll('[data-testid="skeleton"]').length,
      items: host?.querySelectorAll('[data-testid^="photo-"], [data-testid^="card-"]').length ?? 0,
      statusRows: [...document.querySelectorAll('[data-paginator-host] *')].filter((el) =>
        /^Загрузка страницы/.test(el.textContent?.trim() ?? ''),
      ).length,
      cols: cols?.children.length ?? 0,
      colCells: cols ? [...cols.children].map((c) => c.children.length) : [],
      skeletons: document.querySelectorAll('[data-testid="skeleton"]').length,
    }
  })

console.log('до клика:', await probe())
const link = page.locator('[data-testid="load-next"]').first()
const hasLink = (await link.count()) > 0
let target = link
if (!hasLink) {
  // классический режим: страницы листаются навигацией под списком
  target = page
    .locator('[data-paginator-host] [data-testid="page-nav"]')
    .first()
    .locator('button, a', { hasText: /^2$/ })
    .first()
  console.log('режим без ссылки: жмём страницу 2 в навигации')
} else {
  console.log('ссылка «показать ещё»:', await link.count(), await link.isVisible().catch(() => false))
}

await target.click({ noWaitAfter: true })
const t0 = Date.now()
let last = null
while (Date.now() - t0 < 1400) {
  const s = await probe()
  const key = JSON.stringify(s)
  if (key !== last) {
    console.log(`  +${String(Date.now() - t0).padStart(4)} мс`, s)
    last = key
  }
  await page.waitForTimeout(15)
}
await page.screenshot({ path: 'probes/cols-after.png' })
await browser.close()
