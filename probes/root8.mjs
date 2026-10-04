import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
await p.goto('http://127.0.0.1:5173/modals'); await p.waitForTimeout(1200)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1000)
await p.evaluate(()=>{
  window.__tr=[]
  const g=history.go.bind(history), bk=history.back.bind(history)
  history.go=n=>{window.__tr.push({c:`go(${n})`,s:new Error().stack});return g(n)}
  history.back=()=>{window.__tr.push({c:'back()',s:new Error().stack});return bk()}
})
const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)
await p.waitForTimeout(1200)
for (const t of await p.evaluate(()=>window.__tr)) {
  console.log('ВЫЗОВ:',t.c)
  for (const l of String(t.s).split('\n').slice(1,16).map(x=>x.trim().replace('http://127.0.0.1:5173/',''))
      .filter(x=>x.includes('src/')||x.includes('runtime')||x.includes('index-client')).slice(0,10)) console.log('   '+l)
}
await b.close()
