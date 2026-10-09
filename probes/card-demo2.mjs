import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:1280,height:900}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(700)
const mb=await p.locator('button', {hasText:'Действия'}).first().boundingBox()
await p.mouse.click(mb.x+mb.width/2, mb.y+mb.height/2); await p.waitForTimeout(500)
await p.keyboard.press('Enter'); await p.waitForTimeout(500)   // первый пункт
console.log('первый пункт:', (await p.locator('.modal-layer[data-active]').innerText()).match(/действие:\s*\S+/)?.[0],
            '| floating =', await p.locator('[data-host-floating]').count())
// второй пункт — открывает ещё карточку
await p.locator('button', {hasText:'Действия'}).first().click(); await p.waitForTimeout(500)
await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(800)
console.log('второй пункт: слоёв =', await p.locator('.modal-layer').count(),
            '| хвостов =', await p.locator('.modal-tail').count(),
            '| url =', await p.evaluate(()=>location.search))
await b.close()
