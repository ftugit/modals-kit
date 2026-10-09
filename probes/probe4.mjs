import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173/modals'
const b = await chromium.launch()
const log = console.log

const read = (p) => p.evaluate(() => {
  const sk = history.state?.['sveltekit:states'] ?? {}
  const m = sk.modals ?? history.state?.modals ?? {}
  return {
    depth: m.depth ?? 0,
    transient: (m.transient ?? []).map((t) => t.id),
    url: location.pathname + location.search,
    floating: document.querySelectorAll('[data-host-floating]').length,
    layout: document.querySelector('[data-host-floating]')?.getAttribute('data-layout') ?? null,
    stages: document.querySelectorAll('.modal-stage').length,
    positioner: document.querySelectorAll('[data-select-positioner]').length,
    bodyOverflow: getComputedStyle(document.body).overflow,
    backdropVisible: (() => { const el = document.querySelector('.modal-backdrop'); if (!el) return null
      const cs = getComputedStyle(el); return cs.display !== 'none' && !el.hasAttribute('hidden') })(),
  }
})

/* ── A: мобильный лист — есть ли headless-запись на самом деле ────── */
{
  log('=== A: мобильный лист (390px), правильное чтение состояния ===')
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  log('  до        ', JSON.stringify(await read(p)))
  await p.locator('select').first().click({ force: true })
  await p.waitForTimeout(600)
  log('  лист открыт', JSON.stringify(await read(p)))
  log('  --- Назад (history.back) ---')
  await p.evaluate(() => history.back()); await p.waitForTimeout(700)
  log('  после Назад', JSON.stringify(await read(p)))
  await p.close()
}

/* ── B: поворот mobile → desktop при открытом листе ───────────────── */
{
  log('\n=== B: открыт на mobile → поворот в desktop → закрытие ===')
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(500)
  log('  открыт mobile ', JSON.stringify(await read(p)))
  await p.setViewportSize({ width: 1280, height: 860 }); await p.waitForTimeout(600)
  log('  после поворота', JSON.stringify(await read(p)))
  await p.mouse.click(5, 5); await p.waitForTimeout(600)
  log('  после закрытия', JSON.stringify(await read(p)))
  const s = await read(p)
  log(s.depth === 0 && s.transient.length === 0 ? '  ✅ цепочка чиста' : '  ❌ запись осталась в цепочке')
  await p.close()
}

/* ── C: обратный поворот desktop → mobile ─────────────────────────── */
{
  log('\n=== C: открыт на desktop → поворот в mobile → закрытие ===')
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(500)
  log('  открыт desktop', JSON.stringify(await read(p)))
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600)
  log('  после поворота', JSON.stringify(await read(p)))
  await p.keyboard.press('Escape'); await p.waitForTimeout(600)
  log('  после Escape  ', JSON.stringify(await read(p)))
  await p.close()
}

/* ── D: select внутри модалки на мобильной ширине ─────────────────── */
{
  log('\n=== D: select ВНУТРИ модалки, mobile 390px ===')
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  p.on('pageerror', (e) => log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('text=Select внутри модалки').first().click()
  await p.waitForTimeout(700)
  log('  модалка открыта', JSON.stringify(await read(p)))
  const inner = p.locator('.modal-popup select').first()
  await inner.click({ force: true })
  await p.waitForTimeout(800)
  log('  клик по select ', JSON.stringify(await read(p)))
  await p.screenshot({ path: 'shot-inner-mobile.png' })
  log('  --- Escape ---')
  await p.keyboard.press('Escape'); await p.waitForTimeout(600)
  log('  ', JSON.stringify(await read(p)))
  await p.close()
}

/* ── E: то же на desktop для сравнения ────────────────────────────── */
{
  log('\n=== E: select ВНУТРИ модалки, desktop 1280px ===')
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('text=Select внутри модалки').first().click()
  await p.waitForTimeout(700)
  const inner = p.locator('.modal-popup select').first()
  await inner.click({ force: true })
  await p.waitForTimeout(800)
  log('  клик по select ', JSON.stringify(await read(p)))
  await p.close()
}

await b.close()
