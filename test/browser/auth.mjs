/**
 * Браузер-тесты пользовательской системы (ход 258 — отчёт владельца о сломанном
 * no-JS и «кривой» проводке формы):
 *   • «Создать аккаунт» — ссылка: с JS локальная подмена шага, без JS переход
 *     на `?step=register` (seed делает сервер) — раньше была мёртвая кнопка;
 *   • пустой/мусорный seed — ошибки поля ВИДНЫ (required + pattern движка;
 *     раньше шаг отходил серверу и ошибка тонула в скрытом signature);
 *   • без JS пустая/мусорная отправка блокируется нативно (required/pattern);
 *   • после регистрации поле входа пустое (раньше носило seed в себе);
 *   • успех (регистрация и вход) уводит со страницы — раньше finish молчал;
 *   • HoldButton: до заполнения клик ничего не делает (заблокирована),
 *     заливка идёт от наведения курсора (опция hover, решение владельца);
 *   • полный цикл без JS: регистрация (seed сервера) → профиль → вход.
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
      if ((await fetch(BASE + '/user/auth')).ok) return
    } catch {}
    await sleep(500)
  }
  throw new Error(`сервер не отвечает: ${BASE}`)
}

async function run() {
  await waitPreview()
  const browser = await chromium.launch({ headless: true })
  try {
    console.log('— с JS: шаги, валидация, выход после успеха —')
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      const form = page.locator('#user-auth')

      // 1. «Создать аккаунт» — ссылка с адресом шага (не мёртвая кнопка)
      const create = form.getByRole('link', { name: 'Создать аккаунт' })
      assert.equal(await create.count(), 1, '«Создать аккаунт» — ссылка')
      assert.ok((await create.getAttribute('href')).includes('step=register'), 'адрес шага в href')
      ok('создание аккаунта — ссылка с ?step=register')

      // 2. Клик (JS): локальная подмена — адрес не менялся, шаг регистрационный
      await create.click()
      await page.waitForSelector('input[name=seed][readonly]')
      const seed = await page.inputValue('input[name=seed]')
      assert.ok(seed.length >= 43 && seed.length <= 44, 'seed 43–44')
      assert.equal(await form.getByRole('button', { name: 'Копировать seed' }).count(), 1, 'иконка копирования')
      ok('шаг регистрации: seed показан, иконка копирования на месте')

      // 3. Обратно на вход: поле ПУСТОЕ (seed не перетаскивается)
      await form.getByRole('link', { name: 'Авторизация' }).click()
      await page.waitForSelector('input[name=seed]:not([readonly])')
      assert.equal(await page.inputValue('input[name=seed]'), '', 'поле входа пустое')
      ok('возврат на вход: поле чистое')

      // 4. Пустой seed — видимая ошибка обязательности (движок формы)
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      const seedError = form.locator('[data-field=seed] p[role=alert]')
      await seedError.waitFor({ state: 'visible', timeout: 5000 })
      const emptyText = await seedError.textContent()
      assert.ok((emptyText ?? '').length > 3, 'текст ошибки пустого поля виден')
      ok(`пустой seed: ошибка видна («${(emptyText ?? '').trim()}»)`)

      // 5. Набор символов вне base64url — видимая ошибка формата
      await page.fill('input[name=seed]', 'я'.repeat(44))
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForTimeout(400)
      const garbage = await seedError.textContent()
      assert.ok(/не seed/.test(garbage ?? ''), 'ошибка формата видна')
      ok(`мусорный seed: ошибка видна («${(garbage ?? '').trim()}»)`)

      // 6. Регистрация: кнопка заблокирована до заполнения, заливка — от курсора
      await form.getByRole('link', { name: 'Создать аккаунт' }).click()
      await page.waitForSelector('input[name=seed][readonly]')
      const fresh = await page.inputValue('input[name=seed]')
      const hold = form.locator('button[type=submit]:has-text("Удерживайте")')
      // обычный клик по заблокированной не отправляет форму
      await hold.click({ force: true })
      await page.waitForTimeout(600)
      assert.equal(await form.locator('input[name=nickname]').count(), 0, 'клик до заполнения не выполняет')
      ok('HoldButton до заполнения: клик не срабатывает')
      // курсор на кнопке — заливка идёт сама (hover) и выполняет
      // (после клика курсор уже там — сначала уводим, чтобы pointerenter случился;
      // под нагрузкой rAF/enter может не дойти — наводим заново)
      let profileOpen = false
      for (let i = 0; i < 3 && !profileOpen; i++) {
        await page.mouse.move(240, 40)
        await hold.hover()
        try {
          await form.locator('input[name=nickname]').waitFor({ state: 'visible', timeout: 8000 })
          profileOpen = true
        } catch {
          /* заливка не доехала — попытка заново */
        }
      }
      assert.ok(profileOpen, 'hover-заливка открыла шаг профиля')
      ok('HoldButton hover: заливка от курсора, шаг профиля открыт')

      // 7. Профиль → успех уводит со страницы (finish не молчит)
      await page.fill('input[name=nickname]', 'e2e-ход-258')
      await form.getByRole('button', { name: 'Сохранить' }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
      ok('регистрация (JS): профиль сохранён, страница закрылась переходом')

      // 8. Выход
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      await form.getByRole('button', { name: 'Выйти из аккаунта' }).click()
      await page.waitForSelector('input[name=seed]:not([readonly])')
      ok('выход: снова шаг входа')

      // 9. Вход тем же seed — успех уводит со страницы
      await page.fill('input[name=seed]', fresh)
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
      ok('вход (JS): корректный seed проходит, страница закрылась переходом')
      await page.close()
    }

    console.log('— без JS: регистрация и вход работают —')
    {
      const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 860 } })
      const page = await ctx.newPage()

      // 10. Ссылка шага работает нативно
      await page.goto(BASE + '/user/auth', { waitUntil: 'load' })
      const form = page.locator('#user-auth')
      assert.equal(await form.getByRole('button', { name: 'Создать аккаунт' }).count(), 0, 'мёртвой кнопки нет')
      await form.getByRole('link', { name: 'Создать аккаунт' }).click()
      await page.waitForURL(/step=register/)
      await page.waitForSelector('input[name=seed][readonly]')
      ok('без JS: ссылка ведёт на шаг регистрации (seed ниже, в п.12)')

      // 11. Пустая и мусорная отправки блокируются нативно (required/pattern):
      // на шаге ВХОДА поле редактируемое — проверяем именно нативный заслон
      await page.goto(BASE + '/user/auth', { waitUntil: 'load' })
      assert.equal(await page.getAttribute('input[name=seed]', 'required'), '', 'required-атрибут')
      assert.ok((await page.getAttribute('input[name=seed]', 'pattern'))?.length > 5, 'pattern-атрибут')
      const here = BASE + '/user/auth'
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForTimeout(800)
      assert.equal(page.url(), here, 'пустая отправка не уехала (required)')
      await page.fill('input[name=seed]', 'я'.repeat(44))
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForTimeout(800)
      assert.equal(page.url(), here, 'мусорная отправка не уехала (pattern)')
      ok('без JS: required/pattern блокируют пустое и мусорное нативно')

      // 12. Полный цикл без JS: создать → профиль → домой (readonly-поле с
      // серверным seed уходит в отправку; readonly не проверяется нативно)
      await form.getByRole('link', { name: 'Создать аккаунт' }).click()
      await page.waitForURL(/step=register/)
      await page.waitForSelector('input[name=seed][readonly]')
      const seed = await page.inputValue('input[name=seed]')
      assert.ok(seed.length >= 43 && seed.length <= 44, 'серверный seed 43–44')
      await form.getByRole('button', { name: 'Создать аккаунт' }).click()
      await page.waitForURL(/step=profile/, { timeout: 15000 })
      await page.fill('input[name=nickname]', 'e2e-nojs-258')
      await form.getByRole('button', { name: 'Сохранить' }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth') && !u.search.includes('step'), { timeout: 15000 })
      ok('без JS: регистрация + профиль прошли (редиректы экшена)')

      // 13. Вход без JS тем же seed (доказательство = знание секрета)
      await page.goto(BASE + '/user/auth', { waitUntil: 'load' })
      await page.fill('input[name=seed]', seed)
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth') && !u.search.includes('step'), { timeout: 15000 })
      ok('без JS: вход корректным seed проходит')
      await page.close()
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  console.log(`✅ auth-browser: ${passed} проверок пройдено`)
}

run().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
