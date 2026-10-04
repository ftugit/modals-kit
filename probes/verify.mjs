import { chromium } from 'playwright'
const BASE='http://127.0.0.1:4173/modals'
const b=await chromium.launch(); const log=console.log

/* V1: геометрия .select-content против контейнера (claim 1.md H5) */
for (const [w,h,label] of [[390,844,'mobile sheet'],[900,800,'desktop popup 900px']]) {
  const p=await b.newPage({viewport:{width:w,height:h}})
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  const g=await p.evaluate(()=>{
    const out=document.querySelector('[data-host-floating]'), inn=document.querySelector('.select-content')
    const r=e=>e?{w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height),
      top:Math.round(e.getBoundingClientRect().top),bottom:Math.round(e.getBoundingClientRect().bottom)}:null
    return {outer:r(out), inner:r(inn), layout:out?.getAttribute('data-layout'),
      innerH:inn?getComputedStyle(inn).height:null, innerMaxH:inn?getComputedStyle(inn).maxHeight:null}
  })
  const over = g.inner && g.outer ? g.inner.h - g.outer.h : null
  log(`V1 ${label}: outer=${g.outer?.w}x${g.outer?.h} inner=${g.inner?.w}x${g.inner?.h} layout=${g.layout} maxH=${g.innerMaxH}`)
  log(`   → вылезает на ${over}px ${over>1?'❌ ДА':'✅ нет'} (inner.bottom=${g.inner?.bottom}, outer.bottom=${g.outer?.bottom})`)
  await p.close()
}

/* V2: фантом + обычная модалка → пустой активный слой (claim 3.md P0 / 1.md H3) */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(500)
  await p.setViewportSize({width:1280,height:860}); await p.waitForTimeout(500)
  await p.keyboard.press('Escape'); await p.waitForTimeout(500)
  log('\nV2 после mobile→desktop→Escape, фантом в цепочке:',
    JSON.stringify(await p.evaluate(()=>({t:(history.state?.['sveltekit:states']?.modals?.transient??[]).map(x=>x.id)}))))
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(800)
  const r=await p.evaluate(()=>{
    const layers=[...document.querySelectorAll('.modal-layer')]
    return {count:layers.length, layers:layers.map(l=>({active:l.hasAttribute('data-active'),
      ariaHidden:l.getAttribute('aria-hidden'), text:(l.textContent||'').trim().slice(0,40)}))}
  })
  log('   .modal-layer:', JSON.stringify(r,null,1).replace(/\n/g,'\n   '))
  await p.screenshot({path:'probes/shot-empty-layer.png'})
  await p.close()
}

/* V3: Back → Forward для standalone sheet (claim 1.md H1) */
{
  const p=await b.newPage({viewport:{width:390,height:844}})
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(600)
  const s=()=>p.evaluate(()=>({fl:document.querySelectorAll('[data-host-floating]').length,
    t:(history.state?.['sveltekit:states']?.modals?.transient??[]).map(x=>x.id)}))
  log('\nV3 открыт:      ', JSON.stringify(await s()))
  await p.goBack(); await p.waitForTimeout(700); log('   после Back:   ', JSON.stringify(await s()))
  await p.goForward(); await p.waitForTimeout(800); log('   после Forward:', JSON.stringify(await s()),
    '← запись вернулась, а UI?')
  await p.close()
}
await b.close()
