import { chromium } from 'playwright'
const b=await chromium.launch()
for (const ctx of [{n:'мышь',o:{viewport:{width:390,height:844}}},
                   {n:'тач ',o:{viewport:{width:390,height:844},hasTouch:true,isMobile:true}}]) {
  const p=await b.newPage(ctx.o)
  await p.goto('http://127.0.0.1:5173/modals'); await p.waitForTimeout(1200)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1000)
  await p.evaluate(()=>{
    window.__t=[]; const t0=performance.now()
    const root=document.querySelector('.modal-popup [data-select-root]')
    new MutationObserver(ms=>{for(const m of ms) if(m.attributeName==='data-expanded')
      window.__t.push(`${Math.round(performance.now()-t0)}ms data-expanded=${root.hasAttribute('data-expanded')}`)})
      .observe(root,{attributes:true})
    for (const ev of ['pointerdown','mousedown','click'])
      document.addEventListener(ev,e=>{if(e.target.tagName==='SELECT')
        window.__t.push(`${Math.round(performance.now()-t0)}ms ${e.type} defaultPrevented(на входе)=${e.defaultPrevented}`)},true)
    new MutationObserver(()=>{const n=document.querySelectorAll('[data-host-floating]').length
      if(n!==window.__n){window.__n=n; window.__t.push(`${Math.round(performance.now()-t0)}ms floating=${n}`)}})
      .observe(document.body,{childList:true,subtree:true})
  })
  const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
  if (ctx.n.trim()==='тач') await p.touchscreen.tap(bb.x+bb.width/2, bb.y+bb.height/2)
  else await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2)
  await p.waitForTimeout(1200)
  console.log(`\n=== ${ctx.n} ===`)
  for (const l of await p.evaluate(()=>window.__t)) console.log('  '+l)
  console.log('  ИТОГ floating=', await p.locator('[data-host-floating]').count())
  await p.close()
}
await b.close()
