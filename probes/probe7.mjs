import { chromium } from 'playwright'
const b = await chromium.launch()
async function kb(w, h, inModal) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(500)
  if (inModal) { await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700) }
  const sel = inModal ? p.locator('.modal-popup select').first() : p.locator('select').first()
  await sel.focus(); await p.waitForTimeout(200)
  const active = await p.evaluate(() => { const a = document.activeElement
    return a ? a.tagName + (a.className ? '.' + String(a.className).slice(0, 40) : '') : null })
  for (const key of ['Enter', ' ', 'ArrowDown']) {
    await sel.focus(); await p.waitForTimeout(100)
    await p.keyboard.press(key === ' ' ? 'Space' : key); await p.waitForTimeout(500)
    const fl = await p.locator('[data-host-floating]').count()
    console.log(`  ${inModal ? 'в модалке' : 'на странице'} ${w}px  focus=${active}  ${key.trim() || 'Space'} → floating=${fl}`)
    if (fl) { await p.keyboard.press('Escape'); await p.waitForTimeout(400) }
  }
  await p.close()
}
await kb(1280, 860, false)
await kb(390, 844, false)
await kb(1280, 860, true)
await kb(390, 844, true)
await b.close()
