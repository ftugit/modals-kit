/**
 * Проба: сколько живёт pending (скелетоны) и когда появляется содержимое.
 *
 * Матрица сценариев «подгрузки»: список/колонки, накопление/смена страницы,
 * демо-пагинатор/галерея, смена размера страницы и настроек. Для каждого —
 * время до первого скелетона, время его жизни и время до нового содержимого.
 *
 * Основание для ожидания: демо-источник отвечает за DEMO_TRANSPORT_MS (500 мс,
 * src/content/items.ts) — скелетоны должны жить примерно столько же и уж точно
 * быть видны (порог заметности ~100 мс).
 *
 * Запуск: node probes/pag-pending-window.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.PAGINATE_BASE ?? 'http://127.0.0.1:4173/paginator'
const STAKE = 100 // мс — короче не читается глазом

const browser = await chromium.launch()

/** Общий сэмплер: пока идёт сценарий, копим хронологию скелетонов/элементов. */
async function sample(page, scenario) {
  const state = () =>
    page.evaluate(() => {
      const host = document.querySelector('[data-paginator-host]')
      return {
        skel: document.querySelectorAll('[data-testid="skeleton"]').length,
        items: host?.querySelectorAll('[data-testid^="card-"], [data-testid^="photo-"]').length ?? 0,
        busy: host?.getAttribute('aria-busy') === 'true',
      }
    })

  const before = await state()
  const t0 = Date.now()
  await scenario()
  let firstSkel = null
  let lastSkel = null
  let changedAt = null
  while (Date.now() - t0 < 2500) {
    const s = await state()
    const at = Date.now() - t0
    if (s.skel > 0) {
      if (firstSkel == null) firstSkel = at
      lastSkel = at
    }
    if (s.items !== before.items && s.skel === 0 && changedAt == null) changedAt = at
    if (changedAt != null && lastSkel != null) break
    await page.waitForTimeout(15)
  }
  return { before, firstSkel, lastSkel, changedAt }
}

async function open(q) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}${q ? `?${q}` : ''}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-paginator-host]')
  await page.waitForTimeout(250)
  return page
}

const goNext = (page) => page.locator('[data-testid="load-next"]').first().click()
const goPage2 = (page) =>
  page
    .locator('[data-paginator-host] [data-testid="page-nav"]')
    .first()
    .locator('button, a', { hasText: /^2$/ })
    .first()
    .click()
const galleryPage2 = (page) =>
  page
    .locator('[data-testid="gallery-nav"] [data-testid="page-nav"]')
    .first()
    .locator('button, a', { hasText: /^2$/ })
    .first()
    .click()

const cases = [
  ['список · накопление · «показать ещё»', 'page.size=5&page.bottomTrigger=manual&page.topTrigger=off', goNext],
  ['список · смена страницы (nav 2)', 'page.size=10&page.mode=single&page.topTrigger=off&page.bottomTrigger=off', goPage2],
  ['колонки · накопление · «показать ещё»', 'page.size=5&page.kind=photos&page.layout=columns&page.bottomTrigger=manual&page.topTrigger=off', goNext],
  ['колонки · смена страницы (nav 2)', 'page.size=10&page.kind=photos&page.layout=columns&page.mode=single&page.topTrigger=off&page.bottomTrigger=off', goPage2],
  ['галерея · смена страницы (nav 2)', '', galleryPage2],
  ['смена размера страницы', '', (page) => page.locator('select[name="page.size"]').selectOption('10')],
  ['смена настроек (вид: фото)', '', (page) => page.locator('select[name="page.kind"]').selectOption('photos')],
]

let bad = 0
for (const [label, q, scenario] of cases) {
  const page = await open(q)
  const r = await sample(page, () => scenario(page))
  await page.close()
  const life = r.firstSkel == null ? 0 : (r.lastSkel ?? 0) - r.firstSkel
  const okSkel = r.firstSkel != null
  const okLife = life >= STAKE
  if (!okSkel || !okLife) bad += 1
  console.log(
    `▸ ${label}\n` +
      `   скелетоны: ${okSkel ? `с ${r.firstSkel} мс, жили ≈${life} мс` : 'НЕ ПОЯВИЛИСЬ'}` +
      ` ${okLife ? '✓' : '✗'}\n` +
      `   содержимое обновилось: ${r.changedAt == null ? 'не дождались' : `${r.changedAt} мс`} ` +
      `(элементов ${r.before.items} → новое)`,
  )
}

await browser.close()
console.log(bad ? `\nИТОГ: сценариев без видимой загрузки — ${bad}` : '\nИТОГ: во всех сценариях загрузка видна ✓')
process.exit(bad ? 1 : 0)
