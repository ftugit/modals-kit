import { chromium } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch()

/* Что реально видно наружу при открытом мобильном листе */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  const logs=[]; p.on('console',m=>{const t=m.text(); if(t.startsWith('[host]')) logs.push(t)})
  await p.goto(BASE); await p.waitForTimeout(800)
  const before=await p.evaluate(()=>({
    хвостов: document.querySelectorAll('.modal-tail').length,
    слоёв: document.querySelectorAll('.modal-layer').length,
    сцен: document.querySelectorAll('.modal-stage').length,
    индикатор: document.body.innerText.match(/в стопке:\s*\d+/)?.[0],
  }))
  logs.length=0
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(700)
  const during=await p.evaluate(()=>({
    хвостов: document.querySelectorAll('.modal-tail').length,
    слоёв: document.querySelectorAll('.modal-layer').length,
    сцен: document.querySelectorAll('.modal-stage').length,
    индикатор: document.body.innerText.match(/в стопке:\s*\d+/)?.[0],
    кнопкаЗакрытия: document.querySelectorAll('.modal-backdrop-close').length,
  }))
  console.log('=== мобильный лист открыт ===')
  console.log('  до:    ', JSON.stringify(before))
  console.log('  при:   ', JSON.stringify(during))
  console.log('  колбэки:', JSON.stringify(logs))
  await p.keyboard.press('Escape'); await p.waitForTimeout(500)
  console.log('  после Escape колбэки:', JSON.stringify(logs))
  await p.close()
}

/* Та же проверка для desktop popup — там headless не создаётся */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  const logs=[]; p.on('console',m=>{const t=m.text(); if(t.startsWith('[host]')) logs.push(t)})
  await p.goto(BASE); await p.waitForTimeout(800); logs.length=0
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  console.log('\n=== desktop popup (headless НЕ создаётся) ===')
  console.log('  индикатор:', await p.evaluate(()=>document.body.innerText.match(/в стопке:\s*\d+/)?.[0]), '| колбэки:', JSON.stringify(logs))
  await p.close()
}

/* Влияет ли headless на «закрыть всё» и на блокировку */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto(BASE); await p.waitForTimeout(800)
  await p.locator('text=Карточка').first().click().catch(()=>{})
  await p.locator('text=Открыть карточку').first().click().catch(()=>{})
  await p.waitForTimeout(600)
  await p.locator('.modal-popup select').first().click({force:true}).catch(()=>{})
  await p.waitForTimeout(600)
  console.log('\n=== модалка + лист поверх ===')
  console.log('  ', JSON.stringify(await p.evaluate(()=>({
    индикатор: document.body.innerText.match(/в стопке:\s*\d+/)?.[0],
    слоёв: document.querySelectorAll('.modal-layer').length,
    хвостов: document.querySelectorAll('.modal-tail').length,
  }))))
  await p.close()
}
await b.close()
