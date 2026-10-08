/**
 * Desktop-проверка «похожей болячки»: модалка открыта, поверх неё popup (select),
 * клик по фону МОДАЛКИ (второго слоя оверлея у popup на desktop нет).
 * Ожидание: popup закрывается, модалка остаётся, ни одно событие хвоста жеста
 * не активирует страницу/контролы модалки.
 */
import { chromium } from 'playwright'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })
await page.waitForSelector('[data-select-root][data-enhanced]')

// Открываем модалку с select внутри.
await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).click()
await page.locator('[data-modal-stage]').waitFor({ state: 'visible' })
await sleep(320)

// Открываем select внутри модалки (desktop → popup, без второго оверлея).
const select = page.locator('[data-modal-layer][data-active] select').first()
const sbox = await select.boundingBox()
await page.mouse.click(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, { force: true })
await page.waitForSelector('[data-host-floating][data-layout="popup"]')
await sleep(300)

// Точка клика: по фону модалки (за пределами stage), где под фоном — страница.
// Берём точку слева от модалки, внутри вьюпорта.
const point = { x: 40, y: 450 }
const hit = await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y)
  return el ? el.tagName.toLowerCase() + (el.hasAttribute('data-modal-backdrop') ? '[backdrop]' : '') : 'none'
}, point)
console.log('hit-test в точке клика:', hit)

await page.evaluate(() => {
  window.__ev = []
  const desc = (t) => {
    if (!t) return 'null'
    if (t === document) return '#document'
    if (t.nodeType !== 1) return String(t.nodeName)
    const el = t
    let s = el.tagName.toLowerCase()
    if (el.id) s += '#' + el.id
    for (const a of ['data-modal-backdrop', 'data-host-floating', 'data-select-native', 'data-modal-layer', 'data-modal-stage', 'name']) {
      if (el.hasAttribute(a)) s += `[${a}=${el.getAttribute(a)}]`
    }
    return s
  }
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focusin']) {
    window.addEventListener(type, (e) => window.__ev.push({ ph: 'win-cap', type, target: desc(e.target) }), true)
    document.addEventListener(type, (e) => window.__ev.push({ ph: 'doc-bub', type, target: desc(e.target) }), false)
  }
})

await page.mouse.click(point.x, point.y)
await page.waitForSelector('[data-host-floating]', { state: 'detached' })
await sleep(400)

const ev = await page.evaluate(() => window.__ev)
console.log('=== ЖУРНАЛ (desktop, клик по фону модалки при открытом popup) ===')
for (const e of ev) console.log(`  ${e.ph.padEnd(8)} ${e.type.padEnd(11)} → ${e.target}`)

const state = await page.evaluate(() => ({
  modalOpen: document.querySelectorAll('[data-modal-stage]').length,
  floatings: document.querySelectorAll('[data-host-floating]').length,
  chain: (history.state?.['sveltekit:states']?.modals?.transient ?? []).length,
  active: document.activeElement
    ? document.activeElement.tagName.toLowerCase() + (document.activeElement.id ? '#' + document.activeElement.id : '')
    : 'null',
}))
console.log('состояние после клика:', JSON.stringify(state))

const delivered = ev.filter((e) => e.ph === 'doc-bub')
const leaked = delivered.filter((e) => ['mousedown', 'mouseup', 'click'].includes(e.type) &&
  !e.target.includes('data-modal-backdrop'))
console.log('leak (доставлено не в фон):', JSON.stringify(leaked))
console.log('popup закрыт:', state.floatings === 0)
console.log('модалка открыта:', state.modalOpen === 1)
console.log('transient-цепочка (информационно; модальные записи могут жить в url/local — тогда transient пуст):', state.chain)
await browser.close()
