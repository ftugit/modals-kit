import { chromium, devices } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch(); const errs=[]
const setSeg=async(p,label,option)=>{
  const ctl=p.locator('div', {hasText: new RegExp('^'+label)}).last()
  await p.locator(`button:near(:text("${label}"))`, {hasText:option}).first().click({timeout:3000})
}
/* 1. глобальный выключатель мобильного режима */
{
  const p=await b.newPage({...devices['Pixel 5']})
  p.on('pageerror',e=>errs.push(String(e).slice(0,100)))
  await p.goto(BASE); await p.waitForTimeout(800)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  console.log('до выключения: layout =', await p.locator('[data-host-floating]').getAttribute('data-layout'))
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  await p.locator('button', {hasText:'выкл'}).first().click(); await p.waitForTimeout(400)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  console.log('после «выкл»:  layout =', await p.locator('[data-host-floating]').getAttribute('data-layout'),
              '| прокрутка =', await p.evaluate(()=>getComputedStyle(document.body).overflow))
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  // и модалка тоже не прижимается
  await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(700)
  console.log('модалка при «выкл»: data-anchor =', await p.locator('.modal-stage').getAttribute('data-anchor'))
  await p.close()
}
/* 2. отдельный переключатель для оверлеев */
{
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto(BASE); await p.waitForTimeout(800)
  await p.locator('button', {hasText:'всегда выпадашка'}).first().click(); await p.waitForTimeout(400)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  console.log('\nоверлеи выключены: layout =', await p.locator('[data-host-floating]').getAttribute('data-layout'))
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(700)
  console.log('а модалка:        data-anchor =', await p.locator('.modal-stage').getAttribute('data-anchor'))
  await p.close()
}
/* 3. кнопка, у которой мобильный режим отключён всегда */
{
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto(BASE); await p.waitForTimeout(800)
  const btn=p.locator('button', {hasText:'Меню без мобильного режима'}).first()
  const bb=await btn.boundingBox(); await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(600)
  console.log('\nsheetOnNarrow=false: layout =', await p.locator('[data-host-floating]').getAttribute('data-layout'))
  await p.close()
}
console.log('\nошибки:', errs.length?errs:'нет')
await b.close()
