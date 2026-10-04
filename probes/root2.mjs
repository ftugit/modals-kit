import { chromium } from 'playwright'
const BASE='http://127.0.0.1:5173/modals'
const b=await chromium.launch()

/* V-A: lifecycle callbacks для headless (чек3 P1.5 / чек1 M-08 / A-H7) */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  const logs=[]; p.on('console',m=>{const t=m.text(); if(t.startsWith('[host]')) logs.push(t)})
  await p.goto(BASE); await p.waitForTimeout(1500)
  logs.length=0
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(900)
  const stage=await p.locator('.modal-stage').count()
  console.log('V-A lifecycle при открытии мобильного листа:')
  console.log('   логи:', JSON.stringify(logs), ' .modal-stage =', stage)
  console.log('   →', logs.some(l=>l.includes('headless'))&&stage===0
    ? '🔴 ВОСПРОИЗВЕЛОСЬ: хост объявляет об открытии модалки, которой визуально нет'
    : '⚪ не воспроизвелось')
  await p.close()
}
/* V-B: narrow viewport + МЫШЬ, вложенный select (чек1 M-07, 2-я часть) */
{
  const p=await b.newPage({viewport:{width:390,height:844}})  // без hasTouch
  await p.goto(BASE); await p.waitForTimeout(1500)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1000)
  const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
  await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2)
  const probe=[]
  for (const ms of [50,150,500,1000]) { await p.waitForTimeout(ms===50?50:ms-probe.at(-1)?.ms||100)
    probe.push({ms, fl:await p.locator('[data-host-floating]').count(), st:await p.locator('.modal-stage').count()}) }
  console.log('\nV-B вложенный select, 390px + мышь (без hasTouch):')
  console.log('  ', JSON.stringify(probe))
  console.log('   →', probe.at(-1).fl===0
    ? '🔴 ВОСПРОИЗВЕЛОСЬ: floating не удерживается'
    : '⚪ не воспроизвелось: floating остаётся открытым')
  await p.close()
}
/* V-C: expected fail — сценарий forceClose в середине цепочки (чек3 P2.6) */
{
  console.log('\nV-C expected fail (чек3 P2.6): проверяется юнит-тестом, не браузером')
}
await b.close()
