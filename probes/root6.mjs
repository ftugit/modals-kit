import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
await p.goto('http://127.0.0.1:5173/modals'); await p.waitForTimeout(1200)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1000)
await p.evaluate(()=>{
  window.__s=[]
  const isF=n=>n?.nodeType===1&&(n.hasAttribute?.('data-host-floating')||n.querySelector?.('[data-host-floating]'))
  const grab=(tag,n)=>{ if(isF(n)) window.__s.push({tag,stack:new Error().stack}) }
  const rc=Node.prototype.removeChild; Node.prototype.removeChild=function(c){grab('removeChild',c);return rc.call(this,c)}
  const rm=Element.prototype.remove;   Element.prototype.remove=function(){grab('remove',this);return rm.call(this)}
})
const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)
await p.waitForTimeout(1200)
const s=await p.evaluate(()=>window.__s)
console.log('снятий floating:', s.length)
for (const e of s) {
  console.log('\n  через', e.tag)
  for (const l of String(e.stack).split('\n').slice(1,16).map(x=>x.trim().replace('http://127.0.0.1:5173/',''))
       .filter(x=>x.includes('src/')||x.includes('runtime')||x.includes('index-client')).slice(0,8)) console.log('     '+l)
}
await b.close()
