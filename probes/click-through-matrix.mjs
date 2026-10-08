/**
 * Матрица click-through: тап по оверлею листа над элементами РАЗНЫХ типов.
 *
 * Зачем: показать, что фикс корневой (механизм потребления жеста), а не
 * «починили select». Прогон на одной странице, три цели под оверлеем:
 *   - нативный select (панель настроек)
 *   - кнопка «Применить» (форма фильтров)
 *   - поле поиска (input)
 *
 * Лист открываем через select «Тип» (короткий список — панель низкая, зона щита
 * большая), клавиатурно (фокус + ArrowDown), чтобы не зависеть от прокрутки.
 *
 * A/B: на базе (до фикса) все три цели получают mousedown/mouseup/focusin;
 * на фиксе — ничего не доставляется ни одной цели.
 *
 * Запуск: node probes/click-through-matrix.mjs [baseUrl]
 */
import { chromium } from 'playwright'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4173').replace(/\/$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TARGETS = [
  { type: 'select', selector: 'select[name="page.src"]', label: 'нативный select (настройки)' },
  { type: 'button', selector: '[data-testid="catalog-filter-submit"]', label: 'кнопка «Применить»' },
  { type: 'input', selector: '[data-testid="search-input"]', label: 'поле поиска' },
]

// Select «Тип» (id page.filters.kind): короткий список → низкая панель листа.
const TRIGGER_SELECT = 'select[id="page.filters.kind"]'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
})
const page = await context.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message.slice(0, 200)))

console.log('— Открытие ' + BASE + '/paginator ...')
await page.goto(BASE + '/paginator', { waitUntil: 'networkidle' })
await page.locator('select[name="page.src"]').selectOption('animes')
await page.waitForFunction(
  () => {
    const form = document.querySelector('[data-testid="catalog-filter-form"]')
    return form && form.getBoundingClientRect().height > 0 && form.querySelectorAll('[data-select-root]').length > 0
  },
  { timeout: 45000, polling: 500 },
)
const toggle = page.locator('[data-testid="filters-toggle"]')
await toggle.scrollIntoViewIfNeeded()
await toggle.tap()
await page.waitForFunction(() => document.querySelector('[data-testid="filters-details"]')?.open === true)
await sleep(400)

// Журнал событий: win-cap видит всё, doc-bub — только доставленное.
await page.evaluate(() => {
  window.__ev = []
  const desc = (t) => {
    if (!t) return 'null'
    if (t === document) return '#document'
    if (t.nodeType !== 1) return String(t.nodeName)
    const el = t
    let s = el.tagName.toLowerCase()
    if (el.id) s += '#' + el.id
    for (const a of ['data-modal-backdrop', 'data-host-floating', 'data-select-native', 'data-modal-layer', 'name', 'data-testid']) {
      if (el.hasAttribute(a)) s += `[${a}=${el.getAttribute(a)}]`
    }
    return s
  }
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focusin']) {
    window.addEventListener(type, (e) => {
      window.__ev.push({
        ph: 'win-cap', type, target: desc(e.target),
        onTarget: Boolean(e.target instanceof Element && e.target.closest('[data-matrix-target]')),
      })
    }, true)
    document.addEventListener(type, (e) => {
      window.__ev.push({
        ph: 'doc-bub', type, target: desc(e.target),
        onTarget: Boolean(e.target instanceof Element && e.target.closest('[data-matrix-target]')),
      })
    }, false)
  }
})

const sheetOpen = () =>
  page.evaluate(() => document.querySelectorAll('[data-host-floating][data-layout="sheet"]').length > 0)

/** Закрыть лист, если открыт. */
async function closeSheet() {
  if (!(await sheetOpen())) return
  await page.keyboard.press('Escape')
  await page.locator('[data-host-floating]').waitFor({ state: 'detached', timeout: 8000 })
  await sleep(400) // guard lastClosedAt (250 мс) в Select
}

/** Открыть лист клавиатурой (фокус на триггерном select + ArrowDown). */
async function openSheet() {
  if (await sheetOpen()) return
  await page.evaluate((sel) => {
    document.querySelector(sel)?.focus({ preventScroll: true })
  }, TRIGGER_SELECT)
  await page.keyboard.press('ArrowDown')
  await page.waitForSelector('[data-host-floating][data-layout="sheet"]', { timeout: 8000 })
  await page.waitForSelector('[data-modal-backdrop]', { timeout: 8000 })
  await sleep(350)
}

