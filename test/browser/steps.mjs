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

    // ── 4. form-режим: шаги поверх одной формы (паразит formSteps) ──────────
    const sec4 = page.locator('section').nth(3)
    const pane = (key) => sec4.locator(`[data-step="${key}"]`)
    await page.goto(BASE + '/steps', { waitUntil: 'networkidle' })

    // поля ВСЕХ шагов в DOM (свёрнутые едут в POST), виден только текущий
    assert.equal(await pane('contacts').count(), 1, 'form: шаг «Контакты» в DOM')
    assert.equal(await pane('extra').count(), 1, 'form: шаг «Примечание» в DOM')
    assert.equal(await pane('extra').isHidden(), true, 'form: соседний шаг скрыт (CSS)')
    ok('form: все шаги в DOM, виден только текущий')

    // шаговый провал: subset ловит пустые поля СВОЕГО шага, шаг не меняется
    await sec4.getByRole('button', { name: 'Далее: примечание' }).click()
    await page.waitForTimeout(400)
    assert.equal(await pane('contacts').isVisible(), true, 'form: пустой шаг не пропустило')
    assert.ok((await pane('contacts').textContent())?.includes('Обязательное'), 'form: ошибка subset у поля')
    ok('form: «Далее» проверяет только свой шаг')

    // успех шага: интенция уводит на следующий, адрес не тронут
    const addressBeforeForm = page.url()
    await pane('contacts').getByLabel('Имя').fill('Ада')
    await pane('contacts').getByLabel('Электропочта').fill('ada@example.com')
    await sec4.getByRole('button', { name: 'Далее: примечание' }).click()
    await page.waitForTimeout(500)
    assert.equal(await pane('extra').isVisible(), true, 'form: успех шага открыл «Примечание»')
    assert.equal(await pane('contacts').isHidden(), true, 'form: прошлый шаг свёрнут')
    assert.equal(page.url(), addressBeforeForm, 'form: адрес не участвует')
    ok('form: «Далее» = submit с интенцией, шаг сменился локально')

    // свёрнутый шаг едет в POST: ловим тела отправок
    const posts = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/steps')) {
        const buf = r.postDataBuffer()
        if (buf) posts.push(buf.toString('utf8'))
      }
    })
    await pane('extra').getByLabel('Примечание').fill('заметка')
    await sec4.getByRole('button', { name: 'Сохранить' }).click()
    await page.waitForTimeout(600)
    assert.ok(posts.some((b) => b.includes('name="name"') && b.includes('name="note"')),
      'form: в POST значения и видимых, и свёрнутых шагов')
    assert.equal(await pane('done').isVisible(), true, 'form: успех save — шаг «Готово»')
    ok('form: свёрнутые поля в POST, финал открыл «Готово»')

    // разбор: серверная-only ошибка (ловит только save на финальной отправке)
    // закрепляет чужой шаг, чистые свёрнуты
    await page.goto(BASE + '/steps', { waitUntil: 'networkidle' })
    await pane('contacts').getByLabel('Имя').fill('ошибка')
    await pane('contacts').getByLabel('Электропочта').fill('ada@example.com')
    await sec4.getByRole('button', { name: 'Далее: примечание' }).click()
    await page.waitForTimeout(500)
    await pane('extra').getByLabel('Примечание').fill('заметка')
    await sec4.getByRole('button', { name: 'Сохранить' }).click()
    await page.waitForTimeout(700)
    assert.equal(await pane('contacts').isVisible(), true, 'разбор: чужой шаг с ошибкой раскрыт')
    assert.ok((await pane('contacts').textContent())?.includes('Сервер не пропустил'), 'разбор: серверная ошибка у поля')
    const disclose = sec4.locator('summary[data-step-disclose="extra"]')
    assert.equal(await disclose.isVisible(), true, 'разбор: чистый шаг свёрнут в «Отобразить шаг N»')
    assert.equal(await pane('extra').isHidden(), true, 'разбор: чистый шаг скрыт до щелчка')
    ok('разбор: ошибочный шаг раскрыт, чистый свёрнут')

    // щелчок «Отобразить шаг 2» раскрывает; поля прежних шагов в DOM
    await disclose.click()
    await page.waitForTimeout(200)
    assert.equal(await pane('extra').isVisible(), true, 'разбор: «Отобразить шаг 2» раскрыл шаг')
    assert.equal(await disclose.isHidden(), true, 'разбор: кнопка скрыта — заменена блоком шага')
    ok('разбор: раскрытие свёрнутого шага')

    // ── no-JS: тот же форм-режим на нативных POST ──────────────────────────
    const nojs = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false })).newPage()
    await nojs.goto(BASE + '/steps', { waitUntil: 'load' })
    const npane = (key) => nojs.locator(`[data-step="${key}"]`)
    const nsec4 = nojs.locator('section').nth(3)
    await npane('contacts').getByLabel('Имя').fill('Ада')
    await npane('contacts').getByLabel('Электропочта').fill('ada@example.com')
    await nsec4.getByRole('button', { name: 'Далее: примечание' }).click()
    await nojs.waitForLoadState('load')
    assert.equal(await npane('extra').isVisible(), true, 'no-JS: успех шага открыл «Примечание» (шаг из ответа экшена)')
    assert.equal(await npane('contacts').isHidden(), true, 'no-JS: прошлый шаг свёрнут')
    assert.equal(await npane('contacts').count(), 1, 'no-JS: свёрнутый шаг в DOM (поля едут в POST)')
    ok('no-JS: переход шага нативным POST, шаг из ответа')

    // разбор без JS: серверная-only ошибка, чужой шаг раскрыт, чистый свёрнут
    await nojs.goto(BASE + '/steps', { waitUntil: 'load' })
    await npane('contacts').getByLabel('Имя').fill('ошибка')
    await npane('contacts').getByLabel('Электропочта').fill('ada@example.com')
    await nsec4.getByRole('button', { name: 'Далее: примечание' }).click()
    await nojs.waitForLoadState('load')
    await npane('extra').getByLabel('Примечание').fill('заметка')
    await nsec4.getByRole('button', { name: 'Сохранить' }).click()
    await nojs.waitForLoadState('load')
    assert.equal(await npane('contacts').isVisible(), true, 'no-JS: разбор — чужой шаг с ошибкой раскрыт')
    assert.ok((await npane('contacts').textContent())?.includes('Сервер не пропустил'), 'no-JS: серверная ошибка у поля')
    assert.equal(await nojs.locator('summary[data-step-disclose="extra"]').isVisible(), true, 'no-JS: чистый шаг свёрнут в «Отобразить шаг N»')
    ok('no-JS: разбор после серверной ошибки')

    console.log(`✅ steps-browser: ${passed} проверок пройдено`)
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
