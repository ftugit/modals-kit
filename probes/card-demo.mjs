import { chromium } from 'playwright'
const b=await chromium.launch(); const errs=[]
const p=await b.newPage({viewport:{width:1280,height:900}})
p.on('pageerror',e=>errs.push(String(e).slice(0,110)))
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(700)
console.log('карточка открыта: сцен =', await p.locator('.modal-stage').count())
console.log('  select внутри:', await p.locator('.modal-popup select').count(),
            '| кнопка меню:', await p.locator('button', {hasText:'Действия'}).count())
// select
const sel=p.locator('.modal-popup select').first(); const sb=await sel.boundingBox()
await p.mouse.click(sb.x+sb.width/2, sb.y+sb.height/2); await p.waitForTimeout(600)
console.log('  select открыт: floating =', await p.locator('[data-host-floating]').count(),
            '| модалка жива =', (await p.locator('.modal-stage').count())===1,
            '| фокус в поиске =', await p.evaluate(()=>!!document.activeElement?.matches('input[role=combobox]')))
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
// меню
const mb=await p.locator('button', {hasText:'Действия'}).first().boundingBox()
await p.mouse.click(mb.x+mb.width/2, mb.y+mb.height/2); await p.waitForTimeout(600)
console.log('  меню открыто: пунктов =', await p.locator('[role=menuitem]').count(),
            '| модалка жива =', (await p.locator('.modal-stage').count())===1)
await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(500)
console.log('  после выбора пункта: текст действия =',
  (await p.locator('.modal-layer[data-active]').innerText()).match(/действие:\s*\S+/)?.[0])
console.log('ошибок:', errs.length?errs:'нет')
await b.close()
