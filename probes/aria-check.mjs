import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:1280,height:860}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
await p.locator('.modal-popup select').first().focus(); await p.waitForTimeout(150)
await p.keyboard.press('Enter'); await p.waitForTimeout(700)
console.log(JSON.stringify(await p.evaluate(()=>{
  const sel=document.querySelector('.modal-popup select')
  const fl=document.querySelector('[data-host-floating]')
  const stage=document.querySelector('.modal-stage')
  return {
    selectAriaControls: sel?.getAttribute('aria-controls'),
    selectAriaExpanded: sel?.getAttribute('aria-expanded'),
    floatingId: fl?.id,
    совпадают: sel?.getAttribute('aria-controls')===fl?.id,
    floatingРодитель: fl?.parentElement?.className || 'BODY',
    floatingВСцене: stage?.contains(fl) ?? null,
    фокус: document.activeElement?.tagName+'.'+String(document.activeElement?.className||'').split(' ')[0],
  }}),null,1))
await b.close()
