/**
 * probe: подложка drawer'а сайдбара и её место в слоях.
 *
 * Проверяет ровно то, что просили в этой задаче:
 *   • у подложки сайдбара — тот же набор утилит/эффектов, что у фона
 *     модальной системы (fixed inset-0, z-200, затемнение 60%, blur 2px,
 *     transition opacity 220ms);
 *   • подложка ложится ПОВЕРХ шапки (на узком экране 390×844), а не только
 *     поверх рабочей зоны, как было с `absolute inset-0 z-30`;
 *   • панель сайдбара — выше подложки, но вся пара по-прежнему НИЖЕ
 *     модальной системы.
 *
 *   node probes/sidebar-scrim.mjs            # preview на :4173
 *   MODALS_PORT=5173 node probes/sidebar-scrim.mjs
 */
import { chromium } from 'playwright'

const PORT = Number(process.env.MODALS_PORT ?? 4173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (name, pass, extra = '') => {
  if (!pass) bad++
  console.log((pass ? '  ok  ' : ' FAIL ') + name + (extra ? ` — ${extra}` : ''))
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })

  const sample = (label) =>
    page.evaluate((label) => {
      // Именно подложка: у кнопки меню в шапке тот же `for="fe-sidebar"`.
      const scrim = document.querySelector('[data-fe-sidebar-backdrop]')
      const panel = document.getElementById('fe-sidebar-panel')
      const cs = (el) => (el ? getComputedStyle(el) : null)
      const rect = (el) => (el ? el.getBoundingClientRect() : null)
      const r = rect(scrim)
      const p = rect(panel)
      // Что реально лежит в точке: центр шапки и точка над панелью.
      const header = document.querySelector('[data-fe-header]')
      const topLeft = document.elementFromPoint(8, 2)
      // Точка над ШАПКОЙ, но мимо панели (панель 260px): там, где раньше
      // подложки не было вовсе — её прямоугольник начинался под шапкой.
      const overHeader = document.elementFromPoint(330, 8)
      const overPanel = document.elementFromPoint(Math.round((p?.left ?? 0) + 30), Math.round((p?.top ?? 0) + 120))
      return {
        label,
        scrim: scrim
          ? {
              classes: scrim.className,
              position: cs(scrim).position,
              zIndex: cs(scrim).zIndex,
              background: cs(scrim).backgroundColor,
              filter: cs(scrim).backdropFilter,
              transition: cs(scrim).transitionProperty + ' ' + cs(scrim).transitionDuration,
              opacity: cs(scrim).opacity,
              pointerEvents: cs(scrim).pointerEvents,
              box: r ? { top: r.top, left: r.left, w: Math.round(r.width), h: Math.round(r.height) } : null,
            }
          : null,
        panel: panel
          ? { zIndex: cs(panel).zIndex, position: cs(panel).position, translate: cs(panel).translate, box: p ? { left: Math.round(p.left), top: Math.round(p.top) } : null }
          : null,
        topLeft: topLeft?.tagName + (topLeft?.getAttribute('for') ? `[for=${topLeft.getAttribute('for')}]` : '') + (topLeft?.id ? `#${topLeft.id}` : ''),
        overHeader: overHeader?.tagName + (overHeader?.getAttribute('for') ? `[for=${overHeader.getAttribute('for')}]` : ''),
        overPanel: overPanel?.id ? '#' + overPanel.id : overPanel?.className?.toString().split(' ')[0],
      }
    }, label)

  console.log('— drawer закрыт —')
  const closed = await sample('closed')
  console.log('   подложка:', JSON.stringify(closed.scrim))
  check('закрыт: подложка не перехватывает клики', closed.scrim.pointerEvents === 'none')
  check('закрыт: прозрачность 0', closed.scrim.opacity === '0')

  console.log('— drawer открыт —')
  await page.locator('label[for="fe-sidebar"][aria-label="Открыть панель"]').click()
  await sleep(400)
  const open = await sample('open')
  console.log('   подложка:', JSON.stringify(open.scrim))
  console.log('   панель:', JSON.stringify(open.panel))
  console.log('   elementFromPoint(центр шапки):', open.overHeader, '| над панелью:', open.overPanel)

  check('открыт: подложка fixed на весь экран', open.scrim.position === 'fixed' && open.scrim.box.top === 0 && open.scrim.box.h >= 844, JSON.stringify(open.scrim.box))
  check('открыт: z-index как у фона модалок (200)', open.scrim.zIndex === '200', open.scrim.zIndex)
  check('открыт: затемнение 60%', /0\.6\)|60%/.test(open.scrim.background) || open.scrim.background.includes('rgba(0, 0, 0, 0.6)'), open.scrim.background)
  check('открыт: blur(2px) как у фона модалок', /blur\(2px\)/.test(open.scrim.filter), open.scrim.filter)
  check('открыт: переход opacity 220ms', /opacity/.test(open.scrim.transition) && /0\.22s|220ms/.test(open.scrim.transition), open.scrim.transition)
  check('открыт: подложка кликабельна', open.scrim.pointerEvents === 'auto')
  check('открыт: подложка ЛОЖИТСЯ ПОВЕРХ ШАПКИ (точка над шапкой мимо панели)', open.overHeader.startsWith('LABEL'), open.overHeader)
  check('открыт: панель выше подложки', Number(open.panel.zIndex) > Number(open.scrim.zIndex), `${open.panel.zIndex} > ${open.scrim.zIndex}`)
  check('открыт: панель сдвинута на экран', open.panel.translate === '0px' || open.panel.translate === 'none', open.panel.translate)

  console.log('— drawer закрывается кликом по подложке —')
  await page.mouse.click(330, 300)
  await sleep(350)
  check('клик по подложке закрыл drawer', !(await page.evaluate(() => document.getElementById('fe-sidebar')?.checked)))

  console.log('— модалка поверх drawer’а —')
  // Модалку поднимаем из адреса (холодный старт собирает стопку из ?modal=),
  // а drawer открываем программно: клик по кнопке меню перехватил бы модальный
  // слой — и это правильно, но проверить надо слои, а не перехват.
  await page.goto(BASE + '/modals?modal=card', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-modal-stage]')
  await sleep(300)
  await page.evaluate(() => {
    document.getElementById('fe-sidebar').checked = true
  })
  await sleep(400)
  const withModal = await page.evaluate(() => {
    const scrim = document.querySelector('[data-fe-sidebar-backdrop]')
    const panel = document.getElementById('fe-sidebar-panel')
    const backdrop = document.querySelector('[data-modal-backdrop]')
    const overPanel = document.elementFromPoint(
      Math.round(panel.getBoundingClientRect().left + 30),
      Math.round(panel.getBoundingClientRect().top + 120),
    )
    const row = scrim.parentElement
    return {
      modalZ: Number(getComputedStyle(backdrop).zIndex),
      viewportZ: Number(getComputedStyle(document.querySelector('[data-modal-viewport]') ?? document.body).zIndex) || null,
      panelZ: Number(getComputedStyle(panel).zIndex),
      scrimZ: Number(getComputedStyle(scrim).zIndex),
      rowZ: Number(getComputedStyle(row).zIndex),
      rowIsContext: getComputedStyle(row).position !== 'static' && getComputedStyle(row).zIndex !== 'auto',
      scrimVisible: getComputedStyle(scrim).opacity,
      overPanel: overPanel?.className?.toString().split(' ').slice(0, 2).join(' ') ?? null,
      // Модалка выше: над панелью drawer'а в этой точке лежит её содержимое.
      overPanelIsSheet: !!overPanel?.closest?.('[data-modal-stage], [data-modal-popup]'),
    }
  })
  console.log('   слои:', JSON.stringify(withModal))
  check('рабочая строка — контекст наложения на узком экране', withModal.rowIsContext, `z=${withModal.rowZ}`)
  check('drawer раскрыт и фон модалок на месте', withModal.scrimVisible === '1', withModal.scrimVisible)
  // Слои считаем по контекстам: подложка (200) и панель (210) drawer'а
  // живут ВНУТРИ рабочей строки, а она — слой 40 корневого контекста.
  // Модальная система (200/210 в корне) целиком выше этой строки.
  check('модалка (200) выше рабочей строки drawer’а (40)', withModal.modalZ > withModal.rowZ, `${withModal.modalZ} > ${withModal.rowZ}`)
  check('подложка и панель drawer’а лежат ВНУТРИ этой строки (их 200/210 не выходят в корень)', withModal.rowIsContext, `row z=${withModal.rowZ}`)
  check('модальный viewport в корне выше строки', (withModal.viewportZ ?? 0) > withModal.rowZ, `${withModal.viewportZ} > ${withModal.rowZ}`)

  console.log('— desktop: подложки нет, панель в потоке —')
  const wide = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  await wide.goto(BASE + '/modals', { waitUntil: 'networkidle' })
  const desktop = await wide.evaluate(() => {
    const scrim = document.querySelector('[data-fe-sidebar-backdrop]')
    const panel = document.getElementById('fe-sidebar-panel')
    return {
      scrimDisplay: getComputedStyle(scrim).display,
      panelPosition: getComputedStyle(panel).position,
      panelZ: getComputedStyle(panel).zIndex,
    }
  })
  console.log('   ', JSON.stringify(desktop))
  check('desktop: подложка скрыта', desktop.scrimDisplay === 'none', desktop.scrimDisplay)
  check('desktop: панель в потоке (не fixed)', desktop.panelPosition === 'static' || desktop.panelPosition === 'relative', desktop.panelPosition)
  await wide.close()

  console.log(bad === 0 ? '\n✅ scrim-проверки пройдены' : `\n❌ провалов: ${bad}`)
} finally {
  await browser.close()
}
if (bad > 0) process.exit(1)
