/**
 * Браузер-тесты пользовательской системы (ход 261 — решения владельца; база — 258):
 *   • «Создать аккаунт» — ссылка: шаг живёт в адресе на ОБЕИХ сторонах
 *     (?stage=auth.register, seed делает сервер при fallback-загрузке);
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
      const ctxJs = await browser.newContext({
        viewport: { width: 1280, height: 860 },
        permissions: ['clipboard-read', 'clipboard-write'],
      })
      const page = await ctxJs.newPage()
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      const form = page.locator('#user-auth')

      // 1. «Создать аккаунт» — ссылка с адресом шага (не мёртвая кнопка)
      const create = form.getByRole('link', { name: 'Создать аккаунт' })
      assert.equal(await create.count(), 1, '«Создать аккаунт» — ссылка')
      assert.match(await create.getAttribute('href'), /stage=(auth\.)?register/, 'адрес шага в href')
      ok('создание аккаунта — ссылка с адресом шага')

      // 1а. В МОДАЛКЕ смена шага — локальная (репорт владельца, ход 261):
      // адрес не уезжает на роут, модалка жива, seed делает браузер
      await page.goto(BASE + '/?modal=user.auth', { waitUntil: 'networkidle' })
      const dlg = page.locator('[role=dialog]')
      await dlg.waitFor({ state: 'visible' })
      await dlg.getByRole('link', { name: 'Создать аккаунт' }).click()
      await page.waitForTimeout(800)
      assert.ok(page.url().includes('modal=user.auth'), 'модалка: адрес не уехал на роут')
      assert.equal(await dlg.isVisible(), true, 'модалка: жива после смены шага')
      const seedModal = await dlg.locator('input[name=seed]').inputValue()
      assert.ok(seedModal.length >= 43, 'модалка: seed на месте')
      assert.ok((await dlg.textContent()).includes('в этом браузере'), 'модалка: текст «ключ сделал браузер»')
      ok('модалка: смена шага локальна, seed браузера, модалка жива')
      await page.keyboard.press('Escape')
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })

      // 2. Клик (JS): шаг через адрес (навигация), seed генерирует сервер
      await create.click()
      await page.waitForURL(/stage=(auth\.)?register/)
      await page.waitForFunction(() => {
        const el = document.querySelector('input[name=seed]')
        return el && el.value.length >= 43
      })
      const seed = await page.inputValue('input[name=seed]')
      assert.ok(seed.length >= 43 && seed.length <= 44, 'seed 43–44')
      const copyBtn = form.getByRole('button', { name: 'Копировать', exact: true })
      assert.equal(await copyBtn.count(), 1, 'иконка копирования')
      await page.evaluate(() => navigator.clipboard.writeText('старое значение'))
      await copyBtn.click()
      const inClipboard = await page.evaluate(() => navigator.clipboard.readText())
      assert.equal(inClipboard, seed, 'в буфере — seed из поля')
      ok('шаг регистрации: seed сервера показан, иконка копирует значение в буфер')

      // 2а. Иконка копирования (решение владельца): за кликом из п.2 — «Скопировано»
      // и не нажимаемость 5 с, затем возврат к «Копировать» (один клик — одна волна
      // состояний; кликать снова в окне возврата — гоняться с таймером)
      // состояние читаем по селектору, а не по роли-имени: у кнопки в состоянии
      // «Скопировано» другое имя, и локатор по «Копировать» ждал бы её возврата
      const copyState = page.locator('[data-copy-input] button')
      await page.waitForFunction(
        () => document.querySelector('[data-copy-input] button')?.getAttribute('aria-label') === 'Скопировано',
        { timeout: 5000 },
      )
      assert.equal(await copyState.getAttribute('aria-label'), 'Скопировано', 'иконка выполнено')
      assert.equal(await copyState.isDisabled(), true, 'кнопка не нажимается после успеха')
      await page.waitForFunction(
        () => document.querySelector('[data-copy-input] button')?.getAttribute('aria-label') === 'Копировать',
        { timeout: 8000 },
      )
      assert.equal(await copyState.isDisabled(), false, 'кнопка вернулась')
      ok('иконка копирования: «Скопировано» 5 с, затем возврат')

      // 3. Обратно на вход: поле ПУСТОЕ (seed шага регистрации не перетаскивается)
      await form.getByRole('link', { name: 'Авторизация' }).click()
      await page.waitForURL((u) => !/stage=(auth\.)?register/.test(u.search))
      await page.waitForFunction(() => document.querySelector('input[name=seed]')?.value === '')
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
      await page.waitForURL(/stage=(auth\.)?register/)
      await page.waitForFunction(() => document.querySelector('input[name=seed]')?.value.length >= 43)
      const fresh = await page.inputValue('input[name=seed]')
      const hold = form.locator('button[type=submit]:has-text("Удерживайте")')
      // обычный клик по заблокированной не отправляет форму
      await hold.click({ force: true })
      await page.waitForTimeout(600)
      assert.equal(await form.locator('input[name=nickname]').count(), 0, 'клик до заполнения не выполняет')
      ok('HoldButton до заполнения: клик не срабатывает')
      // заливка от курсора измеряется напрямую: scaleX растёт под курсором
      // и сбрасывается уходом (опция hover); force — форма при busy перехватывает
      const fillOf = async () => {
        const style = (await hold.locator('span').first().getAttribute('style')) ?? ''
        return Number(/scaleX\(([\d.]+)\)/.exec(style)?.[1] ?? '0')
      }
      await hold.hover({ force: true })
      await page.waitForTimeout(700)
      const t1 = await fillOf()
      assert.ok(t1 > 0.05, `заливка от курсора идёт (scaleX=${t1})`)
      await page.mouse.move(240, 40)
      await page.waitForTimeout(300)
      assert.equal(await fillOf(), 0, 'уход курсора сбрасывает заливку')
      ok(`HoldButton hover: заливка от курсора идёт (scaleX=${t1.toFixed(2)}) и сбрасывается`)
      // выполнение — удержанием клавиши (тот же perform, что у заливки до конца)
      await hold.focus()
      await page.keyboard.down(' ')
      await page.waitForTimeout(2600)
      await page.keyboard.up(' ')
      // Профиль живёт ОТДЕЛЬНОЙ формой (`#user-profile`): с декомпозиции
      // AuthWidget ник и аватар — своя форма со своим конвертом.
      const profile = page.locator('#user-profile')
      await profile.locator('input[name=nickname]').waitFor({ state: 'visible', timeout: 15000 })
      ok('HoldButton удержание: шаг профиля открыт')

      // 6а. Фото-поле: файл проходит через lib/image и кладёт готовый результат
      // в скрытый носитель `avatar`; ошибки поля видны у самого поля.
      const JPEG_1X1 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
      await profile.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(JPEG_1X1, 'base64') })
      await page.waitForFunction(() => (document.querySelector('#user-profile input[name=avatar]')?.value ?? '').length > 0, undefined, { timeout: 20000 })
      ok('фото: честный JPEG прошёл подготовку и лёг в носитель')
      // Подмена носителя на не-картинку: ошибка обязана быть ВИДНА у поля.
      await page.evaluate(() => {
        document.querySelector('#user-profile input[name=avatar]').value = 'data:image/jpeg;base64,' + 'A'.repeat(28_000)
      })
      await profile.getByRole('button', { name: 'Сохранить' }).click()
      const avatarError = profile.locator('[data-field=avatar] p[role=alert]')
      await avatarError.waitFor({ state: 'visible', timeout: 10000 })
      assert.ok((await avatarError.textContent()).length > 3, 'текст ошибки аватара')
      ok('перегруженный/битый аватар: ошибка видна у формы')

      // 7. Профиль → успех уводит со страницы (finish не молчит). Аватар чистим:
      // после 6а в носителе — мусор (аватар необязателен).
      await profile.locator('input[name=nickname]').fill('e2e-ход-258')
      await page.evaluate(() => {
        document.querySelector('#user-profile input[name=avatar]').value = ''
      })
      // blur ДО клика: mousedown снял бы фокус с поля — рендер touched пересоздал
      // бы кнопку между mousedown и mouseup, и click не родился бы
      await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur())
      await profile.getByRole('button', { name: 'Сохранить' }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
      ok('регистрация (JS): профиль сохранён, страница закрылась переходом')

      // 8. Выход
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      const nonceBefore = await page.inputValue('input[name=nonce]')
      await form.getByRole('button', { name: 'Выйти из аккаунта' }).click()
      await form.getByRole('link', { name: 'Создать аккаунт' }).waitFor({ state: 'visible' })
      ok('выход: снова шаг входа')

      // 9. Вход тем же seed — успех уводит со страницы. Выход тратит challenge:
      // виджет сам запрашивает свежий nonce — ждём его перед входом
      await page.waitForFunction(
        (old) => { const v = document.querySelector('input[name=nonce]')?.value; return v !== '' && v !== old },
        nonceBefore,
        { timeout: 15000 },
      )
      await page.fill('input[name=seed]', fresh)
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
      ok('вход (JS): корректный seed проходит, страница закрылась переходом')

      // 9а. Меню шапки (ход 261, репорт «после входа в шапке ничего нет»):
      // аватар виден, клик открывает меню с выходом; выход со страницы меню работает
      await page.goto(BASE + '/', { waitUntil: 'networkidle' })
      const userBtn = page.locator('[data-testid=header-user]')
      await userBtn.waitFor({ state: 'visible' })
      ok('после входа: в шапке аватар (не пустое место)')
      await userBtn.click()
      await page.getByRole('button', { name: 'Выйти', exact: true }).waitFor({ state: 'visible', timeout: 5000 })
      ok('клик аватара открывает меню с выходом')
      await page.keyboard.press('Escape')
      await page.goto(BASE + '/user/menu', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Выйти', exact: true }).click()
      await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
      ok('страница /user/menu: выход уводит на главную')
      await ctxJs.close()
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
      await page.waitForURL(/stage=(auth\.)?register/)
      // readonly у seed больше нет (решение владельца: шаг живёт в адресе, seed
      // всегда серверный) — проверяем сам факт: поле в HTML со значением сервера
      await page.waitForSelector('input[name=seed]')
      assert.ok((await page.inputValue('input[name=seed]')).length >= 43, 'seed сервера в HTML')
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
      await page.waitForURL(/stage=(auth\.)?register/)
      await page.waitForFunction(() => document.querySelector('input[name=seed]')?.value.length >= 43)
      const seed = await page.inputValue('input[name=seed]')
      assert.ok(seed.length >= 43 && seed.length <= 44, 'серверный seed 43–44')
      await form.getByRole('button', { name: 'Создать аккаунт' }).click()
      await page.waitForURL((u) => u.pathname === '/user/profile', { timeout: 15000 })
      // профиль — самостоятельный роут /user/profile со своей формой
      const profile = page.locator('#user-profile')
      await profile.locator('input[name=nickname]').fill('e2e-nojs-258')
      await profile.getByRole('button', { name: 'Сохранить' }).click()
      await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
      ok('без JS: регистрация + профиль прошли (редиректы экшена)')

      // 13. Вход без JS тем же seed (доказательство = знание секрета)
      await page.goto(BASE + '/user/auth', { waitUntil: 'load' })
      await page.fill('input[name=seed]', seed)
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth') && !u.search.includes('stage'), { timeout: 15000 })
      ok('без JS: вход корректным seed проходит')

      // 14. Меню без JS: аватар-ссылка ведёт на страницу меню, выход — формой
      await page.goto(BASE + '/', { waitUntil: 'load' })
      assert.equal(await page.locator('[data-testid=header-user]').count(), 1, 'аватар в шапке')
      assert.equal(await page.locator('[data-testid=header-user]').getAttribute('href'), '/user/menu', 'ссылка меню без JS')
      await page.goto(BASE + '/user/menu', { waitUntil: 'load' })
      assert.ok((await page.locator('span').filter({ hasText: 'e2e-nojs-258' }).count()) > 0, 'ник на странице меню')
      await page.getByRole('button', { name: 'Выйти', exact: true }).click()
      await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
      assert.equal(await page.locator('[data-testid=header-auth]').count(), 1, 'после выхода — «Авторизация»')
      ok('без JS: страница меню с выходом работает')
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
