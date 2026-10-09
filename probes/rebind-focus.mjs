import { chromium, devices } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({...devices['Pixel 5']})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
const bb=await p.locator('.modal-popup select').first().boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)
for (const ms of [100,300,600,1000]) {
  await p.waitForTimeout(ms===100?100:300)
  console.log(`+${ms}ms`, await p.evaluate(()=>{
    const a=document.activeElement, f=document.querySelector('[data-host-floating]')
    return `${f&&f.contains(a)?'в листе: ':'ВНЕ: '}${a?.tagName}.${String(a?.className||'').split(' ')[0].slice(0,20)}`
  }))
}
await b.close()
