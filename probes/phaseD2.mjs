import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('select').first().click({force:true}); await p.waitForTimeout(1200)
console.log(JSON.stringify(await p.evaluate(()=>{
  const id='modals-host-sheet-floating-1'
  return {
    сКлючевымId: document.querySelectorAll('#'+CSS.escape(id)).length,
    getElementById: !!document.getElementById(id),
    маркеровInerted: document.querySelectorAll('[data-inerted]').length,
    маркеровAriaHidden: document.querySelectorAll('[data-aria-hidden]').length,
    детиBody: [...document.body.children].map(e=>({
      тег:e.tagName, кл:String(e.className).slice(0,24), inert:e.hasAttribute('inert'),
      ah:e.getAttribute('aria-hidden'), содержитЛист: e.contains(document.getElementById(id))})),
    inertПоддерживается: HTMLElement.prototype.hasOwnProperty('inert'),
  }}),null,1))
await b.close()
