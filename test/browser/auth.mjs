/**
 * Браузер-тесты пользовательской системы (ход 261 + рефакторинг Acl / SeedForm / бинарного File аватара):
 *   • «Создать аккаунт» — ссылка: шаг живёт в адресе на ОБЕИХ сторонах
 *     (?stage=auth.register, seed делает сервер при fallback-загрузке);
 *   • пустой/мусорный seed — ошибки поля ВИДНЫ (required + pattern движка);
 *   • без JS пустая/мусорная отправка блокируется нативно (required/pattern);
 *   • после регистрации поле входа пустое;
 *   • успех (регистрация и вход) уводит со страницы;
 *   • HoldButton: до заполнения клик ничего не делает, заливка от курсора;
 *   • фото-поле: бинарный File сжимается через lib/image в `avatar.jpg` + компактный
 *     `FileAttachment`, мусорный файл отвергается с ошибкой у поля, никаких base64-строк;
 *   • Acl: авторизованный на `/user/auth` видит `guest_only`, гость на `/user/menu` — `auth_required`;
 *   • полный цикл без JS: регистрация → 422 в ответе POST → бинарный File аватара (`decodeWithNode`) → вход.
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

const JPEG_1X1 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

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
  let readyAvatar200 = null
  try {
    console.log('— с JS: шаги, валидация, бинарный File аватара, Acl и выход —')
    {
      const ctxJs = await browser.newContext({
        viewport: { width: 1280, height: 860 },
        permissions: ['clipboard-read', 'clipboard-write'],
      })
      const page = await ctxJs.newPage()
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      const form = page.locator('#user-auth')

      // Вход выключен без `AUTH_SEAL_SECRET` (ACL-экран `auth_disabled`): проверять
      // шаги нечего, а провал «0 ссылок» выглядел как поломка формы. Пропуск
      // называется своим именем и говорит, что задать.
      if (!(await form.count())) {
        console.log('  SKIP auth: на сервере не задан AUTH_SEAL_SECRET — /user/auth отдаёт экран «Вход выключен»')
        return
      }

      // 1. «Создать аккаунт» — ссылка с адресом шага (не мёртвая кнопка)
      const create = form.getByRole('link', { name: 'Создать аккаунт' })
      assert.equal(await create.count(), 1, '«Создать аккаунт» — ссылка')
      assert.match(await create.getAttribute('href'), /stage=(auth\.)?register/, 'адрес шага в href')
      ok('создание аккаунта — ссылка с адресом шага')

      // 1а. В МОДАЛКЕ смена шага — локальная: адрес не уезжает на роут, модалка жива, seed делает браузер
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

      // 2а. Иконка копирования: «Скопировано» и ненажимаемость 5 с, затем возврат
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

      // 3. Обратно на вход: поле ПУСТОЕ
      await form.getByRole('link', { name: 'Авторизация' }).click()
      await page.waitForURL((u) => !/stage=(auth\.)?register/.test(u.search))
      await page.waitForFunction(() => document.querySelector('input[name=seed]')?.value === '')
      assert.equal(await page.inputValue('input[name=seed]'), '', 'поле входа пустое')
      ok('возврат на вход: поле чистое')

      // 4. Пустой seed — видимая ошибка обязательности
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
      await hold.click({ force: true })
      await page.waitForTimeout(600)
      assert.equal(await form.locator('input[name=nickname]').count(), 0, 'клик до заполнения не выполняет')
      ok('HoldButton до заполнения: клик не срабатывает')
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
      await hold.focus()
      await page.keyboard.down(' ')
      await page.waitForTimeout(2600)
      await page.keyboard.up(' ')
      const profile = page.locator('#user-profile')
      await profile.locator('input[name=nickname]').waitFor({ state: 'visible', timeout: 15000 })
      ok('HoldButton удержание: шаг профиля открыт')

      // 6а. Фото-поле (`photo`): не-картинка даёт ошибку у поля, честный кадр
      //     сжимается через lib/image и сохраняется в `/api/storage/avatars/...`
      const fileInput = profile.locator('input[type=file][name=photo]')
      await fileInput.setInputFiles({
        name: 'evil.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      })
      await fileInput.evaluate((el) => el.blur())
      const avatarError = profile.locator('[data-field=photo] p[role=alert]')
      await avatarError.waitFor({ state: 'visible', timeout: 10000 })
      assert.ok((await avatarError.textContent()).length > 3, 'текст ошибки фото')
      ok('битый аватар: ошибка видна у поля photo')

      await fileInput.setInputFiles({
        name: 'a.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(JPEG_1X1, 'base64'),
      })
      await profile.locator('[data-field=photo] [data-slot=attachment] img').waitFor({
        state: 'visible',
        timeout: 20000,
      })
      const convertedBytes = await fileInput.evaluate(async (el) => {
        const f = el.files?.[0]
        if (!f) return null
        return Array.from(new Uint8Array(await f.arrayBuffer()))
      })
      assert.ok(convertedBytes && convertedBytes.length > 100, 'сконвертированный 200x200 JPEG получен')
      readyAvatar200 = Buffer.from(convertedBytes)
      ok('фото: честный JPEG сжат через lib/image (200x200) и показан в FileAttachment')

      // 7. Профиль → успех сохраняет ник и аватар в боевое хранилище (/api/storage/avatars/...)
      await profile.locator('input[name=nickname]').fill('e2e-ход-258')
      await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur())
      await profile.getByRole('button', { name: 'Сохранить' }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
      assert.equal(await page.locator('[data-testid=header-user] img').count(), 1, 'сохранённый аватар в шапке')
      const savedAvatarSrc = await page.locator('[data-testid=header-user] img').getAttribute('src')
      assert.match(savedAvatarSrc ?? '', /^\/api\/storage\/avatars\//, 'аватар лежит по неизменяемому URL хранилища, а не data:')
      const avatarRes = await fetch(BASE + savedAvatarSrc)
      assert.equal(avatarRes.status, 200, 'раздача /api/storage/avatars/... отдаёт 200')
      assert.match(avatarRes.headers.get('cache-control') ?? '', /immutable/, 'Cache-Control содержит immutable')
      assert.match(avatarRes.headers.get('etag') ?? '', /^"[^"]+"$/, 'сильный ETag без W/')
      ok('регистрация (JS): профиль и аватар в /api/storage/avatars/... сохранены, раздача 200 + immutable + strong ETag')

      // 8. Acl allow="guest": повторный заход авторизованным на /user/auth показывает guest_only
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      assert.equal(await page.locator('#user-auth').count(), 0, 'форма скрыта для авторизованного')
      assert.equal(await page.locator('[data-acl-code="guest_only"]').count(), 1, 'экран Acl guest_only')
      ok('Acl на /user/auth: авторизованному показан экран guest_only')

      // Выход через меню и возврат на шаг входа
      await page.goto(BASE + '/user/menu', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Выйти', exact: true }).click()
      await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      await form.getByRole('link', { name: 'Создать аккаунт' }).waitFor({ state: 'visible' })
      ok('выход через меню: /user/auth снова открывает шаг входа')

      // 9. Вход тем же seed — успех уводит со страницы
      await page.fill('input[name=seed]', fresh)
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })
      ok('вход (JS): корректный seed проходит, страница закрылась переходом')

      // 9а. Меню шапки на широкой ширине: аватар открывает ВСПЛЫВАШКУ (не модалку,
      //     адрес не меняется), «Изменить профиль» — модалку профиля поверх,
      //     смена ника сразу живёт в RAM, а «Выйти» мгновенно обновляет шапку
      await page.goto(BASE + '/', { waitUntil: 'networkidle' })
      const userBtn = page.locator('[data-testid=header-user]')
      await userBtn.waitFor({ state: 'visible' })
      ok('после входа: в шапке аватар (не пустое место)')
      await userBtn.click()
      const popover = page.locator('[data-user-menu-popover]')
      await popover.getByRole('button', { name: 'Выйти', exact: true }).waitFor({ state: 'visible', timeout: 5000 })
      assert.ok(!page.url().includes('modal='), 'всплывашка меню не трогает адрес')
      assert.equal(await page.locator('[data-modal-popup]').count(), 0, 'модалка меню на десктопе не открывается')
      ok('клик аватара открывает всплывашку меню (без URL и без модалки)')

      // Переход в «Изменить профиль» из всплывашки: она закрывается, профиль — модалка
      await popover.getByRole('link', { name: 'Изменить профиль' }).click()
      const modalProfile = page.locator('#user-profile')
      await modalProfile.locator('input[name=nickname]').waitFor({ state: 'visible', timeout: 5000 })
      assert.equal(await popover.count(), 0, 'всплывашка закрылась при открытии профиля')
      assert.equal(await page.locator('[data-acl-code="guest_only"]').count(), 0, 'нет ложного экрана guest_only')
      assert.equal(await modalProfile.locator('input[name=nickname]').inputValue(), 'e2e-ход-258', 'живой ник подставлен')
      ok('«Изменить профиль» во всплывашке открывает форму профиля с живым ником (без guest_only)')

      // Сохраняем новый ник в модалке профиля: она закрывается, а заново открытая
      // всплывашка мгновенно светит обновлённый ник из RAM без перезагрузки!
      await modalProfile.locator('input[name=nickname]').fill('e2e-ram-nick')
      await modalProfile.getByRole('button', { name: 'Сохранить' }).click()
      await page.locator('[data-modal-popup]').waitFor({ state: 'detached', timeout: 10000 })
      await userBtn.click()
      await popover.getByRole('button', { name: 'Выйти', exact: true }).waitFor({ state: 'visible', timeout: 5000 })
      assert.ok((await popover.textContent()).includes('e2e-ram-nick'), 'обновлённый ник сразу виден во всплывашке RAM')

      // Выходим прямо из всплывашки и проверяем мгновенную смену шапки на гостя
      await popover.getByRole('button', { name: 'Выйти', exact: true }).click()
      await page.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 10000 })
      assert.equal(await page.locator('[data-testid=header-user]').count(), 0, 'кнопка аватара сразу скрыта без reload')
      ok('выход из модального меню мгновенно переключает шапку в гостя без перезагрузки страницы')

      // Варианты оформления: plain внутри модалки, card на отдельных страницах /user/auth и /user/menu
      await page.goto(BASE + '/user/menu', { waitUntil: 'networkidle' })
      assert.equal(
        await page.locator('[data-acl-code="auth_required"]').getAttribute('data-acl-variant'),
        'card',
        'на странице /user/menu экран Acl рендерится с variant="card"',
      )
      await page.goto(BASE + '/?modal=user.menu', { waitUntil: 'networkidle' })
      assert.equal(
        await page.locator('[role=dialog] [data-acl-code="auth_required"]').getAttribute('data-acl-variant'),
        'plain',
        'в модалке ?modal=user.menu экран Acl рендерится с variant="plain"',
      )
      ok('Acl и AuthWidget прокидывают variant="card" на страницах и variant="plain" в модалках')
      await ctxJs.close()
    }

    console.log('— без JS: Acl, серверные POST-ошибки, decodeWithNode и вход —')
    {
      const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 860 } })
      const page = await ctx.newPage()

      // 10а. Гостю на /user/menu без JS рендерится экран Acl auth_required (без 303-редиректа)
      await page.goto(BASE + '/user/menu', { waitUntil: 'load' })
      assert.equal(page.url(), BASE + '/user/menu', 'гость остаётся на /user/menu без редиректа')
      assert.equal(await page.locator('[data-acl-code="auth_required"]').count(), 1, 'Acl auth_required')
      ok('без JS: гостю на /user/menu рендерится экран Acl auth_required')

      // 10. Ссылка шага работает нативно
      await page.goto(BASE + '/user/auth', { waitUntil: 'load' })
      const form = page.locator('#user-auth')
      assert.equal(await form.getByRole('button', { name: 'Создать аккаунт' }).count(), 0, 'мёртвой кнопки нет')
      await form.getByRole('link', { name: 'Создать аккаунт' }).click()
      await page.waitForURL(/stage=(auth\.)?register/)
      await page.waitForSelector('input[name=seed]')
      assert.ok((await page.inputValue('input[name=seed]')).length >= 43, 'seed сервера в HTML')
      ok('без JS: ссылка ведёт на шаг регистрации')

      // 11. Пустая и мусорная отправки блокируются нативно (required/pattern)
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

      // 12. Полный цикл без JS: создать → 422 в ответе POST → бинарный File аватара (decodeWithNode) → домой
      await form.getByRole('link', { name: 'Создать аккаунт' }).click()
      await page.waitForURL(/stage=(auth\.)?register/)
      const seed = await page.inputValue('input[name=seed]')
      assert.ok(seed.length >= 43 && seed.length <= 44, 'серверный seed 43–44')
      await form.getByRole('button', { name: 'Создать аккаунт' }).click()
      await page.waitForURL(/stage=(auth\.)?profile/, { timeout: 15000 })
      const profile = page.locator('#user-profile')

      // 12а. Запрещённый ник в no-JS возвращает 422 прямо в ответе POST (без GET)
      await profile.locator('input[name=nickname]').fill('admin')
      await profile.getByRole('button', { name: 'Сохранить' }).click()
      await page.waitForLoadState('load')
      assert.match(await profile.locator('[data-field=nickname] [role=alert]').textContent(), /нельзя/)
      ok('без JS: ошибка валидации возвращается прямо в ответе POST без GET')

      // 12б. В no-JS картинка не по спеке (1x1 вместо 200x200) отклоняется fitsSpec,
      //      а готовый 200x200 JPEG сохраняется в /api/storage/avatars/...
      await profile.locator('input[name=nickname]').fill('e2e-nojs-258')
      await profile.locator('input[type=file][name=photo]').setInputFiles({
        name: 'raw-1x1.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(JPEG_1X1, 'base64'),
      })
      await profile.getByRole('button', { name: 'Сохранить' }).click()
      await page.waitForLoadState('load')
      assert.ok((await profile.locator('[role=alert]').count()) > 0, 'без JS: 1x1 JPEG отклонён по спеке 200x200')
      ok('без JS: сырой 1x1 JPEG честно отклонён fitsSpec (сервер не перекодирует)')

      await profile.locator('input[name=nickname]').fill('e2e-nojs-258')
      await profile.locator('input[type=file][name=photo]').setInputFiles({
        name: 'ready-200x200.jpg',
        mimeType: 'image/jpeg',
        buffer: readyAvatar200,
      })
      await profile.getByRole('button', { name: 'Сохранить' }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth') && !u.search.includes('stage'), { timeout: 15000 })
      assert.equal(await page.locator('[data-testid=header-user] img').count(), 1, 'готовый 200x200 аватар сохранён')
      const noJsAvatarSrc = await page.locator('[data-testid=header-user] img').getAttribute('src')
      assert.match(noJsAvatarSrc ?? '', /^\/api\/storage\/avatars\//, 'no-JS аватар лежит в /api/storage/avatars/')
      ok('без JS: регистрация + готовый 200x200 File аватара в /api/storage/avatars/... прошли')

      // 13. Выход на /user/menu → повторный вход без JS тем же seed → снова выход
      await page.goto(BASE + '/user/menu', { waitUntil: 'load' })
      assert.ok((await page.locator('span').filter({ hasText: 'e2e-nojs-258' }).count()) > 0, 'ник на странице меню')
      await page.getByRole('button', { name: 'Выйти', exact: true }).click()
      await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
      assert.equal(await page.locator('[data-testid=header-auth]').count(), 1, 'после выхода — «Авторизация»')

      await page.goto(BASE + '/user/auth', { waitUntil: 'load' })
      await page.fill('input[name=seed]', seed)
      await form.getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.includes('user/auth') && !u.search.includes('stage'), { timeout: 15000 })
      ok('без JS: страница меню с выходом и повторный вход корректным seed работают')

      // 13а. Без JS: истёкший/удалённый auth_tmp при живом auth_sid бесшовно восстанавливается на SSR,
      // а «Выйти» с мёртвым auth_tmp реально отзывает сессию в БД.
      await ctx.clearCookies({ name: 'auth_tmp' })
      await page.goto(BASE + '/user/menu', { waitUntil: 'load' })
      assert.ok((await page.locator('span').filter({ hasText: 'e2e-nojs-258' }).count()) > 0, 'SSR восстановил сессию по auth_sid')
      // Снова удаляем auth_tmp прямо перед нажатием «Выйти» и сохраняем копию auth_sid:
      const savedSid = (await ctx.cookies(BASE)).find((c) => c.name === 'auth_sid')
      assert.ok(savedSid, 'auth_sid присутствует')
      await ctx.clearCookies({ name: 'auth_tmp' })
      await page.getByRole('button', { name: 'Выйти', exact: true }).click()
      await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 })
      assert.equal(await page.locator('[data-testid=header-auth]').count(), 1, 'вышел даже с мёртвым auth_tmp')
      // Возвращаем старую куку auth_sid вручную — БД обязана отказать (сессия реально отозвана!):
      await ctx.addCookies([savedSid])
      await page.goto(BASE + '/user/menu', { waitUntil: 'load' })
      assert.equal(await page.locator('[data-acl-code="auth_required"]').count(), 1, 'отозванный auth_sid отвергнут БД')
      ok('без JS: SSR-восстановление по auth_sid и реальный отзыв в БД при мёртвом auth_tmp работают')

      await page.close()
      await ctx.close()

      // 14. С JS: межвкладочная синхронизация (BroadcastChannel) и бесшовное восстановление после сна вкладки
      const syncCtx = await browser.newContext()
      const tabA = await syncCtx.newPage()
      const tabB = await syncCtx.newPage()
      await tabA.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      await tabA.fill('input[name=seed]', seed)
      await tabA.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }).click()
      await tabA.waitForURL((u) => !u.pathname.includes('user/auth'), { timeout: 15000 })

      // Вкладка B открывает главную — видит текущего пользователя, при этом сырой
      // HttpOnly-токен `auth_tmp` (`Fe26.2**...`) НЕ утекает в SSR HTML страницы (AS-01):
      await tabB.goto(BASE + '/', { waitUntil: 'networkidle' })
      await tabB.locator('[data-testid=header-user]').waitFor({ state: 'visible' })
      const htmlContent = await tabB.content()
      assert.equal(htmlContent.includes('Fe26.2'), false, 'сырой токен auth_tmp не сериализован в HTML')

      // Имитируем проснувшуюся через сутки вкладку A: auth_tmp удалён браузером по maxAge,
      // но пользователь открывает форму профиля и меняет ник без перезагрузки (ровно 1 Set-Cookie на имя, AS-07):
      await tabA.goto(BASE + '/user/menu', { waitUntil: 'networkidle' })
      await tabA.getByRole('link', { name: /Изменить профиль/ }).or(tabA.getByRole('button', { name: /Изменить профиль/ })).click()
      await tabA.locator('#user-profile input[name=nickname]').waitFor({ state: 'visible', timeout: 5000 })
      await syncCtx.clearCookies({ name: 'auth_tmp' })
      const profileResponsePromise = tabA.waitForResponse((res) => res.request().method() === 'POST')
      await tabA.locator('#user-profile input[name=nickname]').fill('sync-tab-hero')
      await tabA.locator('#user-profile').getByRole('button', { name: 'Сохранить' }).click()
      const profileResponse = await profileResponsePromise
      const setCookieHeaders = (await profileResponse.headersArray()).filter(
        (h) => h.name.toLowerCase() === 'set-cookie',
      )
      assert.equal(
        setCookieHeaders.filter((h) => h.value.startsWith('auth_tmp=')).length,
        1,
        'ровно 1 Set-Cookie auth_tmp без дублей',
      )
      assert.equal(
        setCookieHeaders.filter((h) => h.value.startsWith('auth_sid=')).length,
        1,
        'ровно 1 Set-Cookie auth_sid без двойной ротации',
      )
      await tabA.waitForSelector('text=sync-tab-hero', { timeout: 10000 })

      // Вкладка B БЕЗ перезагрузки мгновенно получила новый ник через BroadcastChannel:
      await tabB.waitForFunction(
        () => document.querySelector('[data-testid=header-user]')?.getAttribute('aria-label') === 'Аккаунт: sync-tab-hero',
        null,
        { timeout: 5000 },
      )

      // Нажимаем «Выйти» во вкладке A — вкладка B БЕЗ перезагрузки переключает шапку на «Авторизация»:
      await tabA.getByRole('button', { name: 'Выйти', exact: true }).click()
      await tabB.locator('[data-testid=header-auth]').waitFor({ state: 'visible', timeout: 5000 })
      ok('с JS: спящая вкладка (без auth_tmp) сохраняет форму с 1 клика, а BroadcastChannel синхронизирует ник и выход во 2-ю вкладку')

      await tabA.close()
      await tabB.close()
      await syncCtx.close()
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
