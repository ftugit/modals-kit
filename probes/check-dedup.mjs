import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true})
await p.goto('http://127.0.0.1:5173/modals'); await p.waitForTimeout(1500)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(1000)
const sel=p.locator('.modal-popup select').first(); const bb=await sel.boundingBox()
await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(1200)

const r=await p.evaluate(()=>{
  const list=document.querySelector('.select-content')
  const floating=document.querySelector('[data-host-floating]')
  const stage=document.querySelector('.modal-stage')
  const layers=[...document.querySelectorAll('.modal-layer')]
  const inLayer=layers.findIndex(l=>l.contains(list))
  return {
    списокВнутриСлоя: inLayer,                         // -1 = ни в одном
    списокВнутриСцены: stage? stage.contains(list):null,
    floatingВнутриСцены: stage? stage.contains(floating):null,
    родительFloating: floating?.parentElement?.tagName+'.'+(floating?.parentElement?.className||'(body)'),
    слоёв: layers.length,
    активныйСлойПуст: (layers.find(l=>l.hasAttribute('data-active'))?.textContent||'').trim()==='' ,
    фокус: document.activeElement?.className||document.activeElement?.tagName,
  }
})
console.log('=== где физически живёт список относительно слоёв ===')
console.log(JSON.stringify(r,null,1))
console.log('\nВывод:', r.списокВнутриСлоя===-1 && r.floatingВнутриСцены===false
  ? '🔴 список и floating-контейнер НЕ находятся ни в одном .modal-layer и вне .modal-stage —\n   значит правка Layers.svelte (фильтрация headless) на решение focus-trap не влияет'
  : 'список внутри слоя — дедупликация итог1 может быть обоснована')
await b.close()
