/** Stage 2 demo smoke: SSR/no-JS pages and cookie-vault modal refresh. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chromium } from 'playwright'

const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
const browser = await chromium.launch({ headless: true })
try {
  const nojs = await browser.newContext({ javaScriptEnabled: false })
  try {
    const p = await nojs.newPage()
    for (const [path, selector] of [
      ['/db-demo', '[data-testid="rows"]'],
      ['/modals', 'h1'],
      ['/upload-demo/vault', '[data-testid="storage-vault-entry-form"]'],
    ]) {
      const res = await p.goto(BASE + path)
      assert.equal(res?.status(), 200, `${path} SSR status`)
      assert.ok(await p.locator(selector).count(), `${path} SSR contents`)
    }
    assert.ok(await p.locator('[data-testid="vault-empty"]').isVisible(), 'vault empty without JS')
    console.log('  ok: /db-demo, /modals, /upload-demo/vault SSR/no-JS')
  } finally { await nojs.close() }

  const ctx = await browser.newContext()
  try {
    await ctx.addCookies([{ name: 'dv_key', value: randomBytes(32).toString('base64url'), url: BASE, httpOnly: true }])
    const p = await ctx.newPage()
    await p.goto(BASE + '/upload-demo', { waitUntil: 'networkidle' })
    await p.locator('[data-testid="demo-vault-open"]').click()
    const modal = p.locator('[role="dialog"] [data-testid="storage-vault-modal"]')
    await modal.locator('[data-testid="vault-reset-key"]').waitFor({ state: 'visible', timeout: 15000 })
    await modal.locator('[data-testid="vault-reset-key"]').click()
    await modal.locator('[data-testid="vault-key-status"]').getByText('ключ не создан').waitFor({ state: 'visible', timeout: 15000 })
    assert.ok(!(await ctx.cookies(BASE)).some((c) => c.name === 'dv_key'), 'reset removes cookie')
    await p.keyboard.press('Escape')
    await modal.waitFor({ state: 'hidden', timeout: 15000 })
    await p.locator('[data-testid="demo-vault-open"]').click()
    await modal.locator('[data-testid="vault-key-status"]').getByText('ключ не создан').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await modal.locator('[data-testid="vault-reset-key"]').count(), 0, 'reopen cannot reuse stale loader snapshot')
    console.log('  ok: reset and reopen use fresh cookie-vault snapshot')
  } finally { await ctx.close() }
} finally { await browser.close() }
