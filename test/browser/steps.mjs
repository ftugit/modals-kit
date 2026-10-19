/**
 * Браузерный тест демо шагов (/steps): панель режимов-ссылок (?demo=…) и
 * форм-режим «паразита».
 *   • панель: режимы и опции — ссылки, режим в адресе (?demo=…, своя бронь);
 *   • url: ссылки ведут на адрес, aria-current, deep-link (?ustep=…);
 *   • local: смена шага адрес не пишет;
 *   • hybrid: адрес синхронизируется своим ключом (?hstep=…) без навигации;
 *   • form: subset-шаги, свёрнутые поля в POST, разбор после серверной ошибки
 *     (в т.ч. по СКРЫТОМУ полю первого шага — email), no-JS.
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

/** Текущий шаг области: подпись с aria-current="step". */
const currentLabel = (scope) => scope.locator('[aria-current=step]').first().textContent()

async function run() {
  await waitPreview()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()

    await page.goto(BASE + '/steps', { waitUntil: 'networkidle' })
    const panel = page.getByTestId('demo-panel')
    const steps = page.getByTestId('demo-steps')

    // панель: выбор применяется СРАЗУ (после оживления кнопки «Применить» нет);
    // до оживления jsOnly-варианты выключены — видно по факту, без подсказок
    await panel.getByRole('button', { name: 'Применить' })
      .waitFor({ state: 'detached', timeout: 10000 })
      .catch(() => {})
    assert.equal(await panel.getByRole('button', { name: 'Применить' }).count(), 0,
      'панель: после оживления «Применить» не нужна')
    assert.equal(await panel.locator('option[value="hybrid"]').isDisabled(), false,
      'панель: после оживления hybrid доступен')
    assert.equal((await panel.locator('option[value="hybrid"]').textContent())?.includes('JavaScript'), false,
      'панель: без подсказок «Нужен JavaScript» в вариантах')
    await panel.getByRole('combobox').selectOption('local')
    await page.waitForURL(/demo=local/)
    assert.ok(!new URL(page.url()).searchParams.get('ustep'), 'панель: смена режима — чистый адрес')
    ok('панель: select применяется сразу, режим в адресе (?demo=local)')

    // 1. url-режим: deep-link ?ustep=confirm
    await page.goto(BASE + '/steps?ustep=confirm', { waitUntil: 'networkidle' })
    assert.equal((await currentLabel(steps))?.trim(), 'Подтверждение', 'url: deep-link открыл подтверждение')
    ok('url: deep-link ?ustep=confirm')
    await steps.getByRole('link', { name: 'Готово' }).click()
    await page.waitForURL(/ustep=done/)
    assert.equal((await currentLabel(steps))?.trim(), 'Готово', 'url: ссылка сменила шаг')
    ok('url: ссылка ведёт на адрес, шаг сменился')

    // 2. local: клик по навигации НЕ меняет адрес
    const addressBefore = page.url()
    await panel.getByRole('combobox').selectOption('local')
    await page.waitForURL(/demo=local/)
    const addressLocal = page.url()
    await steps.getByRole('link', { name: 'Подтверждение' }).click()
    await page.waitForTimeout(400)
    assert.equal((await currentLabel(steps))?.trim(), 'Подтверждение', 'local: шаг сменился локально')
    assert.equal(page.url(), addressLocal, 'local: адрес не тронут')
    ok('local: смена без адреса')

    // 3. hybrid: локальная смена + адрес своим ключом (?hstep=…)
    await panel.getByRole('combobox').selectOption('hybrid')
    await page.waitForURL(/demo=hybrid/)
    await steps.getByRole('link', { name: 'Состав' }).click()
    await page.waitForTimeout(400)
    assert.equal((await currentLabel(steps))?.trim(), 'Состав', 'hybrid: шаг сменился локально')
    assert.ok(new URL(page.url()).searchParams.get('hstep') === 'compose', 'hybrid: адрес получил hstep=compose')
    ok('hybrid: локальная смена + адрес своим ключом')
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal((await currentLabel(steps))?.trim(), 'Состав', 'hybrid: обновление держит шаг')
    ok('обновление страницы: hybrid держит шаг')

    // 4. form: шаги поверх одной формы (паразит formSteps)
    await panel.getByRole('combobox').selectOption('form')
    await page.waitForURL(/demo=form/)
    const form = page.getByTestId('demo-form')
    const pane = (key) => form.locator(`[data-step="${key}"]`)

    // поля ВСЕХ шагов в DOM (свёрнутые едут в POST), виден только текущий;
    // ДО серверной ошибки другой шаг недоступен вовсе: нет кнопок «Отобразить шаг N»
    assert.equal(await pane('contacts').count(), 1, 'form: шаг «Контакты» в DOM')
    assert.equal(await pane('extra').count(), 1, 'form: шаг «Примечание» в DOM')
    assert.equal(await pane('extra').isHidden(), true, 'form: соседний шаг скрыт (CSS)')
    assert.equal(await form.locator('summary').count(), 0, 'form: до ошибки нет «Отобразить шаг N»')
    ok('form: все шаги в DOM, виден только текущий, соседний недоступен')

    // шаговый провал: subset ловит пустые поля СВОЕГО шага, шаг не меняется
    await form.getByRole('button', { name: 'Далее' }).click()
    await page.waitForTimeout(400)
    assert.equal(await pane('contacts').isVisible(), true, 'form: пустой шаг не пропустило')
    assert.ok((await pane('contacts').textContent())?.includes('Обязательное'), 'form: ошибка subset у поля')
    ok('form: «Далее» проверяет только свой шаг')

    // успех шага: интенция уводит на следующий, адрес не тронут
    const addressBeforeForm = page.url()
    await pane('contacts').getByLabel('Имя').fill('Ада')
    // чужая электропочта: серверная-only норма поймает её на финальном «Сохранить»
    await pane('contacts').getByLabel('Электропочта').fill('bob@example.com')
    await form.getByRole('button', { name: 'Далее' }).click()
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

    // РАЗБОР ПО СКРЫТОМУ ПОЛЮ: серверная-only норма email (шаг 1). Шаг «Контакты»
    // свёрнут, но его значение в POST — сервер ругается на email, разбор
    // раскрывает первый шаг и показывает ошибку у поля.
    await pane('extra').getByLabel('Примечание').fill('заметка')
    await form.getByRole('button', { name: 'Сохранить' }).click()
    await page.waitForTimeout(700)
    assert.ok(posts.some((b) => b.includes('name="name"') && b.includes('name="email"') && b.includes('name="note"')),
      'разбор: в POST значения и видимых, и свёрнутых шагов')
    assert.equal(await pane('contacts').isVisible(), true, 'разбор: скрытый шаг с ошибкой email раскрыт')
    assert.ok((await pane('contacts').textContent())?.includes('Сервер принимает только test@test.local'),
      'разбор: серверная ошибка у email (поля первого шага)')
    assert.equal(await pane('contacts').getByLabel('Электропочта').isVisible(), true,
      'разбор: поле email (было скрыто) видно')
    // открыты ТОЛЬКО ошибочные: чистый финальный шаг свёрнут в «Отобразить шаг 2»
    assert.equal(await pane('extra').isHidden(), true, 'разбор: чистый шаг свёрнут сразу — не виден')
    const discloseExtra = form.locator('summary[data-step-disclose="extra"]')
    assert.equal(await discloseExtra.isVisible(), true, 'разбор: чистый шаг свёрнут в «Отобразить шаг 2»')
    assert.equal(await form.locator('summary[data-step-disclose="done"]').count(), 0,
      'form: третьего шага не существует')
    ok('разбор: открыты только ошибочные, чистый — за «Отобразить шаг 2»')

    // исправили email — разбор отпускает: показываемых ошибок нет, обычный вид:
    // снова ТОЛЬКО текущий шаг, никаких свёрток (решение владельца)
    await pane('contacts').getByLabel('Электропочта').fill('test@test.local')
    await page.waitForTimeout(400)
    assert.equal(await form.locator('summary').count(), 0, 'после исправления: свёрток нет — обычный вид')
    assert.equal(await pane('extra').isVisible(), true, 'после исправления: виден текущий шаг')
    ok('после исправления: разбор отпустил — снова только текущий шаг')

    // успех save: серверная норма соблюдена — форма НЕ пропадает, баннер как в /form
    await pane('extra').getByRole('button', { name: 'Сохранить' }).dispatchEvent('click')
    await page.waitForTimeout(600)
    assert.equal(await pane('extra').isVisible(), true, 'form: успех save — форма на месте (не пропала)')
    assert.ok((await form.textContent())?.includes('Готово. Исход:'), 'form: баннер успеха как в разделе «Формы»')
    ok('form: финал — баннер успеха над живой формой')

    // ── no-JS: панель-ссылки, форм-режим на нативных POST ──────────────────
    const nojs = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false })).newPage()
    const npane = (key) => nojs.locator(`[data-step="${key}"]`)
    await nojs.goto(BASE + '/steps?demo=form', { waitUntil: 'load' })
    await npane('contacts').getByLabel('Имя').fill('Ада')
    await npane('contacts').getByLabel('Электропочта').fill('bob@example.com')
    await nojs.getByTestId('demo-form').getByRole('button', { name: 'Далее' }).click()
    await nojs.waitForLoadState('load')
    assert.equal(await npane('extra').isVisible(), true, 'no-JS: успех шага открыл «Примечание»')
    assert.equal(await npane('contacts').isHidden(), true, 'no-JS: прошлый шаг свёрнут')
    assert.equal(await npane('contacts').count(), 1, 'no-JS: свёрнутый шаг в DOM')
    ok('no-JS: переход шага нативным POST')

    // no-JS финал через разбор: save с чужой почтой → разбор раскрывает шаг 1 →
    // исправили на test@test.local → «Далее» → «Сохранить» → «Готово» (тот же
    // итог, что у JS: финальный текст и шаг «Готово»)
    await npane('extra').getByLabel('Примечание').fill('заметка')
    await nojs.getByTestId('demo-form').getByRole('button', { name: 'Сохранить' }).click()
    await nojs.waitForLoadState('load')
    assert.equal(await npane('contacts').isVisible(), true, 'no-JS: разбор — скрытый шаг с ошибкой email раскрыт')
    assert.ok((await npane('contacts').textContent())?.includes('Сервер принимает только test@test.local'),
      'no-JS: серверная ошибка у email')
    assert.equal(await nojs.locator('summary[data-step-disclose="extra"]').isVisible(), true,
      'no-JS: чистый шаг свёрнут в «Отобразить шаг 2», ошибочный раскрыт')
    ok('no-JS: разбор по скрытому полю')
    // шаг 1 закреплён разбором (pinned) — уже раскрыт, правим прямо в нём
    await npane('contacts').getByLabel('Электропочта').fill('test@test.local')
    await nojs.getByTestId('demo-form').getByRole('button', { name: 'Далее' }).click()
    await nojs.waitForLoadState('load')
    assert.equal(await npane('extra').isVisible(), true, 'no-JS: после исправления разбор отпустил')
    await nojs.getByTestId('demo-form').getByRole('button', { name: 'Сохранить' }).click()
    await nojs.waitForLoadState('load')
    assert.equal(await npane('extra').isVisible(), true, 'no-JS: финал — форма на месте (не пропала)')
    assert.ok((await nojs.getByTestId('demo-form').textContent())?.includes('Готово. Исход:'),
      'no-JS: баннер успеха равен JS-каналу')
    ok('no-JS: финал — баннер равен JS-каналу')

    console.log(`✅ steps-browser: ${passed} проверок пройдено`)
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
