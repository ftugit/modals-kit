/**
 * Браузерный тест демо шагов (/steps) — ход 261 (ревизия): универсальный хост.
 *   • url: ссылки ведут на адрес, aria-current, deep-link (?step=…);
 *   • local: смена шага адрес не пишет;
 *   • hybrid: адрес синхронизируется своим ключом (?hstep=…) без навигации,
 *     обновление страницы держит шаг.
 * Прогон — только этот файл (затронутый участок), не browser-all.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const PORT = Number(process.env.MODALS_PORT ?? 5173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`
let passed = 0
const ok = (name) => {
  passed++
  console.log('  ok  ' + name)
}

async function waitPreview() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + '/steps')).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`сервер не отвечает: ${BASE}`)
}

/** Текущий шаг секции: подпись с aria-current="step". */
const currentLabel = (scope) => scope.locator('[aria-current=step]').first().textContent()

async function run() {
  await waitPreview()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()

    // 1. url-режим: deep-link ?step=confirm
    await page.goto(BASE + '/steps?ustep=confirm', { waitUntil: 'networkidle' })
    const sec1 = page.locator('section').nth(0)
    assert.equal((await currentLabel(sec1))?.trim(), 'Подтверждение', 'url: deep-link открыл подтверждение')
    ok('url: deep-link ?step=confirm')
    // ссылка на следующий шаг: клик → адрес, aria-current переехал
    await sec1.getByRole('link', { name: 'Готово' }).click()
    await page.waitForURL(/ustep=done/)
    assert.equal((await currentLabel(sec1))?.trim(), 'Готово', 'url: ссылка сменила шаг')
    ok('url: ссылка ведёт на адрес, шаг сменился')

    // 2. local-режим: клик по навигации НЕ меняет адрес
    const addressBefore = page.url()
    const sec2 = page.locator('section').nth(1)
    await sec2.getByRole('link', { name: 'Подтверждение' }).click()
    await page.waitForTimeout(400)
    assert.equal((await currentLabel(sec2))?.trim(), 'Подтверждение', 'local: шаг сменился локально')
    assert.equal(page.url(), addressBefore, 'local: адрес не тронут')
    ok('local: смена без адреса')

    // 3. hybrid: локальная смена + адрес своим ключом (?hstep=…), без навигации
    const sec3 = page.locator('section').nth(2)
    await sec3.getByRole('link', { name: 'Состав' }).click()
    await page.waitForTimeout(400)
    console.log('      [dbg] url после клика:', page.url())
    console.log('      [dbg] текущий шаг sec3:', (await currentLabel(sec3))?.trim())
    assert.equal((await currentLabel(sec3))?.trim(), 'Состав', 'hybrid: шаг сменился локально')
    assert.ok(new URL(page.url()).searchParams.get('hstep') === 'compose', 'hybrid: адрес получил hstep=compose')
    ok('hybrid: локальная смена + адрес своим ключом')
    // чужие ключи не потеряны (step= от url-демо остался)
    assert.ok(new URL(page.url()).searchParams.get('ustep') === 'done', 'hybrid: чужие ключи адреса не тронуты')
    ok('hybrid: чужие ключи сохранены')

    // обновление страницы: hybrid держит шаг, url-демо тоже
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal((await currentLabel(sec3))?.trim(), 'Состав', 'hybrid: обновление держит шаг')
    assert.equal((await currentLabel(sec1))?.trim(), 'Готово', 'url: обновление держит шаг')
    ok('обновление страницы: шаги восстановлены из адреса')

    console.log(`✅ steps-browser: ${passed} проверок пройдено`)
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
