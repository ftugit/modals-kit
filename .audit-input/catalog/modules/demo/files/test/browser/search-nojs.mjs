// Regression: каталог применяет поиск через нативную форму и после гидрации.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const initial = await page.goto(`${base}/paginator?page.src=products`)
  assert.equal(initial?.status(), 200)
  assert.equal(await page.locator('[data-testid="search-form"] input[name="page_param"]').inputValue(), 'page')
  assert.equal(await page.locator('[data-testid="search-form"] input[name="from"]').inputValue(), '/paginator?page.src=products')
  await page.locator('[data-testid="search-input"]').fill('Product 29')
  const positivePost = page.waitForResponse((response) => response.request().method() === 'POST')
  const positiveNavigation = page.waitForURL((url) => url.searchParams.get('page.q') === 'Product 29')
  await page.locator('[data-testid="search-submit"]').click()
  assert.equal((await positivePost).status(), 303)
  await positiveNavigation
  assert.equal(new URL(page.url()).searchParams.get('page.src'), 'products')
  await page.locator('[data-testid="card-29"]').waitFor({ state: 'visible' })
  assert.equal(await page.locator('[data-testid="card-1"]').count(), 0)
  await page.locator('[data-testid="search-input"]').fill('zzzz')
  const post = page.waitForResponse((response) => response.request().method() === 'POST')
  const navigation = page.waitForURL((url) => url.searchParams.get('page.q') === 'zzzz')
  await page.locator('[data-testid="search-submit"]').click()
  assert.equal((await post).status(), 303)
  await navigation
  assert.equal(new URL(page.url()).searchParams.get('page.src'), 'products')
  assert.equal(await page.locator('[data-testid="search-input"]').inputValue(), 'zzzz')
  await page.locator('[data-testid="empty-state"]').waitFor({ state: 'visible' })
  await context.close()
  console.log('search-nojs: POST 303, фильтр в URL и пустая выдача подтверждены')

  const js = await browser.newContext()
  const live = await js.newPage()
  await live.goto(`${base}/paginator?page.src=products`, { waitUntil: 'networkidle' })
  await live.locator('[data-testid="search-input"]').fill('zzzz')
  await live.waitForURL((url) => url.searchParams.get('page.q') === 'zzzz')
  await live.locator('[data-testid="empty-state"]').waitFor({ state: 'visible' })
  await live.reload({ waitUntil: 'networkidle' })
  assert.equal(await live.locator('[data-testid="search-input"]').inputValue(), 'zzzz')
  await live.locator('[data-testid="empty-state"]').waitFor({ state: 'visible' })
  await js.close()
  console.log('search-js: живой поиск и восстановление после перезагрузки подтверждены')
} finally {
  await browser.close()
}
