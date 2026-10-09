import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('select').first().click({force:true}); await p.waitForTimeout(900)
console.log(JSON.stringify(await p.evaluate(()=>{
  const fl=document.querySelector('[data-host-floating]')
  const inertNeighbours=[...document.body.children].filter(el=>el.hasAttribute('inert')).length
  return {
    стадий: document.querySelectorAll('.modal-stage').length,
    контейнерInert: fl?.hasAttribute('inert') ?? null,
    соседейInert: inertNeighbours,
    role: fl?.getAttribute('role'), ariaModal: fl?.getAttribute('aria-modal'),
    ariaLabel: fl?.getAttribute('aria-label'), id: fl?.id,
    dataState: fl?.getAttribute('data-state'),
    bodyOverflow: getComputedStyle(document.body).overflow,
    фокус: document.activeElement?.className?.toString().slice(0,40)||document.activeElement?.tagName,
    страницаInert: document.querySelector('main,#app,body > div')?.hasAttribute('inert') ?? null,
  }}),null,1))
// интерактивность: можно ли кликнуть опцию
const opt=p.locator('[data-host-floating] [role=option]').first()
console.log('опций видно:', await p.locator('[data-host-floating] [role=option]').count())
await opt.click({timeout:3000}).then(()=>console.log('клик по опции: прошёл')).catch(e=>console.log('клик по опции: НЕ прошёл —', String(e).slice(0,60)))
await b.close()
