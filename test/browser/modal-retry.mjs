// Изолированная браузерная фикстура: подменяется только ответ JS в контексте
// Playwright, продакшен-код и открытые пользователям маршруты не меняются.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = (process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`).replace(/\/$/, '')
const base = origin.endsWith('/modals') ? origin : `${origin}/modals`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  let injected = 0
  await page.route('**/_app/immutable/**/*.js', async (route) => {
    const response = await route.fetch()
    let body = await response.text()
    if (body.includes('Быстрый ответ загрузчика')) {
      const marker = /route:\s*([`'"])\/cards\/\$id\1,loader:async\s*\([^)]*\)=>\{/g
      const matches = [...body.matchAll(marker)]
      assert.equal(matches.length, 1, 'не найдена единственная карточка для тестовой инъекции; обновите фикстуру')
      body = body.replace(marker, (prefix) => `${prefix}if(!globalThis.__modalRetryProbe){globalThis.__modalRetryProbe=1;throw Error('test-once');}`)
      injected += 1
    }
    await route.fulfill({ response, body })
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  const link = page.locator('[data-modal-link]', { hasText: 'Открыть карточку' }).first()
  await link.waitFor({ state: 'visible' })
  assert.equal(injected, 1, 'тестовая фикстура не установлена')
  await link.click()
  await page.waitForFunction((el) => el?.getAttribute('data-state') === 'error', await link.elementHandle())
  assert.equal(await link.getAttribute('aria-disabled'), null)
  assert.equal(await page.locator('[role="dialog"]').count(), 0)
  await link.click()
  await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 10000 })
  console.log('modal-retry: ошибка → доступный повтор → открытая модалка')
} finally {
  await browser.close()
}
