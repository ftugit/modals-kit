import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
const logs=[]; p.on('console',m=>{const t=m.text(); if(t.startsWith('[host]')) logs.push(t)})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800); logs.length=0
const btn = p.locator('button', { hasText: 'Закрыть все' }).first()
console.log('до открытия :', (await btn.textContent())?.trim(), '| disabled =', await btn.isDisabled())
await p.locator('select').first().click({force:true}); await p.waitForTimeout(700)
console.log('лист открыт :', (await btn.textContent())?.trim(), '| disabled =', await btn.isDisabled(),
            '| floating =', await p.locator('[data-host-floating]').count(),
            '| body overflow =', await p.evaluate(()=>getComputedStyle(document.body).overflow))
console.log('колбэки     :', JSON.stringify(logs))
await p.keyboard.press('Escape'); await p.waitForTimeout(600)
console.log('после Escape:', JSON.stringify(logs))

/* смешанный сценарий: модалка, потом лист поверх, потом закрыть лист */
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700); logs.length=0
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
const bb=await p.locator('.modal-popup select').first().boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(600)
console.log('\nмодалка+лист:', (await btn.count()) ? '' : '', 'колбэки =', JSON.stringify(logs))
await p.keyboard.press('Escape'); await p.waitForTimeout(500)
await p.keyboard.press('Escape'); await p.waitForTimeout(600)
console.log('после двух Escape колбэки =', JSON.stringify(logs))
await b.close()
