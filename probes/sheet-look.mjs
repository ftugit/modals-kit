import { chromium, devices } from 'playwright'
const b=await chromium.launch()
/* вид: лист меню против листа select */
{
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
  const btn=p.locator('button', {hasText:'Меню на странице'}).first()
  const bb=await btn.boundingBox(); await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(700)
  await p.screenshot({path:'probes/shot-menu-sheet.png'})
  console.log('лист меню:', JSON.stringify(await p.evaluate(()=>{
    const f=document.querySelector('[data-host-floating]')
    const head=f?.querySelector('.floating-menu-head')
    const item=f?.querySelector('[role=menuitem]')
    const r=(e)=>e?{w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)}:null
    return {контейнер:r(f), шапка:r(head), пункт:r(item),
      шапкаВидна: head ? getComputedStyle(head).display!=='none' : null,
      anchor:f?.getAttribute('data-mobile-anchor')}})))
  await p.close()
}
/* клик мимо: закрывает лист и НЕ нажимает кнопку под ним */
{
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
  const btn=p.locator('button', {hasText:'Меню на странице'}).first()
  const bb=await btn.boundingBox(); await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(700)
  const sheet=await p.locator('[data-host-floating]').boundingBox()
  // кликаем заведомо выше листа — там, где лежат триггеры страницы
  const target=await p.locator('text=Открыть карточку').first().boundingBox()
  const y = target && target.y < sheet.y - 10 ? target.y + target.height/2 : Math.max(5, sheet.y - 40)
  await p.mouse.click(target ? target.x + target.width/2 : 40, y); await p.waitForTimeout(700)
  console.log('\nклик мимо на мобильном:', JSON.stringify(await p.evaluate(()=>({
    floating: document.querySelectorAll('[data-host-floating]').length,
    сцен: document.querySelectorAll('.modal-stage').length,
    url: location.search}))))
  await p.close()
}
await b.close()
