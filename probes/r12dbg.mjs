import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
console.log('лист:', await p.locator('[data-host-floating]').getAttribute('data-layout'),
            '| anchor:', await p.locator('[data-host-floating]').getAttribute('data-mobile-anchor'),
            '| role:', await p.locator('[data-host-floating]').getAttribute('role'))
await p.keyboard.press('Escape'); await p.waitForTimeout(600)
console.log('фокус после Escape:', await p.evaluate(()=>{const a=document.activeElement
  return a===document.body?'BODY':a?.tagName+'.'+String(a?.className||'').split(' ')[0]}))
await b.close()
