/**
 * Браузер-тесты подсистемы блокировок (`user.block`, этапы B1–B6):
 *   1. С JS (цепочки модалок):
 *      • вход под `admin`, открытие профиля демо-пользователя → кнопка «Блокировки» (`user.blocks`);
 *      • в `user.blocks` при заданном `uid`: кнопка выбора пользователей в `user.blocks.filters` имеет `disabled`;
 *      • добавление блокировки из `user.blocks.create` (сфера `profile.edit`, причина, `forever`) → живое обновление списка;
 *      • глобальный `/blocks` без `uid`: в фильтрах кнопка выбора пользователей активна → пикер `user.picker` (`multiple`) выбирает `uid` → фильтр применяется;
 *      • глобальное создание из `/blocks`: пикер `user.picker` (`single`) подставляет `subject` → сохранение;
 *      • клик по строке в глобальном `/blocks` → `user.blocks.edit`: поле `[data-testid="block-target-id-input"]` (`disabled`, `readonly`, без `name`, показывает только UUID цели, не `seed`) + кнопка `user.profile`, правка `reason`;
 *      • удаление через `user.blocks.delete` (`HoldButton`, чекбокс `hard` виден у `admin`): мягкое удаление → фильтр `deleted` → клик по удалённой записи открывает read-only `BlockForm` без кнопки submit.
 *   2. Без JS (`javaScriptEnabled: false`, нативные маршруты и GET/POST-формы):
 *      • `/user/[id]` → переход по ссылке «Блокировки» на `/user/[id]/blocks` → `/blocks/filters?uid=[id]` с disabled-кнопкой выбора пользователей;
 *      • `/blocks/new` → переход в `/users/pick` (`single`) → возврат с `?subject=<uuid>` в SSR HTML поля `subject` → POST создаёт запись и редиректит на `/blocks`;
 *      • переход по строке на `/blocks/[blockId]` → проверка поля ID цели без `name` и ссылки на `/user/[id]` → POST «Снять сейчас» (`lift`) переводит запись в «Истекла».
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const PORT = Number(process.env.MODALS_PORT ?? 4173)
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`
const ADMIN_SECRET = process.env.MODALS_ADMIN_SECRET ?? ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let passed = 0
const ok = (name) => {
  passed++
  console.log('  ok  ' + name)
}

async function waitPreview() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + '/db-demo')).ok) return
    } catch {}
    await sleep(500)
  }
  throw new Error(`сервер не отвечает: ${BASE}`)
}

async function run() {
  if (!ADMIN_SECRET) {
    console.log('  SKIP blocks: не задан MODALS_ADMIN_SECRET (ключ администратора из лога запуска БД)')
    return
  }
  await waitPreview()
  const browser = await chromium.launch({ headless: true })
  const tag = Date.now().toString(36)
  const rScoped = `Проверка из модалки профиля ${tag}`
  const rGlobal = `Глобальная блокировка через пикер ${tag}`
  const rEdited = `Обновлённая причина блокировки ${tag}`
  const rNoJs = `Блокировка без JS ${tag}`
  let targetUserId = ''
  let adminCookies = []

  try {
    console.log('— с JS: модальные цепочки блокировок (профиль → список → фильтры → пикер → форма → удаление) —')
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const page = await ctx.newPage()

      // 1. Вход под admin (при первом входе без профиля AuthWidget открывает шаг профиля, сессия уже активна)
      await page.goto(BASE + '/user/auth', { waitUntil: 'networkidle' })
      await page.fill('input[name=seed]', ADMIN_SECRET)
      await page.locator('#user-auth').getByRole('button', { name: 'Авторизация', exact: true }).click()
      await page.locator('[data-testid="header-user"], #user-profile').first().waitFor({ state: 'visible', timeout: 15000 })
      adminCookies = await ctx.cookies(BASE)
      assert.ok(adminCookies.some((c) => c.name === 'auth_sid' || c.name === 'auth_tmp'), 'куки сессии получены')
      ok('вход под admin выполнен')

      // 2. Находим UUID демо-пользователя на /users и открываем его профиль в модалке
      await page.goto(BASE + '/users', { waitUntil: 'networkidle' })
      const firstUserLink = page.locator('[data-testid="seed-user-row"]').filter({ hasText: 'demo-' }).first()
      await firstUserLink.waitFor({ state: 'visible', timeout: 15000 })
      const userHref = await firstUserLink.getAttribute('href')
      const m = /^\/user\/([0-9a-f-]{36})/i.exec(userHref ?? '')
      assert.ok(m, `ожидался href /user/<uuid>, получено ${userHref}`)
      targetUserId = m[1]

      await firstUserLink.click()
      const blocksBtn = page.locator('[data-testid="profile-blocks-open"]').last()
      await blocksBtn.waitFor({ state: 'visible', timeout: 10000 })
      ok('Profile.svelte показывает кнопку «Блокировки»')

      // 3. Клик по «Блокировки» открывает модалку user.blocks для конкретного uid
      await blocksBtn.click()
      const scopedList = page.locator('[data-testid="blocks-list"]').last()
      await scopedList.waitFor({ state: 'visible', timeout: 10000 })
      ok('модалка user.blocks открыта из профиля')

      // 4. В фильтрах при переданном uid кнопка выбора пользователей disabled
      await scopedList.locator('[data-testid="blocks-filters-open"]').click()
      const scopedFilters = page.locator('[data-testid="blocks-filters-form"]').last()
      await scopedFilters.waitFor({ state: 'visible', timeout: 10000 })
      const scopedPickBtn = scopedFilters.locator('[data-testid="blocks-filters-pick-users"]')
      assert.equal(await scopedPickBtn.isDisabled(), true, 'кнопка пикера disabled при переданном uid')
      ok('BlocksFiltersForm: выбор пользователей заблокирован при переданном uid')
      await scopedFilters.locator('[data-testid="blocks-filters-apply"]').click()
      await scopedFilters.waitFor({ state: 'hidden', timeout: 10000 })

      // 5. Создание блокировки из списка пользователя (без поля subject)
      await scopedList.locator('[data-testid="blocks-add-button"]').click()
      const createForm = page.locator('[data-testid="block-form-create"]').last()
      await createForm.waitFor({ state: 'visible', timeout: 10000 })
      assert.equal(await createForm.locator('[data-testid="block-create-pick-user"]').count(), 0, 'нет пикера цели при фиксированном uid')
      await createForm.locator('select[name="scope"]').selectOption('auth')
      await createForm.locator('textarea[name="reason"]').fill(rScoped)
      await createForm.locator('[data-testid="block-create-submit"]').click()
      await createForm.waitFor({ state: 'hidden', timeout: 10000 })
      await scopedList.getByText(rScoped).waitFor({ state: 'visible', timeout: 10000 })
      ok('BlockForm (create с uid): запись создана и список обновился')

      // 6. Глобальный список /blocks (без uid): пикер пользователей в фильтрах (multiple)
      await page.goto(BASE + '/blocks', { waitUntil: 'networkidle' })
      const globalList = page.locator('[data-testid="blocks-list"]').first()
      await globalList.waitFor({ state: 'visible', timeout: 10000 })
      await globalList.locator('[data-testid="blocks-filters-open"]').click()
      const globalFilters = page.locator('[data-testid="blocks-filters-form"]').last()
      await globalFilters.waitFor({ state: 'visible', timeout: 10000 })
      const globalPickBtn = globalFilters.locator('[data-testid="blocks-filters-pick-users"]')
      assert.equal(await globalPickBtn.isDisabled(), false, 'кнопка пикера активна в глобальном списке')
      await globalPickBtn.click()

      const pickerMulti = page.locator('[data-testid="user-picker"]').last()
      await pickerMulti.waitFor({ state: 'visible', timeout: 10000 })
      await pickerMulti.locator('[data-testid="seed-user-row"]').filter({ has: page.locator(`code[title="${targetUserId}"]`) }).click()
      assert.equal((await pickerMulti.locator('[data-testid="user-picker-count"]').textContent())?.trim(), '1', 'выбран 1 пользователь')
      await pickerMulti.locator('[data-testid="user-picker-apply"]').click()
      await pickerMulti.waitFor({ state: 'hidden', timeout: 10000 })
      assert.match(await globalPickBtn.textContent(), /\(1\)/, 'счётчик выбранных пользователей = 1')
      await globalFilters.locator('[data-testid="blocks-filters-apply"]').click()
      await globalFilters.waitFor({ state: 'hidden', timeout: 10000 })
      assert.match(page.url(), /blocks\.uids=/, 'фильтр blocks.uids записан в адрес')
      ok('BlocksFiltersForm + UserPicker (multiple): фильтр по пользователям применён')

      // Сбросим фильтр для проверки глобального создания
      await page.goto(BASE + '/blocks', { waitUntil: 'networkidle' })

      // 7. Глобальное создание из /blocks (без uid): пикер single подставляет subject
      await page.locator('[data-testid="blocks-add-button"]').first().click()
      const globalCreate = page.locator('[data-testid="block-form-create"]').last()
      await globalCreate.waitFor({ state: 'visible', timeout: 10000 })
      await globalCreate.locator('[data-testid="block-create-pick-user"]').click()

      const pickerSingle = page.locator('[data-testid="user-picker"]').last()
      await pickerSingle.waitFor({ state: 'visible', timeout: 10000 })
      await pickerSingle.locator('[data-testid="seed-user-row"]').filter({ has: page.locator(`code[title="${targetUserId}"]`) }).click()
      await pickerSingle.locator('[data-testid="user-picker-apply"]').click()
      await pickerSingle.waitFor({ state: 'hidden', timeout: 10000 })

      assert.equal(await globalCreate.locator('input[name="subject"]').inputValue(), targetUserId, 'subject заполнен из single-пикера')
      await globalCreate.locator('select[name="scope"]').selectOption('auth')
      await globalCreate.locator('textarea[name="reason"]').fill(rGlobal)
      await globalCreate.locator('[data-testid="block-create-submit"]').click()
      await globalCreate.waitFor({ state: 'hidden', timeout: 10000 })
      await page.locator('[data-testid="block-row"]').filter({ hasText: rGlobal }).waitFor({ state: 'visible', timeout: 10000 })
      ok('BlockForm (create без uid) + UserPicker (single): запись создана')

      // 8. Клик по строке в глобальном /blocks → проверка disabled target ID без name + кнопки профиля + правка reason
      await page.locator('[data-testid="block-row"]').filter({ hasText: rGlobal }).click()
      const editForm = page.locator('[data-testid="block-form-edit"]').last()
      await editForm.waitFor({ state: 'visible', timeout: 10000 })

      const targetIdInput = editForm.locator('[data-testid="block-target-id-input"]')
      assert.equal(await targetIdInput.count(), 1, 'поле ID цели отрендерено в глобальном режиме')
      assert.equal(await targetIdInput.getAttribute('name'), null, 'у поля ID цели нет атрибута name')
      assert.equal(await targetIdInput.isDisabled(), true, 'поле ID цели disabled')
      assert.notEqual(await targetIdInput.getAttribute('readonly'), null, 'поле ID цели readonly')
      assert.equal(await targetIdInput.inputValue(), targetUserId, 'показан именно UUID цели, а не seed')
      assert.equal(await editForm.locator('[data-testid="block-open-profile"]').count(), 1, 'кнопка открытия профиля цели видна')

      await editForm.locator('textarea[name="reason"]').fill(rEdited)
      await editForm.locator('[data-testid="block-save-submit"]').click()
      await editForm.waitFor({ state: 'hidden', timeout: 10000 })
      await page.locator('[data-testid="block-row"]').filter({ hasText: rEdited }).waitFor({ state: 'visible', timeout: 10000 })
      ok('BlockForm (edit без uid): визуальный ID без name, кнопка профиля и правка reason работают')

      // 9. Удаление через BlockDelete (HoldButton) → фильтр deleted → read-only просмотр без submit
      await page.locator('[data-testid="block-row"]').filter({ hasText: rEdited }).click()
      await editForm.waitFor({ state: 'visible', timeout: 10000 })
      await editForm.locator('[data-testid="block-delete-open"]').click()

      const delBox = page.locator('[data-testid="block-delete-form"]').last()
      await delBox.waitFor({ state: 'visible', timeout: 10000 })
      assert.equal(await delBox.locator('[data-testid="block-delete-hard-option"]').count(), 1, 'чекбокс hard виден для admin')

      const holdBtn = delBox.locator('[data-testid="block-delete-submit"]')
      await holdBtn.focus()
      await page.keyboard.down(' ')
      await page.waitForTimeout(2600)
      await page.keyboard.up(' ')
      await delBox.waitFor({ state: 'hidden', timeout: 10000 })

      // Переключаем фильтр состояния на deleted и проверяем read-only форму без submit
      await page.goto(BASE + '/blocks?blocks.state=deleted', { waitUntil: 'networkidle' })
      const deletedRow = page.locator('[data-testid="block-row"]').filter({ hasText: rEdited })
      await deletedRow.waitFor({ state: 'visible', timeout: 10000 })
      await deletedRow.click()

      const roForm = page.locator('[data-testid="block-form-edit"]').last()
      await roForm.waitFor({ state: 'visible', timeout: 10000 })
      assert.notEqual(await roForm.getAttribute('data-readonly'), null, 'удалённая запись открыта в read-only режиме')
      assert.equal(await roForm.locator('[data-testid="block-save-submit"]').count(), 0, 'кнопка submit скрыта в read-only режиме')
      assert.equal(await roForm.locator('[data-testid="block-lift-submit"]').count(), 0, 'кнопка lift скрыта в read-only режиме')
      ok('BlockDelete (HoldButton) и read-only просмотр без submit работают')

      await page.close()
      await ctx.close()
    }

    console.log('— без JS: маршруты, SSR-пикер пользователей и нативные POST-формы —')
    {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled: false,
      })
      await ctx.addCookies(adminCookies)
      const page = await ctx.newPage()

      // 1. Страница профиля → ссылка «Блокировки» → /user/[id]/blocks → /blocks/filters?uid=[id]
      await page.goto(`${BASE}/user/${targetUserId}`, { waitUntil: 'load' })
      const profileBlocksLink = page.locator('[data-testid="profile-blocks-open"]')
      assert.equal(new URL((await profileBlocksLink.getAttribute('href')) ?? '', page.url()).pathname, `/user/${targetUserId}/blocks`)
      await profileBlocksLink.click()
      await page.waitForURL((u) => u.pathname === `/user/${targetUserId}/blocks`, { timeout: 10000 })

      await page.locator('[data-testid="blocks-filters-open"]').click()
      await page.waitForURL((u) => u.pathname === '/blocks/filters', { timeout: 10000 })
      assert.equal(
        await page.locator('[data-testid="blocks-filters-pick-users"]').isDisabled(),
        true,
        'без JS кнопка выбора пользователей disabled при uid в адресе',
      )
      ok('без JS: маршрут /user/[id]/blocks и disabled пикер в /blocks/filters?uid=[id] работают')

      // 2. Глобальное создание /blocks/new → /users/pick (single) → выбор + Применить → возврат с ?subject=<uuid> → POST
      await page.goto(BASE + '/blocks/new', { waitUntil: 'load' })
      await page.locator('[data-testid="block-create-pick-user"]').click()
      await page.waitForURL((u) => u.pathname === '/users/pick', { timeout: 10000 })
      await page.locator('[data-testid="seed-user-row"]').filter({ has: page.locator(`code[title="${targetUserId}"]`) }).click()
      await page.waitForURL((u) => u.pathname === '/users/pick' && u.searchParams.get('picked') === targetUserId, {
        timeout: 10000,
      })
      await page.locator('[data-testid="user-picker-apply"]').click()
      await page.waitForURL((u) => u.pathname === '/blocks/new' && u.searchParams.get('subject') === targetUserId, {
        timeout: 10000,
      })
      assert.equal(
        await page.locator('input[name="subject"]').inputValue(),
        targetUserId,
        'без JS SSR засеял input[name="subject"] из ?subject=…',
      )

      await page.locator('select[name="scope"]').selectOption('auth')
      await page.locator('textarea[name="reason"]').fill(rNoJs)
      await page.locator('[data-testid="block-create-submit"]').click()
      await page.waitForURL((u) => u.pathname === '/blocks', { timeout: 10000 })
      await page.locator('[data-testid="block-row"]').filter({ hasText: rNoJs }).waitFor({ state: 'visible', timeout: 10000 })
      ok('без JS: /users/pick → /blocks/new?subject=… → POST /blocks создаёт блокировку')

      // 3. Клик по строке → /blocks/[blockId] → проверка target ID без name и POST «Снять сейчас» (lift)
      await page.locator('[data-testid="block-row"]').filter({ hasText: rNoJs }).click()
      await page.waitForURL((u) => /^\/blocks\/[0-9a-f-]{36}$/i.test(u.pathname), { timeout: 10000 })
      const noJsTargetId = page.locator('[data-testid="block-target-id-input"]')
      assert.equal(await noJsTargetId.getAttribute('name'), null, 'без JS у поля ID цели нет name')
      assert.equal(await noJsTargetId.inputValue(), targetUserId, 'без JS поле ID цели содержит UUID')
      assert.equal(
        new URL((await page.locator('[data-testid="block-open-profile"]').getAttribute('href')) ?? '', page.url()).pathname,
        `/user/${targetUserId}`,
        'без JS кнопка профиля ведёт на /user/[id]',
      )

      await page.locator('[data-testid="block-lift-submit"]').click()
      await page.waitForURL((u) => u.pathname === '/blocks', { timeout: 10000 })
      const liftedRow = page.locator('[data-testid="block-row"]').filter({ hasText: rNoJs })
      assert.match(await liftedRow.textContent(), /снята/, 'после lift статус записи «снята»')
      ok('без JS: /blocks/[blockId] рендерит ID без name и снимает блокировку через POST lift')

      await page.close()
      await ctx.close()
    }

    console.log(`\n✓ browser/blocks: ${passed} проверок пройдено`)
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
