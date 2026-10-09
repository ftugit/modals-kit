import { chromium, devices } from 'playwright'
const b=await chromium.launch()
const page=async()=>{const p=await b.newPage({...devices['Pixel 5']});await p.goto('http://127.0.0.1:4173/modals');await p.waitForSelector('[data-select-root][data-enhanced]');await p.waitForTimeout(400);return p}
const dir=async(p)=>{const f=p.locator('[data-host-floating]');return (await f.count())?`${await f.getAttribute('data-layout')}/${await f.getAttribute('data-mobile-anchor')}`:'нет'}

for (const d of ['право','верх']) {
  const p=await page()
  await p.getByRole('button',{name:d,exact:true}).first().click(); await p.waitForTimeout(250)
  await p.locator('text=Открыть карточку').first().click(); await p.waitForSelector('.modal-stage'); await p.waitForTimeout(350)
  console.log(`умолчание «${d}»: модалка =`, await p.locator('.modal-stage').getAttribute('data-anchor'))
  // select внутри карточки (пропов направления у него больше нет)
  const sel=p.locator('.modal-popup select').first(); const sb=await sel.boundingBox()
  await p.mouse.click(sb.x+sb.width/2, sb.y+sb.height/2); await p.waitForTimeout(600)
  console.log('   список внутри неё →', await dir(p))
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  // модалка без хранилища поверх карточки
  await p.locator('button',{hasText:'Без хранилища поверх'}).first().click(); await p.waitForTimeout(600)
  console.log('   модалка без хранилища →', await p.locator('.modal-stage').getAttribute('data-anchor'))
  await p.close()
}
await b.close()
