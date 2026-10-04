import { chromium } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch()
const where=p=>p.evaluate(()=>{const a=document.activeElement
  return a?`${a.tagName}${a.className?'.'+String(a.className).split(' ').slice(0,2).join('.'):''}${a.getAttribute?.('aria-label')?'[aria-label='+a.getAttribute('aria-label')+']':''}`:'null'})

console.log('=== R07 корневая причина: куда уходит фокус внутри модалки ===')
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(600)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(900)
  console.log('  фокус сразу после открытия модалки :', await where(p))
  const sel=p.locator('.modal-popup select').first()
  await sel.focus()
  console.log('  сразу после sel.focus()            :', await where(p))
  await p.waitForTimeout(150); console.log('  +150ms                             :', await where(p))
  await p.waitForTimeout(500); console.log('  +650ms                             :', await where(p))
  // Tab-навигация: доходит ли фокус до select вообще
  await p.keyboard.press('Tab'); await p.waitForTimeout(200); console.log('  после Tab                          :', await where(p))
  await p.keyboard.press('Tab'); await p.waitForTimeout(200); console.log('  после Tab x2                       :', await where(p))
  await p.keyboard.press('Enter'); await p.waitForTimeout(600)
  console.log('  после Enter: сцен=', await p.locator('.modal-stage').count(), ' floating=', await p.locator('[data-host-floating]').count())
  await p.close()
}
console.log('\n=== контроль: тот же select ВНЕ модалки ===')
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto(BASE); await p.waitForTimeout(600)
  const sel=p.locator('select').first()
  await sel.focus(); await p.waitForTimeout(500)
  console.log('  фокус после sel.focus()            :', await where(p))
  await p.keyboard.press('Enter'); await p.waitForTimeout(500)
  console.log('  после Enter: floating=', await p.locator('[data-host-floating]').count())
  await p.close()
}
console.log('\n=== R16 уточнение: сколько шагов «Назад» нужно, чтобы уйти со страницы ===')
for (const phantom of [false,true]) {
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto('http://127.0.0.1:4173/'); await p.waitForTimeout(400)
  await p.goto(BASE); await p.waitForTimeout(600)
  if (phantom) {
    await p.locator('select').first().click({force:true}); await p.waitForTimeout(500)
    await p.setViewportSize({width:1280,height:860}); await p.waitForTimeout(500)
    await p.mouse.click(5,5); await p.waitForTimeout(500)
  }
  const ch=await p.evaluate(()=>(history.state?.['sveltekit:states']?.modals?.transient??[]).map(x=>x.id))
  let steps=0, path=new URL(p.url()).pathname
  while (path.includes('/modals') && steps<5) { await p.evaluate(()=>history.back()); await p.waitForTimeout(600); steps++; path=new URL(p.url()).pathname }
  console.log(`  ${phantom?'с фантомом   ':'без фантома  '} цепочка=${JSON.stringify(ch)} → шагов «Назад» до ухода со страницы: ${steps} (ушли на ${path})`)
  await p.close()
}
await b.close()
