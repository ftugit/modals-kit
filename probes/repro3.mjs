import { chromium } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch(); const R=[]
const say=(id,ok,d)=>{R.push([id,ok]);console.log(`${ok?'🔴 ВОСПРОИЗВЕЛОСЬ':'⚪ не воспроизвелось'}  ${id}\n     ${d}`)}
const chain=p=>p.evaluate(()=>(history.state?.['sveltekit:states']?.modals?.transient??[]).map(x=>x.id))

/* R07: клавиатура внутри модалки */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(500)
  const res={}
  for (const key of ['Enter','Space','ArrowDown']) {
    await p.goto(BASE); await p.waitForTimeout(500)
    await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
    const sel=p.locator('.modal-popup select').first()
    await sel.focus(); await p.waitForTimeout(200)
    const focused=await p.evaluate(()=>document.activeElement?.tagName)
    await p.keyboard.press(key); await p.waitForTimeout(600)
    res[key]=await p.evaluate(()=>({fl:document.querySelectorAll('[data-host-floating]').length,
      st:document.querySelectorAll('.modal-stage').length, url:location.search}))
    res[key].focusBefore=focused
  }
  // контроль: тот же select вне модалки
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(600)
  const ctl=await p.evaluate(()=>document.querySelectorAll('[data-host-floating]').length)
  say('R07 клавиатурой select ВНУТРИ модалки не открывается (вне модалки — открывается)',
    res.Enter.fl===0 && ctl===1,
    `в модалке: Enter→fl=${res.Enter.fl} (модалка ${res.Enter.st?'жива':'ИСЧЕЗЛА'}, url="${res.Enter.url}"), Space→fl=${res.Space.fl} (модалка ${res.Space.st?'жива':'ИСЧЕЗЛА'}), ArrowDown→fl=${res.ArrowDown.fl} (модалка ${res.ArrowDown.st?'жива':'ИСЧЕЗЛА'}); контроль вне модалки Enter→fl=${ctl}`)
  say('R07b Enter на select внутри модалки ЗАКРЫВАЕТ саму модалку',
    res.Enter.st===0 || res.Space.st===0,
    `после Enter сцен=${res.Enter.st} url="${res.Enter.url}"; после Space сцен=${res.Space.st}`)
  await p.close()
}
/* R16: последствие фантома после F5 — врёт глубина истории */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(500)
  await p.setViewportSize({width:1280,height:860}); await p.waitForTimeout(500)
  await p.mouse.click(5,5); await p.waitForTimeout(500)
  await p.reload(); await p.waitForTimeout(900)
  const afterReload=await chain(p)
  await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(800)
  const opened=await p.evaluate(()=>({st:document.querySelectorAll('.modal-stage').length,url:location.search}))
  await p.evaluate(()=>history.back()); await p.waitForTimeout(900)
  const afterBack=await p.evaluate(()=>({st:document.querySelectorAll('.modal-stage').length,
    url:location.search, path:location.pathname}))
  say('R16 после F5 с фантомом «Назад» уводит со страницы вместо закрытия модалки',
    afterBack.st===0 && (afterBack.url!=='' ? false : true) && afterReload.length>0,
    `после F5 в истории ${JSON.stringify(afterReload)}; открыли модалку url="${opened.url}"; после Назад: сцен=${afterBack.st}, url="${afterBack.url}", path="${afterBack.path}"`)
  await p.close()
}
/* R17: «Закрыть все» при фантоме */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(500)
  await p.setViewportSize({width:1280,height:860}); await p.waitForTimeout(500)
  await p.mouse.click(5,5); await p.waitForTimeout(500)
  const before=await chain(p)
  const btn=p.locator('text=Закрыть все').first()
  const has=await btn.count()
  if (has) { await btn.click(); await p.waitForTimeout(700) }
  const after=await chain(p)
  const depthText=await p.evaluate(()=>document.body.innerText.match(/в стопке:\s*\d+/)?.[0])
  say('R17 кнопка «Закрыть все» не убирает фантомную запись', has>0 && after.length>0,
    `до=${JSON.stringify(before)} после «Закрыть все»=${JSON.stringify(after)}; индикатор: "${depthText}"`)
  await p.close()
}
/* R18: открыть/закрыть select 3 раза подряд — остаётся ли чисто (контроль к R15) */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(500)
  for (let i=0;i<3;i++){ await p.locator('select').first().click({force:true}); await p.waitForTimeout(300)
    await p.mouse.click(5,5); await p.waitForTimeout(300) }
  const c=await chain(p)
  say('R18 КОНТРОЛЬ: обычный desktop-цикл открыть/закрыть не оставляет записей', c.length>0,
    `цепочка после 3 циклов на desktop: ${JSON.stringify(c)} (ожидается пусто)`)
  await p.close()
}
console.log('\nИТОГ ЧАСТЬ 3: воспроизведено '+R.filter(x=>x[1]).length+' из '+R.length)
await b.close()
