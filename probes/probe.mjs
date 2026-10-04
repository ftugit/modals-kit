import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:4173/modals'
const b = await chromium.launch()
const log = (...a) => console.log(...a)

const state = (p) => p.evaluate(() => {
  const s = history.state?.modals ?? {}
  return {
    depth: s.depth ?? 0,
    transient: (s.transient ?? []).map((t) => t.id),
    order: (s.order ?? []).length,
    stages: document.querySelectorAll('.modal-stage').length,
    floatings: document.querySelectorAll('[data-host-floating]').length,
    layout: document.querySelector('[data-host-floating]')?.getAttribute('data-layout') ?? null,
  }
})

/* ── P1: поворот mobile → desktop при открытом списке ─────────────── */
{
  log('\n=== P1: открыт на mobile, поворот в desktop ===')
  const page = await b.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(BASE)
  await page.waitForTimeout(400)
  log('  исходно      ', JSON.stringify(await state(page)))

  await page.locator('select').first().click({ force: true })
  await page.waitForTimeout(400)
  log('  открыт mobile', JSON.stringify(await state(page)))

  await page.setViewportSize({ width: 1280, height: 860 })
  await page.waitForTimeout(500)
  log('  после поворота', JSON.stringify(await state(page)))

  // закрываем список кликом снаружи
  await page.mouse.click(5, 5)
  await page.waitForTimeout(500)
  log('  после закрытия', JSON.stringify(await state(page)))

  const after = await state(page)
  log(after.depth === 0 && after.transient.length === 0
    ? '  ✅ цепочка чиста'
    : `  ❌ ОСТАЛАСЬ ЗАПИСЬ В ЦЕПОЧКЕ: depth=${after.depth} transient=${JSON.stringify(after.transient)}`)

  // что сделает Escape / Назад после этого
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  log('  после Escape ', JSON.stringify(await state(page)))
  await page.goBack()
  await page.waitForTimeout(400)
  log('  после Назад  ', JSON.stringify(await state(page)), 'url=', new URL(page.url()).pathname + new URL(page.url()).search)
  await page.close()
}

/* ── P2: накопление записей за несколько циклов поворота ──────────── */
{
  log('\n=== P2: три цикла «открыть на mobile → повернуть → закрыть» ===')
  const page = await b.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(BASE)
  await page.waitForTimeout(400)
  for (let i = 1; i <= 3; i++) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(250)
    await page.locator('select').first().click({ force: true })
    await page.waitForTimeout(350)
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.waitForTimeout(350)
    await page.mouse.click(5, 5)
    await page.waitForTimeout(350)
    log(`  цикл ${i}:`, JSON.stringify(await state(page)))
  }
  await page.close()
}

/* ── P3: каскад CSS в зоне 768–1023 при живом хосте (вопрос A4.2) ─── */
{
  log('\n=== P3: ширина 900px с хостом — какой CSS выиграл ===')
  const page = await b.newPage({ viewport: { width: 900, height: 800 } })
  await page.goto(BASE)
  await page.waitForTimeout(400)
  await page.locator('select').first().click({ force: true })
  await page.waitForTimeout(400)
  const css = await page.evaluate(() => {
    const pos = document.querySelector('[data-select-positioner]')
    const content = document.querySelector('.select-content')
    const host = document.querySelector('[data-host-floating]')
    const g = (el) => el ? (({ position, inset, width, height, zIndex }) =>
      ({ position, inset, width, height, zIndex }))(getComputedStyle(el)) : null
    return {
      positioner: g(pos),
      content: g(content),
      hostLayout: host?.getAttribute('data-layout') ?? null,
      hostRect: host ? host.getBoundingClientRect().toJSON() : null,
      posHasHostMenu: pos?.hasAttribute('data-host-menu') ?? null,
    }
  })
  log('  ', JSON.stringify(css, null, 2).replace(/\n/g, '\n  '))
  await page.close()
}

/* ── P4: mobileSize — проп объявлен, но используется ли? ──────────── */
{
  log('\n=== P4: .modal-stage при мобильном select (должно быть 0) ===')
  const page = await b.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(BASE)
  await page.waitForTimeout(400)
  await page.locator('select').first().click({ force: true })
  await page.waitForTimeout(400)
  log('  ', JSON.stringify(await state(page)))
  await page.close()
}

await b.close()
