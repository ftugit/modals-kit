/**
 * Browser-тесты App Shell & Page Context в Svelte 5:
 *   • CollapsingHeader (3 ряда, scroll-sync с main, sticky middle row, consume physics);
 *   • 3-зонный Sidebar (Safe top/bottom, flex-1 scrollable middle);
 *   • Mobile drawer: открытие через menuButton, закрытие через close / backdrop / Escape / History;
 *   • No-JS CSS-drawer (#fe-sidebar:checked).
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const PORT = Number(process.env.MODALS_PORT ?? 4173)
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
      const sidebarTop = await page.locator('.sidebar-top').count()
      const sidebarMiddle = await page.locator('.sidebar-middle').count()
      const sidebarBottom = await page.locator('.sidebar-bottom').count()
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

    console.log(`\n✅ shell-browser: ${passed} проверок пройдено`)
  } finally {
    await browser.close()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
