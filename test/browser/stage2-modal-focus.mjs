import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.MODALS_BASE ?? `http://127.0.0.1:${process.env.MODALS_PORT ?? 5173}`
const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    const warnings = []
    page.on('console', (msg) => { if (msg.type() === 'warning' && msg.text().includes('derived_inert')) warnings.push(msg.text()) })
    await page.goto(base, { waitUntil: 'networkidle' })
    const trigger = page.locator('[data-testid=header-auth]')
    await trigger.focus()
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'header-auth', { timeout: 5000 })
    assert.deepEqual(warnings, [], 'не должно быть derived_inert')
    await trigger.click()
    await dialog.waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'header-auth', { timeout: 5000 })
    await page.close()
  }
  console.log('ok modal focus restoration on desktop and mobile')
} finally { await browser.close() }
