import { chromium, devices } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({...devices['Pixel 5']})
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)))
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
await p.locator('select').first().click({force:true}); await p.waitForTimeout(800)
console.log('standalone лист:', JSON.stringify(await p.evaluate(()=>{
  const bds=[...document.querySelectorAll('.modal-backdrop')]
  const fl=document.querySelector('[data-host-floating]')
  return {
    фонов: bds.length,
    видимыхФонов: bds.filter(e=>!e.hasAttribute('hidden')).length,
    role: fl?.getAttribute('role'), ariaModal: fl?.getAttribute('aria-modal'),
    overflow: getComputedStyle(document.body).overflow,
    сцен: document.querySelectorAll('.modal-stage').length,
    соседиСкрыты: [...document.body.children].filter(e=>!e.contains(fl)&&e.getAttribute('aria-hidden')==='true').length,
    всегоСоседей: [...document.body.children].filter(e=>!e.contains(fl)).length,
  }}),null,0))
console.log('ошибок:', errs.length?errs:'нет')
await b.close()
