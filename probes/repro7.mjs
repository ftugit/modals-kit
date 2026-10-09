import { chromium } from 'playwright'
const b=await chromium.launch()
/* aria-expanded захардкожен */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(500)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  const r=await p.evaluate(()=>{const c=document.querySelector('[role=combobox]')
    return {role:!!c, expanded:c?.getAttribute('aria-expanded'), haspopup:c?.getAttribute('aria-haspopup'),
      onTrigger:document.querySelector('[data-select-root] button')?.getAttribute('aria-expanded')??'нет атрибута',
      rootExpanded:document.querySelector('[data-select-root]')?.hasAttribute('data-expanded')}})
  console.log('aria-expanded:', JSON.stringify(r))
  await p.screenshot({path:'/home/user/d/probes/ev-popup-900.png'})
  await p.close()
}
/* скриншоты-доказательства геометрии */
for (const [w,h,name] of [[390,844,'ev-sheet-390.png'],[900,800,'ev-popup-900.png']]) {
  const p=await b.newPage({viewport:{width:w,height:h}})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(500)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(700)
  await p.screenshot({path:'/home/user/d/probes/'+name})
  await p.close()
}
/* вложенный mobile: пустая активная оболочка — скриншот */
{
  const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(600)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
  const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
  await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(800)
  await p.screenshot({path:'/home/user/d/probes/ev-nested-mobile.png'})
  await p.close()
}
/* контроль других страниц */
for (const path of ['/cycle','/spike','/cards/7']) {
  const p=await b.newPage({viewport:{width:1280,height:860}})
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,80)))
  const resp=await p.goto('http://127.0.0.1:4173'+path).catch(e=>null)
  await p.waitForTimeout(700)
  console.log(`${path}: HTTP ${resp?.status()??'—'} ошибок=${errs.length} ${errs[0]??''}`)
  await p.close()
}
await b.close()
