import { chromium, devices } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({...devices['Pixel 5']})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
console.log('лист открыт        url =', JSON.stringify(await p.evaluate(()=>location.search)))
await p.evaluate(()=>document.querySelector('a.modal-trigger')?.click())
for (const ms of [300,800,1500]) { await p.waitForTimeout(ms===300?300:ms-800)
  console.log(`+${ms}ms модалка открыта url =`, JSON.stringify(await p.evaluate(()=>location.search)),
    '| сцен =', await p.locator('.modal-stage').count()) }
console.log('перезагрузка…')
await p.reload(); await p.waitForTimeout(1200)
console.log('после F5: url =', JSON.stringify(await p.evaluate(()=>location.search)),
  '| сцен =', await p.locator('.modal-stage').count(), '| модалка жива =', (await p.locator('.modal-layer').count())>0)
await b.close()
