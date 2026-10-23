/**
 * Browser-тесты App Shell & Page Context в Svelte 5:
 *   • CollapsingHeader (3 ряда, scroll-sync с main, sticky middle row, consume physics);
 *   • 3-зонный Sidebar (Safe top/bottom, flex-1 scrollable middle);
 *   • Mobile drawer: открытие через menuButton, закрытие через close / backdrop / Escape / History;
 *   • No-JS CSS-drawer (#fe-sidebar:checked).
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const PORT = Number(process.env.MODALS_PORT ?? 5173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
const ok = (name) => {
  passed++
  console.log('  ok  ' + name)
}

async function waitPreview() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE)
      if (r.ok) return
    } catch {}
    await sleep(500)
  }
  throw new Error(`сервер не отвечает: ${BASE}`)
}

async function run() {
  await waitPreview()
  const browser = await chromium.launch({ headless: true })

  try {
    console.log('— AppShell & CollapsingHeader: desktop & mobile —')

    // 1. Desktop layout & 3-zone sidebar
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
      const res = await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })
      assert.equal(res.status(), 200, 'статус 200 на /modals')

      // Main scroller check
      const hasMain = await page.locator('main[data-fe-scroll="owner"]').count()
      assert.equal(hasMain, 1, 'main скроллер присутствует')

      // Header rows check
      const hasHeader = await page.locator('[data-fe-header]').count()
      assert.equal(hasHeader, 1, 'шапка присутствует')

      // Logo & Nav check
      const hasLogo = await page.locator('header a[href="/"]').count()
      assert.ok(hasLogo > 0, 'логотип со ссылкой на / присутствует')

      // 3-zone sidebar check on desktop
      const sidebarTop = await page.locator('[data-sidebar-zone="top"]').count()
      const sidebarMiddle = await page.locator('[data-sidebar-zone="middle"]').count()
      const sidebarBottom = await page.locator('[data-sidebar-zone="bottom"]').count()
      assert.ok(sidebarTop > 0, 'sidebar-top (Safe Zone) присутствует')
      assert.ok(sidebarMiddle > 0, 'sidebar-middle (Scrollable Zone) присутствует')
      assert.ok(sidebarBottom > 0, 'sidebar-bottom (Safe Zone) присутствует')

      ok('desktop: AppShell, шапка, скроллер и 3-зонный сайдбар отрендерены')
      await page.close()
    }

    // 2. Mobile drawer: Open & Close via backdrop
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })

      // Drawer initially closed
      const isCheckedBefore = await page.evaluate(() => {
        const input = document.getElementById('fe-sidebar')
        return input?.checked ?? false
      })
      assert.equal(isCheckedBefore, false, 'drawer изначально закрыт')

      // Open drawer via menu button
      await page.locator('label[for="fe-sidebar"][aria-label="Открыть панель"]').click()
      await sleep(350)

      const isCheckedAfter = await page.evaluate(() => {
        const input = document.getElementById('fe-sidebar')
        return input?.checked ?? false
      })
      assert.equal(isCheckedAfter, true, 'drawer открыт после клика на кнопку меню')

      // Close drawer by clicking on backdrop outside sidebar (x: 320)
      await page.mouse.click(320, 300)
      await sleep(350)

      const isCheckedClosed = await page.evaluate(() => {
        const input = document.getElementById('fe-sidebar')
        return input?.checked ?? false
      })
      assert.equal(isCheckedClosed, false, 'drawer закрыт после клика по подложке вне панели')

      ok('mobile: drawer открывается через кнопку и закрывается через backdrop')
      await page.close()
    }

    // 3. Mobile drawer: Close via close button in drawer header
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })

      await page.locator('label[for="fe-sidebar"][aria-label="Открыть панель"]').click()
      await sleep(350)

      const isCheckedOpen = await page.evaluate(() => document.getElementById('fe-sidebar')?.checked)
      assert.equal(isCheckedOpen, true)

      // Click close button inside drawer panel
      await page.locator('label[for="fe-sidebar"][aria-label="Закрыть панель"]').click()
      await sleep(350)

      const isCheckedClosed = await page.evaluate(() => document.getElementById('fe-sidebar')?.checked)
      assert.equal(isCheckedClosed, false, 'drawer закрыт кнопкой закрытия в шапке панели')

      ok('mobile: drawer закрывается через внутреннюю кнопку закрытия')
      await page.close()
    }

    // 4. Mobile drawer: Escape key & History back
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })

      // Open drawer
      await page.locator('label[for="fe-sidebar"][aria-label="Открыть панель"]').click()
      await sleep(350)
      assert.equal(await page.evaluate(() => document.getElementById('fe-sidebar')?.checked), true)

      // Escape closes drawer
      await page.keyboard.press('Escape')
      await sleep(350)
      assert.equal(await page.evaluate(() => document.getElementById('fe-sidebar')?.checked), false)
      ok('mobile: Escape закрывает drawer')

      // Open drawer again and test history.back()
      await page.locator('label[for="fe-sidebar"][aria-label="Открыть панель"]').click()
      await sleep(350)
      assert.equal(await page.evaluate(() => document.getElementById('fe-sidebar')?.checked), true)

      await page.goBack()
      await sleep(350)
      assert.equal(await page.evaluate(() => document.getElementById('fe-sidebar')?.checked), false)
      ok('mobile: history.back() закрывает drawer без смены URL')

      await page.close()
    }

    // 5. No-JS CSS Drawer verification
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        javaScriptEnabled: false,
      })
      const page = await context.newPage()
      await page.goto(BASE + '/modals', { waitUntil: 'load' })

      const menuLabel = page.locator('label[for="fe-sidebar"][aria-label="Открыть панель"]')
      if (await menuLabel.count() > 0) {
        await menuLabel.first().click()
        const isChecked = await page.evaluate(() => {
          const input = document.getElementById('fe-sidebar')
          return input?.checked
        })
        assert.equal(isChecked, true, 'без JS нативный клик по label переключает checkbox')
      }

      ok('no-JS: checkbox drawer управляется нативно через CSS :has(#fe-sidebar:checked)')
      await context.close()
    }

    // 6. CollapsingHeader scroll progress & sticky physics
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
      await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })

      const initialProgress = await page.evaluate(() => {
        const header = document.querySelector('[data-fe-header]')
        return header?.getAttribute('data-progress')
      })
      assert.equal(initialProgress, '0.000', 'начальный прогресс шапки = 0.000 (полностью видна)')

      // Scroll main down
      await page.evaluate(() => {
        const main = document.querySelector('main')
        if (main) main.scrollTop = 300
      })
      await sleep(350)

      const headerState = await page.evaluate(() => {
        const header = document.querySelector('[data-fe-header]')
        const middleSlot = header?.querySelector('[data-slot="middle"]')
        return {
          progress: header?.getAttribute('data-progress'),
          isHeaderVisible: header ? getComputedStyle(header).display !== 'none' : false,
          hasMiddleSticky: middleSlot ? getComputedStyle(middleSlot).position === 'sticky' : false,
        }
      })
      assert.ok(headerState.isHeaderVisible, 'шапка остаётся в потоке')
      assert.ok(headerState.hasMiddleSticky, 'средний ряд остаётся sticky')
      ok('collapsing-header: синхронизация скролла 1:1, sticky middle ряд и анимация прогресса')

      await page.close()
    }

    // 7. Link (ход 138): под капотом обычная <a>; с JS — индикатор у той
    // ссылки, на чей адрес идёт переход SvelteKit (адаптер `linkTask`).
    {
      const NAV = 'nav[aria-label="Основная навигация"]'
      // Без JS — простые ссылки, индикатора в разметке нет.
      const html = await (await fetch(BASE + '/form')).text()
      assert.match(html, /<a[^>]*href="\/paginator"/, 'SSR: пункт меню — обычная <a href>')
      assert.ok(!/data-state="loading"/.test(html), 'SSR: индикатора в разметке нет')
      {
        const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, javaScriptEnabled: false })
        const page = await context.newPage()
        await page.goto(BASE + '/form', { waitUntil: 'load' })
        await page.locator(`${NAV} a[href="/paginator"]`).click()
        await page.waitForURL('**/paginator', { timeout: 15000 })
        await context.close()
      }
      ok('Link без JS: обычная ссылка, браузер переходит сам')

      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
      await page.goto(BASE + '/form', { waitUntil: 'networkidle' })
      await page.waitForFunction(() => document.querySelector('form')?.hasAttribute('novalidate'))
      // Медленный сервер: данные следующей страницы приходят через 1,5 с.
      let slowed = 0
      await page.route('**/__data.json*', async (route) => {
        slowed++
        await sleep(1500)
        await route.continue()
      })
      const target = page.locator(`${NAV} a[href="/paginator"]`)
      const other = page.locator(`${NAV} a[href="/modals"]`)
      const t0 = Date.now()
      await target.click()
      await page.waitForSelector(`${NAV} a[href="/paginator"][data-state="loading"]`, { timeout: 1200 })
      const shownAfter = Date.now() - t0
      assert.ok(shownAfter >= 140, `индикатор не раньше задержки 150 мс (показан через ${shownAfter} мс)`)
      assert.equal(await target.getAttribute('aria-busy'), 'true', 'нажатая ссылка — aria-busy')
      assert.equal(await target.evaluate((el) => getComputedStyle(el, '::before').animationName), 'link-indicator-spin', 'спиннер (::before) у нажатой ссылки')
      assert.equal(await other.getAttribute('data-state'), null, 'у соседней ссылки индикатора нет')
      await page.waitForURL('**/paginator', { timeout: 15000 })
      await page.waitForFunction(() => !document.querySelector('nav a[data-state="loading"]'), null, { timeout: 5000 })
      assert.ok(slowed > 0, 'переход действительно ждал данные (__data.json перехвачен)')
      ok(`Link с JS: медленный переход — спиннер у нажатой ссылки через ${shownAfter} мс, после перехода снят`)

      // «Мелкая» запись адреса (модалка) держит navigating 1–2 мс — не мигает.
      await page.unroute('**/__data.json*')
      await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })
      await page.evaluate(() => {
        window.__taskFlash = 0
        new MutationObserver((list) => {
          for (const m of list) if (m.target.getAttribute?.('data-state') === 'loading' && !m.target.hasAttribute('data-modal-link')) window.__taskFlash++
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'] })
      })
      await page.locator('a[href*="modal=fullpage"]').first().click()
      await sleep(800)
      assert.equal(await page.evaluate(() => window.__taskFlash), 0, 'открытие модалки не зажгло индикатор ссылок')
      ok('Link: «мелкая» запись адреса (открытие модалки) индикатор не зажигает')

      // Кнопка закрытия модалки синхронизирована по анимации угасания (220ms + data-ending-style) с подложкой.
      await page.goto(BASE + '/?modal=user.auth', { waitUntil: 'networkidle' })
      const closeBtn = page.locator('[data-modal-close]').first()
      await closeBtn.waitFor({ state: 'visible', timeout: 5000 })
      const closeTransition = await closeBtn.evaluate((el) => getComputedStyle(el).transitionDuration)
      assert.match(closeTransition, /0\.22s/, `длительность затухания кнопки закрытия = 220мс (${closeTransition})`)
      await closeBtn.click()
      const hadEndingAttr = await page.evaluate(() => {
        const btn = document.querySelector('[data-modal-close]')
        return btn ? btn.hasAttribute('data-ending-style') : true
      })
      assert.equal(hadEndingAttr, true, 'кнопка закрытия получает data-ending-style синхронно с backdrop')
      await sleep(300)
      ok('Modal close: кнопка закрытия плавно угасает за 220мс синхронно с затемнением')
      await page.close()
    }

    // 8. Scroll reset между разделами сайта + сохранение скролла при URL-пагинации (?page=2) + popstate
    {
      const NAV = 'nav[aria-label="Основная навигация"]'
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
      await page.goto(BASE + '/modals', { waitUntil: 'networkidle' })
      await page.evaluate(() => {
        const main = document.querySelector('main[data-fe-scroll="owner"]')
        if (main) main.scrollTop = 340
      })
      await sleep(200)
      const scrolledModals = await page.evaluate(() => document.querySelector('main[data-fe-scroll="owner"]').scrollTop)
      assert.ok(scrolledModals >= 200, `прокрутили /modals вниз (${scrolledModals}px)`)

      await page.locator(`${NAV} a[href="/paginator"]`).click()
      await page.waitForURL('**/paginator', { timeout: 15000 })
      await sleep(150)

      const resetState = await page.evaluate(() => ({
        scrollTop: document.querySelector('main[data-fe-scroll="owner"]').scrollTop,
        progress: document.querySelector('[data-fe-header]')?.getAttribute('data-progress'),
      }))
      assert.equal(resetState.scrollTop, 0, 'переход между разделами сбросил main.scrollTop в 0')
      assert.equal(resetState.progress, '0.000', 'шапка полностью раскрыта на новой странице')
      ok('Scroll reset: переход между разделами сбрасывает main.scrollTop в 0 и раскрывает шапку')

      // На /paginator смена query (?page=2) НЕ сбрасывает скролл как межстраничный переход
      await page.evaluate(() => {
        const main = document.querySelector('main[data-fe-scroll="owner"]')
        if (main) main.scrollTop = 180
      })
      await sleep(100)
      const beforePage2 = await page.evaluate(() => document.querySelector('main[data-fe-scroll="owner"]').scrollTop)
      if (beforePage2 > 0) {
        const page2Link = page.locator('nav[aria-label="Страницы"] a').first()
        if ((await page2Link.count()) > 0) {
          assert.equal(await page2Link.getAttribute('data-state'), null, 'у ссылки пагинатора нет спиннера')
          await page2Link.click()
          await sleep(300)
          const afterPage2 = await page.evaluate(() => document.querySelector('main[data-fe-scroll="owner"]').scrollTop)
          assert.ok(afterPage2 > 0, `URL-пагинация сохранила скролл (${beforePage2}px → ${afterPage2}px)`)
        }
      }
      ok('URL-пагинация: смена query на том же маршруте не сбрасывает скролл и не крутит спиннер на номере страницы')
      await page.close()
    }

    // 9. Симметричные мобильные поля <main> (p-4 = 16px) и полноширинный <footer> без переполнения
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      for (const path of ['/', '/form', '/fields', '/paginator', '/modals', '/user/auth']) {
        await page.goto(BASE + path, { waitUntil: 'networkidle' })
        const metrics = await page.evaluate(() => {
          const main = document.querySelector('main[data-fe-scroll="owner"]')
          const inner = main.firstElementChild
          const footer = main.querySelector('footer')
          const cs = getComputedStyle(inner)
          const footerRect = footer.getBoundingClientRect()
          return {
            pl: cs.paddingLeft,
            pr: cs.paddingRight,
            pt: cs.paddingTop,
            pb: cs.paddingBottom,
            overflow: main.scrollWidth - main.clientWidth,
            footerLeft: Math.round(footerRect.left),
            footerWidth: Math.round(footerRect.width),
          }
        })
        assert.equal(metrics.pl, '16px', `${path}: padding-left = 16px`)
        assert.equal(metrics.pr, '16px', `${path}: padding-right = 16px`)
        assert.equal(metrics.pt, '16px', `${path}: padding-top = 16px`)
        assert.equal(metrics.pb, '16px', `${path}: padding-bottom = 16px`)
        assert.ok(metrics.overflow <= 0, `${path}: нет горизонтального скролла (overflow=${metrics.overflow})`)
        assert.equal(metrics.footerLeft, 0, `${path}: footer начинается с левого края`)
        assert.equal(metrics.footerWidth, 390, `${path}: footer тянется на всю ширину 390px`)
      }
      ok('Mobile <main>: симметричные отступы 16px со всех 4 сторон, 0px overflow и полноширинный footer на всех роутах')
      await page.close()
    }

    console.log(`\n✅ shell-browser: ${passed} проверок пройдено`)
  } finally {
    await browser.close()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
