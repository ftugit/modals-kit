import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
await p.goto('http://127.0.0.1:5173/modals'); await p.waitForTimeout(1500)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1000)
await p.evaluate(()=>{
  window.__log=[]
  const isF=n=>n?.nodeType===1&&n.hasAttribute?.('data-host-floating')
  const rc=Node.prototype.removeChild
  Node.prototype.removeChild=function(ch){ if(isF(ch)) window.__log.push({ev:'УДАЛЁН floating',stack:new Error().stack}); return rc.call(this,ch) }
  const ap=Node.prototype.appendChild
  Node.prototype.appendChild=function(ch){ if(isF(ch)) window.__log.push({ev:'СОЗДАН floating',stack:new Error().stack}); return ap.call(this,ch) }
  const ib=Node.prototype.insertBefore
  Node.prototype.insertBefore=function(ch,r){ if(isF(ch)) window.__log.push({ev:'СОЗДАН floating (insertBefore)',stack:new Error().stack}); return ib.call(this,ch,r) }
})
const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)
await p.waitForTimeout(1500)
const log=await p.evaluate(()=>window.__log)
console.log('события с floating-контейнером:', log.length)
for (const e of log) {
  console.log('\n  '+e.ev)
  const lines=String(e.stack).split('\n').slice(1,11).map(l=>l.trim().replace('http://127.0.0.1:5173/',''))
    .filter(l=>l.includes('src/')||l.includes('runtime')||l.includes('index-client'))
  for (const l of lines.slice(0,7)) console.log('     '+l)
}
console.log('\nитог: floating=', await p.locator('[data-host-floating]').count(),
            ' stage=', await p.locator('.modal-stage').count(),
            ' expanded=', await p.locator('.modal-popup [data-select-root][data-expanded]').count())
await b.close()
