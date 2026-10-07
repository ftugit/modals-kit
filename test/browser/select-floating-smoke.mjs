import { chromium } from 'playwright'

const BASE = process.env.MODALS_BASE ?? 'http://127.0.0.1:4173/modals'
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
async function waitCount(page, selector, count, timeout = 5000) {
  await page.waitForFunction(
    ([selector, count]) => document.querySelectorAll(selector).length === count,
    [selector, count],
    { timeout },
  )
}
async function waitAtLeast(page, selector, count, timeout = 5000) {
  await page.waitForFunction(
    ([selector, count]) => document.querySelectorAll(selector).length >= count,
    [selector, count],
    { timeout },
  )
}
async function clickSelect(root) {
  await root.locator('select').click({ force: true })
}

const browser = await chromium.launch({ headless: true })
let passed = 0
const ok = (msg) => { passed += 1; console.log('  ok  ' + msg) }
try {
  console.log('— Select: desktop host.floating —')
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    const root = page.locator('[data-select-root]').first()
    await root.waitFor({ state: 'visible' })
    await clickSelect(root)
    await waitAtLeast(page, '[data-host-floating]', 1)
    assert(await page.locator('[data-select-content][data-host-menu]').count() >= 1, 'host menu content not rendered')
    assert(await page.locator('[data-modal-stage]').count() === 0, 'desktop select unexpectedly opened modal layer')
    const place = await page.locator('[data-host-floating]').first().getAttribute('data-place')
    assert(['bottom', 'top', 'overlay'].includes(place), `unexpected floating place=${place}`)
    ok(`desktop opened host.floating menu (${place})`)
    await page.mouse.click(5, 5)
    await waitCount(page, '[data-host-floating]', 0)
    ok('outside pointer closed host.floating without modal chain')
    await page.close()
  }

  console.log('— Select: desktop⇄mobile transfer keeps same open state —')
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    const root = page.locator('[data-select-root]').first()
    await clickSelect(root)
    await waitAtLeast(page, '[data-host-floating]', 1)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(
      () => document.querySelector('[data-host-floating]')?.getAttribute('data-layout') === 'sheet',
      undefined, { timeout: 5000 },
    )
    // Узел ТОТ ЖЕ: переносится поведение и оформление, а не DOM.
    assert((await page.locator('[data-host-floating]').count()) === 1, 'контейнер пересоздался')
    assert(
      (await page.locator('[data-host-floating]').getAttribute('data-mobile-anchor')) === 'bottom',
      'mobile select did not use mobile="bottom"',
    )
    // 🔴 Контракт уточнён (решение владельца, ISSUES.md R-04): лист модальный,
    // поэтому сцена Ark существует — она даёт фон, scroll lock и aria-изоляцию.
    // Проверяем то, ради чего пункт писался: ПУСТОЙ ОБОЛОЧКИ нет.
    assert((await page.locator('[data-modal-popup]').count()) === 0, 'headless-запись нарисовала пустую модалку')
    ok('desktop floating стал листом без переноса DOM')
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.waitForFunction(
      () => document.querySelector('[data-host-floating]')?.getAttribute('data-layout') === 'popup',
      undefined, { timeout: 5000 },
    )
    assert((await page.locator('[data-host-floating]').count()) === 1, 'контейнер пересоздался на обратном пути')
    ok('лист вернулся в выпадашку, узел снова тот же')
    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)
    await page.close()
  }

  console.log('— Select: mobile multiselect keeps layer by default —')
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    const root = page.locator('[data-select-root]').first()
    await clickSelect(root)
    await waitAtLeast(page, '[data-host-floating]', 1)
    const sheet = page.locator('[data-host-floating]').first()
    assert((await sheet.getAttribute('data-layout')) === 'sheet', 'на мобильном должен быть лист')
    const anchor = await sheet.getAttribute('data-mobile-anchor')
    assert(anchor === 'bottom', `mobile select anchor=${anchor}, expected bottom`)
    ok('mobile Select раскрывается листом снизу через mobile/mobileAnchor API')
    await page.locator('[data-select-content][data-as-layer] [role="option"]', { hasText: 'localStorage' }).click()
    await page.waitForTimeout(250)
    assert(await page.locator('[data-select-content][data-as-layer]').count() >= 1, 'multiple select closed after option click')
    ok('multiple Select did not close after option click by default')
    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)
    await page.close()
  }

  console.log('— Select inside modal: floating does not dismiss owner modal —')
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).click()
    await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 })
    const modalSelects = page.locator('[data-modal-layer][data-active] [data-select-root]')

    const singleSelect = modalSelects.nth(0)
    await clickSelect(singleSelect)
    await waitAtLeast(page, '[data-host-floating]', 1)
    await page.locator('[data-select-content][data-host-menu]').waitFor({ state: 'visible' })
    assert(await page.locator('[data-modal-stage]').count() === 1, 'owner modal closed when inner select opened')
    ok('inner Select opened as host.floating while owner modal stayed open')
    await page.locator('[data-select-content][data-host-menu] [role="option"]', { hasText: 'Комедия' }).click()
    await waitCount(page, '[data-host-floating]', 0)
    assert(await page.locator('[data-modal-stage]').count() === 1, 'owner modal closed after choosing inner option')
    const picked = await page.locator('[data-modal-layer][data-active] [data-select-modal-picked]').innerText()
    assert(picked.includes('comedy'), `inner select did not commit comedy: ${picked}`)
    ok('single Select closes only floating menu and commits value')

    const defaultMulti = modalSelects.nth(1)
    await clickSelect(defaultMulti)
    await waitAtLeast(page, '[data-host-floating]', 1)
    await page.locator('[data-select-content][data-host-menu] [role="option"]', { hasText: 'Боевик' }).click()
    await waitAtLeast(page, '[data-host-floating]', 1)
    assert(await page.locator('[data-modal-stage]').count() === 1, 'owner modal closed after default multiple choice')
    ok('multiple Select stays open by default after option click')
    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)

    const closingMulti = modalSelects.nth(2)
    await clickSelect(closingMulti)
    await waitAtLeast(page, '[data-host-floating]', 1)
    await page.locator('[data-select-content][data-host-menu] [role="option"]', { hasText: 'Драма' }).click()
    await waitCount(page, '[data-host-floating]', 0)
    assert(await page.locator('[data-modal-stage]').count() === 1, 'owner modal closed after closeOnSelect multiple choice')
    ok('multiple Select can opt into closeOnSelect')

    await page.close()
  }

  console.log('— Select: смена источников не закрывает слой (reconfigure, не пересоздание) —')
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })

    // Панель источников пишет в demoSources на КАЖДЫЙ выбор. Раньше это
    // пересоздавало ядро модалок и убивало открытый transient-слой —
    // мультиселект закрывался на первом же клике.
    const sources = page.locator('[data-select-root]').first()
    const trigger = sources.locator('[data-select-trigger], button').first()
    const before = (await trigger.innerText()).replace(/\s+/g, ' ').trim()

    await sources.locator('button, [role="combobox"], select').first().click({ force: true })
    await waitAtLeast(page, '[data-host-floating]', 1)

    const option = page.locator('[data-select-content] [role="option"]', { hasText: 'localStorage' }).first()
    assert((await option.getAttribute('aria-selected')) === 'true', 'localStorage должен быть выбран изначально')
    await option.click()
    await page.waitForTimeout(300)

    assert((await page.locator('[data-host-floating]').count()) === 1, 'слой закрылся после смены набора источников')
    assert((await option.getAttribute('aria-selected')) === 'false', 'выбор источника не применился')
    ok('смена источников не роняет открытый слой')

    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)
    const after = (await trigger.innerText()).replace(/\s+/g, ' ').trim()
    assert(after !== before, `набор источников не изменился: ${before} → ${after}`)
    ok('ядро переконфигурировано на месте, набор источников применён')
    await page.close()
  }

  console.log('— Select: клавиатура и aria-activedescendant (модель APG) —')
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })

    const select = page.locator('[data-select-root]').first()
    await clickSelect(select)
    await waitAtLeast(page, '[data-host-floating]', 1)

    const input = page.locator('[data-select-content] input[role="combobox"]').first()
    assert(await input.count() === 1, 'у поиска нет role="combobox"')
    const controls = await input.getAttribute('aria-controls')
    assert(controls, 'aria-controls не проставлен')
    assert(
      await page.locator(`[id="${controls}"][role="listbox"]`).count() === 1,
      'aria-controls не указывает на listbox',
    )

    const first = await input.getAttribute('aria-activedescendant')
    assert(first, 'aria-activedescendant отсутствует — навигация не озвучивается')
    assert(
      await page.locator(`[id="${first}"][role="option"]`).count() === 1,
      'aria-activedescendant указывает в пустоту',
    )
    ok('combobox связан с listbox и активной опцией')

    await page.keyboard.press('ArrowDown')
    const second = await input.getAttribute('aria-activedescendant')
    assert(second && second !== first, `ArrowDown не сдвинул активную опцию: ${first} → ${second}`)
    ok('ArrowDown двигает виртуальный фокус')

    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)
    await page.close()
  }

  console.log('— Select: без автофокуса клавиатура всё равно работает —')
  {
    // 🔴 Контекст именно СЕНСОРНЫЙ: автофокус поиска отключается по типу
    // ввода `(hover: none) and (pointer: coarse)`, а не по ширине окна
    // (шаг плана «автофокус по типу ввода»). Узкое окно с мышью теперь
    // автофокус получает — и это намеренно.
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    })
    await page.goto(BASE, { waitUntil: 'networkidle' })

    const sources = page.locator('[data-select-root]').first()
    await sources.locator('button, [role="combobox"], select').first().click({ force: true })
    await waitAtLeast(page, '[data-host-floating]', 1)

    // На мобильном слое автофокус поиска выключен намеренно: фокус в поле
    // поднял бы экранную клавиатуру поверх списка. Но фокус обязан остаться
    // ВНУТРИ слоя, иначе стрелки и Enter некому принять.
    const focused = await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return 'none'
      if (el.matches('input[role="combobox"]')) return 'search'
      return el.closest('[data-select-content]') ? 'content' : 'outside'
    })
    assert(focused === 'content', `фокус ушёл не туда: ${focused}`)
    ok('фокус держится на слое, не поднимая клавиатуру')

    const input = page.locator('[data-select-content] input[role="combobox"]').first()
    const before = await input.getAttribute('aria-activedescendant')
    await page.keyboard.press('ArrowDown')
    const after = await input.getAttribute('aria-activedescendant')
    assert(after && after !== before, `без автофокуса стрелки не работают: ${before} → ${after}`)
    ok('стрелки двигают активную опцию и без фокуса в поле')

    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)
    await page.close()
  }

  console.log('— Select: поиск переживает переход desktop⇄mobile —')
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await clickSelect(page.locator('[data-select-root]').first())
    await waitAtLeast(page, '[data-host-floating]', 1)

    const typed = 'mem'
    await page.locator('[data-select-content] input[role="combobox"]').first().fill(typed)
    await page.waitForTimeout(100)
    const filteredDesktop = await page.locator('[data-select-content] [role="option"]').count()
    assert(filteredDesktop >= 1, 'фильтр ничего не оставил — тест бессмысленен')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(
      () => document.querySelector('[data-host-floating]')?.getAttribute('data-layout') === 'sheet',
      undefined, { timeout: 5000 },
    )

    // 🔴 Это и есть причина, по которой `query` живёт в Select, а не в панели:
    // при переходе desktop⇄mobile панель пересоздаётся, и состояние внутри
    // неё было бы потеряно. Перенести поиск внутрь панели можно только
    // после overlay-плоскости, когда панель перестанет перемонтироваться.
    const kept = await page.locator('[data-select-content] input[role="combobox"]').first().inputValue()
    assert(kept === typed, `поиск не пережил переход: ${JSON.stringify(kept)}`)
    ok('строка поиска сохраняется при смене ориентации')

    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)
    await page.close()
  }

  console.log('— Select: порог берётся у хоста (зона 768–1023) —')
  {
    // 🔴 Раньше у select был свой захардкоженный 1024 против 768 у хоста:
    // в этой полосе хост считал экран широким, а select открывался слоем.
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })

    await clickSelect(page.locator('[data-select-root]').first())
    await waitAtLeast(page, '[data-host-floating]', 1)
    assert(
      (await page.locator('[data-modal-popup]').count()) === 0,
      'на 900px select открылся слоем — порог всё ещё свой, а не хостовый',
    )
    ok('на 900px select — выпадашка, как и модалки у хоста')
    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)

    // Ниже порога хоста (768) поведение прежнее: слой.
    await page.setViewportSize({ width: 600, height: 800 })
    await page.waitForTimeout(300)
    await clickSelect(page.locator('[data-select-root]').first())
    await page.waitForFunction(
      () => document.querySelector('[data-host-floating]')?.getAttribute('data-layout') === 'sheet',
      undefined, { timeout: 5000 },
    )
    ok('ниже порога хоста select по-прежнему раскрывается листом')
    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)
    await page.close()
  }

  console.log('— Behavioural layering: поворот не пересоздаёт список —')
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await clickSelect(page.locator('[data-select-root]').first())
    await waitAtLeast(page, '[data-host-floating]', 1)

    // Метим живой DOM-узел списка. Если при повороте он уцелеет — значит
    // содержимое не пересоздавалось, а только сменило оформление.
    await page.evaluate(() => {
      document.querySelector('[data-select-content]').dataset.liveMark = 'kept'
    })

    const input = page.locator('[data-select-content] input[role="combobox"]').first()
    await input.fill('mem')
    await page.evaluate(() => {
      const el = document.querySelector('[data-select-content] input[role="combobox"]')
      el.focus(); el.setSelectionRange(2, 2)
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(
      () => document.querySelector('[data-host-floating]')?.getAttribute('data-layout') === 'sheet',
      undefined, { timeout: 5000 },
    )

    const mark = await page.locator('[data-select-content]').first().getAttribute('data-live-mark')
    assert(mark === 'kept', 'список пересоздан: метка на узле пропала')
    ok('тот же DOM-узел списка пережил поворот')

    const state = await page.evaluate(() => {
      const el = document.activeElement
      return {
        isSearch: !!el && el.matches('input[role="combobox"]'),
        value: el && 'value' in el ? el.value : null,
        caret: el && 'selectionStart' in el ? el.selectionStart : null,
      }
    })
    assert(state.value === 'mem', `строка поиска потеряна: ${JSON.stringify(state.value)}`)
    assert(state.isSearch, 'фокус ушёл из поля поиска при повороте')
    assert(state.caret === 2, `каретка сбилась: ${state.caret}`)
    ok('фокус, значение и позиция каретки сохранены')

    await page.keyboard.press('Escape')
    await waitCount(page, '[data-host-floating]', 0)
    await page.close()
  }

  console.log('— Select: мобильный лист — три бага из мобильного отчёта —')
  {
    // Живая страница с ДЛИННЫМ списком: панель фильтров источника «animes»,
    // у жанров 80 пунктов — именно на них список раньше упирался в предел.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      locale: 'ru-RU',
    })
    const page = await ctx.newPage()
    await page.goto(`${new URL(BASE).origin}/paginator?page.src=animes&page.filters.kind=tv`, {
      waitUntil: 'networkidle',
    })
    await page.locator('details').first().evaluate((el) => el.setAttribute('open', ''))

    const kind = page.locator('[data-select-root]:has(select[name="page.filters.kind"])').locator('select')
    await kind.scrollIntoViewIfNeeded()

    // Точка фона, за которой ЗАВЕДОМО есть управляющий элемент: без этого
    // проверка «пробоя фона» ничего не доказывала бы — пустой фон и сам
    // ничего не нажимает. Ищем в верхней полосе (лист занимает низ).
    const bgPoint = await page.evaluate(() => {
      for (let y = 24; y <= 180; y += 12) {
        for (let x = 24; x <= 366; x += 24) {
          const hit = document.elementFromPoint(x, y)?.closest?.('button, a[href], input, label, [role="button"]')
          if (hit) {
            const name = hit.getAttribute('aria-label') || hit.textContent || hit.tagName
            return { x, y, name: name.replace(/\s+/g, ' ').trim().slice(0, 24) }
          }
        }
      }
      return null
    })
    assert(bgPoint, 'в верхней полосе страницы нет управляющего элемента — проверка пробоя фона недействительна')

    // 1) Открытие тапом НЕ выбирает пункт, оказавшийся на месте контрола —
    // ни когда значение уже стоит (прежнее «меняет выбор сам»), ни когда
    // поле пустое (прежний «сброс/самовыбор»).
    for (const [label, name] of [
      ['со значением', 'page.filters.kind'],
      ['пустое', 'page.filters.status'],
    ]) {
      const field = page.locator(`[data-select-root]:has(select[name="${name}"])`).locator('select')
      await field.scrollIntoViewIfNeeded()
      const valueBefore = await field.inputValue()
      await field.tap()
      await waitAtLeast(page, '[data-select-content]', 1)
      const valueAfter = await field.inputValue()
      assert(
        valueAfter === valueBefore,
        `тап «выбрал» пункт вместо открытия (${label}): ${JSON.stringify(valueBefore)} → ${JSON.stringify(valueAfter)}`,
      )
      await page.keyboard.press('Escape')
      await waitCount(page, '[data-select-content]', 0)
    }
    ok('открытие тапом не подменяет значение — ни выбранное, ни пустое')

    // 2) Длинный список прокручивается пальцем.
    const genres = page.locator('[data-select-root]:has(select[name="page.filters.genres.and"])').locator('select')
    await genres.scrollIntoViewIfNeeded()
    await genres.evaluate((el) => el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }),
    ))
    await waitAtLeast(page, '[data-select-listbox]', 1)

    const listbox = page.locator('[data-select-listbox]').last()
    const box = await listbox.boundingBox()
    const cdp = await ctx.newCDPSession(page)
    const x = Math.round(box.x + box.width / 2)
    const y0 = Math.round(box.y + box.height - 60)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
    for (let i = 1; i <= 8; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 30 }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(400)

    const scrolled = await listbox.evaluate((el) => ({
      top: el.scrollTop,
      room: el.scrollHeight - el.clientHeight,
      height: el.clientHeight,
    }))
    assert(scrolled.room > 100, `список жанров некуда прокручивать: запас ${scrolled.room}px`)
    assert(scrolled.top > 100, `жест не прокрутил список: scrollTop=${scrolled.top}`)
    ok(`список жанров прокручивается пальцем (scrollTop=${scrolled.top}, запас ${scrolled.room}px)`) 

    // 3) Тап по фону закрывает лист и НЕ нажимает то, что оказалось под пальцем.
    await page.evaluate(() => {
      window.__leaked = 0
      document.addEventListener(
        'click',
        (event) => {
          const hit = event.target?.closest?.('button, a[href], input, label, [role="button"]')
          if (hit) window.__leaked += 1
        },
        true,
      )
    })
    const urlBefore = page.url()
    await page.touchscreen.tap(bgPoint.x, bgPoint.y)
    await waitCount(page, '[data-select-content]', 0)
    await page.waitForTimeout(400)
    const leaked = await page.evaluate(() => window.__leaked)
    assert(leaked === 0, `клик от тапа по фону дошёл до «${bgPoint.name}» (${leaked} клик(ов))`)
    assert(page.url() === urlBefore, `тап по фону сменил адрес: ${page.url()}`)
    ok(`тап по фону закрыл лист, не нажав «${bgPoint.name}» под пальцем`)

    await ctx.close()
  }

  console.log(`\n✅ select-floating-smoke: ${passed} checks passed`)
} finally {
  await browser.close()
}
