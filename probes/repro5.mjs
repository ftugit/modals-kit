import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:1280,height:860}})
await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(600)
await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(900)

await p.evaluate(()=>{
  window.__ev=[]
  const d=(e)=>{const t=e.target
    window.__ev.push(`${e.type} key=${e.key??''} target=${t?.tagName}${t?.className?'.'+String(t.className).split(' ')[0]:''} defaultPrevented=${e.defaultPrevented} phase=${e.eventPhase}`)}
  for (const t of ['keydown','keyup','click','pointerdown','focusin','focusout','change','input'])
    document.addEventListener(t, d, true)
  const ps=history.pushState.bind(history), rs=history.replaceState.bind(history)
  history.pushState=(s,t,u)=>{window.__ev.push('pushState '+u); return ps(s,t,u)}
  history.replaceState=(s,t,u)=>{window.__ev.push('replaceState '+u); return rs(s,t,u)}
  window.addEventListener('popstate',()=>window.__ev.push('POPSTATE '+location.search))
})
const sel=p.locator('.modal-popup select').first()
await sel.focus(); await p.waitForTimeout(200)
await p.evaluate(()=>window.__ev.push('--- нажимаем Enter ---'))
await p.keyboard.press('Enter')
await p.waitForTimeout(900)
const ev=await p.evaluate(()=>window.__ev)
console.log('=== поток событий при Enter на select внутри модалки ===')
for (const e of ev) console.log('  '+e)
console.log('\nсцен=', await p.locator('.modal-stage').count(), 'floating=', await p.locator('[data-host-floating]').count())
await b.close()
