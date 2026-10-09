import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173/modals'
const b = await chromium.launch()
const log = console.log
const read = (p) => p.evaluate(() => {
  const m = history.state?.['sveltekit:states']?.modals ?? {}
  return { depth: m.depth ?? 0, t: (m.transient ?? []).map(x => x.id), url: location.search,
    fl: document.querySelectorAll('[data-host-floating]').length,
    st: document.querySelectorAll('.modal-stage').length }
})

/* F1: последствия фантомной записи */
{
  log('=== F1: что делает Escape/Назад после фантомной записи ===')
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true }); await p.waitForTimeout(500)
  await p.setViewportSize({ width: 1280, height: 860 }); await p.waitForTimeout(500)
  await p.mouse.click(5, 5); await p.waitForTimeout(500)
  log('  фантом в цепочке:', JSON.stringify(await read(p)))
  log('  видимых модалок на экране:', (await read(p)).st)
  await p.keyboard.press('Escape'); await p.waitForTimeout(600)
  log('  после Escape №1 :', JSON.stringify(await read(p)), '← пользователь не видит никакой реакции')
  await p.evaluate(() => history.back()); await p.waitForTimeout(700)
  log('  после Назад     :', JSON.stringify(await read(p)), 'url=', p.url())
  await p.close()
}

/* F2: почему select внутри модалки не открывается на mobile */
{
  log('\n=== F2: покадрово — select внутри модалки, mobile 390 ===')
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('text=Select внутри модалки').first().click(); await p.waitForTimeout(700)
  log('  модалка:', JSON.stringify(await read(p)))
  await p.locator('.modal-popup select').first().click({ force: true })
  for (let i = 1; i <= 10; i++) {
    await p.waitForTimeout(100)
    const s = await read(p)
    log(`  +${i * 100}ms`, JSON.stringify(s))
  }
  await p.close()
}

/* F3: тот же сценарий, но select вне модалки на mobile — для контраста */
{
  log('\n=== F3: контроль — тот же клик вне модалки, mobile 390 ===')
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE); await p.waitForTimeout(500)
  await p.locator('select').first().click({ force: true })
  for (let i = 1; i <= 5; i++) { await p.waitForTimeout(100); log(`  +${i * 100}ms`, JSON.stringify(await read(p))) }
  await p.close()
}
await b.close()
