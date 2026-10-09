import { chromium, devices } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch()

/* F2.1 — жив ли канал dismiss: клик мимо закрывает? */
{
  console.log('=== F2.1 клик мимо (dismiss-канал) ===')
  // десктоп, обычная модалка: клик по фону
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(600)
  await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(700)
  const before=await p.locator('.modal-stage').count()
  await p.mouse.click(8,8); await p.waitForTimeout(700)
  console.log('  модалка: сцен до =', before, '→ после клика по фону =', await p.locator('.modal-stage').count())
  await p.close()

  // узкий экран, лист: клик по пустому месту над листом
  const m=await b.newPage({...devices['Pixel 5']})
  await m.goto(BASE); await m.waitForTimeout(800)
  await m.locator('select').first().click({force:true}); await m.waitForTimeout(700)
  const fl=await m.locator('[data-host-floating]').boundingBox()
  console.log('  лист: верх =', Math.round(fl.y), '→ кликаю выше него')
  await m.mouse.click(fl.x+fl.width/2, Math.max(5, fl.y-40)); await m.waitForTimeout(700)
  console.log('  лист после клика мимо: floating =', await m.locator('[data-host-floating]').count())
  await m.close()
}

/* F1.1 — Tab из листа внутри модалки: уходит ли в фоновую сцену */
{
  console.log('\n=== F1.1 сцена + лист: куда уходит Tab ===')
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto(BASE); await p.waitForTimeout(800)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(900)
  const bb=await p.locator('.modal-popup select').first().boundingBox()
  await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(800)
  const layout=await p.locator('[data-host-floating]').getAttribute('data-layout')
  const attrs=await p.evaluate(()=>{const f=document.querySelector('[data-host-floating]')
    return {role:f?.getAttribute('role'), ariaModal:f?.getAttribute('aria-modal'), вСцене: !!document.querySelector('.modal-stage')?.contains(f)}})
  console.log('  лист:', JSON.stringify({layout, ...attrs}))
  const path=[]
  for (let i=0;i<8;i++){ await p.keyboard.press('Tab'); await p.waitForTimeout(120)
    path.push(await p.evaluate(()=>{const a=document.activeElement
      const f=document.querySelector('[data-host-floating]')
      return (f&&f.contains(a)?'лист:':'ВНЕ:')+ (a?.tagName||'') + '.' + String(a?.className||'').split(' ')[0].slice(0,18)})) }
  console.log('  Tab×8:', path.join('  '))
  await p.close()
}

/* F5.1 — позиционные параметры адреса при снятии headless */
{
  console.log('\n=== F5.1 адрес и параметры при снятии headless ===')
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto(BASE); await p.waitForTimeout(800)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  console.log('  лист открыт, url =', await p.evaluate(()=>location.search||'(пусто)'))
  await p.evaluate(()=>document.querySelector('a.modal-trigger')?.click()); await p.waitForTimeout(900)
  console.log('  + модалка:   url =', await p.evaluate(()=>location.search))
  await p.setViewportSize({width:1280,height:860}); await p.waitForTimeout(900)
  const after=await p.evaluate(()=>({url:location.search,
    t:(history.state?.['sveltekit:states']?.modals?.transient??[]).map(x=>x.id),
    слоёв:document.querySelectorAll('.modal-layer').length,
    текстСлоя:(document.querySelector('.modal-layer')?.textContent||'').trim().slice(0,40)}))
  console.log('  после поворота (headless снят):', JSON.stringify(after))
  await p.close()
}

/* F1.6 — снятие записи при живой цепочке: нет ли мёртвой ссылки */
{
  console.log('\n=== F1.6 после снятия листа цепочка жива ===')
  const p=await b.newPage({...devices['Pixel 5']})
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,90)))
  await p.goto(BASE); await p.waitForTimeout(800)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
  const bb=await p.locator('.modal-popup select').first().boundingBox()
  await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(700)
  await p.setViewportSize({width:1280,height:860}); await p.waitForTimeout(900)
  console.log('  после поворота: сцен =', await p.locator('.modal-stage').count(),
              '| floating =', await p.locator('[data-host-floating]').count(), '| ошибок =', errs.length)
  await p.keyboard.press('Escape'); await p.waitForTimeout(600)
  console.log('  Escape → сцен =', await p.locator('.modal-stage').count(), '| url =', await p.evaluate(()=>location.search||'(пусто)'))
  await p.close()
}
await b.close()
