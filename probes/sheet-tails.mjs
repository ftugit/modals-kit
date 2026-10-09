import { chromium, devices } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({...devices['Pixel 5']})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForSelector('[data-select-root][data-enhanced]'); await p.waitForTimeout(400)
await p.locator('text=Открыть карточку').first().click(); await p.waitForSelector('.modal-stage'); await p.waitForTimeout(400)
console.log('только модалка: хвостов =', await p.locator('.modal-tail').count())
const sel=p.locator('.modal-popup select').first(); const sb=await sel.boundingBox()
await p.mouse.click(sb.x+sb.width/2, sb.y+sb.height/2); await p.waitForTimeout(700)
console.log('открыт лист:    хвостов всего =', await p.locator('.modal-tail').count(),
            '| внутри листа =', await p.locator('[data-host-floating] .modal-tail').count())
await p.screenshot({path:'probes/shot-sheet-tails.png'})
await b.close()