/**
 * Притащить цель наверх вьюпорта (зона щита), ПОКА лист закрыт и страница не
 * заперта. block:'start' кладёт элемент на верх main-скроллера (под шапкой).
 */
async function bringToTop(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { ok: false, reason: 'элемент не найден' }
    el.scrollIntoView({ block: 'start' })
    const r = el.getBoundingClientRect()
    return { ok: true, cx: r.left + r.width / 2, cy: r.top + r.height / 2, top: r.top, bottom: r.bottom }
  }, selector)
}

console.log('\n=== МАТРИЦА: тап по оверлею над целью ===')
let allClean = true
for (const target of TARGETS) {
  await closeSheet()
  const zone = await bringToTop(target.selector)
  if (!zone.ok) {
    console.log(`  ${target.type.padEnd(6)} (${target.label}): ПРОПУЩЕН — ${zone.reason}`)
    allClean = false
    continue
  }
  await openSheet()
  // Контроль: в точке цели реальный hit-test — щит (html/backdrop), не панель листа.
  const hit = await page.evaluate(({ cx, cy }) => {
    const el = document.elementFromPoint(cx, cy)
    if (!el) return 'none'
    return el === document.documentElement || el === document.body ? 'html' : el.tagName.toLowerCase()
  }, zone)
  const panelTop = await page.evaluate(
    () => document.querySelector('[data-host-floating]')?.getBoundingClientRect().top ?? 0,
  )
  if (hit === 'none' || zone.cy >= panelTop - 24) {
    console.log(`  ${target.type.padEnd(6)} (${target.label}): ПРОПУЩЕН — цель вне зоны щита (y=${Math.round(zone.cy)}, panelTop=${Math.round(panelTop)}, hit=${hit})`)
    allClean = false
    continue
  }

  await page.evaluate((sel) => {
    document.querySelector(sel)?.setAttribute('data-matrix-target', '')
  }, target.selector)
  await page.evaluate(() => { window.__ev.length = 0 })

  await page.touchscreen.tap(zone.cx, zone.cy)
  await page.locator('[data-host-floating]').waitFor({ state: 'detached', timeout: 8000 })
  await sleep(400)

  const ev = await page.evaluate(() => window.__ev)
  const delivered = ev.filter((e) => e.ph === 'doc-bub')
  const toTarget = delivered.filter((e) => e.onTarget)
  const mouseLeak = delivered.filter((e) => ['mousedown', 'mouseup', 'click'].includes(e.type))
  const focusLeak = delivered.filter((e) => e.type === 'focusin' && e.onTarget)
  const after = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return {
      floatings: document.querySelectorAll('[data-host-floating]').length,
      modals: document.querySelectorAll('[data-modal-stage]').length,
      chain: (history.state?.['sveltekit:states']?.modals?.transient ?? []).length,
      activeIsTarget: document.activeElement === el,
    }
  }, target.selector)
  await page.evaluate((sel) => {
    document.querySelector(sel)?.removeAttribute('data-matrix-target')
  }, target.selector)

  const clean = toTarget.length === 0 && mouseLeak.length === 0 && focusLeak.length === 0 &&
    !after.activeIsTarget && after.floatings === 0 && after.modals === 0 && after.chain === 0
  if (!clean) allClean = false
  console.log(`\n  цель: ${target.label} — тап по оверлею в (${Math.round(zone.cx)}, ${Math.round(zone.cy)})`)
  console.log(`  доставлено цели: ${toTarget.length} ${toTarget.length ? JSON.stringify(toTarget.map((e) => e.type)) : ''}`)
  console.log(`  доставлено mousedown/mouseup/click куда-либо: ${mouseLeak.length} ${mouseLeak.length ? JSON.stringify(mouseLeak.map((e) => `${e.type}→${e.target}`)) : ''}`)
  console.log(`  фокус украден целью: ${focusLeak.length > 0 || after.activeIsTarget}`)
  console.log(`  побочки: модалок=${after.modals}, цепочка=${after.chain}, лист закрыт=${after.floatings === 0}`)
  console.log(`  ИТОГ: ${clean ? 'ЧИСТО' : 'УТЕЧКА'}`)
}

console.log(`\n${allClean ? '✅ Матрица чистая: ни один тип элемента под оверлеем ничего не получил' : '❌ Матрица с утечками (ожидаемо на базе до фикса)'}`)
await browser.close()
process.exitCode = allClean ? 0 : 1
