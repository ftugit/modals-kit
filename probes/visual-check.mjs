/**
 * probe: визуальная проверка после переноса оформления в утилиты.
 * Снимает те страницы, которые переписывались в этом раунде, и печатает
 * несколько замеров — чтобы «на глаз» и «числами» убедиться, что вид не уехал.
 */
import { chromium } from 'playwright'
const PORT = Number(process.env.MODALS_PORT ?? 4173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ headless: true })

// 1. Демо-страницы «Полный цикл» и «Спайк модели истории» (тёмная тема).
for (const [name, url] of [['cycle', '/cycle'], ['spike', '/spike']]) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto(BASE + url, { waitUntil: 'networkidle' })
  await sleep(400)
  const m = await p.evaluate(() => {
    const page = document.querySelector('main')
    const box = page.getBoundingClientRect()
    return {
      bg: getComputedStyle(page.parentElement).backgroundColor,
      color: getComputedStyle(page.parentElement).color,
      font: getComputedStyle(page.parentElement).fontFamily.split(',')[0],
      h1: getComputedStyle(document.querySelector('h1')).fontSize,
      mainWidth: Math.round(box.width),
      codeFont: getComputedStyle(document.querySelector('code')).fontSize,
    }
  })
  console.log(`— ${url} —`, JSON.stringify(m))
  await p.screenshot({ path: `probes/shot-${name}.png`, fullPage: true })
  await p.close()
}

// 2. Выпадашка FloatingMenu внутри модалки (desktop) — она переписана на утилиты.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  await p.goto(BASE + '/modals?modal=select', { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-modal-stage]')
  await sleep(400)
  const menu = p.locator('[data-modal-layer][data-active] [data-modal-btn]', { hasText: 'Меню внутри модалки' }).first()
  await menu.click()
  await sleep(500)
  const m = await p.evaluate(() => {
    const el = document.querySelector('[data-floating-menu]')
    const cs = getComputedStyle(el)
    const item = el.querySelector('[data-floating-menu-item]')
    return {
      radius: cs.borderRadius, padding: cs.padding, gap: cs.gap, shadow: cs.boxShadow.slice(0, 60) + '…',
      head: getComputedStyle(el.querySelector('[data-floating-menu-head]')).display,
      item: `${getComputedStyle(item).padding} / ${getComputedStyle(item).borderRadius}`,
      hint: getComputedStyle(el.querySelector('[data-floating-menu-hint]')).fontSize,
    }
  })
  console.log('— FloatingMenu (popup) —', JSON.stringify(m))
  await p.screenshot({ path: 'probes/shot-floating-menu.png' })
  await p.close()
}

// 3. Лист меню на узком экране: шапка листа, цели нажатия, разделители.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE + '/modals?modal=select', { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-modal-stage]')
  await sleep(400)
  await p.locator('[data-modal-layer][data-active] [data-modal-btn]', { hasText: 'Меню внутри модалки' }).first().click()
  await sleep(600)
  const m = await p.evaluate(() => {
    const el = document.querySelector('[data-floating-menu]')
    const head = el.querySelector('[data-floating-menu-head]')
    const items = [...el.querySelectorAll('[data-floating-menu-item]')]
    return {
      height: Math.round(el.getBoundingClientRect().height),
      radius: getComputedStyle(el).borderRadius,
      paddingBottom: getComputedStyle(el).paddingBottom,
      head: `${getComputedStyle(head).display} ${Math.round(head.getBoundingClientRect().height)}px`,
      itemHeight: items.map((i) => Math.round(i.getBoundingClientRect().height)),
      separator: getComputedStyle(items[1]).borderTopWidth,
    }
  })
  console.log('— FloatingMenu (sheet, 390px) —', JSON.stringify(m))
  await p.screenshot({ path: 'probes/shot-floating-sheet.png' })
  await p.close()
}

// 4. Панель источников и демо-поля на /modals (карточка «Поля»), светлая тема.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto(BASE + '/modals', { waitUntil: 'networkidle' })
  await sleep(400)
  await p.screenshot({ path: 'probes/shot-modals-page.png', fullPage: true })
  console.log('— /modals —', JSON.stringify(await p.evaluate(() => {
    const panel = document.querySelector('[data-select-root]')?.closest('section')
    return {
      panelRadius: panel ? getComputedStyle(panel).borderRadius : null,
      panelBorder: panel ? getComputedStyle(panel).borderTopWidth : null,
      h2: panel ? getComputedStyle(panel.querySelector('h2')).textTransform : null,
    }
  })))
  await p.close()
}

await browser.close()
console.log('снимки: probes/shot-cycle.png, shot-spike.png, shot-floating-menu.png, shot-floating-sheet.png, shot-modals-page.png')
