import { chromium, devices } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch()
const ok=(m)=>console.log('  ok  '+m)
const errs=[]

/* 1. меню на странице */
{
  const p=await b.newPage({viewport:{width:1280,height:900}})
  p.on('pageerror',e=>errs.push('page: '+String(e).slice(0,100)))
  await p.goto(BASE); await p.waitForTimeout(700)
  await p.locator('button', {hasText:'Меню на странице'}).first().click(); await p.waitForTimeout(500)
  console.log('— меню вне модалки —')
  console.log('   floating:', await p.locator('[data-host-floating]').count(),
              '| пунктов:', await p.locator('[role=menuitem]').count(),
              '| role:', await p.locator('[data-host-floating]').getAttribute('role'))
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(700)
  console.log('   после выбора «Полноэкранная»: сцен =', await p.locator('.modal-stage').count(),
              '| url =', await p.evaluate(()=>location.search))
  await p.close()
}
/* 2. модалка без хранилища + меню внутри + переход на демо-модалку */
{
  const p=await b.newPage({viewport:{width:1280,height:900}})
  p.on('pageerror',e=>errs.push('page: '+String(e).slice(0,100)))
  await p.goto(BASE); await p.waitForTimeout(700)
  await p.locator('button', {hasText:'Модалка без хранилища'}).first().click(); await p.waitForTimeout(700)
  const st=await p.evaluate(()=>({сцен:document.querySelectorAll('.modal-stage').length,
    url:location.search, t:(history.state?.['sveltekit:states']?.modals?.transient??[]).map(x=>x.id),
    текст:(document.querySelector('.modal-layer')?.textContent||'').trim().slice(0,32)}))
  console.log('\n— модалка без хранилища —')
  console.log('  ', JSON.stringify(st))
  await p.locator('button', {hasText:'Меню в этой модалке'}).first().click(); await p.waitForTimeout(500)
  console.log('   меню внутри: floating =', await p.locator('[data-host-floating]').count(),
              '| сцена жива =', (await p.locator('.modal-stage').count())===1)
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  console.log('   после Escape: floating =', await p.locator('[data-host-floating]').count(),
              '| сцена =', await p.locator('.modal-stage').count())
  await p.locator('button', {hasText:'Перейти на демо-модалку'}).first().click(); await p.waitForTimeout(800)
  console.log('   переход: url =', await p.evaluate(()=>location.search),
              '| transient =', JSON.stringify(await p.evaluate(()=>(history.state?.['sveltekit:states']?.modals?.transient??[]).map(x=>x.id))))
  await p.close()
}
/* 3. меню внутри демо-модалки + мобильный лист */
{
  const p=await b.newPage({...devices['Pixel 5']})
  p.on('pageerror',e=>errs.push('page: '+String(e).slice(0,100)))
  await p.goto(BASE); await p.waitForTimeout(800)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
  const btn=p.locator('button', {hasText:'Меню внутри модалки'}).first()
  const bb=await btn.boundingBox()
  await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(700)
  console.log('\n— меню внутри модалки, мобильный —')
  console.log('  ', JSON.stringify(await p.evaluate(()=>{
    const f=document.querySelector('[data-host-floating]')
    return {layout:f?.getAttribute('data-layout'), role:f?.getAttribute('role'),
      ariaModal:f?.getAttribute('aria-modal'), overflow:getComputedStyle(document.body).overflow,
      фокусВМеню: f?.contains(document.activeElement)}})))
  // Tab не должен уходить из листа
  const path=[]
  for (let i=0;i<4;i++){ await p.keyboard.press('Tab'); await p.waitForTimeout(90)
    path.push(await p.evaluate(()=>document.querySelector('[data-host-floating]')?.contains(document.activeElement)?'в листе':'ВНЕ')) }
  console.log('   Tab×4:', path.join(' '))
  await p.close()
}
console.log('\nошибки страницы:', errs.length?errs:'нет')
await b.close()
