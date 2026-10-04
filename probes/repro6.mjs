import { chromium } from 'playwright'
const b=await chromium.launch()
async function run(mode){
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(600)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(900)
  await p.evaluate(()=>{window.__ev=[]
    const d=e=>{const t=e.target; window.__ev.push(`${e.type} ${e.key??''} <${t?.tagName}${t?.className?'.'+String(t.className).split(' ')[0]:''}>`)}
    for (const t of ['keydown','pointerdown','focusin','focusout']) document.addEventListener(t,d,true)
    window.addEventListener('popstate',()=>window.__ev.push('*** POPSTATE — модалка закрыта ***'))
    const mo=new MutationObserver(()=>{const n=document.querySelectorAll('[data-host-floating]').length
      if (n!==window.__last){window.__last=n; window.__ev.push(`floating-контейнеров: ${n}`)}})
    mo.observe(document.body,{childList:true,subtree:true})})
  const sel=p.locator('.modal-popup select').first()
  if (mode==='keyboard'){ await sel.focus(); await p.waitForTimeout(150)
    await p.evaluate(()=>window.__ev.push('— Enter —')); await p.keyboard.press('Enter') }
  else { const bb=await sel.boundingBox(); await p.evaluate(()=>window.__ev.push('— клик мышью —'))
    await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2) }
  await p.waitForTimeout(1000)
  const ev=await p.evaluate(()=>window.__ev)
  console.log(`\n=== ${mode.toUpperCase()} ===`)
  for (const e of ev) console.log('  '+e)
  console.log(`  ИТОГ: сцен=${await p.locator('.modal-stage').count()} floating=${await p.locator('[data-host-floating]').count()}`)
  await p.close()
}
await run('mouse'); await run('keyboard')
await b.close()
