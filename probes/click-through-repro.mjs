/**
 * Воспроизведение click-through при закрытии host-floating (select/меню) по оверлею.
 *
 * Сценарий (мобильный):
 *   1. /paginator, источник Shikimori, панель фильтров с enhanced Select.
 *   2. Открываем multiselect — на узком экране это лист (headless-запись + sheetDialog
 *      со СВОИМ вторым оверлеем-backdrop'ом).
 *   3. Тапаем по оверлею в точке, где ПОД НИМ лежит чужой интерактивный элемент
 *      (нативный select другого контрола / кнопка).
 *   4. Смотрим, какие события дошли до элемента под оверлеем.
 *
 * Запуск: node probes/click-through-repro.mjs [baseUrl]
 */
import { chromium } from 'playwright'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const desc = (t) => {
  if (!t) return 'null'
  if (t === document) return '#document'
  if (t.nodeType !== 1) return String(t.nodeName)
  const el = t
  let s = el.tagName.toLowerCase()
  if (el.id) s += '#' + el.id
  for (const a of ['data-modal-backdrop', 'data-host-floating', 'data-select-native', 'data-select-root', 'data-select-trigger', 'data-modal-layer', 'data-modal-popup', 'data-modal-stage', 'data-layout', 'name', 'type']) {
    if (el.hasAttribute(a)) s += `[${a}=${el.getAttribute(a)}]`
  }
  const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
  if (txt && el.children.length === 0) s += ` "${txt}"`
  return s
}

const INSTRUMENT = `
  window.__ev = []
  const desc = ${desc.toString()}
  for (const type of ['pointerdown','pointerup','mousedown','mouseup','click','focusin']) {
    window.addEventListener(type, (e) => {
      window.__ev.push({ ph: 'win-cap', type, target: desc(e.target), x: e.clientX, y: e.clientY, pd: e.defaultPrevented, t: performance.now() | 0 })
    }, true)
    document.addEventListener(type, (e) => {
      window.__ev.push({ ph: 'doc-bub', type, target: desc(e.target), x: e.clientX, y: e.clientY, pd: e.defaultPrevented, t: performance.now() | 0 })
    }, false)
  }
`

