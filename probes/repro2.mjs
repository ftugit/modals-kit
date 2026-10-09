import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173/modals'
const b = await chromium.launch()
const R = []
const say = (id, ok, d) => { R.push([id, ok]); console.log(`${ok ? '🔴 ВОСПРОИЗВЕЛОСЬ' : '⚪ не воспроизвелось'}  ${id}\n     ${d}`) }
const chain = (p) => p.evaluate(() => (history.state?.['sveltekit:states']?.modals?.transient ?? []).map(x => x.id))

/* R10: modal-stack-cards — класс есть, правил нет */
{
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(800)
  const r = await p.evaluate(() => {
    const el = document.querySelector('.modal-popup')
    let rules = 0
    for (const sh of document.styleSheets) { try { for (const r of sh.cssRules)
      if (r.selectorText && r.selectorText.includes('modal-stack')) rules++ } catch {} }
    return { cls: el?.className, rules }
  })
  say('R10 класс modal-stack-cards рендерится, но правил для него в CSS нет',
    String(r.cls).includes('modal-stack-cards') && r.rules === 0,
    `class="${r.cls}" — найдено CSS-правил с modal-stack: ${r.rules}`)
  await p.close()
}
/* R11: data-mobile-anchor="fullscreen" без CSS-правил */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
  const sel = p.locator('.modal-popup select').first(); const bb = await sel.boundingBox()
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(800)
  const r = await p.evaluate(() => {
    const el = document.querySelector('[data-host-floating]')
    let rules = 0
    for (const sh of document.styleSheets) { try { for (const r of sh.cssRules)
      if (r.selectorText && r.selectorText.includes('fullscreen')) rules++ } catch {} }
    return { anchor: el?.getAttribute('data-mobile-anchor'), layout: el?.getAttribute('data-layout'), rules }
  })
  say('R11 data-mobile-anchor="fullscreen" выставляется, но CSS-правил с этим значением нет',
    r.anchor === 'fullscreen' && r.rules === 0,
    `anchor="${r.anchor}" layout="${r.layout}" правил с 'fullscreen': ${r.rules}`)
  await p.close()
}
/* R12: закрытие модалки при открытом вложенном select (размонтирование) */
{
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
  const sel = p.locator('.modal-popup select').first(); const bb = await sel.boundingBox()
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(600)
  const open = await p.evaluate(() => document.querySelectorAll('[data-host-floating]').length)
  await p.evaluate(() => history.back()); await p.waitForTimeout(800)
  const after = await p.evaluate(() => ({ fl: document.querySelectorAll('[data-host-floating]').length,
    stage: document.querySelectorAll('.modal-stage').length, url: location.search }))
  say('R12 закрытие модалки «Назад» при открытом select оставляет floating-контейнер',
    after.fl > 0, `floating до=${open} после закрытия модалки=${after.fl}, сцен=${after.stage}, url="${after.url}"`)
  await p.close()
}
/* R13: F5 с фантомной записью */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(500)
  await p.setViewportSize({ width: 1280, height: 860 }); await p.waitForTimeout(500)
  await p.mouse.click(5, 5); await p.waitForTimeout(500)
  const before = await chain(p)
  await p.reload(); await p.waitForTimeout(900)
  const after = await chain(p)
  const vis = await p.evaluate(() => ({ stage: document.querySelectorAll('.modal-stage').length,
    layers: document.querySelectorAll('.modal-layer').length }))
  say('R13 фантом переживает F5 (запись осталась в истории после перезагрузки)',
    after.length > 0, `до F5=${JSON.stringify(before)} после F5=${JSON.stringify(after)} сцен=${vis.stage} слоёв=${vis.layers}`)
  await p.close()
}
/* R14: несколько быстрых resize при открытом листе */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(500)
  for (let i = 0; i < 4; i++) {
    await p.setViewportSize({ width: 1280, height: 860 }); await p.waitForTimeout(150)
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150)
  }
  await p.waitForTimeout(600)
  const c = await chain(p)
  say('R14 серия быстрых поворотов накапливает headless-записи', c.length > 1,
    `записей в цепочке: ${c.length} → ${JSON.stringify(c)}`)
  await p.close()
}
/* R15: id растут — косвенное свидетельство роста Map layers */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  const ids = []
  for (let i = 0; i < 5; i++) {
    await p.locator('select').first().click({ force: true }); await p.waitForTimeout(350)
    ids.push((await chain(p))[0])
    await p.keyboard.press('Escape'); await p.waitForTimeout(350)
  }
  say('R15 каждый цикл открытия создаёт новый id (layerSeq растёт, записи в Map не удаляются)',
    new Set(ids).size === ids.length, `ids: ${JSON.stringify(ids)}`)
  await p.close()
}
/* R20: порядок Escape для вложенного select (desktop) */
{
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
  const sel = p.locator('.modal-popup select').first(); const bb = await sel.boundingBox()
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(600)
  const s0 = await p.evaluate(() => ({ fl: document.querySelectorAll('[data-host-floating]').length, st: document.querySelectorAll('.modal-stage').length }))
  await p.keyboard.press('Escape'); await p.waitForTimeout(500)
  const s1 = await p.evaluate(() => ({ fl: document.querySelectorAll('[data-host-floating]').length, st: document.querySelectorAll('.modal-stage').length }))
  await p.keyboard.press('Escape'); await p.waitForTimeout(600)
  const s2 = await p.evaluate(() => ({ fl: document.querySelectorAll('[data-host-floating]').length, st: document.querySelectorAll('.modal-stage').length }))
  const correct = s1.fl === 0 && s1.st === 1 && s2.st === 0
  say('R20 порядок Escape (ожидание: сначала список, потом модалка) НАРУШЕН', !correct,
    `старт fl=${s0.fl} st=${s0.st} → Escape1 fl=${s1.fl} st=${s1.st} → Escape2 fl=${s2.fl} st=${s2.st}`)
  await p.close()
}
/* R21: два select одновременно */
{
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
  const sels = p.locator('.modal-popup select')
  const n = await sels.count()
  if (n >= 2) {
    const b1 = await sels.nth(0).boundingBox(); await p.mouse.click(b1.x + 5, b1.y + b1.height / 2); await p.waitForTimeout(500)
    const f1 = await p.evaluate(() => document.querySelectorAll('[data-host-floating]').length)
    const b2 = await sels.nth(1).boundingBox(); await p.mouse.click(b2.x + 5, b2.y + b2.height / 2); await p.waitForTimeout(600)
    const f2 = await p.evaluate(() => document.querySelectorAll('[data-host-floating]').length)
    say('R21 второй select не закрывает первый — два floating одновременно', f2 > 1,
      `после 1-го=${f1}, после 2-го=${f2} (селектов в модалке: ${n})`)
  } else say('R21 два select одновременно', false, `в модалке найдено селектов: ${n}`)
  await p.close()
}
console.log('\nИТОГ ЧАСТЬ 2: воспроизведено ' + R.filter(x => x[1]).length + ' из ' + R.length)
await b.close()
