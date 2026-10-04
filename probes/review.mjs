import { chromium } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch()
const say=(id,v,d)=>console.log(`${v} ${id}\n     ${d}`)

/* M1-a: смена поверхности при open=true — модалка поверх открытого листа */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto(BASE); await p.waitForTimeout(700)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  const before=await p.evaluate(()=>({
    листInert: document.querySelector('[data-host-floating]')?.hasAttribute('inert'),
    листAria: document.querySelector('[data-host-floating]')?.getAttribute('aria-hidden'),
  }))
  // программное открытие модалки, пока лист держит модальность
  await p.evaluate(()=>document.querySelector('a.modal-trigger')?.click())
  await p.waitForTimeout(900)
  const after=await p.evaluate(()=>{
    const fl=document.querySelector('[data-host-floating]')
    const stage=document.querySelector('.modal-stage')
    return {
      floating: document.querySelectorAll('[data-host-floating]').length,
      листInert: fl?.hasAttribute('inert') ?? null,
      листAria: fl?.getAttribute('aria-hidden') ?? null,
      сцена: !!stage,
      сценаInert: stage?.hasAttribute('inert') ?? null,
      сценаAria: stage?.getAttribute('aria-hidden') ?? null,
      активный: document.activeElement?.className?.toString().slice(0,40)||document.activeElement?.tagName,
      слоёв: document.querySelectorAll('.modal-layer').length,
      кликабельнаКнопкаЗакрытия: !!document.querySelector('.modal-backdrop-close'),
    }})
  console.log('M1-a до открытия модалки:', JSON.stringify(before))
  console.log('M1-a после:', JSON.stringify(after))
  // можно ли взаимодействовать с новой модалкой
  const clickable = await p.locator('.modal-popup button, .modal-backdrop-close').first()
    .click({timeout:1500}).then(()=>true).catch(()=>false)
  console.log('   клик по элементу новой модалки прошёл:', clickable)
  await p.close()
}

/* M3-c: F5 при ОТКРЫТОМ листе */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto(BASE); await p.waitForTimeout(700)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  await p.reload(); await p.waitForTimeout(1200)
  const st=await p.evaluate(()=>({
    индикатор: document.body.innerText.match(/в стопке:\s*\d+/)?.[0],
    floating: document.querySelectorAll('[data-host-floating]').length,
    histTransient: (history.state?.['sveltekit:states']?.modals?.transient??[]).length,
    overflow: getComputedStyle(document.body).overflow,
  }))
  console.log('\nM3-c после F5 с открытым листом:', JSON.stringify(st))
  await p.close()
}

/* M1-d: куда уходит фокус после закрытия листа */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto(BASE); await p.waitForTimeout(700)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  await p.keyboard.press('Escape'); await p.waitForTimeout(700)
  console.log('\nM1-d фокус после закрытия листа:', await p.evaluate(()=>{
    const a=document.activeElement
    return a===document.body ? 'BODY (потерян)' : a?.tagName+'.'+String(a?.className||'').split(' ')[0]
  }))
  await p.close()
}

/* M2-a: клик по опции вложенного popup и клик мимо листа */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(700)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
  const bb=await p.locator('.modal-popup select').first().boundingBox()
  await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(500)
  await p.locator('[data-host-floating] [role=option]').first().click(); await p.waitForTimeout(500)
  console.log('\nM2-a клик по опции: модалка жива =', (await p.locator('.modal-stage').count())===1,
              '| floating =', await p.locator('[data-host-floating]').count())
  await p.close()
}
await b.close()
