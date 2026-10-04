import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
const btn = p.locator('button', { hasText: 'Закрыть все' }).first()
console.log('до открытия  :', (await btn.textContent())?.trim(), '| disabled =', await btn.isDisabled())
await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
console.log('лист открыт  :', (await btn.textContent())?.trim(), '| disabled =', await btn.isDisabled(),
            '| floating =', await p.locator('[data-host-floating]').count())
// кликаем «Закрыть все» при открытом листе
await btn.click({force:true}); await p.waitForTimeout(700)
console.log('после клика  : floating =', await p.locator('[data-host-floating]').count(),
            '| индикатор =', await p.evaluate(()=>document.body.innerText.match(/в стопке:\s*\d+/)?.[0]))
await b.close()
