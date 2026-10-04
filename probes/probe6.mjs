import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 390, height: 844 } })
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(500)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
const sel = p.locator('.modal-popup select').first()
console.log('bbox:', JSON.stringify(await sel.boundingBox()))
console.log('enhanced:', await p.locator('.modal-popup [data-select-root]').first().getAttribute('data-enhanced'))
// путь 2: клавиатура вместо указателя
await sel.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(600)
console.log('после Enter  floating=', await p.locator('[data-host-floating]').count(),
            'expanded=', await p.locator('.modal-popup [data-select-root]').first().getAttribute('data-expanded'))
// путь 3: прямой клик по координатам центра
const bb = await sel.boundingBox()
if (bb) { await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(600) }
console.log('после клика  floating=', await p.locator('[data-host-floating]').count(),
            'expanded=', await p.locator('.modal-popup [data-select-root]').first().getAttribute('data-expanded'))
await p.screenshot({ path: 'shot-f2.png' })
await b.close()
