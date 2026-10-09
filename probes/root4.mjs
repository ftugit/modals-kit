import { chromium } from 'playwright'
const b=await chromium.launch()
for (const ctx of [{name:'мышь (390, без hasTouch)',opts:{viewport:{width:390,height:844}}},
                   {name:'тач  (390, isMobile+hasTouch)',opts:{viewport:{width:390,height:844},hasTouch:true,isMobile:true}}]) {
  const p=await b.newPage(ctx.opts)
  await p.goto('http://127.0.0.1:5173/modals'); await p.waitForTimeout(1200)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1000)
  const r=await p.evaluate(()=>{
    const s=document.querySelector('.modal-popup select')
    const r=s.getBoundingClientRect()
    const cx=r.left+r.width/2, cy=r.top+r.height/2
    const top=document.elementFromPoint(cx,cy)
    return {rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
      vh:window.innerHeight, point:{x:Math.round(cx),y:Math.round(cy)},
      topEl: top? top.tagName+(top.className?'.'+String(top.className).split(' ')[0]:'') : null,
      sameNode: top===s, inViewport: cy>=0&&cy<=window.innerHeight,
      selVisible: getComputedStyle(s).visibility, pe:getComputedStyle(s).pointerEvents}
  })
  console.log(`${ctx.name}:`)
  console.log('  ', JSON.stringify(r))
  await p.close()
}
await b.close()
