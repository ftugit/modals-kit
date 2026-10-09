import { chromium, devices } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({...devices['Pixel 5']})
const errs=[]
p.on('pageerror',e=>errs.push('pageerror: '+String(e).slice(0,160)))
p.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text().slice(0,160)) })
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
errs.length=0
await p.evaluate(()=>document.querySelector('a.modal-trigger')?.click())
await p.waitForTimeout(1200)
console.log('ошибки при открытии модалки поверх листа:')
errs.forEach(e=>console.log('   ', e))
if (!errs.length) console.log('    (нет)')
console.log('порядок цепочки в состоянии:', JSON.stringify(await p.evaluate(()=>{
  const m=history.state?.['sveltekit:states']?.modals ?? {}
  return {transient:(m.transient??[]).map(x=>x.id), order:m.order, depth:m.depth}
})))
await b.close()
