/**
 * Проба: скелетоны при подгрузке ЖЕСТОМ (скролл колесом, дефолтная конфигурация).
 * Программный scrollTop жест не заменяет: триггеры direction/chat считают намерение
 * пользователя по wheel/touch, поэтому скроллим колесом.
 *
 * Запуск: node probes/pag-edge-skel.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.PAGINATE_BASE ?? 'http://127.0.0.1:4173/paginator'
const Q = process.env.Q ?? ''

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(`${BASE}${Q ? `?${Q}` : ''}`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-paginator-host]')
await page.waitForTimeout(300)

const host = page.locator('[data-paginator-host]').first()
await host.hover() // scrollIntoView + курсор в центр контейнера

const state = () =>
  page.evaluate(() => {
    const h = document.querySelector('[data-paginator-host]')
    return {
      busy: h?.getAttribute('aria-busy'),
      skel: document.querySelectorAll('[data-testid="skeleton"]').length,
      items: h?.querySelectorAll('[data-testid^="card-"], [data-testid^="photo-"]').length ?? 0,
      scrollTop: Math.round(h?.scrollTop ?? -1),
      scrollHeight: Math.round(h?.scrollHeight ?? -1),
    }
  })

console.log('старт:', await state())
// крутим колесом вниз — как пользователь
for (let i = 0; i < 12; i += 1) {
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(60)
}
console.log('после жеста вниз:', await state())

const t0 = Date.now()
let last = null
while (Date.now() - t0 < 1500) {
  const s = await state()
  const key = JSON.stringify({ busy: s.busy, skel: s.skel, items: s.items })
  if (key !== last) {
    console.log(`  +${String(Date.now() - t0).padStart(4)} мс  busy=${s.busy} скелетонов=${s.skel} элементов=${s.items}`)
    last = key
  }
  await page.waitForTimeout(15)
}
await browser.close()
