/**
 * Эксперимент: гасит ли preventDefault() на pointerdown (capture, shield-жест)
 * совместимые mouse-события (mousedown/mouseup/click) и focusin, которые иначе
 * уходят в элемент под снятым оверлеем.
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
  for (const a of ['data-modal-backdrop', 'data-host-floating', 'data-select-native', 'data-select-root', 'name', 'data-testid']) {
    if (el.hasAttribute(a)) s += `[${a}=${el.getAttribute(a)}]`
  }
  return s
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
})
const page = await context.newPage()
await page.goto(BASE + '/paginator', { waitUntil: 'networkidle' })
await page.locator('select[name="page.src"]').selectOption('animes')
await page.waitForFunction(() => {
  const form = document.querySelector('[data-testid="catalog-filter-form"]')
  return form && form.getBoundingClientRect().height > 0 && form.querySelectorAll('[data-select-root]').length > 0
}, { timeout: 45000, polling: 500 })
const toggle = page.locator('[data-testid="filters-toggle"]')
await toggle.scrollIntoViewIfNeeded()
await toggle.tap()
await page.waitForFunction(() => document.querySelector('[data-testid="filters-details"]')?.open === true)

// открываем лист
const firstSelect = page.locator('[data-testid="catalog-filter-form"] [data-select-root]').first()
await firstSelect.scrollIntoViewIfNeeded()
const box = await firstSelect.boundingBox()
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForSelector('[data-host-floating][data-layout="sheet"]', { timeout: 8000 })
await page.waitForSelector('[data-modal-backdrop]', { timeout: 8000 })
await sleep(400)

// Имитируем фикс: на pointerdown по щиту (html/body/backdrop) — preventDefault.
// Только пока лист открыт, чтобы не ломать остальную страницу.
await page.evaluate(() => {
  window.__ev = []
  const desc = (t) => {
    if (!t) return 'null'
    if (t === document) return '#document'
    if (t.nodeType !== 1) return String(t.nodeName)
    const el = t
    let s = el.tagName.toLowerCase()
    if (el.id) s += '#' + el.id
    for (const a of ['data-modal-backdrop', 'data-host-floating', 'data-select-native', 'name', 'data-testid']) {
      if (el.hasAttribute(a)) s += `[${a}=${el.getAttribute(a)}]`
    }
    return s
  }
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focusin']) {
    window.addEventListener(type, (e) => {
      window.__ev.push({ ph: 'win-cap', type, target: desc(e.target), pd: e.defaultPrevented, t: performance.now() | 0 })
    }, true)
    document.addEventListener(type, (e) => {
      window.__ev.push({ ph: 'doc-bub', type, target: desc(e.target), pd: e.defaultPrevented, t: performance.now() | 0 })
    }, false)
  }
  // сам "фикс": потребляем жест, начатый на щите
  document.addEventListener('pointerdown', (e) => {
    const t = e.target
    const onShield = t === document.documentElement || t === document.body ||
      (t instanceof Element && t.closest('[data-modal-backdrop]') !== null)
    if (onShield) e.preventDefault()
  }, true)
})

// точка тапа: под оверлеем — чужой select
const point = await page.evaluate(() => {
  const backdrop = document.querySelector('[data-modal-backdrop]')
  const floatings = [...document.querySelectorAll('[data-host-floating]')]
  const hidden = []
  const hide = (el) => { hidden.push([el, el.style.visibility]); el.style.visibility = 'hidden' }
  if (backdrop) hide(backdrop)
  floatings.forEach(hide)
  const bodyPE = document.body.style.pointerEvents
  document.body.style.pointerEvents = 'auto'
  let found = null
  outer:
  for (let y = 30; y < innerHeight - 16; y += 14) {
    for (let x = 14; x < innerWidth - 14; x += 14) {
      const stack = document.elementsFromPoint(x, y)
      const behind = stack.find((el) => el.closest && el.closest('select, button, a, input, [data-select-trigger]'))
      if (behind) {
        found = { x, y, behind: behind.tagName.toLowerCase() + (behind.getAttribute('name') ? '[name=' + behind.getAttribute('name') + ']' : '') }
        break outer
      }
    }
  }
  document.body.style.pointerEvents = bodyPE
  hidden.forEach(([el, v]) => { el.style.visibility = v })
  return found
})
console.log('тапаем по оверлею в точке', JSON.stringify(point))
await page.evaluate(() => { window.__ev.length = 0 })
await page.touchscreen.tap(point.x, point.y)
await sleep(700)

const events = await page.evaluate(() => window.__ev)
console.log('=== ЖУРНАЛ СОБЫТИЙ (с preventDefault на pointerdown) ===')
for (const e of events) {
  console.log(`  ${String(e.t).padStart(6)}ms ${e.ph.padEnd(8)} ${e.type.padEnd(11)} → ${e.target}${e.pd ? ' [defaultPrevented]' : ''}`)
}
const after = await page.evaluate(() => ({
  floatings: document.querySelectorAll('[data-host-floating]').length,
  backdrops: document.querySelectorAll('[data-modal-backdrop]').length,
  active: document.activeElement ? document.activeElement.tagName.toLowerCase() + (document.activeElement.getAttribute('name') ? '[name=' + document.activeElement.getAttribute('name') + ']' : '') : 'null',
}))
console.log('после тапа:', JSON.stringify(after))
await browser.close()
