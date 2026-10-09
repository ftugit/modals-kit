import { chromium } from 'playwright'
const b=await chromium.launch()
for (const ctx of [{n:'мышь',o:{viewport:{width:390,height:844}}},
                   {n:'тач ',o:{viewport:{width:390,height:844},hasTouch:true,isMobile:true}}]) {
  const p=await b.newPage(ctx.o)
  await p.goto('http://127.0.0.1:5173/modals'); await p.waitForTimeout(1200)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1000)
  await p.evaluate(()=>{
    window.__tl=[]; const t0=performance.now()
    const snap=()=>{const m=history.state?.['sveltekit:states']?.modals??{}
      const s=`chain=[${(m.transient??[]).map(x=>x.id).join(',')}] floating=${document.querySelectorAll('[data-host-floating]').length} layers=${document.querySelectorAll('.modal-layer').length}`
      if (s!==window.__prev){window.__prev=s; window.__tl.push(`${Math.round(performance.now()-t0)}ms ${s}`)}}
    snap(); window.__iv=setInterval(snap,8)
    const ps=history.pushState.bind(history),rs=history.replaceState.bind(history)
    history.pushState=(a,b2,u)=>{window.__tl.push(`${Math.round(performance.now()-t0)}ms pushState`);return ps(a,b2,u)}
    history.replaceState=(a,b2,u)=>{window.__tl.push(`${Math.round(performance.now()-t0)}ms replaceState`);return rs(a,b2,u)}
    window.addEventListener('popstate',()=>window.__tl.push(`${Math.round(performance.now()-t0)}ms POPSTATE`))
  })
  const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
  if (ctx.n.trim()==='тач') await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2)
  else await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)
  await p.waitForTimeout(1000)
  await p.evaluate(()=>clearInterval(window.__iv))
  console.log(`\n=== ${ctx.n} ===`)
  for (const l of await p.evaluate(()=>window.__tl)) console.log('  '+l)
  await p.close()
}
await b.close()
