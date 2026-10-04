import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(900)
const who=()=>p.evaluate(()=>document.activeElement?.className?.toString().slice(0,40)||document.activeElement?.tagName)
console.log('фокус после открытия:', await who())
// пробуем сфокусировать содержимое списка вручную — удержится ли
const res=await p.evaluate(async ()=>{
  const el=document.querySelector('[data-select-content]')||document.querySelector('.select-content')
  if(!el) return 'нет узла списка'
  el.setAttribute('tabindex','-1'); el.focus()
  const immediately=document.activeElement?.className?.toString().slice(0,30)
  await new Promise(r=>setTimeout(r,250))
  return {сразу:immediately, через250мс:document.activeElement?.className?.toString().slice(0,30)}
})
console.log('ручной focus на список:', JSON.stringify(res))
await b.close()
