import { chromium } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch()
const who = (p) => p.evaluate(() => {
  const el=document.activeElement
  if(!el) return 'none'
  if(el.matches('input[role="combobox"]')) return 'ПОИСК'
  if(el.tagName==='SELECT') return 'select'
  if(el.closest?.('[data-select-content]')) return 'панель'
  return el.tagName+'.'+String(el.className||'').split(' ')[0]
})

console.log('=== A. холодный старт: новая страница каждый раз, первый клик ===')
for (let i=1;i<=5;i++){
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(600)
  await p.locator('select').first().click({force:true})
  const probes=[]
  for (const ms of [60,120,250,600]) { await p.waitForTimeout(ms===60?60:ms-probes.at(-1).ms); probes.push({ms, w:await who(p)}) }
  console.log(`  попытка ${i}:`, probes.map(x=>`${x.ms}ms=${x.w}`).join('  '))
  await p.close()
}

console.log('\n=== B. та же страница, пять открытий подряд ===')
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(600)
  for (let i=1;i<=5;i++){
    await p.locator('select').first().click({force:true}); await p.waitForTimeout(350)
    console.log(`  открытие ${i}: ${await who(p)}`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(250)
  }
  await p.close()
}

console.log('\n=== C. select внутри модалки ===')
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(600)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
  for (let i=1;i<=4;i++){
    const sel=p.locator('.modal-popup select').nth(0); const bb=await sel.boundingBox()
    await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(400)
    console.log(`  открытие ${i}: ${await who(p)}`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  }
  await p.close()
}

console.log('\n=== D. внутри iframe (как в просмотрщике) ===')
{
  const p=await b.newPage({viewport:{width:1280,height:900}})
  await p.setContent(`<style>body{margin:0}iframe{width:100%;height:860px;border:0}</style><iframe src="${BASE}"></iframe>`)
  await p.waitForTimeout(1500)
  const f=p.frames().find(f=>f.url().includes('/modals'))
  await f.locator('select').first().click({force:true})
  await p.waitForTimeout(400)
  console.log('  без клика по iframe заранее:', await f.evaluate(()=>{
    const el=document.activeElement
    return el?.matches('input[role="combobox"]') ? 'ПОИСК' : (el?.tagName+'.'+String(el?.className||'').split(' ')[0])
  }), '| hasFocus документа iframe:', await f.evaluate(()=>document.hasFocus()))
  await p.close()
}
await b.close()
