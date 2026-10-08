// Регрессии на корневые дефекты, найденные аудитом 01.10.2026 (ISSUES.md).
//
// Штатные наборы проверяли НАЛИЧИЕ узлов; эти проверки смотрят состояние
// цепочки, фокуса и геометрии ПОСЛЕ действия — именно там жили дефекты.
//
// Запуск: node test/browser/regressions.mjs   (нужен preview на :4173)
import { chromium } from 'playwright'

const PORT = Number(process.env.MODALS_PORT ?? 4173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}/modals`
const only = process.argv[2]

let passed = 0
const ok = (msg) => { passed += 1; console.log('  ok  ' + msg) }
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const chainOf = (page) =>
  page.evaluate(() => {
    const m = history.state?.['sveltekit:states']?.modals ?? {}
    return (m.transient ?? []).map((t) => t.id)
  })

const browser = await chromium.launch({ headless: true })
const gotoBase = async (page) => {
  await page.goto(BASE)
  await page.waitForSelector('[data-select-root][data-enhanced]')
}
const run = async (name, fn) => {
  if (only && !name.startsWith(only)) return
  console.log('— ' + name + ' —')
  await fn()
}

try {
  /* ── R-02: headless не попадает в слой вида ─────────────────────── */
  await run('R-02 headless не рисует слой, хвост и не крадёт активность', async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    })
    await gotoBase(page)
    await page.locator('text=Select внутри модалки').first().click()
    await page.waitForSelector('[data-modal-stage]')
    const tailsBefore = await page.locator('[data-modal-tail]').count()

    const select = page.locator('[data-modal-popup] select').first()
    const box = await select.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-host-floating]')
    await page.waitForTimeout(300)

    const state = await page.evaluate(() => {
      const layers = [...document.querySelectorAll('[data-modal-layer]')]
      const active = layers.find((l) => l.hasAttribute('data-active'))
      return {
        layers: layers.length,
        activeText: (active?.textContent ?? '').trim().length,
        hidden: layers.filter((l) => l.getAttribute('aria-hidden') === 'true').length,
        inert: layers.filter((l) => l.hasAttribute('inert')).length,
        // Хвосты СЦЕНЫ: headless не имеет права добавлять их сюда.
        tails: document.querySelectorAll('[data-modal-stage] [data-modal-tail]').length,
        // А вот собственный хвост листа — это участие в потоке (D34).
        sheetTails: document.querySelectorAll('[data-host-floating] [data-modal-tail]').length,
      }
    })
    assert(state.layers === 1, `слоёв ${state.layers}, ожидался 1 (headless нарисовал свой)`)
    assert(state.activeText > 0, 'активный слой пуст — headless стал визуальным владельцем')
    assert(state.hidden === 0, 'реальная модалка скрыта aria-hidden из-за headless')
    assert(state.inert === 0, 'реальная модалка заинертена из-за headless')
    assert(state.tails === tailsBefore,
      `хвостов в сцене ${state.tails}, было ${tailsBefore} — headless нарисовал свой`)
    assert(state.sheetTails === 0,
      `всплывашка не должна иметь хвостов: обнаружено ${state.sheetTails}`)
    ok('owner-модалка остаётся активным слоем, а всплывающий лист не рисует лишний хвост стопки')
    await page.close()
  })

  /* ── R-01: симметрия headless-записи при смене режима ───────────── */
  await run('R-01 поворот не оставляет осиротевших записей цепочки', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await gotoBase(page)
    await page.locator('select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')

    await page.setViewportSize({ width: 1280, height: 860 })
    await page.waitForSelector('[data-host-floating][data-layout="popup"]')
    await page.mouse.click(5, 5)
    await page.waitForTimeout(400)

    assert((await page.locator('[data-host-floating]').count()) === 0, 'floating не закрылся')
    const chain = await chainOf(page)
    assert(chain.length === 0, `в цепочке осталось ${JSON.stringify(chain)}`)
    ok('sheet → popup → закрытие оставляет цепочку чистой')

    // накопление на серии поворотов
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('select').first().scrollIntoViewIfNeeded()
    await page.locator('select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating]')
    for (let i = 0; i < 3; i += 1) {
      await page.setViewportSize({ width: 1280, height: 860 })
      await page.waitForTimeout(120)
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(120)
    }
    const after = await chainOf(page)
    assert(after.length <= 1, `серия поворотов накопила записи: ${JSON.stringify(after)}`)
    ok('серия поворотов не накапливает записи')
    await page.close()
  })

  /* ── R-05: фокус внутри оверлея не считается кликом по фону ─────── */
  await run('R-05 клавиатура открывает select внутри модалки, не закрывая её', async () => {
    for (const key of ['Enter', 'Space', 'ArrowDown']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
      await gotoBase(page)
      await page.locator('text=Select внутри модалки').first().click()
      await page.waitForSelector('[data-modal-stage]')
      await page.locator('[data-modal-popup] select').first().focus()
      await page.keyboard.press(key)
      await page.waitForTimeout(500)
      const state = await page.evaluate(() => ({
        stage: document.querySelectorAll('[data-modal-stage]').length,
        floating: document.querySelectorAll('[data-host-floating]').length,
      }))
      assert(state.stage === 1, `${key}: owner-модалка закрылась`)
      assert(state.floating === 1, `${key}: список не открылся (floating=${state.floating})`)
      await page.close()
    }
    ok('Enter, Space и ArrowDown открывают список и не рушат модалку')

    // узкий экран + мышь: список обязан остаться открытым
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await gotoBase(page)
    await page.locator('text=Select внутри модалки').first().click()
    await page.waitForSelector('[data-modal-stage]')
    const select = page.locator('[data-modal-popup] select').first()
    const box = await select.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(600)
    assert(
      (await page.locator('[data-host-floating]').count()) === 1,
      'узкий экран + мышь: floating не удержался',
    )
    ok('на узком экране с мышью вложенный список остаётся открытым')
    await page.close()
  })

  /* ── R-06: фокус остаётся в списке, стрелки работают ────────────── */
  await run('R-06 фокус не уезжает на кнопку закрытия', async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    })
    await gotoBase(page)
    await page.locator('text=Select внутри модалки').first().click()
    await page.waitForSelector('[data-modal-stage]')
    const select = page.locator('[data-modal-popup] select').first()
    const box = await select.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-host-floating]')
    await page.waitForTimeout(800)

    const focus = await page.evaluate(() => document.activeElement?.className ?? '')
    assert(!String(focus).includes('modal-backdrop-close'), 'фокус уехал на кнопку закрытия')

    const before = await page.evaluate(
      () => document.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant'),
    )
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(250)
    const after = await page.evaluate(
      () => document.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant'),
    )
    assert(before !== after, `ArrowDown не сдвинул активную опцию (${before})`)
    ok('фокус держится в списке, стрелки двигают активную опцию')
    await page.close()
  })

  /* ── R-03: Forward не оставляет запись без интерфейса ───────────── */
  await run('R-03 Back → Forward не создаёт запись без UI', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await gotoBase(page)
    await page.locator('select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating]')
    await page.goBack()
    await page.waitForTimeout(400)
    await page.goForward()
    await page.waitForTimeout(600)

    const floating = await page.locator('[data-host-floating]').count()
    const chain = await chainOf(page)
    assert(
      (chain.length === 0 && floating === 0) || (chain.length > 0 && floating > 0),
      `рассинхрон: chain=${JSON.stringify(chain)}, floating=${floating}`,
    )
    ok('после Forward состояние цепочки и UI согласованы')
    await page.close()
  })

  /* ── R-04: мобильный лист действительно модален ─────────────────── */
  await run('R-04 лист получает фон, scroll lock и aria-изоляцию', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await gotoBase(page)
    await page.locator('select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    await page.waitForTimeout(350)

    // Проверяем именно блокировку, а не `scrollTo`: программная прокрутка
    // работает и при `overflow: hidden`, поэтому она плохой индикатор.
    const state = await page.evaluate(() => {
      // Фонов в DOM может быть два: у стопки свой, у поверхности листа свой.
      const backdrops = [...document.querySelectorAll('[data-modal-backdrop]')]
      return {
        bodyOverflow: getComputedStyle(document.body).overflow,
        backdropHidden: !backdrops.some((el) => !el.hasAttribute('hidden')),
        dialogs: document.querySelectorAll('[role=dialog]').length,
        popups: document.querySelectorAll('[data-modal-popup]').length,
        stages: document.querySelectorAll('[data-modal-stage]').length,
        label: document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? null,
      }
    })
    assert(state.bodyOverflow === 'hidden', `scroll lock не включился (overflow: ${state.bodyOverflow})`)
    assert(!state.backdropHidden, 'фон скрыт')
    assert(state.dialogs === 1, `role=dialog: ${state.dialogs}`)
    assert(state.popups === 0, 'нарисована пустая оболочка модалки')
    assert(state.stages === 0, 'ради модальности нарисована лишняя сцена')
    assert(state.label, 'лист без доступного имени')
    ok('фон, блокировка прокрутки и имя есть, лишней сцены нет')

    // Изоляция: соседи скрыты от скринридера, сам лист — нет.
    const isolation = await page.evaluate(() => {
      const sheet = document.querySelector('[data-host-floating]')
      const siblings = [...document.body.children].filter((el) => !el.contains(sheet))
      return {
        hiddenSiblings: siblings.filter((el) => el.getAttribute('aria-hidden') === 'true').length,
        siblings: siblings.length,
        sheetHidden: sheet?.getAttribute('aria-hidden') === 'true' || sheet?.hasAttribute('inert'),
      }
    })
    assert(isolation.siblings > 0 && isolation.hiddenSiblings === isolation.siblings,
      `соседи не изолированы: ${isolation.hiddenSiblings} из ${isolation.siblings}`)
    assert(!isolation.sheetHidden, 'изоляция задела сам лист — он стал недоступен')
    ok('страница под листом скрыта от скринридера, лист доступен')

    // И он при этом живой: опция нажимается, фокус внутри листа.
    const focusInside = await page.evaluate(() =>
      document.querySelector('[data-host-floating]')?.contains(document.activeElement) ?? false)
    assert(focusInside, 'фокус оказался вне листа')
    await page.locator('[data-host-floating] [role=option]').first().click({ timeout: 3000 })
    ok('фокус внутри листа, опции нажимаются')

    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => ({
      overflow: getComputedStyle(document.body).overflow,
      chain: (history.state?.['sveltekit:states']?.modals?.transient ?? []).length,
    }))
    assert(after.chain === 0, 'Escape не снял запись')
    assert(after.overflow !== 'hidden', 'блокировка прокрутки осталась после закрытия')
    ok('Escape закрывает лист и снимает блокировку')
    await page.close()
  })

  /* ── R-07: содержимое не выходит за контейнер хоста ─────────────── */
  await run('R-07 геометрия списка не выходит за floating-контейнер', async () => {
    for (const [width, height, label] of [[390, 844, 'sheet'], [900, 800, 'popup 900']]) {
      const page = await browser.newPage({ viewport: { width, height } })
      await gotoBase(page)
      await page.locator('select').first().click({ force: true })
      await page.waitForSelector('[data-host-floating]')
      await page.waitForTimeout(250)
      const geometry = await page.evaluate(() => {
        const outer = document.querySelector('[data-host-floating]')
        const inner = document.querySelector('[data-select-content]')
        return {
          outer: Math.round(outer.getBoundingClientRect().height),
          inner: Math.round(inner.getBoundingClientRect().height),
        }
      })
      assert(
        geometry.inner <= geometry.outer + 1,
        `${label}: content ${geometry.inner}px против контейнера ${geometry.outer}px`,
      )
      await page.close()
    }
    ok('в sheet и в popup 768–1024 содержимое помещается в контейнер')
  })

  /* ── R-11: автофокус поиска не проигрывает клику по триггеру ────── */
  await run('R-11 автофокус поиска работает и внутри модалки', async () => {
    const focusKind = (page) =>
      page.evaluate(() => {
        const el = document.activeElement
        if (!el) return 'none'
        if (el.matches('input[role="combobox"]')) return 'search'
        return el.closest?.('[data-select-content]') ? 'panel' : el.tagName.toLowerCase()
      })

    // На странице
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await gotoBase(page)
    await page.locator('select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating]')
    await page.waitForTimeout(250)
    assert((await focusKind(page)) === 'search', 'на странице поиск не получил фокус')

    // Внутри модалки: контейнер списка уже существует (портал в сцену),
    // панель монтируется в том же такте — и раньше фокус отбирал <select>.
    await gotoBase(page)
    await page.locator('text=Select внутри модалки').first().click()
    await page.waitForSelector('[data-modal-stage]')
    for (let i = 0; i < 3; i += 1) {
      const box = await page.locator('[data-modal-popup] select').first().boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForSelector('[data-host-floating]')
      await page.waitForTimeout(250)
      const kind = await focusKind(page)
      assert(kind === 'search', `внутри модалки (попытка ${i + 1}) фокус на «${kind}», а не в поиске`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
    }
    ok('поиск получает фокус и на странице, и внутри модалки')
    await page.close()
  })

  /* ── R-08: системный оверлей — полноправная запись стопки ───────── */
  await run('R-08 системный оверлей: виден счётчикам, страница под ним заблокирована', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await gotoBase(page)
    const closeAll = page.locator('button', { hasText: 'Закрыть все' }).first()
    assert(await closeAll.isDisabled(), 'кнопка активна при пустой стопке')

    await page.locator('select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    await page.waitForTimeout(250)

    // Решение D27: пока лист держит модальность (фон, scroll lock,
    // изоляция), он обязан быть виден счётчикам — иначе интерфейс врёт.
    const locked = await page.evaluate(() => getComputedStyle(document.body).overflow)
    assert(locked === 'hidden', 'лист не держит блокировку прокрутки')
    assert(!(await closeAll.isDisabled()), 'счётчики не видят лист — кнопка закрытия погасла')
    assert(/\(1\)/.test((await closeAll.textContent()) ?? ''), 'лист не попал в счётчик стопки')
    ok('оверлей виден счётчикам: «Закрыть все (1)», кнопка не погасла')

    // И одновременно: страница ПОД листом недоступна для указателя —
    // это и есть модальность. Клик по кнопке перехватывается, и это
    // правильно: закрывать лист полагается Escape, «Назад» или кликом
    // мимо, а не элементом, лежащим под модальным слоем.
    const intercepted = await closeAll
      .click({ timeout: 1200 })
      .then(() => false)
      .catch(() => true)
    assert(intercepted, 'кнопка под модальным листом осталась кликабельной')
    ok('страница под листом недоступна для указателя')

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    assert((await page.locator('[data-host-floating]').count()) === 0, 'Escape не закрыл лист')
    assert((await chainOf(page)).length === 0, 'запись осталась в цепочке')
    assert(await closeAll.isDisabled(), 'счётчик не вернулся к нулю')
    ok('Escape закрывает лист, счётчик возвращается к нулю')
    await page.close()
  })

  /* ── R-12: после закрытия листа фокус возвращается на триггер ───── */
  await run('R-12 закрытие листа возвращает фокус триггеру', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await gotoBase(page)
    await page.locator('select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    await page.waitForTimeout(250)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    const where = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return 'body'
      return el.tagName.toLowerCase()
    })
    assert(where === 'select', `фокус после закрытия ушёл в «${where}», а не на триггер`)
    ok('фокус вернулся на нативный контрол, а не потерялся в body')
    await page.close()
  })

  /* ── R-15: вложенный лист удерживает фокус у себя ──────────────── */
  await run('R-15 лист поверх модалки — верхняя поверхность', async () => {
    const page = await browser.newPage({
      viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true,
      deviceScaleFactor: 2,
    })
    await gotoBase(page)
    await page.locator('text=Select внутри модалки').first().click()
    await page.waitForSelector('[data-modal-stage]')
    const box = await page.locator('[data-modal-popup] select').first().boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    await page.waitForTimeout(350)

    const sheet = await page.evaluate(() => {
      const f = document.querySelector('[data-host-floating]')
      return { role: f?.getAttribute('role'), modal: f?.getAttribute('aria-modal') }
    })
    assert(sheet.role === 'dialog' && sheet.modal === 'true',
      `лист не объявлен диалогом: ${JSON.stringify(sheet)}`)

    // Tab не должен выводить из листа на контролы фоновой модалки.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab')
      await page.waitForTimeout(90)
      const inside = await page.evaluate(() =>
        document.querySelector('[data-host-floating]')?.contains(document.activeElement) ?? false)
      assert(inside, `Tab №${i + 1} вывел фокус из листа`)
    }
    ok('лист объявлен диалогом и удерживает Tab')

    // И главное: модалка под ним оживает после закрытия листа.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => ({
      floating: document.querySelectorAll('[data-host-floating]').length,
      stage: document.querySelectorAll('[data-modal-stage]').length,
      inert: document.querySelectorAll('[data-modal-popup][inert], [data-modal-close][inert]').length,
    }))
    assert(after.floating === 0 && after.stage === 1, 'лист не закрылся или сцена пропала')
    assert(after.inert === 0, 'на модалке остался inert после закрытия листа')
    await page.locator('[data-modal-popup] select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating]')
    ok('после закрытия листа модалка снова интерактивна')
    await page.close()
  })

  /* ── R-16: второй потребитель host.floating и модалка без хранилища ─ */
  await run('R-16 меню и transient-модалка работают на общем API', async () => {
    // Меню вне модалки: тот же host.floating, что у select.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await gotoBase(page)
    await page.locator('button', { hasText: 'Меню на странице' }).first().click()
    await page.waitForSelector('[data-host-floating]')
    assert((await page.locator('[role=menuitem]').count()) > 0, 'меню без пунктов')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert((await page.locator('[data-host-floating]').count()) === 0, 'Escape не закрыл меню')
    ok('меню вне модалки открывается и закрывается через хост')

    // Модалка без хранилища: запись есть, адреса нет.
    await page.locator('button', { hasText: 'Модалка без хранилища' }).first().click()
    await page.waitForSelector('[data-modal-stage]')
    const transient = await page.evaluate(() => ({
      url: location.search,
      ids: (history.state?.['sveltekit:states']?.modals?.transient ?? []).map((t) => t.id),
    }))
    assert(transient.url === '', `transient-модалка попала в адрес: ${transient.url}`)
    assert(transient.ids.length === 1, `запись не создана: ${JSON.stringify(transient.ids)}`)
    ok('модалка без хранилища: запись в истории есть, адрес чист')

    // Меню внутри неё не рушит модалку.
    await page.locator('button', { hasText: 'Меню в этой модалке' }).first().click()
    await page.waitForSelector('[data-host-floating]')
    assert((await page.locator('[data-modal-stage]').count()) === 1, 'меню закрыло модалку')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    assert((await page.locator('[data-modal-stage]').count()) === 1, 'Escape закрыл модалку вместо меню')

    // Переход на зарегистрированную модалку: новая стопка, адрес появился.
    await page.locator('button', { hasText: 'Перейти на демо-модалку' }).first().click()
    await page.waitForTimeout(600)
    const after = await page.evaluate(() => ({
      url: location.search,
      ids: (history.state?.['sveltekit:states']?.modals?.transient ?? []).map((t) => t.id),
    }))
    assert(after.url.includes('modal=select'), `адрес не записан: ${after.url}`)
    assert(after.ids.length === 0, 'transient-запись осталась под зарегистрированной')
    ok('переход на зарегистрированную модалку начинает новую стопку')
    await page.close()
  })

  /* ── R-17: мобильный режим — умолчания, а не выключатель ────────── */
  await run('R-17 умолчание мобильного режима и наследование направления', async () => {
    const page = await browser.newPage({
      viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    })
    await gotoBase(page)
    await page.waitForSelector('[data-select-root][data-enhanced]')
    await page.waitForTimeout(400)

    const setDefault = async (label) => {
      await page.locator('button', { hasText: label }).first().click()
      await page.waitForTimeout(200)
    }
    const openModal = async (trigger) => {
      await page.locator(`text=${trigger}`).first().click()
      await page.waitForSelector('[data-modal-stage]')
      await page.waitForTimeout(250)
      return page.locator('[data-modal-stage]').getAttribute('data-anchor')
    }
    const closeAll = async () => {
      for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Escape'); await page.waitForTimeout(220) }
    }
    const floating = async () => {
      await page.waitForSelector('[data-host-floating]')
      await page.waitForTimeout(250)
      const node = page.locator('[data-host-floating]')
      return `${await node.getAttribute('data-layout')}/${await node.getAttribute('data-mobile-anchor')}`
    }

    // У demo-модалок нет зашитого mobile: обе следуют живому умолчанию хоста.
    await setDefault('выкл')
    assert((await openModal('Select внутри модалки')) === 'center',
      'Select-модалка сохранила зашитое направление вместо настройки хоста')
    await closeAll()
    assert((await openModal('Открыть карточку')) === 'center',
      'карточка не послушалась умолчания хоста')
    await closeAll()
    ok('зарегистрированные модалки без override следуют умолчанию хоста')

    // `floatingMobile` относится только к обычным popup/menu. Select —
    // часть потока хоста и поэтому всё равно становится листом.
    await setDefault('выпадашка')
    await page.locator('select').first().click({ force: true })
    assert((await floating()).startsWith('sheet/fullscreen'),
      'Select выпал из потока при floatingMobile=false')
    await closeAll()
    // Обычное меню со своим решением по-прежнему вправе остаться popup.
    await page.locator('button', { hasText: 'Меню без мобильного режима' }).first().click()
    assert((await floating()).startsWith('popup'), 'sheetOnNarrow=false не подействовал')
    await closeAll()
    ok('Select остаётся в потоке, а menu может явно остаться popup')

    // Направление наследуется у активной модалки.
    await setDefault('как у модалок')
    for (const [label, expected] of [['низ', 'bottom'], ['право', 'right']]) {
      await setDefault(label)
      assert((await openModal('Открыть карточку')) === expected, `модалка не прижалась: ${label}`)
      await page.locator('button', { hasText: 'Действия' }).first().click()
      const got = await floating()
      assert(got === `sheet/${expected}`, `меню не унаследовало направление: ${got}`)
      await closeAll()
    }
    ok('оверлей без своего направления наследует его у модалки')
    await page.close()
  })

  /* ── R-18: close:none не ждёт базовую длительность transition ───── */
  await run('R-18 выключенная анимация не оставляет сцену после фона', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await gotoBase(page)
    // Берём ровно control закрытия, а не одноимённые «выкл» у открытия/стопки.
    const closeControl = page.getByText('Анимация закрытия', { exact: true }).locator('..')
    await closeControl.getByRole('button', { name: 'выкл' }).click()
    await page.locator('text=Открыть карточку').first().click()
    await page.waitForSelector('[data-modal-stage]')

    const started = await page.evaluate(() => performance.now())
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-modal-stage]'), undefined, { timeout: 1000 })
    const elapsed = await page.evaluate((start) => performance.now() - start, started)
    // Один rAF и планировщик допустимы; базовые 320ms сюда уже не помещаются.
    assert(elapsed < 150, `сцена прожила ${Math.round(elapsed)}ms при closeAnimation=none`)
    ok(`сцена снята за ${Math.round(elapsed)}ms, а не после базового transition`)
    await page.close()
  })

  /* ── R-19: Select и transient наследуют активный поток ──────────── */
  await run('R-19 Select и transient следуют текущему якорю хоста', async () => {
    const page = await browser.newPage({ viewport: { width: 393, height: 851 } })
    await gotoBase(page)
    // `floatingMobile=false` вправе оставить menu popup, но не Select.
    await page.getByRole('button', { name: 'право' }).first().click()
    await page.getByRole('button', { name: 'выпадашка' }).first().click()
    await page.locator('text=Select внутри модалки').first().click()
    await page.waitForSelector('[data-modal-stage][data-anchor="right"]')

    const select = page.locator('[data-modal-popup] select').first()
    await select.click({ force: true })
    await page.waitForSelector('[data-host-floating]')
    const sheet = page.locator('[data-host-floating]')
    assert(await sheet.getAttribute('data-layout') === 'sheet',
      'Select не стал поверхностью потока')
    assert(await sheet.getAttribute('data-mobile-anchor') === 'right',
      'Select не унаследовал якорь активной модалки')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-host-floating]', { state: 'detached' })

    // `openLayer()` без mobile-override также обязан найти якорь ниже по стеку.
    await page.locator('button', { hasText: 'Без хранилища поверх' }).first().click()
    await page.waitForFunction(
      () => document.querySelector('[data-modal-stage]')?.getAttribute('data-anchor') === 'right',
    )
    const transient = await page.evaluate(() =>
      (history.state?.['sveltekit:states']?.modals?.transient ?? []).length)
    assert(transient === 1, `transient-запись не создана: ${transient}`)
    ok('Select и модалка без хранилища получили правый якорь от активного потока')
    await page.close()
  })

  /* ── R-20: probe наследования и отклонённое открытие над transient ─ */
  await run('R-20 обычная модалка не ломает transient, а Back/Forward восстанавливают снимок', async () => {
    const page = await browser.newPage({ viewport: { width: 393, height: 851 } })
    await gotoBase(page)
    const anchor = () => page.locator('[data-modal-stage]').getAttribute('data-anchor')
    const snapshot = () => page.evaluate(() => history.state?.['sveltekit:states']?.modals ?? null)

    await page.getByRole('button', { name: 'право' }).first().click()
    await page.getByText('Проверить наследование', { exact: true }).click()
    assert(await anchor() === 'right', 'root opener без параметров не взял defaultMobile хоста')

    await page.locator('[data-active] [data-probe-action="random-modal"]').click()
    await page.waitForTimeout(120)
    const explicit = await anchor()
    assert(['top', 'bottom', 'left', 'right'].includes(explicit),
      `случайное направление не применилось: ${explicit}`)

    await page.locator('[data-active] [data-probe-action="inherited-modal"]').click()
    await page.waitForTimeout(120)
    assert(await anchor() === explicit,
      `модалка без направления не унаследовала ${explicit}, получила ${await anchor()}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(240)

    await page.locator('[data-active] [data-probe-action="plain-transient"]').click()
    await page.waitForSelector('[data-flow-probe-transient="plain"]')
    assert(await anchor() === explicit, 'transient без направления не унаследовал активный якорь')
    const beforeRejectedOpen = JSON.stringify(await snapshot())
    await page.locator('[data-probe-action="registered-from-transient"]').click()
    await page.waitForTimeout(120)
    const outcome = await page.locator('[data-probe-registered-result]').textContent()
    assert(outcome.includes('transient-запись оказалась ниже registered'),
      `отклонённое открытие не объяснило нарушение инварианта: ${outcome}`)
    assert((await page.locator('[data-flow-probe-transient="plain"]').count()) === 1,
      'ошибка открытия заменила transient визуальной модалкой')
    assert(JSON.stringify(await snapshot()) === beforeRejectedOpen,
      'отклонённое открытие успело изменить history.state')

    await page.goBack()
    await page.waitForSelector('[data-flow-probe-transient="plain"]', { state: 'detached' })
    assert(await anchor() === explicit, 'Back не вернул предшествующую зарегистрированную модалку')
    await page.goForward()
    await page.waitForSelector('[data-flow-probe-transient="plain"]')
    assert(await anchor() === explicit, 'Forward не восстановил transient с наследуемым якорем')

    await page.keyboard.press('Escape')
    await page.waitForTimeout(240)
    await page.locator('[data-active] [data-probe-action="random-transient"]').click()
    await page.waitForSelector('[data-flow-probe-transient="random"]')
    const own = await page.locator('[data-flow-probe-transient="random"] [data-probe-random]').getAttribute('data-probe-random')
    assert(await anchor() === own,
      `transient с override должен применить ${own}, получил ${await anchor()}`)
    ok('default → active anchor → explicit override; rejected open is atomic, Back/Forward restore the transient snapshot')
    await page.close()
  })

  /* ── R-21: закрытие Select в модалке не активирует цель под ним ─── */
  await run('R-21 outside click закрывает Select, но не действие модалки под ним', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await gotoBase(page)
    await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).click()
    await page.locator('[data-modal-stage]').waitFor({ state: 'visible' })
    await page.waitForTimeout(320)

    await page.locator('[data-modal-layer][data-active] select').first().click({ force: true })
    await page.waitForSelector('[data-host-floating][data-layout="popup"]')

    // Центр кнопки находится вне выпадающего списка, но внутри слоя модалки.
    // Проверяем hit-test до жеста: это реальная цель, не пустое место/щит.
    const action = page
      .locator('[data-modal-layer][data-active] button')
      .filter({ hasText: 'Без хранилища поверх' })
      .first()
    const box = await action.boundingBox()
    assert(box, 'действие за Select не имеет hit-target')
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const hit = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y)
      const button = target?.closest('button')
      return {
        label: button?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        inModal: Boolean(button?.closest('[data-modal-layer]')),
        inFloating: Boolean(button?.closest('[data-host-floating]')),
      }
    }, point)
    assert(hit.label.includes('Без хранилища поверх') && hit.inModal && !hit.inFloating,
      `проверяемая точка не попадает в кнопку за Select: ${JSON.stringify(hit)}`)

    await page.evaluate(() => {
      window.__outsideActionClicks = 0
      document.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button')
        if (button?.textContent?.includes('Без хранилища поверх')) window.__outsideActionClicks += 1
      }, true)
    })
    await page.mouse.click(point.x, point.y)
    await page.waitForSelector('[data-host-floating]', { state: 'detached' })
    const leakedClicks = await page.evaluate(() => window.__outsideActionClicks)
    assert(leakedClicks === 0, `закрытие Select активировало нижнюю кнопку (${leakedClicks} click)`)
    assert((await chainOf(page)).length === 0, 'вместе с Select открылся transient-слой')
    assert((await page.locator('[data-modal-stage]').count()) === 1, 'закрылся owner-modal')
    const focusReturned = await page.evaluate(() =>
      document.activeElement instanceof HTMLSelectElement &&
      document.activeElement.closest('[data-modal-layer]') !== null)
    assert(focusReturned, 'фокус не вернулся к триггеру Select внутри модалки')
    ok('focus вернулся к Select, не потерявшись на body')
    ok('hit-test подтвердил реальную кнопку; outside click закрыл только Select')

    await action.click()
    await page.waitForFunction(
      () => (history.state?.['sveltekit:states']?.modals?.transient ?? []).length === 1,
    )
    assert((await chainOf(page)).length === 1, 'обычный клик после закрытия Select не сработал')
    ok('следующий намеренный клик по той же кнопке активен')
    await page.close()
  })

  /* ── R-22: single Select toggles its current value and uses radio marks ── */
  await run('R-22 single Select deselects current option, preserves default, stays open', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await gotoBase(page)
    await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).click()
    await page.locator('[data-modal-stage]').waitFor({ state: 'visible' })

    const selects = page.locator('[data-modal-stage] [data-select-native]')
    const withDefault = selects.nth(0)
    await withDefault.waitFor({ state: 'attached' })
    assert((await withDefault.inputValue()) === 'drama', 'single Select не восстановил исходный выбор')
    await withDefault.click({ force: true })
    const list = page.locator('[data-select-listbox]').last()
    await list.waitFor({ state: 'visible' })
    let selected = list.locator('[role="option"][aria-selected="true"]')
    assert((await selected.count()) === 1 && (await selected.innerText()).includes('Драма'),
      'выбранная single-опция не отмечена')
    assert((await selected.locator('span').first().innerText()) === '◉',
      'single Select не показывает radio dot для выбранного варианта')
    assert((await selected.locator('svg').count()) === 0,
      'single Select показывает multiselect-checkmark')
    const singleMarkers = await list.locator('[role="option"] > span[aria-hidden="true"]').allInnerTexts()
    assert(singleMarkers.every((marker) => marker !== 'false'),
      `в маркерах single Select появился текст false: ${JSON.stringify(singleMarkers)}`)
    ok('single selected option uses the radio-dot indicator without false markers')

    await selected.click()
    await page.waitForFunction(() => document.querySelector('[data-modal-stage] [data-select-native]')?.value === '')
    assert(await list.isVisible(), 'повторный выбор закрыл single popup')
    const defaultState = await withDefault.evaluate((el) => ({
      value: el.value,
      placeholderSelected: [...el.options].some((option) => option.value === '' && option.selected),
    }))
    assert(defaultState.value === '' && defaultState.placeholderSelected,
      `single Select не вернулся к empty placeholder default: ${JSON.stringify(defaultState)}`)
    assert((await list.locator('[role="option"]').filter({ hasText: 'Выберите жанр' }).count()) === 0,
      'placeholder default нельзя выбирать/снимать как обычную опцию списка')
    assert((await list.locator('[role="option"][aria-selected="true"]').count()) === 0,
      'после снятия выбора осталась отмеченная single-опция')
    ok('reselect clears to the placeholder default and leaves the popup open')

    await list.locator('[role="option"]').filter({ hasText: 'Комедия' }).click()
    await list.waitFor({ state: 'detached' })
    assert((await withDefault.inputValue()) === 'comedy', 'обычный выбор single-опции сломан')
    ok('choosing a different single option still closes normally')

    const multiple = selects.nth(1)
    await multiple.click({ force: true })
    await list.waitFor({ state: 'visible' })
    await list.locator('[role="option"]').filter({ hasText: 'Боевик' }).click()
    assert(await list.isVisible(), 'обычный multiselect неожиданно закрылся')
    selected = list.locator('[role="option"][aria-selected="true"]')
    assert((await selected.count()) === 1, 'multiselect не отметил выбранную опцию')
    assert((await selected.locator('span').first().innerText()) === '✓',
      'multiselect потерял checkmark indicator')
    assert((await selected.locator('svg').count()) === 0,
      'multiselect marker unexpectedly uses SVG instead of the checkmark glyph')
    const multiMarkers = await list.locator('[role="option"] > span[aria-hidden="true"]').allInnerTexts()
    assert(multiMarkers.every((marker) => marker !== 'false'),
      `в маркерах multiselect появился текст false: ${JSON.stringify(multiMarkers)}`)
    ok('multiselect retains checkmarks and stays open after selection without false markers')
    await page.close()
  })

  /* ── R-23: multiselect в обычной модалке не попадает в native option hit-target ── */
  await run('R-23 touch multiselect в обычной модалке открывает слой без снятия выбранных options', async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    })
    await gotoBase(page)
    await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).tap()
    await page.locator('[data-modal-stage]').waitFor({ state: 'visible' })

    const selects = page.locator('[data-modal-stage] [data-select-native]')
    const multiple = selects.nth(1)
    const list = page.locator('[data-select-listbox]').last()
    const chosen = () => multiple.evaluate((el) => [...el.selectedOptions].map((option) => option.value).sort())
    const expected = ['action', 'drama']

    await multiple.tap({ force: true })
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    await list.locator('[role="option"]').filter({ hasText: 'Боевик' }).tap()
    await list.locator('[role="option"]').filter({ hasText: 'Драма' }).tap()
    await page.keyboard.press('Escape')
    await page.locator('[data-host-floating]').waitFor({ state: 'detached' })
    await page.waitForTimeout(300)
    assert(JSON.stringify(await chosen()) === JSON.stringify(expected), 'не удалось подготовить выбранные multiselect options')

    const hit = await multiple.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return {
        pointerEvents: getComputedStyle(el).pointerEvents,
        nativeSelect: target === el,
        nativeOption: target instanceof HTMLOptionElement,
        size: el.size,
      }
    })
    assert(hit.pointerEvents !== 'none' && hit.nativeSelect && !hit.nativeOption && hit.size === 1,
      `hydrated multiselect tap target is not its SELECT: ${JSON.stringify(hit)}`)

    await page.evaluate(() => {
      window.__selectOpeningOptionEvents = []
      window.__selectOpeningTargets = []
      window.__selectOpeningNativeEvents = []
      const native = document.querySelector('[data-modal-stage] select[data-select-native-multiple]')
      for (const type of ['input', 'change']) {
        document.addEventListener(type, (event) => {
          if (event.target !== native) return
          window.__selectOpeningNativeEvents.push({
            type: event.type,
            selectedValues: [...native.selectedOptions].map((option) => option.value).sort(),
            isTrusted: event.isTrusted,
          })
        }, true)
      }
      for (const type of ['pointerdown', 'pointerup', 'pointerover', 'mouseover', 'click']) {
        document.addEventListener(type, (event) => {
          const target = event.target
          const customOption = target instanceof Element
            ? target.closest('[data-select-listbox] [role="option"]')
            : null
          if (target === native || target instanceof HTMLOptionElement || customOption) {
            window.__selectOpeningTargets.push({ type, nativeSelect: target === native, tag: target?.tagName })
          }
          if (customOption) window.__selectOpeningOptionEvents.push({ type, text: customOption.textContent?.trim() })
        }, true)
      }
    })
    const box = await multiple.boundingBox()
    assert(box, 'filled multiselect trigger lost its hitbox')
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    assert(JSON.stringify(await chosen()) === JSON.stringify(expected),
      `opening the filled multiselect changed its selection: ${JSON.stringify(await chosen())}`)
    assert((await page.evaluate(() => window.__selectOpeningNativeEvents)).length === 0,
      `opening the filled multiselect emitted native input/change: ${JSON.stringify(await page.evaluate(() => window.__selectOpeningNativeEvents))}`)
    assert((await page.locator('[data-modal-stage]').count()) === 1,
      'opening the nested Select sheet closed its ordinary owner modal')
    assert((await page.evaluate(() => window.__selectOpeningOptionEvents)).length === 0,
      'the opening touch was retargeted to an option inside the new Select sheet')
    const openingTargets = await page.evaluate(() => window.__selectOpeningTargets)
    assert(openingTargets.some((event) => event.type === 'pointerdown' && event.nativeSelect) &&
      openingTargets.some((event) => event.type === 'click' && event.nativeSelect) &&
      openingTargets.every((event) => event.nativeSelect),
      `opening touch escaped the native SELECT hit-target: ${JSON.stringify(openingTargets)}`)
    assert((await chainOf(page)).length === 1, 'Select sheet did not get exactly one headless stack entry')
    ok('filled multiselect keeps touch on SELECT; opening gesture targets no native/custom option')

    await page.keyboard.press('Escape')
    await page.locator('[data-host-floating]').waitFor({ state: 'detached' })
    await page.waitForTimeout(300)
    const label = page.locator('[data-modal-stage] label').nth(1)
    const labelBox = await label.boundingBox()
    assert(labelBox, 'multiselect label has no hitbox')
    await page.touchscreen.tap(labelBox.x + 8, labelBox.y + 4)
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    assert(JSON.stringify(await chosen()) === JSON.stringify(expected), 'label activation changed multiselect values')
    assert((await page.evaluate(() => window.__selectOpeningNativeEvents)).length === 0,
      `label activation emitted native input/change: ${JSON.stringify(await page.evaluate(() => window.__selectOpeningNativeEvents))}`)
    assert((await page.locator('[data-modal-stage]').count()) === 1, 'label activation closed the owner modal')
    ok('label activation also opens the custom multiselect without native deselection')

    const single = selects.nth(0)
    const singleBox = await single.boundingBox()
    assert(singleBox, 'sibling Select has no hitbox behind its owner modal')
    await page.touchscreen.tap(singleBox.x + singleBox.width / 2, singleBox.y + singleBox.height / 2)
    await page.locator('[data-host-floating]').waitFor({ state: 'detached' })
    assert((await page.locator('[data-modal-stage]').count()) === 1,
      'outside tap on nested Select dismissed the ordinary owner modal too')
    assert((await chainOf(page)).length === 0, 'outside tap left a headless Select record behind')
    assert(JSON.stringify(await chosen()) === JSON.stringify(expected),
      'dismissing the Select sheet changed the underlying multiselect values')
    ok('outside tap first dismisses only the Select sheet and preserves its owner/value')

    await page.waitForTimeout(300)
    await single.tap({ force: true })
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    assert((await page.locator('[data-modal-stage]').count()) === 1,
      'a deliberate tap on a sibling Select replaced the ordinary modal')
    ok('the next deliberate tap opens a sibling Select inside the same ordinary modal')
    await page.keyboard.press('Escape')
    await page.locator('[data-host-floating]').waitFor({ state: 'detached' })
    await page.close()
  })

  /* ── R-24: очистка multiselect не мешает следующей ordinary modal ── */
  await run('R-24 clearing every multiselect value then opens an ordinary modal', async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    })
    await gotoBase(page)
    await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).tap()
    await page.locator('[data-modal-stage]').waitFor({ state: 'visible' })

    const multiple = page.locator('[data-modal-stage] select[data-select-native-multiple]').first()
    const chosen = () => multiple.evaluate((el) => [...el.selectedOptions].map((option) => option.value).sort())
    await multiple.tap()
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    const list = page.locator('[data-select-listbox]').last()
    await list.locator('[role="option"]').filter({ hasText: 'Боевик' }).tap()
    await list.locator('[role="option"]').filter({ hasText: 'Драма' }).tap()
    assert(JSON.stringify(await chosen()) === JSON.stringify(['action', 'drama']),
      `could not prepare multiple values: ${JSON.stringify(await chosen())}`)

    await list.locator('[role="option"]').filter({ hasText: 'Боевик' }).tap()
    assert(JSON.stringify(await chosen()) === JSON.stringify(['drama']),
      `clearing the first selected option damaged the remaining value: ${JSON.stringify(await chosen())}`)
    assert((await page.locator('[data-host-floating]').count()) === 1,
      'clearing one multiselect value closed its Select sheet')
    await list.locator('[role="option"]').filter({ hasText: 'Драма' }).tap()
    assert((await chosen()).length === 0, 'clearing the last selected option did not leave an empty multiselect')
    assert((await page.locator('[data-host-floating]').count()) === 1,
      'clearing the last multiselect value closed its Select sheet')
    ok('both selected values can be cleared individually while the Select sheet stays open')

    await page.keyboard.press('Escape')
    await page.locator('[data-host-floating]').waitFor({ state: 'detached' })
    assert((await page.locator('[data-modal-stage]').count()) === 1,
      'closing the Select sheet also dismissed its ordinary owner modal')
    assert((await chainOf(page)).length === 0, 'closed Select sheet left a headless stack entry')
    await multiple.tap()
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    assert((await chosen()).length === 0, 'reopening the empty multiselect restored a stale value')
    await page.keyboard.press('Escape')
    await page.locator('[data-host-floating]').waitFor({ state: 'detached' })
    ok('an empty multiselect reopens normally and preserves its empty value')

    await page.keyboard.press('Escape')
    await page.locator('[data-modal-stage]').waitFor({ state: 'detached' })
    const card = page.locator('[data-modal-trigger]').filter({ hasText: 'Открыть карточку' }).first()
    await card.tap()
    await page.getByText('Карточка #7', { exact: true }).waitFor({ state: 'visible' })
    assert((await page.locator('[data-modal-stage]').count()) === 1,
      'ordinary Card modal did not open after clearing the multiselect')
    assert((await page.locator('[data-host-floating]').count()) === 0,
      'a stale Select sheet remained over the ordinary Card modal')
    ok('after all multiselect values are cleared, the ordinary Card modal opens cleanly')
    await page.close()
  })

  /* ── R-25: нативные input/change только при фактическом изменении value ── */
  await run('R-25 native Select events follow value changes and skip no-op bulk selection', async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    })
    await gotoBase(page)
    await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).tap()
    await page.locator('[data-modal-stage]').waitFor({ state: 'visible' })

    const multiple = page.locator('[data-modal-stage] select[data-select-native-multiple]').first()
    const chosen = () => multiple.evaluate((el) => [...el.selectedOptions].map((option) => option.value).sort())
    await page.evaluate(() => {
      const native = document.querySelector('[data-modal-stage] select[data-select-native-multiple]')
      window.__issue5SelectEvents = []
      for (const type of ['input', 'change']) {
        document.addEventListener(type, (event) => {
          if (event.target !== native) return
          window.__issue5SelectEvents.push({
            type: event.type,
            targetTag: event.target.tagName,
            selectedValues: [...native.selectedOptions].map((option) => option.value).sort(),
            isTrusted: event.isTrusted,
          })
        }, true)
      }
    })

    await multiple.tap({ force: true })
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    assert((await chosen()).length === 0, 'opening empty multiselect unexpectedly selected a value')
    assert((await page.evaluate(() => window.__issue5SelectEvents.length)) === 0,
      'opening empty multiselect emitted native input/change')

    const list = page.locator('[data-select-listbox]').last()
    await list.locator('[role="option"]').filter({ hasText: 'Боевик' }).tap()
    assert(JSON.stringify(await chosen()) === JSON.stringify(['action']),
      'choosing an enabled option did not change the native SELECT value')
    const changedEvents = await page.evaluate(() => window.__issue5SelectEvents)
    assert(changedEvents.length === 2 && changedEvents[0].type === 'input' && changedEvents[1].type === 'change',
      `a real value change should emit input then change once: ${JSON.stringify(changedEvents)}`)
    assert(changedEvents.every((event) => event.targetTag === 'SELECT' &&
      event.isTrusted === false && JSON.stringify(event.selectedValues) === JSON.stringify(['action'])),
      `real selection events lost their native target or post-change value: ${JSON.stringify(changedEvents)}`)

    const search = page.locator('[data-select-content] input[role="combobox"]').last()
    await search.click({ force: true })
    await page.waitForFunction(() =>
      !document.querySelector('[data-select-content] input[role="combobox"]')?.hasAttribute('readonly'))
    await search.fill('Документальный')
    const disabledOption = list.locator('[role="option"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-select-listbox] [role="option"]').length === 1)
    assert((await disabledOption.count()) === 1 && await disabledOption.isDisabled(),
      'the no-op probe did not isolate the single disabled option')
    const selectFound = page.locator('[data-select-content] [data-select-mobile-action][aria-label="Выбрать найденные"]').last()
    await selectFound.waitFor({ state: 'visible' })
    const beforeNoop = await chosen()
    await selectFound.tap({ force: true })
    await page.waitForTimeout(80)
    const afterNoop = await chosen()
    assert(JSON.stringify(afterNoop) === JSON.stringify(beforeNoop),
      `select-all on a disabled-only result changed values: ${JSON.stringify(beforeNoop)} → ${JSON.stringify(afterNoop)}`)
    assert((await page.evaluate(() => window.__issue5SelectEvents.length)) === 2,
      `a no-op selection emitted input/change despite unchanged values: ${JSON.stringify(await page.evaluate(() => window.__issue5SelectEvents))}`)
    assert((await page.locator('[data-host-floating]').count()) === 1,
      'a no-op bulk selection closed the multiselect sheet')
    ok('open emits no events; changed option emits one post-change pair; disabled-only no-op emits none')
    await page.close()
  })

  console.log(`\n✅ regressions: ${passed} проверок пройдено`)
} catch (error) {
  console.error('\n❌ ' + error.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
