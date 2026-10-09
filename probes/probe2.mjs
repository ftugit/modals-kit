import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173/modals'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 390, height: 844 } })
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.type(), m.text().slice(0, 200)) })
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)))

await page.goto(BASE)
await page.waitForTimeout(500)

const snap = async (label) => {
  const s = await page.evaluate(() => ({
    histDepth: history.state?.modals?.depth ?? 0,
    transient: (history.state?.modals?.transient ?? []).map(t => t.id),
    url: location.pathname + location.search,
    floatings: document.querySelectorAll('[data-host-floating]').length,
    layout: document.querySelector('[data-host-floating]')?.getAttribute('data-layout') ?? null,
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    bodyLocked: document.body.hasAttribute('data-scroll-lock') || document.documentElement.hasAttribute('data-scroll-lock'),
    backdrop: document.querySelectorAll('.modal-backdrop').length,
    backdropVisible: (() => { const el = document.querySelector('.modal-backdrop'); if (!el) return null; const cs = getComputedStyle(el); return cs.display !== 'none' && cs.opacity !== '0' && !el.hasAttribute('hidden') }
    )(),
  }))
  console.log(`  ${label.padEnd(22)}`, JSON.stringify(s))
  return s
}

console.log('=== мобильный лист: есть ли у него запись цепочки, scroll lock, backdrop, Назад ===')
await snap('до открытия')
await page.locator('select').first().click({ force: true })
await page.waitForTimeout(500)
await snap('лист открыт')

console.log('\n--- нажимаем Назад ---')
await page.goBack().catch((e) => console.log('  goBack:', String(e).slice(0, 80)))
await page.waitForTimeout(600)
await snap('после Назад')

console.log('\n--- заново: Escape ---')
await page.goto(BASE); await page.waitForTimeout(400)
await page.locator('select').first().click({ force: true })
await page.waitForTimeout(400)
await snap('лист открыт')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await snap('после Escape')

console.log('\n--- сравнение: обычная transient-модалка (ModalTrigger) ---')
await page.goto(BASE); await page.waitForTimeout(400)
await snap('до')
const trigger = page.locator('text=Select внутри модалки').first()
if (await trigger.count()) {
  await trigger.click()
  await page.waitForTimeout(600)
  await snap('модалка открыта')
  await page.goBack(); await page.waitForTimeout(600)
  await snap('после Назад')
}

await b.close()