/** Ищем точку, где под sheet-оверлеем лежит чужой интерактивный элемент. */
const FIND_POINT = `
  (() => {
    const backdrop = document.querySelector('[data-modal-backdrop]')
    const floatings = [...document.querySelectorAll('[data-host-floating]')]
    const hidden = []
    const hide = (el) => { hidden.push([el, el.style.visibility]); el.style.visibility = 'hidden' }
    if (backdrop) hide(backdrop)
    floatings.forEach(hide)
    const bodyPE = document.body.style.pointerEvents
    document.body.style.pointerEvents = 'auto'
    let found = null
    const W = innerWidth, H = innerHeight
    outer:
    for (let y = 30; y < H - 16; y += 14) {
      for (let x = 14; x < W - 14; x += 14) {
        const stack = document.elementsFromPoint(x, y)
        const behind = stack.find((el) =>
          el.closest && el.closest('select, button, a, input, [data-select-trigger], [role="button"]'))
        if (behind) {
          found = {
            x, y,
            behind: behind.tagName.toLowerCase()
              + (behind.id ? '#' + behind.id : '')
              + (behind.getAttribute('name') ? '[name=' + behind.getAttribute('name') + ']' : '')
              + (behind.hasAttribute('data-select-native') ? '[data-select-native]' : ''),
          }
          break outer
        }
      }
    }
    document.body.style.pointerEvents = bodyPE
    hidden.forEach(([el, v]) => { el.style.visibility = v })
    return found
  })()
`

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text())
  })

  console.log('— Открытие ' + BASE + '/paginator ...')
  await page.goto(BASE + '/paginator', { waitUntil: 'networkidle' })

  // Меняем источник на Shikimori через нативный select панели настроек.
  const srcSelect = page.locator('select[name="page.src"]')
  await srcSelect.waitFor({ state: 'visible' })
  await srcSelect.selectOption('animes')
  console.log('— Источник переключён на Shikimori, ждём панель фильтров...')
  try {
    await page.waitForFunction(
      () => {
        const form = document.querySelector('[data-testid="catalog-filter-form"]')
        if (!form) return false
        const r = form.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && form.querySelectorAll('[data-select-root]').length > 0
      },
      { timeout: 45000, polling: 500 },
    )
  } catch {
    const diag = await page.evaluate(() => ({
      url: location.search,
      form: !!document.querySelector('[data-testid="catalog-filter-form"]'),
      selectRoots: document.querySelectorAll('[data-select-root]').length,
      err: document.querySelector('[data-testid="filters-schema-error"]')?.textContent ?? null,
    }))
    throw new Error('Панель фильтров не появилась: ' + JSON.stringify(diag))
  }
  await sleep(500)

  // Раскрываем свёрнутую панель фильтров (<details>).
  const toggle = page.locator('[data-testid="filters-toggle"]')
  await toggle.scrollIntoViewIfNeeded()
  await toggle.tap()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="filters-details"]')?.open === true,
    { timeout: 5000 },
  )
  console.log('— Панель фильтров раскрыта.')

  // Открываем первый select/multiselect панели фильтров тачем.
  const firstSelect = page.locator('[data-testid="catalog-filter-form"] [data-select-root]').first()
  console.log('— Открываем первый select панели фильтров тачем...')
  await page.evaluate(INSTRUMENT)
  await firstSelect.scrollIntoViewIfNeeded()
  const box = await firstSelect.boundingBox()
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForSelector('[data-host-floating][data-layout="sheet"]', { timeout: 8000 })
  await page.waitForSelector('[data-modal-backdrop]', { timeout: 8000 })
  await sleep(400)
  console.log('— Лист открыт (data-layout="sheet"), оверлей на месте. Ищем точку для тапа...')

  const stateBefore = await page.evaluate(() => ({
    bodyPE: document.body.style.pointerEvents,
    backdrops: document.querySelectorAll('[data-modal-backdrop]').length,
    floatings: document.querySelectorAll('[data-host-floating]').length,
    expanded: [...document.querySelectorAll('[data-select-root][data-expanded]')].map((el) => el.id || el.getAttribute('name') || '?'),
  }))
  console.log('  состояние до тапа:', JSON.stringify(stateBefore))

  const point = await page.evaluate(FIND_POINT)
  if (!point) throw new Error('Не нашли интерактивный элемент под оверлеем')
  console.log(`— Точка тапа: (${point.x}, ${point.y}), под оверлеем: ${point.behind}`)

  // Что реально под точкой в боевом состоянии (с замком страницы)?
  const realHit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el ? el.tagName.toLowerCase() + (el.hasAttribute('data-modal-backdrop') ? '[data-modal-backdrop]' : '') : 'none'
    },
    point,
  )
  console.log(`— Реальный hit-test в этой точке: ${realHit}`)

  await page.evaluate(() => { window.__ev.length = 0 })
  console.log('— Тапаем по оверлею...')
  await page.touchscreen.tap(point.x, point.y)
  await sleep(700)

  const events = await page.evaluate(() => window.__ev)
  console.log('\n=== ЖУРНАЛ СОБЫТИЙ жеста ===')
  for (const e of events) {
    console.log(`  ${String(e.t).padStart(6)}ms ${e.ph.padEnd(8)} ${e.type.padEnd(11)} → ${e.target}${e.pd ? ' [defaultPrevented]' : ''}`)
  }

  const stateAfter = await page.evaluate(() => ({
    bodyPE: document.body.style.pointerEvents,
    backdrops: document.querySelectorAll('[data-modal-backdrop]').length,
    floatings: document.querySelectorAll('[data-host-floating]').length,
    expanded: [...document.querySelectorAll('[data-select-root][data-expanded]')].map((el) => el.id || '?'),
    active: (() => {
      const el = document.activeElement
      if (!el) return 'null'
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.getAttribute('name') ? '[name=' + el.getAttribute('name') + ']' : '')
    })(),
  }))
  console.log('\n=== СОСТОЯНИЕ после тапа ===')
  console.log(JSON.stringify(stateAfter, null, 2))

  // Аналитика: дошли ли события до элемента ПОД оверлеем (кроме штатного focusin на триггер)
  const behind = 'select[name=page.bottomZone]'
  const leaked = events.filter((e) => e.ph === 'doc-bub' && e.target.includes(behind))
  const swallowed = events.filter(
    (e) => e.ph === 'win-cap' && e.target.includes(behind) &&
      !events.some((d) => d.ph === 'doc-bub' && d.type === e.type && d.target === e.target),
  )
  console.log('\n=== АНАЛИЗ (жест закрытия) ===')
  console.log(`  всего событий: ${events.length}`)
  console.log(`  событий дошло до элемента под оверлеем (${behind}): ${leaked.length}`)
  for (const e of leaked) console.log(`    LEAK: ${e.ph} ${e.type} → ${e.target}`)
  console.log(`  заглушено на capture (не дошло): ${swallowed.length}`)
  for (const e of swallowed) console.log(`    SWALLOWED: ${e.ph} ${e.type} → ${e.target}`)
  console.log(`  mousedown/mouseup дошли: ${events.filter((e) => e.type === 'mousedown' || e.type === 'mouseup').length}`)
  console.log(`  лист закрыт: ${stateAfter.floatings === 0}`)
  console.log(`  фокус на триггере (restoreFocus): ${stateAfter.active.includes('page.filters.genres.and')}`)

  /* ── Фаза 2: быстрый повторный тап по триггеру — лист должен переоткрыться ── */
  console.log('\n— Фаза 2: повторный тап по триггеру сразу после закрытия...')
  await page.evaluate(() => { window.__ev.length = 0 })
  const trigBox = await firstSelect.boundingBox()
  await page.touchscreen.tap(trigBox.x + trigBox.width / 2, trigBox.y + trigBox.height / 2)
  await sleep(500)
  const reopened = await page.evaluate(() => ({
    floatings: document.querySelectorAll('[data-host-floating][data-layout="sheet"]').length,
    expanded: [...document.querySelectorAll('[data-select-root][data-expanded]')].length,
  }))
  console.log(`  лист переоткрылся: ${reopened.floatings > 0 && reopened.expanded > 0}`)

  /* ── Фаза 3: закрываем снова и тапаем прямо по элементу под бывшим оверлеем ── */
  console.log('— Фаза 3: закрываем лист тапом по оверлею и тапаем по элементу под ним...')
  await page.touchscreen.tap(point.x, point.y)
  await page.waitForSelector('[data-host-floating]', { state: 'detached', timeout: 5000 })
  await sleep(300)
  await page.evaluate(() => { window.__ev.length = 0 })
  await page.touchscreen.tap(point.x, point.y)
  await sleep(500)
  const direct = await page.evaluate(() => window.__ev)
  const delivered = direct.filter((e) => e.ph === 'doc-bub' && e.target.includes(behind))
  console.log('=== АНАЛИЗ (прямой тап по элементу под бывшим оверлеем) ===')
  for (const e of direct) {
    console.log(`  ${String(e.t).padStart(6)}ms ${e.ph.padEnd(8)} ${e.type.padEnd(11)} → ${e.target}`)
  }
  console.log(`  элемент получил события (доставлено): ${delivered.length > 0}`)
  for (const e of delivered) console.log(`    OK: ${e.type} → ${e.target}`)

  await page.screenshot({ path: '/tmp/pw-check/after-tap.png' })
  await browser.close()
}

main().catch((e) => {
  console.error('\n❌ ' + (e.stack || e.message))
  process.exit(1)
})
