import { chromium } from 'playwright'
const BASE='http://127.0.0.1:5173/modals'
const b=await chromium.launch()

console.log('=== КОРЕНЬ #1: кто закрывает модалку при Enter на select внутри неё ===')
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(1500)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1200)
  await p.evaluate(()=>{
    window.__traces=[]
    const g=history.go.bind(history), bk=history.back.bind(history)
    history.go=(n)=>{window.__traces.push({call:`history.go(${n})`,stack:new Error().stack}); return g(n)}
    history.back=()=>{window.__traces.push({call:'history.back()',stack:new Error().stack}); return bk()}
  })
  const sel=p.locator('.modal-popup select').first()
  await sel.focus(); await p.waitForTimeout(200)
  await p.keyboard.press('Enter'); await p.waitForTimeout(1200)
  const tr=await p.evaluate(()=>window.__traces)
  for (const t of tr) {
    console.log('  ВЫЗОВ:', t.call)
    const lines=String(t.stack).split('\n').slice(1,14)
      .map(l=>l.trim().replace('http://127.0.0.1:5173/',''))
      .filter(l=>!l.includes('node_modules/.vite')||l.includes('zag')||l.includes('ark'))
    for (const l of lines) console.log('    '+l)
  }
  if (!tr.length) console.log('  (history.go/back не вызывались)')
  await p.close()
}

console.log('\n=== КОРЕНЬ #2: кто переводит фокус на .modal-backdrop-close ===')
{
  const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true})
  await p.goto(BASE); await p.waitForTimeout(1500)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1200)
  await p.evaluate(()=>{
    window.__focus=[]
    const f=HTMLElement.prototype.focus
    HTMLElement.prototype.focus=function(...a){
      if (this.classList?.contains('modal-backdrop-close'))
        window.__focus.push(new Error().stack)
      return f.apply(this,a)
    }
  })
  const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
  await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(1500)
  const fs=await p.evaluate(()=>window.__focus)
  console.log('  вызовов focus() на кнопке закрытия:', fs.length)
  for (const s of fs.slice(0,2)) {
    const lines=String(s).split('\n').slice(1,12).map(l=>l.trim().replace('http://127.0.0.1:5173/',''))
    for (const l of lines) console.log('    '+l)
    console.log('    ---')
  }
  console.log('  активный элемент сейчас:', await p.evaluate(()=>document.activeElement?.className||document.activeElement?.tagName))
  await p.close()
}
await b.close()
