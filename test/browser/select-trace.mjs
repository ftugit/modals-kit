import { chromium } from 'playwright'

const BASE = process.env.SELECT_TRACE_BASE ?? 'http://127.0.0.1:5173/modals'
const TRACE_PREFIX = '[modals/select-trace] '

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function withTrace(url, enabled) {
  const result = new URL(url)
  result.searchParams.delete('selectTrace')
  if (enabled) result.searchParams.set('selectTrace', '1')
  return result.href
}

function withTraceValue(url, value) {
  const result = new URL(url)
  result.searchParams.set('selectTrace', value)
  return result.href
}

async function openInnerSelect(page) {
  await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).click()
  await page.locator('[data-modal-stage]').waitFor({ state: 'visible' })
  await page.locator('[data-modal-layer][data-active] select').first().click({ force: true })
  await page.waitForSelector('[data-host-floating]', { state: 'visible' })
}

async function readTransientCount(page) {
  return page.evaluate(() =>
    (history.state?.['sveltekit:states']?.modals?.transient ?? []).length,
  )
}

const browser = await chromium.launch({ headless: true })
try {
  // Diagnostics must be opt-in even on a development server; only value=1 enables the URL flag.
  for (const url of [withTrace(BASE, false), withTraceValue(BASE, '0')]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const logs = []
    page.on('console', (message) => {
      if (message.text().startsWith(TRACE_PREFIX)) logs.push(message.text())
    })
    await page.goto(url, { waitUntil: 'networkidle' })
    await openInnerSelect(page)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-host-floating]', { state: 'detached' })
    assert(logs.length === 0, `trace без selectTrace=1 должен быть молча выключен, записей ${logs.length}`)
    await page.close()
  }

  // The DevTools flag provides the second opt-in path, even without a query parameter.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const records = []
    page.on('console', (message) => {
      const text = message.text()
      if (text.startsWith(TRACE_PREFIX)) records.push(JSON.parse(text.slice(TRACE_PREFIX.length)))
    })
    await page.addInitScript(() => { window.__MODALS_SELECT_TRACE__ = true })
    await page.goto(withTrace(BASE, false), { waitUntil: 'networkidle' })
    await openInnerSelect(page)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-host-floating]', { state: 'detached' })
    await page.waitForTimeout(50)
    assert(records.some((record) => record.event.type === 'pointerdown' && record.select.inRoot),
      'window.__MODALS_SELECT_TRACE__ не включил trace без query')
    await page.close()
  }

  // Check trigger, popup, and an outside press whose actual target is a modal button.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const records = []
  page.on('console', (message) => {
    const text = message.text()
    if (!text.startsWith(TRACE_PREFIX)) return
    try {
      records.push(JSON.parse(text.slice(TRACE_PREFIX.length)))
    } catch {
      throw new Error(`Select trace не является JSON: ${text}`)
    }
  })

  await page.goto(withTrace(BASE, true), { waitUntil: 'networkidle' })
  await openInnerSelect(page)
  const select = page.locator('[data-modal-layer][data-active] select').first()
  const option = page.locator('[data-host-floating] [role="option"]', { hasText: 'Боевик' }).first()
  await option.click()
  await page.waitForSelector('[data-host-floating]', { state: 'detached' })
  await page.waitForTimeout(300)

  await select.click({ force: true })
  await page.waitForSelector('[data-host-floating]', { state: 'visible' })
  const action = page
    .locator('[data-modal-layer][data-active] button')
    .filter({ hasText: 'Без хранилища поверх' })
    .first()
  const box = await action.boundingBox()
  assert(box, 'не найдена кнопка для проверки outside hit-test')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const physicalHit = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y)
    return hit?.closest('button')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  }, point)
  assert(physicalHit.includes('Без хранилища поверх'), `hit-test попал не в кнопку: ${physicalHit}`)
  await page.mouse.click(point.x, point.y)
  await page.waitForSelector('[data-host-floating]', { state: 'detached' })
  await page.waitForTimeout(80)
  assert((await readTransientCount(page)) === 0, 'outside gesture неожиданно активировал кнопку за Select')

  const triggerPress = records.find((record) =>
    record.event.type === 'pointerdown' && record.select.inRoot && record.target?.tag === 'select',
  )
  assert(triggerPress, 'нет trace записи на нажатие trigger')
  assert(triggerPress.browser?.userAgent && 'hitTest' in triggerPress,
    'trace trigger не содержит browser/hit-test данных')
  assert(triggerPress.event.defaultPreventedAfterDispatch === true,
    'trace не фиксирует defaultPrevented после обработчика Select')

  const popupPress = records.find((record) =>
    record.event.type === 'pointerdown' && record.select.inPopup && record.target?.data?.floating,
  )
  assert(popupPress, 'нет trace записи на нажатие option/popup')

  const outsidePress = records.find((record) =>
    record.event.type === 'pointerdown' && record.select.open &&
    !record.select.inRoot && !record.select.inPopup &&
    record.target?.text?.includes('Без хранилища поверх'),
  )
  assert(outsidePress, 'outside pointerdown с реальным modal hit-target не попал в trace')
  assert(outsidePress.hitTest?.text?.includes('Без хранилища поверх'),
    'outside trace потерял elementFromPoint')
  assert(outsidePress.event.defaultPreventedAfterDispatch === true,
    'trace не показал preventDefault, которым гасится background press')

  const outsideClick = records.find((record) =>
    record.event.type === 'click' && !record.select.open &&
    record.target?.text?.includes('Без хранилища поверх'),
  )
  assert(outsideClick, 'trace не зафиксировал trailing click после закрытия Select')
  assert(outsideClick.event.defaultPreventedAfterDispatch === true,
    'trace не показал, что trailing click был подавлен')

  console.log(`  ok  dev trace opt-in; trigger/popup/outside: ${records.length} JSON records, реальные target и browser данные`)
  await page.close()
} finally {
  await browser.close()
}
