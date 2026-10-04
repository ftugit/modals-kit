import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173/modals'
const b = await chromium.launch()
const R = []
const say = (id, ok, detail) => { R.push([id, ok]); console.log(`${ok ? '🔴 ВОСПРОИЗВЕЛОСЬ' : '⚪ не воспроизвелось'}  ${id}\n     ${detail}`) }
const st = (p) => p.evaluate(() => {
  const m = history.state?.['sveltekit:states']?.modals ?? {}
  return { depth: m.depth ?? 0, t: (m.transient ?? []).map(x => x.id),
    fl: document.querySelectorAll('[data-host-floating]').length,
    layers: document.querySelectorAll('.modal-layer').length,
    tails: document.querySelectorAll('.modal-tail').length,
    stage: document.querySelectorAll('.modal-stage').length }
})

/* R01 */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(500)
  await p.setViewportSize({ width: 1280, height: 860 }); await p.waitForTimeout(500)
  await p.mouse.click(5, 5); await p.waitForTimeout(600)
  const s = await st(p)
  say('R01 фантомная headless после mobile→desktop→close', s.t.length > 0,
    `chain=${JSON.stringify(s.t)} depth=${s.depth} floating=${s.fl} видимых модалок=${s.stage}`)
  await p.keyboard.press('Escape'); await p.waitForTimeout(500)
  const s2 = await st(p)
  say('R01b Escape после фантома не даёт видимой реакции', s2.t.length > 0 || s.t.length > 0,
    `после Escape chain=${JSON.stringify(s2.t)}`)
  await p.close()
}
/* R02 */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(600)
  const a = await st(p); await p.goBack(); await p.waitForTimeout(700)
  const c = await st(p); await p.goForward(); await p.waitForTimeout(800)
  const d = await st(p)
  say('R02 Forward возвращает запись, но не UI', d.t.length > 0 && d.fl === 0,
    `открыт fl=${a.fl} t=${JSON.stringify(a.t)} → Back fl=${c.fl} t=${JSON.stringify(c.t)} → Forward fl=${d.fl} t=${JSON.stringify(d.t)}`)
  await p.close()
}
/* R03 + R06 + R09 */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await p.goto(BASE); await p.waitForTimeout(600)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
  const before = await st(p)
  const sel = p.locator('.modal-popup select').first(); const bb = await sel.boundingBox()
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(900)
  const r = await p.evaluate(() => {
    const L = [...document.querySelectorAll('.modal-layer')]
    const act = L.find(l => l.hasAttribute('data-active'))
    return { n: L.length, activeEmpty: act ? (act.textContent || '').trim() === '' : null,
      realHidden: L.some(l => l.getAttribute('aria-hidden') === 'true' && (l.textContent || '').trim().length > 0),
      tails: document.querySelectorAll('.modal-tail').length,
      focus: document.activeElement?.className?.toString().slice(0, 45) || document.activeElement?.tagName }
  })
  say('R03 headless рендерится слоем: пустой активный + реальная модалка aria-hidden',
    r.n === 2 && r.activeEmpty === true && r.realHidden === true,
    `слоёв=${r.n} активный пустой=${r.activeEmpty} реальная скрыта=${r.realHidden}`)
  say('R09 хвосты считаются по полной цепочке (headless добавил хвост)', r.tails > (before.tails),
    `хвостов до select=${before.tails}, после=${r.tails}`)
  const ad1 = await p.evaluate(() => document.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant'))
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(400)
  const ad2 = await p.evaluate(() => document.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant'))
  say('R06 фокус уехал на .modal-backdrop-close, ArrowDown не двигает активную опцию',
    String(r.focus).includes('backdrop-close') && ad1 === ad2,
    `focus=${r.focus} activedescendant до=${ad1} после ArrowDown=${ad2}`)
  await p.close()
}
/* R04 */
for (const [w, h, lbl] of [[390, 844, 'sheet 390'], [900, 800, 'popup 900']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(600)
  const g = await p.evaluate(() => {
    const o = document.querySelector('[data-host-floating]'), i = document.querySelector('.select-content')
    const R = e => ({ h: Math.round(e.getBoundingClientRect().height), b: Math.round(e.getBoundingClientRect().bottom) })
    return { o: R(o), i: R(i), layout: o.getAttribute('data-layout'), maxH: getComputedStyle(i).maxHeight }
  })
  say(`R04 ${lbl}: .select-content вылезает за контейнер хоста`, g.i.h - g.o.h > 1,
    `контейнер h=${g.o.h} content h=${g.i.h} (+${g.i.h - g.o.h}px) layout=${g.layout} max-height=${g.maxH}`)
  await p.close()
}
/* R05 */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(600)
  const r = await p.evaluate(async () => {
    const before = window.scrollY; window.scrollTo(0, 400); await new Promise(r => setTimeout(r, 200))
    const after = window.scrollY
    const bd = document.querySelector('.modal-backdrop')
    return { before, after, overflow: getComputedStyle(document.body).overflow,
      backdropHidden: bd?.hasAttribute('hidden') ?? null, dialogs: document.querySelectorAll('[role=dialog]').length }
  })
  say('R05 под мобильным листом страница прокручивается, нет backdrop и role=dialog',
    r.after !== r.before && r.backdropHidden === true,
    `scrollY ${r.before}→${r.after}, body overflow=${r.overflow}, backdrop hidden=${r.backdropHidden}, role=dialog=${r.dialogs}`)
  await p.close()
}
/* R08 */
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  const t0 = await p.evaluate(() => document.body.innerText.match(/в стопке:\s*\d+/)?.[0])
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(600)
  const t1 = await p.evaluate(() => document.body.innerText.match(/в стопке:\s*\d+/)?.[0])
  say('R08 headless виден в публичной глубине цепочки (демо-индикатор)', t0 !== t1,
    `до: "${t0}" → при открытом списке: "${t1}"`)
  await p.close()
}
console.log('\nИТОГ ЧАСТЬ 1: воспроизведено ' + R.filter(x => x[1]).length + ' из ' + R.length)
await b.close()
