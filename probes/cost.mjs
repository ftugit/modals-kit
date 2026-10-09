import { chromium, devices } from 'playwright'
const b=await chromium.launch()
const say=(k,v)=>console.log('  '+k.padEnd(42), v)

/* цена: сколько узлов фона в разных состояниях */
{
  console.log('=== узлы .modal-backdrop ===')
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
  const c=()=>p.evaluate(()=>{const a=[...document.querySelectorAll('.modal-backdrop')]
    return `всего ${a.length}, видимых ${a.filter(e=>!e.hasAttribute('hidden')).length}`})
  say('пусто', await c())
  await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(600)
  say('обычная модалка (desktop)', await c())
  await p.keyboard.press('Escape'); await p.waitForTimeout(600)
  await p.close()
  const m=await b.newPage({...devices['Pixel 5']})
  await m.goto('http://127.0.0.1:4173/modals'); await m.waitForTimeout(800)
  const cm=()=>m.evaluate(()=>{const a=[...document.querySelectorAll('.modal-backdrop')]
    return `всего ${a.length}, видимых ${a.filter(e=>!e.hasAttribute('hidden')).length}`})
  say('пусто (mobile)', await cm())
  await m.locator('select').first().click({force:true}); await m.waitForTimeout(700)
  say('лист', await cm())
  await m.keyboard.press('Escape'); await m.waitForTimeout(700)
  say('после закрытия листа', await cm())
  await m.close()
}
/* цена: scroll lock снимается после закрытия обеих поверхностей */
{
  console.log('\n=== scroll lock: модалка + лист + закрытие ===')
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
  const ov=()=>p.evaluate(()=>getComputedStyle(document.body).overflow)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
  say('модалка', await ov())
  const bb=await p.locator('.modal-popup select').first().boundingBox()
  await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(700)
  say('модалка + лист', await ov())
  await p.keyboard.press('Escape'); await p.waitForTimeout(700)
  say('лист закрыт, модалка жива', await ov())
  await p.keyboard.press('Escape'); await p.waitForTimeout(800)
  say('всё закрыто', await ov())
  say('сцен/floating', await p.evaluate(()=>`${document.querySelectorAll('.modal-stage').length}/${document.querySelectorAll('[data-host-floating]').length}`))
  await p.close()
}
await b.close()
