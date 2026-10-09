import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:1280,height:860}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
await p.evaluate(()=>{
  window.__log=[]
  const f=HTMLElement.prototype.focus
  HTMLElement.prototype.focus=function(...a){
    window.__log.push({ev:'focus()', el:this.tagName+'.'+String(this.className||'').split(' ')[0],
      stack:String(new Error().stack).split('\n').slice(2,6).map(s=>s.trim())})
    return f.apply(this,a)
  }
  for (const t of ['focusin','focusout'])
    document.addEventListener(t,e=>window.__log.push({ev:t, el:e.target.tagName+'.'+String(e.target.className||'').split(' ')[0]}),true)
})
const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)
await p.waitForTimeout(900)
for (const l of await p.evaluate(()=>window.__log)) {
  if (l.stack) { console.log(`focus() → ${l.el}`); l.stack.forEach(s=>console.log('      '+s.replace('http://127.0.0.1:4173',''))) }
  else console.log(`${l.ev} ${l.el}`)
}
console.log('\nитог activeElement:', await p.evaluate(()=>document.activeElement?.tagName+'.'+String(document.activeElement?.className||'').split(' ')[0]))
console.log('есть ли поле поиска:', await p.locator('[data-select-content] input[role=combobox]').count())
await b.close()
