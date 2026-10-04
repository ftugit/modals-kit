import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173/modals'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 390, height: 844 } })

await page.addInitScript(() => {
  window.__hist = []
  const ps = history.pushState.bind(history)
  const rs = history.replaceState.bind(history)
  history.pushState = (s, t, u) => { window.__hist.push(['push', u, JSON.stringify(s?.modals ?? null)]); return ps(s, t, u) }
  history.replaceState = (s, t, u) => { window.__hist.push(['repl', u, JSON.stringify(s?.modals ?? null)]); return rs(s, t, u) }
})
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 400)))

await page.goto(BASE)
await page.waitForTimeout(600)
await page.evaluate(() => { window.__hist.length = 0 })

console.log('=== что пишется в историю при открытии мобильного листа ===')
await page.locator('select').first().click({ force: true })
for (const ms of [100, 300, 800, 1500]) {
  await page.waitForTimeout(ms === 100 ? 100 : 200)
  const s = await page.evaluate(() => ({
    t: (history.state?.modals?.transient ?? []).map(x => x.id),
    depth: history.state?.modals?.depth ?? 0,
    floating: document.querySelectorAll('[data-host-floating]').length,
  }))
  console.log(`  +${ms}ms`, JSON.stringify(s))
}
console.log('  записи истории:', JSON.stringify(await page.evaluate(() => window.__hist), null, 1))

console.log('\n=== тот же вопрос для select ВНУТРИ модалки (mobile=bottom) ===')
await page.goto(BASE); await page.waitForTimeout(500)
await page.evaluate(() => { window.__hist.length = 0 })
const t = page.locator('text=Select внутри модалки').first()
await t.click()
await page.waitForTimeout(700)
const inner = page.locator('.modal-popup select').first()
console.log('  select внутри модалки найден:', await inner.count())
if (await inner.count()) {
  await inner.click({ force: true })
  await page.waitForTimeout(700)
  console.log('  состояние:', JSON.stringify(await page.evaluate(() => ({
    t: (history.state?.modals?.transient ?? []).map(x => x.id),
    depth: history.state?.modals?.depth ?? 0,
    floating: document.querySelectorAll('[data-host-floating]').length,
    layout: document.querySelector('[data-host-floating]')?.getAttribute('data-layout'),
    stages: document.querySelectorAll('.modal-stage').length,
  }))))
  console.log('  история:', JSON.stringify(await page.evaluate(() => window.__hist)))
  console.log('  --- Escape №1 ---')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  console.log('  ', JSON.stringify(await page.evaluate(() => ({
    floating: document.querySelectorAll('[data-host-floating]').length,
    stages: document.querySelectorAll('.modal-stage').length,
    url: location.search,
  }))))
  console.log('  --- Escape №2 ---')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  console.log('  ', JSON.stringify(await page.evaluate(() => ({
    floating: document.querySelectorAll('[data-host-floating]').length,
    stages: document.querySelectorAll('.modal-stage').length,
    url: location.search,
  }))))
}
await b.close()
