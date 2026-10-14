// Регрессии на корневые дефекты, найденные аудитом 01.10.2026 (ISSUES.md).
//
// Штатные наборы проверяли НАЛИЧИЕ узлов; эти проверки смотрят состояние
// цепочки, фокуса и геометрии ПОСЛЕ действия — именно там жили дефекты.
//
// Запуск: node test/browser/regressions.mjs   (нужен preview на :4173)
import { chromium } from 'playwright'
import { pageState, waitPageState } from './history-state.mjs'

const PORT = Number(process.env.MODALS_PORT ?? 4173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}/modals`
const only = process.argv[2]

let passed = 0
const ok = (msg) => { passed += 1; console.log('  ok  ' + msg) }
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const chainOf = async (page) => ((await pageState(page)).modals?.transient ?? []).map((t) => t.id)

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
    await page.locator('select[data-select-native]').first().click({ force: true })
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
    await page.locator('select[data-select-native]').first().scrollIntoViewIfNeeded()
    await page.locator('select[data-select-native]').first().click({ force: true })
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
    await page.locator('select[data-select-native]').first().first().click({ force: true })
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
    await page.locator('select[data-select-native]').first().first().click({ force: true })
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
    const after = {
      overflow: await page.evaluate(() => getComputedStyle(document.body).overflow),
      chain: (await chainOf(page)).length,
    }
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
      await page.locator('select[data-select-native]').first().first().click({ force: true })
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
    await page.locator('select[data-select-native]').first().first().click({ force: true })
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

    await page.locator('select[data-select-native]').first().first().click({ force: true })
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
    await page.locator('select[data-select-native]').first().first().click({ force: true })
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
    const transient = {
      url: await page.evaluate(() => location.search),
      ids: await chainOf(page),
    }
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
    const after = {
      url: await page.evaluate(() => location.search),
      ids: await chainOf(page),
    }
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

    // Этап 8: панель настроек — select-поля механизма; подписи Segmented
    // ушли, но таблица «метка → поле+значение» сохраняет текст сценария.
    const setDefault = async (label) => {
      const [sel, value] = {
        'выкл': ['#default_mobile', 'off'],
        'низ': ['#default_mobile', 'bottom'],
        'право': ['#default_mobile', 'right'],
        'выпадашка': ['#floating_mobile', 'off'],
        'как у модалок': ['#floating_mobile', 'on'],
      }[label]
      await page.selectOption(sel, value)
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
    await page.locator('select[data-select-native]').first().first().click({ force: true })
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
    await page.selectOption('#close_animation', 'none') // панель — select механизма (этап 8)
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
    await page.selectOption('#default_mobile', 'right') // панель — select'ы механизма
    await page.selectOption('#floating_mobile', 'off')
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
    const transient = (await chainOf(page)).length
    assert(transient === 1, `transient-запись не создана: ${transient}`)
    ok('Select и модалка без хранилища получили правый якорь от активного потока')
    await page.close()
  })

  /* ── R-20: probe наследования и отклонённое открытие над transient ─ */
  await run('R-20 обычная модалка не ломает transient, а Back/Forward восстанавливают снимок', async () => {
    const page = await browser.newPage({ viewport: { width: 393, height: 851 } })
    await gotoBase(page)
    const anchor = () => page.locator('[data-modal-stage]').getAttribute('data-anchor')
    const snapshot = async () => (await pageState(page)).modals ?? null

    await page.selectOption('#default_mobile', 'right') // панель — select механизма
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
    await waitPageState(page, (s) => (s.modals?.transient ?? []).length === 1)
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


  /* ── R-26: тап по оверлею листа не «кликает» сквозь него (мобильный) ── */
  await run('R-26 закрытие листа тапом по оверлею не активирует элемент под ним', async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    })
    await gotoBase(page)

    // Page-level multiselect (панель «Источники»): на узком экране — лист со своим оверлеем.
    const selectRoot = page.locator('section:has(h2:text-is("Источники")) [data-select-root]')
    await selectRoot.scrollIntoViewIfNeeded()
    const box = await selectRoot.boundingBox()
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    await page.waitForSelector('[data-modal-backdrop]')
    await page.waitForTimeout(300)

    // Точка в зоне щита (не над панелью листа), под которой лежит интерактивный элемент.
    const point = await page.evaluate(() => {
      const backdrop = document.querySelector('[data-modal-backdrop]')
      const floatings = [...document.querySelectorAll('[data-host-floating]')]
      const hidden = []
      const hide = (el) => { hidden.push([el, el.style.visibility]); el.style.visibility = 'hidden' }
      const bodyPE = document.body.style.pointerEvents
      if (backdrop) hide(backdrop)
      floatings.forEach(hide)
      document.body.style.pointerEvents = 'auto'
      const candidates = []
      for (let y = 30; y < innerHeight - 16 && candidates.length < 60; y += 14) {
        for (let x = 14; x < innerWidth - 14 && candidates.length < 60; x += 14) {
          const stack = document.elementsFromPoint(x, y)
          const behind = stack.find((el) =>
            el.closest && el.closest('select, button, a, input, [data-select-trigger], [role="button"]'))
          if (behind) candidates.push({ x, y })
        }
      }
      document.body.style.pointerEvents = bodyPE
      hidden.forEach(([el, v]) => { el.style.visibility = v })
      // Оставляем только точки, которые в боевом состоянии попадают в щит, а не в панель листа.
      for (const c of candidates) {
        const top = document.elementFromPoint(c.x, c.y)
        if (top === document.documentElement || top === document.body ||
            (top && top.closest && top.closest('[data-modal-backdrop]'))) {
          return c
        }
      }
      return null
    })
    assert(point, 'под оверлеем не нашлось интерактивного элемента в зоне щита')

    // Журнал событий: win-cap — видит всё, doc-bub — только ДОСТАВЛЕННОЕ (не заглушенное).
    await page.evaluate(() => {
      window.__ev = []
      const desc = (t) => {
        if (!t) return 'null'
        if (t === document) return '#document'
        if (t.nodeType !== 1) return String(t.nodeName)
        const el = t
        let s = el.tagName.toLowerCase()
        if (el.id) s += '#' + el.id
        for (const a of ['data-modal-backdrop', 'data-host-floating', 'data-select-native', 'data-modal-layer', 'name']) {
          if (el.hasAttribute(a)) s += `[${a}=${el.getAttribute(a)}]`
        }
        return s
      }
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focusin']) {
        window.addEventListener(type, (e) => {
          window.__ev.push({ ph: 'win-cap', type, target: desc(e.target) })
        }, true)
        document.addEventListener(type, (e) => {
          window.__ev.push({ ph: 'doc-bub', type, target: desc(e.target) })
        }, false)
      }
    })

    await page.touchscreen.tap(point.x, point.y)
    await page.locator('[data-host-floating]').waitFor({ state: 'detached' })
    await page.waitForTimeout(300)

    const ev = await page.evaluate(() => window.__ev)
    const delivered = ev.filter((e) => e.ph === 'doc-bub')
    const leaked = delivered.filter((e) => ['mousedown', 'mouseup', 'click'].includes(e.type))
    assert(leaked.length === 0,
      `хвост жеста дошёл сквозь снятый оверлей: ${JSON.stringify(leaked)}`)
    ok('ни mousedown/mouseup/click не дошли до страницы после снятия оверлея')
    assert((await page.locator('[data-modal-stage]').count()) === 0,
      'клик сквозь оверлей открыл модалку')
    assert((await chainOf(page)).length === 0, 'клик сквозь оверлей изменил цепочку модалок')
    const activeIsTrigger = await page.evaluate(() => {
      const roots = [...document.querySelectorAll('[data-select-root]')]
      const active = document.activeElement
      return Boolean(active && roots.some((r) => r.contains(active)))
    })
    assert(activeIsTrigger, 'фокус не вернулся на триггер закрытого листа')
    ok('фокус вернулся на триггер, цепочка пуста, модалок нет — жест полностью потреблён оверлеем')

    // Быстрый повторный тап по триггеру переоткрывает лист: хвост не съел новый жест.
    await selectRoot.scrollIntoViewIfNeeded()
    const box2 = await selectRoot.boundingBox()
    await page.touchscreen.tap(box2.x + box2.width / 2, box2.y + box2.height / 2)
    await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
    ok('быстрый повторный тап по триггеру переоткрывает лист')

    // Закрываем снова и тапаем прямо по точке под бывшим оверлеем — элемент должен получить события.
    await page.touchscreen.tap(point.x, point.y)
    await page.locator('[data-host-floating]').waitFor({ state: 'detached' })
    await page.waitForTimeout(300)
    await page.evaluate(() => { window.__ev.length = 0 })
    await page.touchscreen.tap(point.x, point.y)
    await page.waitForTimeout(400)
    const ev2 = await page.evaluate(() => window.__ev)
    const delivered2 = ev2.filter((e) => e.ph === 'doc-bub')
    assert(delivered2.some((e) => e.type === 'mousedown' || e.type === 'click'),
      'прямой тап по элементу под бывшим оверлеем не дошёл до него — страница «застыла»')
    ok('прямой тап по элементу под бывшим оверлеем доставляется — взаимодействие не сломано')
    await page.close()
  })
  /* ── R-27 (F7): <title> страницы есть уже в SSR ─────────────────── */
  // ModalHost — предок каждой страницы. Привязка к пропсу дочернего компонента
  // (`bind:ref`) включала у него SSR-цикл на копии рендерера, и `<title>`
  // страницы проигрывал `<title>` раскладки (sveltejs/svelte#18845): без JS и
  // для краулеров заголовок был «dd modals».
  await run('R-27 SSR отдаёт <title> страницы, тот же, что после гидрации', async () => {
    const origin = new URL(BASE).origin
    for (const [path, expected] of [['/', 'modals-kit — главная'], ['/paginator', 'Пагинатор — modals-kit']]) {
      const html = await (await fetch(origin + path)).text()
      const ssr = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1])
      assert(ssr.length === 1 && ssr[0] === expected, `${path}: SSR <title> = ${JSON.stringify(ssr)}, ждали «${expected}»`)
      const page = await browser.newPage()
      await page.goto(origin + path)
      await page.waitForFunction((t) => document.title === t, expected, { timeout: 10000 })
      await page.close()
      ok(`${path}: SSR и клиент — «${expected}»`)
    }
  })

  /* ── R-28 (F6): мобильная панель пишет историю через SvelteKit ──── */
  // Раньше — нативный `history.pushState({...history.state, ddSidebar: 1})`:
  // в dev SvelteKit предупреждал «Avoid using history.pushState(...)», а в
  // новую запись копировались его служебные ключи. Теперь флаг — в
  // `page.state` (shallow routing): в записи SvelteKit, а не в корне `history.state`.
  await run('R-28 мобильная панель: shallow-запись SvelteKit, Back закрывает, адрес цел', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
    const warnings = []
    page.on('console', (m) => { if (m.text().includes('history.pushState')) warnings.push(m.text()) })
    await page.goto(`${origin}/paginator?page.size=10#r28`)
    await page.waitForSelector('[data-select-root][data-enhanced]')
    const checked = () => page.evaluate(() => document.getElementById('fe-sidebar').checked)
    await page.locator('label[for="fe-sidebar"]:not([data-fe-sidebar-close])').filter({ visible: true }).first().click()
    await page.waitForFunction(() => document.getElementById('fe-sidebar').checked)
    const st = await page.evaluate(() => history.state)
    const ps = await pageState(page)
    assert(ps.ddSidebar === true, `флаг панели не в page.state: ${JSON.stringify(ps)}`)
    assert(!('ddSidebar' in st), 'флаг панели лежит в корне history.state — запись сделана в обход SvelteKit')
    assert(await page.evaluate(() => location.search + location.hash) === '?page.size=10#r28', 'открытие панели изменило адрес')
    ok('открытие: флаг в page.state, адрес (поиск и #якорь) не тронут')
    await page.goBack()
    await page.waitForFunction(() => !document.getElementById('fe-sidebar').checked)
    assert(await page.evaluate(() => location.pathname) === '/paginator', 'Back увёл со страницы')
    ok('Back закрывает панель и остаётся на странице')
    await page.locator('label[for="fe-sidebar"]:not([data-fe-sidebar-close])').filter({ visible: true }).first().click()
    await page.waitForFunction(() => document.getElementById('fe-sidebar').checked)
    await page.locator('[data-fe-sidebar-close]').click()
    await waitPageState(page, (s) => !s.ddSidebar)
    assert(!(await checked()), 'крестик не закрыл панель')
    ok('крестик закрывает панель и снимает её запись истории')
    assert(warnings.length === 0, `SvelteKit предупредил о history.pushState: ${warnings[0]}`)
    await page.close()
  })

  /* ── R-29 (C4): Link (бывший LoadLink) различает исходы загрузчика ── */
  // Исход читает адаптер `preloadOutcome` по контракту kit 3 (`loaded |
  // redirect | error`). Было: `type !== 'loaded'` считалось ошибкой — штатная
  // переадресация рисовалась ошибкой, а отказ preloadData оставлял ссылку в
  // вечном `loading`.
  await run('R-29 Link: переадресация — не ошибка, отказ предзагрузки — ошибка, битая ссылка заблокирована', async () => {
    const watch = (page, href) => page.evaluate((h) => {
      window.__llStates = []
      const a = document.querySelector(`a[href="${h}"]`)
      new MutationObserver(() => window.__llStates.push(a.getAttribute('data-state')))
        .observe(a, { attributes: true, attributeFilter: ['data-state'] })
    }, href)

    // 1. Переадресация: переход на цель, состояния `error` не было.
    let page = await browser.newPage()
    await gotoBase(page)
    await watch(page, '/cards/307?moved=1')
    await page.locator('a[href="/cards/307?moved=1"]').click()
    await page.waitForURL((u) => u.pathname === '/cards/307' && !u.search.includes('moved'), { timeout: 10000 })
    // Переход клиентский — window тот же, наблюдатель успел записать состояния.
    let states = await page.evaluate(() => window.__llStates)
    assert(!states.includes('error'), `переадресация показана ошибкой: ${JSON.stringify(states)}`)
    ok(`переадресация: переход на цель, ошибки нет (состояния: ${JSON.stringify(states)})`)
    await page.close()

    // 2. Отказ загрузки кода маршрута: пользователь не застревает на ссылке в
    //    вечном `loading` — либо переход (kit сам уходит в нативную навигацию),
    //    либо ссылка выходит из `loading` с причиной.
    page = await browser.newPage()
    await gotoBase(page)
    await page.route(/cards\/\[id\]|nodes\/\d+\.js/, (r) => r.abort())
    await page.locator('a[href="/cards/501?slow=1"]').click()
    await page.waitForFunction(() => {
      if (location.pathname !== '/modals') return true
      return document.querySelector('a[href="/cards/501?slow=1"]')?.getAttribute('data-state') !== 'loading'
    }, null, { timeout: 15000 })
    const where = new URL(page.url()).pathname
    ok(`отказ загрузки кода: не застряли в loading (${where === '/modals' ? 'ссылка вышла из loading' : `переход на ${where}`})`)
    await page.close()

    // 3. Ошибка загрузчика по умолчанию: переход ведёт SvelteKit, страницу показывает её +error.
    page = await browser.newPage()
    await gotoBase(page)
    await page.locator('a[href="/cards/404?fail=1"]').click()
    await page.waitForURL((u) => u.pathname === '/cards/404', { timeout: 10000 })
    await page.waitForFunction(() => document.body.innerText.includes('404'), null, { timeout: 10000 })
    ok('ошибка загрузчика: по умолчанию — страница +error')
    await page.close()

    // 4. navigateOnError={false}: остаёмся на месте, ошибка на ссылке («!» + текст).
    page = await browser.newPage()
    await gotoBase(page)
    const stay = page.locator('a[href="/cards/404?fail=1&stay=1"]')
    await stay.click()
    await page.waitForFunction(
      () => document.querySelector('a[href="/cards/404?fail=1&stay=1"]')?.getAttribute('data-state') === 'error',
      null, { timeout: 10000 },
    )
    assert(new URL(page.url()).pathname === '/modals', `ушли со страницы: ${page.url()}`)
    const stayTitle = await stay.getAttribute('title')
    assert(/ошибка 404/.test(stayTitle ?? ''), `в подсказке нет причины: ${stayTitle}`)
    assert((await stay.locator('[data-task-indicator="error"] svg').count()) === 1, 'нет знака «!»')
    ok(`navigateOnError={false}: остались на /modals, «!» на ссылке, подсказка «${stayTitle}»`)
    await page.close()

    // 5. Битая ссылка: заблокирована уже в SSR (нет href, aria-disabled, «!», причина), клик ничего не делает.
    const html = await (await fetch(new URL('/modals', BASE))).text()
    const broken = html.match(/<a[^>]*data-state="error"[^>]*>(?:(?!<\/a>)[\s\S])*?Битая ссылка[\s\S]*?<\/a>/)?.[0] ?? ''
    assert(broken, 'SSR: битая ссылка не помечена')
    assert(!/\shref=/.test(broken.split('>')[0]), `SSR: у битой ссылки остался href: ${broken.slice(0, 200)}`)
    assert(/aria-disabled="true"/.test(broken) && /Страницы \/no-such-page\/1 не существует/.test(broken), 'SSR: нет aria-disabled или причины')
    assert(/data-task-indicator="error"/.test(broken), 'SSR: нет знака «!»')
    page = await browser.newPage()
    await gotoBase(page)
    // Playwright сам не кликает aria-disabled — жмём принудительно, как упорный пользователь.
    await page.getByText('Битая ссылка', { exact: true }).click({ force: true })
    await page.waitForTimeout(500)
    assert(new URL(page.url()).pathname === '/modals', `битая ссылка увела на ${page.url()}`)
    ok('битая ссылка: в SSR без href, aria-disabled, «!» и причина; клик с JS ничего не делает')
    await page.close()
  })

  /* ── R-30 (F9): запись адреса пагинатором не стирает #якорь ───────── */
  // `hrefOf` (router/sveltekit.ts) собирал только путь + `?search`, и каждая
  // запись адреса (`syncAddress` → `replaceState`) выбрасывала фрагмент.
  await run('R-30 запись адреса пагинатором сохраняет #якорь', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    await page.goto(`${origin}/paginator?page.size=10#r30`)
    await page.waitForSelector('[data-select-root][data-enhanced]')
    const size = page.locator('[data-testid="demo-panel"] select[name="page.size"]')
    const addr = () => page.evaluate(() => location.search + location.hash)
    for (const value of ['40', '5']) {
      await size.selectOption(value, { force: true })
      await page.waitForFunction((v) => new URLSearchParams(location.search).get('page.size') === v, value)
      const now = await addr()
      assert(now.endsWith('#r30'), `после page.size=${value} якорь потерян: ${now}`)
    }
    ok('две записи page.size (40, 5) подряд: поиск обновлён, #r30 на месте')
    await page.close()
  })

  /* ── R-31 (C7): production-сборка не печатает dev-предупреждения ──── */
  // Признак dev был `typeof process === 'undefined' || NODE_ENV !== 'production'`:
  // в браузере `process` нет, и предупреждения жили в production. Теперь — `DEV`
  // из `esm-env`. Набор гоняется на preview (production); в dev то же
  // предупреждение обязано остаться — его ловит отдельная проба.
  await run('R-31 production: dev-предупреждения [paginate] не печатаются', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    const warnings = []
    page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[paginate]')) warnings.push(m.text()) })
    // Пустой `page.q=` не проходит валидатор extra-ключа → в dev это предупреждение.
    // Гидрацию здесь не ждём: её проверяет R-32 (F12).
    await page.goto(`${origin}/paginator?page.size=10&page.q=`)
    await page.waitForTimeout(2500)
    assert(warnings.length === 0, `production печатает dev-предупреждение: ${warnings[0]}`)
    ok('отброшенный extra-ключ в production молчит')
    await page.close()
  })

  /* ── R-32 (F12): адрес с пустым ключом не обрывает гидрацию ───────── */
  // Нативная GET-форма оставляет `?page.q=`; хост чистил адрес `replaceState` в
  // onMount — до запуска роутера SvelteKit: исключение, гидрация обрывалась,
  // страница оставалась неинтерактивной. Теперь запись ждёт первого afterNavigate.
  await run('R-32 пустой ключ адреса: гидрация доходит до конца, адрес очищен', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`${origin}/paginator?page.size=10&page.q=`)
    await page.waitForSelector('[data-select-root][data-enhanced]', { timeout: 10_000 })
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('page.q'), null, { timeout: 5_000 })
    assert(errors.length === 0, `ошибки страницы: ${errors.join(' | ')}`)
    const search = await page.evaluate(() => location.search)
    assert(search.includes('page.size=10'), `соседний ключ потерян: ${search}`)
    ok(`гидрация завершена, ошибок нет, адрес ${search}`)
    await page.close()
  })

  /* ── R-33 (F28): цвет из адреса не дописывает CSS и не грузит ресурсы ─ */
  // `modal.N.color` уходил в inline style как есть: `red;position:fixed;…`
  // растягивал модалку поверх всего, `url(…)` грузил чужой ресурс.
  await run('R-33 цвет из адреса: ни новых объявлений, ни внешних запросов', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    const foreign = []
    page.on('request', (r) => { if (new URL(r.url()).hostname === '127.0.0.2') foreign.push(r.url()) })
    for (const color of [
      'red;position:fixed;inset:0;width:100vw;z-index:2147483647',
      'url(http://127.0.0.2:9/track.png) center/cover',
    ]) {
      await page.goto(`${origin}/modals?modal=card&modal.0.id=1&modal.0.color=${encodeURIComponent(color)}`)
      await page.waitForSelector('[data-modal-popup]', { timeout: 10_000 })
      await page.waitForTimeout(500)
      const box = await page.evaluate(() => {
        const el = document.querySelector('[data-modal-popup]')
        const cs = getComputedStyle(el)
        return { position: cs.position, image: cs.backgroundImage, style: el.getAttribute('style') }
      })
      assert(box.position !== 'fixed', `объявление из адреса применилось: ${box.style}`)
      assert(box.image === 'none', `фон из адреса применился: ${box.image}`)
    }
    assert(foreign.length === 0, `запрос на чужой хост: ${foreign[0]}`)
    const palette = 'color-mix(in oklab, var(--chart-1) 8%, var(--card))'
    await page.goto(`${origin}/modals?modal=card&modal.0.id=1&modal.0.color=${encodeURIComponent(palette)}`)
    await page.waitForSelector('[data-modal-popup]', { timeout: 10_000 })
    const style = await page.getAttribute('[data-modal-popup]', 'style')
    assert(style.includes('color-mix'), `цвет палитры демо отвергнут: ${style}`)
    ok('опасные значения отброшены, цвет палитры принят')
    await page.close()
  })

  /* ── R-34 (F29): размонтированный триггер не открывает модалку ─────── */
  // Триггер ждал предзагрузку и открывал модалку, даже если его уже
  // размонтировали: закрыли карточку, в которой он жил, — а через пару
  // секунд всплывала «следующая». При смене страницы симптом в production
  // маскируется (имя другой области отбрасывается), поэтому сценарий —
  // внутри одной области. Math.random фиксирован: медленность триггера
  // карточки выбирается случайно.
  await run('R-34 медленный триггер внутри закрытой карточки ничего не открывает', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    await page.addInitScript(() => { Math.random = () => 0.9 })
    await page.goto(`${origin}/modals?modal=card&modal.0.id=1`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-modal-layer][data-active] [data-modal-content]', { timeout: 10_000 })
    const trigger = page.locator('[data-modal-layer][data-active] a[data-modal-trigger]').first()
    await trigger.click()
    assert((await trigger.getAttribute('data-state')) === 'loading', 'триггер не ушёл в загрузку')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-modal-popup]'), null, { timeout: 5_000 })
    await page.waitForTimeout(3600) // медленный загрузчик карточки: до 3 с
    const state = await page.evaluate(() => ({ search: location.search, popups: document.querySelectorAll('[data-modal-popup]').length }))
    assert(!state.search.includes('modal=') && state.popups === 0, `модалка открылась после закрытия: ${JSON.stringify(state)}`)
    ok('после закрытия карточки следующая не всплыла, адрес чистый')
    await page.close()
  })

  /* ── R-35 (F31): повторно появившийся хвост играет вход ─────────────── */
  await run('R-35 хвост после закрытия и нового открытия снова «уходит в стопку»', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    await page.goto(`${origin}/modals?modal=card&modal.0.id=1`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-modal-layer][data-active] [data-modal-content]', { timeout: 10_000 })
    const firstFrame = async () => {
      await page.evaluate(() => {
        window.__tailFirst = null
        const mo = new MutationObserver(() => {
          const t = document.querySelector('[data-modal-tail][data-depth="1"]')
          if (t && window.__tailFirst === null) { window.__tailFirst = t.getAttribute('style'); mo.disconnect() }
        })
        mo.observe(document.body, { subtree: true, childList: true, attributes: true })
      })
      await page.locator('[data-modal-layer][data-active] a[data-modal-trigger]').first().click()
      await page.waitForSelector('[data-modal-tail][data-depth="1"]', { timeout: 10_000 })
      await page.waitForTimeout(500)
      return page.evaluate(() => window.__tailFirst)
    }
    const first = await firstFrame()
    assert(/scale\(1\)/.test(first), `первый хвост без входа: ${first}`)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-modal-tail]'), null, { timeout: 5_000 })
    await page.waitForSelector('[data-modal-layer][data-active] [data-modal-content]', { timeout: 10_000 })
    const again = await firstFrame()
    assert(/scale\(1\)/.test(again), `повторный хвост встал в стопку без входа: ${again}`)
    ok('оба появления начинаются с позиции активной оболочки')
    await page.close()
  })

  /* ── R-36 (F37): href триггера следует за адресом после клиентской навигации ── */
  await run('R-36 href триггера следует за query после клиентского перехода', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    const hrefs = () => page.evaluate(() =>
      [...document.querySelectorAll('a[data-modal-trigger]')]
        .map((a) => a.getAttribute('href') ?? '')
        .filter((h) => h.includes('modal=')))
    // Переход — обычной ссылкой: его перехватывает роутер SvelteKit (без перезагрузки).
    const clientNav = (href) => page.evaluate((h) => {
      const a = document.createElement('a'); a.href = h; document.body.append(a); a.click()
    }, href)
    await page.goto(`${origin}/modals?probe=1`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() =>
      document.querySelectorAll('a[data-modal-trigger][href*="modal="]').length > 0, null, { timeout: 10_000 })
    const start = await hrefs()
    assert(start.length > 0 && start.every((h) => h.startsWith('/modals?probe=1&')), `стартовые href: ${start}`)
    for (const [target, prefix] of [['/modals?probe=2', '/modals?probe=2&'], ['/modals', '/modals?modal=']]) {
      await clientNav(target)
      await page.waitForURL(`${origin}${target}`)
      await page.waitForFunction((p) => {
        const hs = [...document.querySelectorAll('a[data-modal-trigger][href*="modal="]')].map((a) => a.getAttribute('href'))
        return hs.length > 0 && hs.every((h) => h.startsWith(p))
      }, prefix, { timeout: 5_000 }).catch(async () => {
        throw new Error(`после перехода на ${target} href устарели: ${await hrefs()}`)
      })
    }
    ok('href пересобраны после ?probe=2 и после /modals без query')
    await page.close()
  })

  /* ── R-37 (F38): клиентский уход со страницы снимает url-модалку того же scope ── */
  await run('R-37 переход ссылкой с открытой url-модалкой не оставляет слоя', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    await page.goto(`${origin}/?modal=gprobe`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-modal-layer]', { timeout: 10_000 })
    await page.evaluate(() => {
      const a = document.createElement('a'); a.href = '/paginator'; document.body.append(a); a.click()
    })
    await page.waitForURL(`${origin}/paginator`)
    await page.waitForFunction(() =>
      !document.querySelector('[data-modal-layer]') && !document.querySelector('[data-modal-popup]'),
    null, { timeout: 5_000 }).catch(async () => {
      const left = await page.evaluate(() => ({
        layers: document.querySelectorAll('[data-modal-layer]').length,
        popup: !!document.querySelector('[data-modal-popup]'),
      }))
      throw new Error(`на /paginator осталась модалка: ${JSON.stringify(left)}`)
    })
    // Устойчиво, а не мгновенный кадр: слой не возвращается следом.
    await page.waitForTimeout(500)
    const layers = await page.evaluate(() => document.querySelectorAll('[data-modal-layer]').length)
    assert(layers === 0, `слой вернулся: ${layers}`)
    ok('адрес /paginator, слоёв 0, попапа нет')
    await page.close()
  })

  /* ── R-38 (C1, Kit 3): якорь, поставленный кликом после «мелкой» записи ── */
  // Клик по ссылке-якорю обновляет в SvelteKit 3.0.1 только `page.url`, а
  // `page.shallow` остаётся от прошлой записи пагинатора. Якорь из `page.*`
  // стирался следующей записью; адаптер берёт его у адресной строки (решение A).
  await run('R-38 запись пагинатора после клика по #якорю его не стирает; Назад синхронизирует срез', async () => {
    const origin = new URL(BASE).origin
    const page = await browser.newPage()
    await page.goto(`${origin}/paginator?page.size=10`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-select-root][data-enhanced]')
    const size = page.locator('[data-testid="demo-panel"] select[name="page.size"]')
    const addr = () => page.evaluate(() => location.search + location.hash)
    const pick = async (v) => {
      await size.selectOption(v, { force: true })
      await page.waitForFunction((x) => new URLSearchParams(location.search).get('page.size') === x, v)
    }
    await pick('40')
    await page.evaluate(() => {
      const a = document.createElement('a'); a.href = '#h1'; a.textContent = 'h1'; document.body.append(a); a.click()
    })
    await page.waitForFunction(() => location.hash === '#h1')
    await pick('5')
    const after = await addr()
    assert(after === '?page.size=5#h1', `запись после клика по якорю: ${after}`)
    ok(`запись page.size=5 сохранила якорь (${after})`)
    await page.goBack()
    await page.waitForFunction(() => new URLSearchParams(location.search).get('page.size') !== '5')
    const back = new URLSearchParams(new URL(page.url()).search).get('page.size')
    await page.waitForFunction((v) =>
      document.querySelector('[data-testid="demo-panel"] select[name="page.size"]')?.value === v, back, { timeout: 5_000 })
      .catch(async () => { throw new Error(`Назад: адрес page.size=${back}, select=${await size.inputValue()}`) })
    ok(`Назад: select следует за адресом (page.size=${back})`)
    await page.close()
  })

  /* ── R-39 (§13.2): снятие записи листа — фокус по причине закрытия ───── */
  // «Назад» при живой модалке → причина `history`: фокус возвращается на Select.
  // Модалка ушла вместе с листом → `owner-closed`: Select фокус не трогает,
  // его возвращает сама модалка своему триггеру.
  await run('R-39 лист Select: «Назад» возвращает фокус на Select, закрытие модалки — на её триггер', async () => {
    const origin = new URL(BASE).origin
    for (const [scenario, step] of [['Назад', -1], ['закрытие модалки', -2]]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`${origin}/modals`, { waitUntil: 'networkidle' })
      await page.locator('[data-modal-trigger]', { hasText: 'Select внутри модалки' }).tap()
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible' })
      await page.locator('[data-modal-stage] [data-select-native]').first().tap({ force: true })
      await page.waitForSelector('[data-host-floating][data-layout="sheet"]')
      await page.waitForTimeout(300)
      await page.evaluate((d) => history.go(d), step)
      await page.locator('[data-host-floating]').waitFor({ state: 'detached', timeout: 5_000 })
      await page.waitForTimeout(800)
      const state = await page.evaluate(() => {
        const a = document.activeElement
        return {
          stage: !!document.querySelector('[data-modal-stage]'),
          select: !!a?.matches('[data-modal-stage] [data-select-native]'),
          trigger: !!a?.matches('[data-modal-trigger]'),
        }
      })
      if (step === -1) assert(state.stage && state.select, `${scenario}: ${JSON.stringify(state)}`)
      else assert(!state.stage && state.trigger, `${scenario}: ${JSON.stringify(state)}`)
      assert(errors.length === 0, `${scenario}: ошибки ${errors.join(' | ')}`)
      ok(`${scenario}: ${step === -1 ? 'модалка жива, фокус на Select' : 'модалка закрыта, фокус на её триггере'}`)
      await page.close()
    }
  })

  await run('R-40 выключенный Select: нативный носитель остаётся невидимым поверх кнопки', async () => {
    // `disabled:opacity-50` базового класса поля специфичнее `opacity-0`
    // (псевдокласс): выключенный нативный select проступал полупрозрачным
    // поверх кнопки, и два контрола накладывались. Гаснет корень целиком.
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await page.goto(BASE.replace(/\/modals$/, '/paginator'), { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-select-root][data-enhanced] select[data-select-native]:disabled')
    const states = await page.$$eval('[data-select-root][data-enhanced] select[data-select-native]:disabled', (els) =>
      els.map((e) => ({ name: e.name, opacity: getComputedStyle(e).opacity })))
    assert(states.length > 0 && states.every((s) => s.opacity === '0'), `видимый выключенный носитель: ${JSON.stringify(states)}`)
    ok(`выключенные Select (${states.map((s) => s.name).join(', ')}): носитель opacity 0`)
    await page.close()
  })

  await run('R-41 два владельца адреса в одной задаче: размер страницы и мобильная панель', async () => {
    // F41: пока запись адреса одного владельца в полёте (`goto` асинхронен),
    // второй строил свой адрес из устаревшего среза. Панель записывала адрес без
    // нового `page.size`, и пагинатор, прочитав его, откатывал выбор пользователя.
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
    await page.goto(BASE.replace(/\/modals$/, '/paginator?page.size=10#r41'), { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="demo-panel"] select[name="page.size"]')
    await page.waitForFunction(() => document.getElementById('fe-sidebar') !== null)
    const before = await page.evaluate(() => history.length)
    await page.evaluate(() => {
      const size = document.querySelector('[data-testid="demo-panel"] select[name="page.size"]')
      size.value = '5'
      size.dispatchEvent(new Event('change', { bubbles: true }))
      const drawer = document.getElementById('fe-sidebar')
      drawer.checked = true
      drawer.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForFunction(() => new URLSearchParams(location.search).get('page.size') === '5', null, { timeout: 5000 })
      .catch(() => {})
    const now = await page.evaluate(() => ({
      search: location.search, hash: location.hash, length: history.length,
      badge: document.querySelector('[data-testid="page-size"]')?.textContent,
      open: document.getElementById('fe-sidebar').checked,
    }))
    assert(now.search.includes('page.size=5') && now.badge === '5',
      `размер страницы потерян второй записью: ${JSON.stringify(now)}`)
    assert(now.hash === '#r41', `якорь потерян: ${now.hash}`)
    assert(now.open && now.length === before + 1, `панель не дала ровно одну запись истории: ${JSON.stringify(now)}`)
    ok('обе записи в адресе: ?page.size=5, #r41, панель — одна запись истории')

    await page.goBack()
    await page.waitForFunction(() => !document.getElementById('fe-sidebar').checked, null, { timeout: 5000 })
    const back = await page.evaluate(() => ({ path: location.pathname, search: location.search,
      badge: document.querySelector('[data-testid="page-size"]')?.textContent }))
    assert(back.path === '/paginator' && back.search.includes('page.size=5') && back.badge === '5',
      `Назад после двух записей: ${JSON.stringify(back)}`)
    ok('Назад закрывает панель и оставляет размер 5')

    await page.reload({ waitUntil: 'networkidle' })
    const reloaded = await page.evaluate(() => document.querySelector('[data-testid="page-size"]')?.textContent)
    assert(reloaded === '5', `после перезагрузки размер ${reloaded}`)
    ok('после перезагрузки — тот же размер страницы')
    await page.close()
  })

  await run('R-42 панель закрыта, пока её запись истории ещё в очереди: флаг не остаётся', async () => {
    // Находка хода 40: закрытие панели звало `history.back()` напрямую и только
    // если запись панели уже ПРИМЕНЕНА. Пока она ждала в очереди писателя (за
    // записью размера страницы), закрытие шаг назад не делало, запись потом
    // применялась — и в истории оставался флаг закрытой панели: следующий «Назад»
    // ничего видимого не делал.
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
    await page.goto(BASE.replace(/\/modals$/, '/paginator?page.size=10#r42'), { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="demo-panel"] select[name="page.size"]')
    await page.waitForFunction(() => document.getElementById('fe-sidebar') !== null)
    const before = await page.evaluate(() => history.length)
    await page.evaluate(() => {
      const size = document.querySelector('[data-testid="demo-panel"] select[name="page.size"]')
      size.value = '5'
      size.dispatchEvent(new Event('change', { bubbles: true }))
      const drawer = document.getElementById('fe-sidebar')
      drawer.checked = true
      drawer.dispatchEvent(new Event('change', { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await page.waitForFunction(() => new URLSearchParams(location.search).get('page.size') === '5', null, { timeout: 5000 })
    await page.waitForTimeout(800)
    const now = await page.evaluate(() => ({
      search: location.search, hash: location.hash, length: history.length,
      badge: document.querySelector('[data-testid="page-size"]')?.textContent,
      open: document.getElementById('fe-sidebar').checked,
    }))
    const ps = await pageState(page)
    assert(!now.open, `панель не закрылась: ${JSON.stringify(now)}`)
    assert(!ps.ddSidebar, `закрытая панель оставила свою запись истории: page.state=${JSON.stringify(ps)}`)
    assert(now.search.includes('page.size=5') && now.badge === '5' && now.hash === '#r42',
      `адрес после открытия и закрытия: ${JSON.stringify(now)}`)
    assert(now.length <= before + 1, `лишние записи истории: было ${before}, стало ${now.length}`)
    ok('закрыта до применения своей записи: флага в истории нет, ?page.size=5 и #r42 целы')
    await page.close()
  })

  await run('R-43 якорь внутри открытой модалки: Escape закрывает окно, адрес и история целы', async () => {
    // F39: клик по `#якорю` внутри модалки добавлял запись истории — браузер
    // копировал в неё состояние «модалка открыта». Escape шагал назад на запись
    // открытия, окно оставалось, адрес терял якорь; следующий Escape окно уже не
    // закрывал. Теперь при открытом слое якорь заменяет текущую запись (через
    // общий писатель адреса), а не добавляет новую.
    const page = await browser.newPage()
    const url = () => page.evaluate(() => location.pathname + location.search + location.hash)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    const start = await url()
    await page.locator('a[data-modal-trigger]').first().click()
    await page.waitForSelector('[role="dialog"]')
    await page.waitForFunction((u) => location.pathname + location.search + location.hash !== u, start)
    const opened = await url()
    const before = await page.evaluate(() => history.length)
    await page.evaluate(() => {
      const target = document.createElement('div'); target.id = 'r43'; target.textContent = 'цель'
      document.body.append(target)
      const a = document.createElement('a'); a.href = '#r43'; a.id = 'r43-link'; a.textContent = 'к цели'
      ;[...document.querySelectorAll('[role="dialog"]')].at(-1).append(a)
    })
    await page.click('#r43-link')
    await page.waitForFunction(() => location.hash === '#r43')
    assert(await page.evaluate(() => history.length) === before, 'якорь внутри модалки добавил запись истории')
    assert(await page.locator('[role="dialog"]').count() === 1, 'якорь закрыл модалку')
    assert(await url() === opened + '#r43', `адрес после якоря: ${await url()}`)
    ok('якорь внутри модалки: адрес с #r43, записи истории не прибавилось, окно открыто')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0, null, { timeout: 5000 })
    await page.waitForFunction(() => !location.search.includes('modal='), null, { timeout: 5000 })
    assert(await page.evaluate(() => location.pathname) === new URL(BASE).pathname, 'Escape увёл со страницы')
    ok(`Escape закрывает окно и снимает его из адреса: ${await url()}`)
    // Открыть снова и закрыть: прежний «залипший» адрес не возвращается.
    await page.locator('a[data-modal-trigger]').first().click()
    await page.waitForSelector('[role="dialog"]')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0, null, { timeout: 5000 })
    await page.waitForFunction(() => !location.search.includes('modal='), null, { timeout: 5000 })
    ok('повторное открытие и закрытие работают')
    await page.close()
  })

  console.log(`\n✅ regressions: ${passed} проверок пройдено`)
} catch (error) {
  console.error('\n❌ ' + error.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
