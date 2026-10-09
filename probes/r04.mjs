import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
await p.locator('select').first().click({force:true}); await p.waitForTimeout(800)
console.log(JSON.stringify(await p.evaluate(()=>({
  stage: document.querySelectorAll('.modal-stage').length,
  popup: document.querySelectorAll('.modal-popup').length,
  dialog: document.querySelectorAll('[role=dialog]').length,
  ariaLabel: document.querySelector('[role=dialog]')?.getAttribute('aria-label'),
  backdropHidden: document.querySelector('.modal-backdrop')?.hasAttribute('hidden'),
  bodyOverflow: getComputedStyle(document.body).overflow,
  htmlOverflow: getComputedStyle(document.documentElement).overflow,
  bodyStyle: document.body.getAttribute('style'),
  htmlStyle: document.documentElement.getAttribute('style'),
  floatingParent: document.querySelector('[data-host-floating]')?.parentElement?.className||'BODY',
})),null,1))
await b.close()
