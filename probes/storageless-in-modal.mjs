import { chromium } from 'playwright'
const b=await chromium.launch(); const errs=[]
const p=await b.newPage({viewport:{width:1280,height:900}})
p.on('pageerror',e=>errs.push(String(e).slice(0,110)))
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(700)
console.log('в карточке кнопок «Без хранилища поверх»:', await p.locator('button', {hasText:'Без хранилища поверх'}).count())
await p.locator('button', {hasText:'Без хранилища поверх'}).first().click(); await p.waitForTimeout(700)
console.log('после клика:', JSON.stringify(await p.evaluate(()=>({
  слоёв: document.querySelectorAll('.modal-layer').length,
  url: location.search,
  transient: (history.state?.['sveltekit:states']?.modals?.transient??[]).map(x=>x.id),
  активныйТекст: (document.querySelector('.modal-layer[data-active]')?.textContent||'').trim().slice(0,30)}))))
await p.locator('button', {hasText:'Меню этой модалки'}).first().click(); await p.waitForTimeout(500)
console.log('меню внутри неё: floating =', await p.locator('[data-host-floating]').count())
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
await p.keyboard.press('Escape'); await p.waitForTimeout(600)
console.log('после Escape: слоёв =', await p.locator('.modal-layer').count(), '| url =', await p.evaluate(()=>location.search))
// в модалке со списками
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(600)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
console.log('в SelectModal кнопок:', await p.locator('button', {hasText:'Без хранилища поверх'}).count())
console.log('ошибки:', errs.length?errs:'нет')
await b.close()
