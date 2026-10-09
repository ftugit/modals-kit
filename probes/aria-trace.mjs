import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:1280,height:860}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
await p.evaluate(()=>{
  window.__l=[]
  const f=HTMLElement.prototype.focus
  HTMLElement.prototype.focus=function(...a){
    window.__l.push({el:this.tagName+'.'+String(this.className||'').split(' ')[0].slice(0,18),
      st:String(new Error().stack).split('\n').slice(2,5).map(x=>x.trim().slice(0,70))})
    return f.apply(this,a)
  }
  for (const t of ['focusin','focusout']) document.addEventListener(t,e=>window.__l.push({ev:t,el:e.target.tagName+'.'+String(e.target.className||'').split(' ')[0].slice(0,18)}),true)
})
const bb=await p.locator('.modal-popup select').first().boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)
await p.waitForTimeout(900)
for (const l of await p.evaluate(()=>window.__l)) {
  if (l.st) { console.log('focus() →', l.el); l.st.forEach(x=>console.log('      ', x)) }
  else console.log(l.ev, l.el)
}
console.log('итог:', await p.evaluate(()=>document.activeElement?.tagName+'.'+String(document.activeElement?.className||'').split(' ')[0]))
await b.close()
