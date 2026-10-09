import { chromium, devices } from 'playwright'
const b=await chromium.launch()
/* desktop popup внутри модалки */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
  const bb=await p.locator('.modal-popup select').first().boundingBox()
  await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(600)
  console.log('desktop popup в модалке:', JSON.stringify(await p.evaluate(()=>{
    const fl=document.querySelector('[data-host-floating]'), st=document.querySelector('.modal-stage')
    return {родитель: fl?.parentElement?.tagName+'.'+(fl?.parentElement?.className||''),
      вСцене: st?.contains(fl), role: fl?.getAttribute('role'), ariaModal: fl?.getAttribute('aria-modal'),
      фокус: document.activeElement?.tagName}})))
  await p.close()
}
/* standalone лист */
{
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(700)
  console.log('standalone лист:       ', JSON.stringify(await p.evaluate(()=>{
    const fl=document.querySelector('[data-host-floating]')
    return {role: fl?.getAttribute('role'), ariaModal: fl?.getAttribute('aria-modal'),
      фонов: document.querySelectorAll('.modal-backdrop').length,
      overflow: getComputedStyle(document.body).overflow}})))
  await p.close()
}
await b.close()
