import { chromium, devices } from 'playwright'
const b=await chromium.launch()
const dump = (el) => el ? {
  классы: el.className || '(нет)',
  атрибуты: [...el.attributes].filter(a=>a.name!=='class'&&a.name!=='style').map(a=>`${a.name}="${a.value}"`),
  inlineStyle: el.getAttribute('style') || '(нет)',
} : null

/* обычная модалка на desktop */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
  await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(800)
  console.log('=== МОДАЛКА: что в DOM ===')
  console.log(JSON.stringify(await p.evaluate(`(${dump.toString()}, (() => {
    const d = ${dump.toString()};
    return {
      backdrop: d(document.querySelector('.modal-backdrop')),
      stage: d(document.querySelector('.modal-stage')),
      body: document.body.getAttribute('style'),
      html: document.documentElement.getAttribute('style'),
      скрытыеСоседи: [...document.body.children].filter(e=>e.hasAttribute('aria-hidden')||e.hasAttribute('inert')).length,
    }
  })())`), null, 1))
  await p.close()
}
/* лист на мобильном */
{
  const p=await b.newPage({...devices['Pixel 5']})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(800)
  await p.locator('select').first().click({force:true}); await p.waitForTimeout(800)
  console.log('\n=== ЛИСТ: что в DOM ===')
  console.log(JSON.stringify(await p.evaluate(`(() => {
    const d = ${dump.toString()};
    return {
      лист: d(document.querySelector('[data-host-floating]')),
      body: document.body.getAttribute('style'),
      html: document.documentElement.getAttribute('style'),
    }
  })()`), null, 1))
  await p.close()
}
await b.close()
