import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:1280,height:900}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
// выключаем обе анимации
// кнопки «выкл»: первая — анимация открытия, вторая — закрытия
const off = p.getByRole('button', { name: 'выкл', exact: true })
await off.nth(0).click(); await p.waitForTimeout(150)
await off.nth(1).click(); await p.waitForTimeout(200)
console.log('анимации:', await p.evaluate(()=>'выключены'))
await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(600)
await p.evaluate(()=>{window.__t=[];const t0=performance.now()
  const obs=new MutationObserver(()=>{
    const s=document.querySelectorAll('.modal-stage').length
    const bd=document.querySelectorAll('.modal-backdrop').length
    const k=`${s}/${bd}`
    if(k!==window.__k){window.__k=k;window.__t.push(`${Math.round(performance.now()-t0)}ms сцена/фон = ${k}`)}})
  obs.observe(document.body,{childList:true,subtree:true,attributes:true})})
await p.keyboard.press('Escape')
await p.waitForTimeout(1200)
console.log('анимации выключены, закрытие по Escape:')
for (const l of await p.evaluate(()=>window.__t)) console.log('   '+l)
await b.close()
