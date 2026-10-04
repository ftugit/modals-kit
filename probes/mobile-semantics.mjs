import { chromium, devices } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch()
const newPage=async()=>{const p=await b.newPage({...devices['Pixel 5']});await p.goto(BASE);await p.waitForSelector('[data-select-root][data-enhanced]');await p.waitForTimeout(400);return p}
const layout=async(p)=>{await p.waitForTimeout(350);const f=p.locator('[data-host-floating]');return (await f.count())? `${await f.getAttribute('data-layout')}/${await f.getAttribute('data-mobile-anchor')}` : 'нет'}

console.log('=== 1. умолчание «не прижимать» не отменяет явное у записи ===')
{
  const p=await newPage()
  await p.locator('button', {hasText:'не прижимать'}).first().click(); await p.waitForTimeout(300)
  // у «Select внутри модалки» явно mobile="bottom"
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForSelector('.modal-stage'); await p.waitForTimeout(300)
  console.log('  модалка со СВОИМ mobile=bottom → anchor =', await p.locator('.modal-stage').getAttribute('data-anchor'))
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  // у «Открыть карточку» mobile={cfg.defaultMobile} → следует умолчанию
  await p.locator('text=Открыть карточку').first().click(); await p.waitForSelector('.modal-stage'); await p.waitForTimeout(300)
  console.log('  модалка БЕЗ своего mobile      → anchor =', await p.locator('.modal-stage').getAttribute('data-anchor'))
  await p.close()
}
console.log('\n=== 2. наследование направления оверлеем ===')
for (const dir of ['низ','право']) {
  const p=await newPage()
  await p.locator('button', {hasText:dir}).first().click(); await p.waitForTimeout(300)
  await p.locator('text=Открыть карточку').first().click(); await p.waitForSelector('.modal-stage'); await p.waitForTimeout(400)
  console.log(`  умолчание «${dir}»: модалка =`, await p.locator('.modal-stage').getAttribute('data-anchor'))
  await p.locator('button', {hasText:'Действия'}).first().click()
  console.log('     меню внутри неё (без своего mobile) →', await layout(p))
  await p.close()
}
console.log('\n=== 3. свой sheetOnNarrow сильнее умолчания оверлеев ===')
{
  const p=await newPage()
  await p.locator('button', {hasText:'выпадашка'}).first().click(); await p.waitForTimeout(300)
  await p.locator('select').first().click({force:true})
  console.log('  список без своего sheetOnNarrow →', await layout(p))
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  await p.locator('button', {hasText:'Меню без мобильного режима'}).first().click()
  console.log('  меню со sheetOnNarrow=false     →', await layout(p))
  await p.close()
}
await b.close()
