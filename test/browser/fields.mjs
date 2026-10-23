/** Браузерные проверки страницы `/fields` (поле `field.fields` и `defineForm({ from })`). Идут на УЖЕ
 * работающий сервер со свежим процессом: набор и запись живут в его кэше.
 *
 *   npm run build && npx vite preview --port 5173 &
 *   node test/browser/fields.mjs
 *
 * Что проверяется:
 *   1. страница идёт шагами («Сборка / Заполнение / Результат»): на каждом шаге только его
 *      действие; незаполненные шаги — текст, заполненные — ссылки;
 *   2. «+ поле» и «Удалить» — кнопки разметки; ключ места случайный (`f` + 6 знаков),
 *      удалённое место не возвращается под тем же ключом;
 *   3. правило вида показано внутри «Правила» выбранным и недосягаемым; смена вида
 *      сбрасывает выбранные правила;
 *   4. Enter в поле сохраняет набор и уводит на «Заполнение»; назад — шаги в режиме
 *      правки: прежние значения на месте, прежнее изображение видно; быстрый щелчок
 *      по шагу во время отправки заблокирован и данные после отправки свежие;
 *      навигация — только ссылки шагов сверху (кнопок возврата нет), сброс виден
 *      со второго шага;
 *   5. запись: обязательные поля, сверка содержимого файла на сервере;
 *   6. результат: значения по ключу, подписи — из текущего набора, удалённое поле не выводится;
 *   7. путь без скрипта: «+ поле» и «Удалить» тем же механизмом (отправка формы,
 *      места возвращает сервер), в «Правилах» все правила схемы — лишнее для вида
 *      отклоняет проверка, набранное не теряется;
 *   8. сброс: очищает набор и запись и возвращает на «Сборку».
 */
import { chromium } from 'playwright'

const BASE = process.env.FIELDS_BASE ?? 'http://127.0.0.1:5173/fields'
let failed = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failed++
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const b = (name) => `#fields-builder-${name.replace(/\./g, '-')}`
const r = (name) => `#fields-record-${name.replace(/\./g, '-')}`
const errorsOf = (pg, field) =>
  pg.locator(`[data-field="${field}"]`).innerText().catch(() => '')
const navLinks = (pg) => pg.locator('nav[aria-label="Шаги"] a').allInnerTexts()
const goStep = async (pg, label) => {
  await pg.click(`nav[aria-label="Шаги"] a:text("${label}")`)
  await pg.waitForTimeout(200)
}
const waitH2 = (pg, text) => pg.waitForFunction((t) => document.querySelector('h2')?.textContent === t, text)

const KEY = /^f[a-z0-9]{6}$/
const rows = (pg) => pg.locator('[data-set-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-set-row')))
// с JS место приходит ответом отправки: клик — и ждём, пока состав мест совпадёт
const addPlace = async (pg, expect) => {
  const before = await pg.locator('[data-set-row]').count()
  await pg.click('[data-testid="add-field"]')
  await pg.waitForFunction((n) => document.querySelectorAll('[data-set-row]').length === n, expect ?? before + 1)
}
const removePlace = async (pg, key) => {
  await pg.click(`[data-testid="remove-${key}"]`)
  await pg.waitForFunction((k) => ![...document.querySelectorAll('[data-set-row]')].some((e) => e.getAttribute('data-set-row') === k), key)
}
const chosenRules = (pg, name) =>
  pg.locator(b(`props.${name}.rules`)).evaluate((el) => Array.from(el.selectedOptions).filter((o) => !o.disabled).map((o) => o.value))

const browser = await chromium.launch()
const consoleErrors = []
let k1, k2
{
  const ctx = await browser.newContext()
  const pg = await ctx.newPage()
  // 422 — ожидаемые отказы сервера в проверках ниже; браузер пишет их в консоль сам
  pg.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('status of 422')) consoleErrors.push(m.text()) })
  pg.on('pageerror', (e) => consoleErrors.push(String(e)))
  await pg.goto(BASE, { waitUntil: 'networkidle' })

  /* 1. шаги и места */
  ok('старт: «Сборка», мест нет, формы записи и сброса нет, шаги без ссылок',
    (await rows(pg)).length === 0 && (await pg.locator('#fields-record').count()) === 0
    && (await pg.locator('[data-testid="reset"]').count()) === 0
    && (await pg.locator('h2').first().innerText()) === 'Создание полей'
    && (await navLinks(pg)).length === 0, (await navLinks(pg)).join(','))
  await pg.click('[data-testid="add-field"]')
  // ожила: список усилился (data-enhanced), место пришло ответом отправки
  await pg.waitForSelector('[data-select-root][data-enhanced]')
  await pg.waitForSelector('[data-set-row]')
  ;[k1] = await rows(pg)
  ok('«+ поле» добавляет место со случайным ключом', KEY.test(k1 ?? ''), k1)
  await pg.fill(b(`props.${k1}.label`), 'Сайт')
  await pg.locator(b(`props.${k1}.kind`)).selectOption('url')
  ok('название не открывает место само', (await rows(pg)).length === 1)

  /* 3а. правило вида — внутри «Правила», выбранным и недосягаемым */
  await pg.waitForSelector(b(`props.${k1}.rules`))
  const lockedOpt = pg.locator(`${b(`props.${k1}.rules`)} option[value="url"]`)
  ok('правило вида — пункт списка «Правила», выключен и выбран',
    await lockedOpt.count() === 1 && await lockedOpt.isDisabled() && await lockedOpt.evaluate((o) => o.selected)
    && (await lockedOpt.innerText()).includes('Всегда: проверка ссылки'), await lockedOpt.innerText())
  ok('у вида «Ссылка» правило вида названо в строке',
    (await pg.locator(`[data-set-row="${k1}"]`).innerText()).includes('Всегда: проверка ссылки'))

  await addPlace(pg)
  k2 = (await rows(pg))[1]
  await pg.fill(b(`props.${k2}.label`), 'Возраст')
  await pg.locator(b(`props.${k2}.kind`)).selectOption('number')
  await pg.locator(b(`props.${k2}.rules`)).selectOption(['required', 'maxValue'])
  await pg.waitForSelector(b(`props.${k2}.max_value`))
  ok('выбранное правило со значением даёт поле числа', (await pg.locator(b(`props.${k2}.max_value`)).count()) === 1)
  await pg.fill(b(`props.${k2}.max_value`), '99999999')

  /* 3б. смена вида сбрасывает выбранные правила */
  await pg.locator(b(`props.${k2}.kind`)).selectOption('text')
  await pg.waitForTimeout(150)
  ok('смена вида сбрасывает выбранные правила', (await chosenRules(pg, k2)).length === 0,
    (await chosenRules(pg, k2)).join(','))
  await pg.locator(b(`props.${k2}.kind`)).selectOption('number')
  await pg.locator(b(`props.${k2}.rules`)).selectOption(['required', 'maxValue'])
  await pg.waitForSelector(b(`props.${k2}.max_value`))
  await pg.fill(b(`props.${k2}.max_value`), '99999999')

  let addFieldPosts = 0
  const trackPost = (req) => {
    if (req.method() === 'POST') addFieldPosts++
  }
  pg.on('request', trackPost)
  const addBtnType = await pg.locator('[data-testid="add-field"]').getAttribute('type')
  const saveBusyDuringAdd = await pg.locator('[data-testid="save"]').getAttribute('aria-busy')
  await addPlace(pg)
  const saveBusyAfterAdd = await pg.locator('[data-testid="save"]').getAttribute('aria-busy')
  pg.off('request', trackPost)
  ok('с JS «+ поле» работает локально (type="button", 0 POST) и не зажигает спиннер на «Сохранить»',
    addBtnType === 'button' && addFieldPosts === 0 && saveBusyDuringAdd === null && saveBusyAfterAdd === null,
    `type=${addBtnType}, posts=${addFieldPosts}`)
  const k3 = (await rows(pg))[2]
  await pg.fill(b(`props.${k3}.label`), 'Лишнее')
  await removePlace(pg, k3)
  await addPlace(pg)
  const after = await rows(pg)
  ok('«Удалить» убирает место; новое место — под новым ключом',
    after.length === 3 && !after.includes(k3) && KEY.test(after[2] ?? ''), after.join(','))
  await removePlace(pg, after[2])

  /* 4. сохранение по Enter — и шаг «Заполнение» */
  await pg.focus(b(`props.${k1}.label`))
  await pg.keyboard.press('Enter')
  await waitH2(pg, 'Заполнение')
  ok('Enter сохраняет набор и уводит на «Заполнение»',
    pg.url().includes('step=fill') && (await navLinks(pg)).join() === 'Сборка',
    `${pg.url().replace('http://127.0.0.1:5173', '')} / ${await navLinks(pg)}`)
  ok('форма записи: название, изображение и поля набора по ключам',
    (await pg.locator(r('title')).count()) === 1 && (await pg.locator(r('image')).count()) === 1
    && (await pg.locator(r(`u_${k1}`)).count()) === 1 && (await pg.locator(r(`u_${k2}`)).count()) === 1)

  /* 5. запись: обязательные поля и сверка файла */
  await pg.click('[data-testid="record-submit"]')
  await pg.waitForTimeout(400)
  ok('пустая запись: ошибки у названия, изображения и обязательного поля набора',
    (await errorsOf(pg, 'title')).length > 'Название'.length && (await errorsOf(pg, 'image')).includes('Изображение')
    && (await pg.locator(`${r(`u_${k2}`)}[aria-invalid="true"]`).count()) === 1)

  await pg.fill(r('title'), 'Котик')
  await pg.fill(r(`u_${k1}`), 'https://example.com')
  await pg.fill(r(`u_${k2}`), '42')
  await pg.setInputFiles(r('image'), { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image at all') })
  await pg.waitForSelector('[data-field="image"] [data-file-item]')
  ok('превью выбранного: карточка с именем и весом',
    (await pg.locator('[data-field="image"] [data-file-item]').innerText()).includes('fake.png'))
  await pg.click('[data-testid="record-submit"]')
  await pg.waitForFunction(() => document.querySelector('[data-field="image"]')?.textContent?.includes('не подходит'))
  ok('сервер сверяет содержимое файла, а не заявленный тип', (await errorsOf(pg, 'image')).includes('не подходит'))

  /* 6. отмена Attachment (×) и отправка результата */
  await pg.setInputFiles(r('image'), { name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await pg.waitForSelector('[data-field="image"] [data-file-item] img')
  await pg.locator('[data-field="image"] button[aria-label="Убрать файл: dot.png"]').click()
  await pg.waitForFunction(() => document.querySelectorAll('[data-field="image"] [data-file-item]').length === 0)
  ok('кнопка × на Attachment убирает и сам файл из input, и карточку превью',
    (await pg.locator('[data-field="image"] [data-file-item]').count()) === 0
    && (await pg.locator(r('image')).evaluate((el) => el.files?.length ?? 0)) === 0)

  await pg.setInputFiles(r('image'), { name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  // миниатюра через локальный objectURL в FileAttachment / Attachment
  await pg.waitForSelector('[data-field="image"] [data-file-item] img')
  ok('превью картинки: objectURL через FileAttachment', (await pg.locator('[data-field="image"] [data-file-item] img').count()) === 1)
  await pg.click('[data-testid="record-submit"]')
  await waitH2(pg, 'Просмотр')
  ok('запись отправлена — шаг «Результат», сброс справа от шагов',
    pg.url().includes('step=result') && (await pg.locator('[data-testid="reset"]').count()) === 1, pg.url())
  const viewText = () => pg.locator('[data-testid="record-view"]').innerText()
  const view = await viewText()
  const src = await pg.locator('[data-testid="record-view"] img').getAttribute('src')
  ok('пример: название', view.includes('Котик'), view)
  ok('пример: изображение data URL по содержимому', src?.startsWith('data:image/png;base64,iVBOR'), src?.slice(0, 40))
  ok('пример: значения полей списком', view.includes('Сайт') && view.includes('https://example.com')
    && view.includes('Возраст') && view.includes('42'), view)
  ok('шаги стали ссылками', (await navLinks(pg)).join() === 'Сборка,Заполнение,Результат', (await navLinks(pg)).join())

  /* 4б. шаги назад — режим правки */
  await goStep(pg, 'Заполнение')
  await waitH2(pg, 'Заполнение')
  ok('заполнение в режиме правки: прежние значения в полях',
    (await pg.inputValue(r('title'))) === 'Котик' && (await pg.inputValue(r(`u_${k2}`))) === '42')
  ok('прежнее изображение показано рядом с полем файла',
    (await pg.locator('figure img').count()) === 1)
  ok('на заполнении сброс уже виден, кнопок возврата нет',
    (await pg.locator('[data-testid="reset"]').count()) === 1
    && !(await pg.locator('body').innerText()).includes('Вернуться'))
  await goStep(pg, 'Сборка')
  await waitH2(pg, 'Создание полей')
  const saved = await pg.locator('[data-testid="saved-set"]').innerText()
  ok('назад: сборка в режиме правки — сохранённый набор на месте (версия 1, полей 2)',
    saved.includes('версия 1') && saved.includes('полей: 2') && (await rows(pg)).join() === [k1, k2].join(), saved)
  ok('значение за пределом заменено при сохранении',
    (await pg.inputValue(b(`props.${k2}.max_value`))) === '1000000')

  // подпись — из текущего набора; поле убрали из набора — значение не выводится
  await pg.fill(b(`props.${k1}.label`), 'Адрес')
  await removePlace(pg, k2)
  await pg.click('[data-testid="save"]')
  await waitH2(pg, 'Заполнение')
  await goStep(pg, 'Результат')
  await waitH2(pg, 'Просмотр')
  const renamed = await viewText()
  ok('пример: новая подпись из набора, удалённого поля нет',
    renamed.includes('Адрес') && !renamed.includes('Сайт') && !renamed.includes('Возраст') && renamed.includes('https://example.com'), renamed)

  /* 4в. быстрый щелчок по шагу во время отправки не ломает ход */
  await goStep(pg, 'Сборка')
  await waitH2(pg, 'Создание полей')
  // замедлили сохранение: ответ придёт, когда рука уже потянется к шагам
  await pg.route('**/fields*', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((r) => setTimeout(r, 800))
    }
    await route.continue()
  })
  await pg.click('[data-testid="save"]')
  // замок виден в разметке: ссылка шага получает aria-disabled (pointer-events-none
  // появился бы на том же ходу, но щёлкать надо по уже запертой ссылке)
  await pg.locator('nav[aria-label="Шаги"] a[aria-disabled="true"]', { hasText: 'Заполнение' }).waitFor({ timeout: 3000 })
  // force: щелчок сквозь pointer-events-none — события уходят сквозь ссылку, шва нет
  await pg.click('nav[aria-label="Шаги"] a:text("Заполнение")', { force: true })
  ok('щелчок по шагу во время отправки заблокирован', !pg.url().includes('step=fill'), pg.url())
  await pg.waitForURL(/fields\?step=fill/)
  ok('после отправки страница открыта на свежих данных — запись сохраняется',
    (await pg.locator(r(`u_${k1}`)).count()) === 1, pg.url())
  await pg.unroute('**/fields*')

  ok('консоль без ошибок', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300))
  await ctx.close()
}

/* 7. без скрипта */
{
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const pg = await ctx.newPage()
  await pg.goto(`${BASE}?step=build`)
  ok('без JS: сохранённый набор на месте, пустого места нет', (await rows(pg)).join() === k1, (await rows(pg)).join())
  // версию снимаем до операций: «+ поле»/«Удалить» число сохранений не меняют
  const versionOf = (t) => t.match(/версия (\d+)/)?.[1] ?? '?'
  const vNojs = versionOf(await pg.locator('[data-testid="saved-set"]').innerText())

  // набранное до «+ поле» не теряется
  await pg.fill(b(`props.${k1}.label`), 'Адрес')
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="add-field"]')])
  const two = await rows(pg)
  ok('без JS: «+ поле» — новое место, набранное на месте',
    two.length === 2 && two[0] === k1 && KEY.test(two[1] ?? '') && (await pg.inputValue(b(`props.${k1}.label`))) === 'Адрес', two.join(','))
  const k4 = two[1]
  await pg.fill(b(`props.${k4}.label`), 'Комментарий')

  // без JS список правил показывает ВСЕ правила схемы: фильтр по виду включит оживление
  const allRules = await pg.locator(b(`props.${k4}.rules`)).evaluate((el) => Array.from(el.options).map((o) => o.value))
  ok('без JS: в «Правилах» все правила схемы, фильтр по виду — после оживления',
    allRules.includes('minValue') && allRules.includes('maxLength'), allRules.join(','))
  // смена вида без скрипта: правила остаются как набрано, лишнее отклонит проверка
  await pg.locator(b(`props.${k4}.rules`)).selectOption(['maxLength'])
  await pg.locator(b(`props.${k4}.kind`)).selectOption('number')
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="add-field"]')])
  ok('без JS: правила остаются при смене вида — их правит пользователь',
    (await chosenRules(pg, k4)).join() === 'maxLength', (await chosenRules(pg, k4)).join(','))
  const k5 = (await rows(pg))[2]
  await Promise.all([pg.waitForNavigation(), pg.click(`[data-testid="remove-${k5}"]`)])
  ok('без JS: «Удалить» убирает место, остальное на месте', (await rows(pg)).join() === [k1, k4].join())
  ok('без JS: кнопки набора ничего не сохранили', versionOf(await pg.locator('[data-testid="saved-set"]').innerText()) === vNojs,
    await pg.locator('[data-testid="saved-set"]').innerText())

  // лишнее для вида отклоняется ошибкой у «Правил»; сохранения не было
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="save"]')])
  ok('без JS: правило не своего вида отклонено схемой',
    (await errorsOf(pg, `props.${k4}.rules`)).includes('не подходит'), await errorsOf(pg, `props.${k4}.rules`))
  ok('без JS: набор после отказа на месте', versionOf(await pg.locator('[data-testid="saved-set"]').innerText()) === vNojs,
    await pg.locator('[data-testid="saved-set"]').innerText())

  // пользователь чинит: вид возвращается — правило подходит, сохранение уводит дальше
  await pg.locator(b(`props.${k4}.kind`)).selectOption('textarea')
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="save"]')])
  ok('без JS: сохранение уводит на «Заполнение»',
    pg.url().includes('step=fill') && (await pg.locator('h2').first().innerText()) === 'Заполнение', pg.url())
  ok('без JS: сброс виден на заполнении, новое поле в форме записи',
    (await pg.locator('[data-testid="reset"]').count()) === 1 && (await pg.locator(r(`u_${k4}`)).count()) === 1)

  await pg.fill(r('title'), 'Без скрипта')
  await pg.fill(r(`u_${k1}`), 'https://example.org')
  await pg.fill(r(`u_${k4}`), 'строка\nвторая')
  await pg.setInputFiles(r('image'), { name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="record-submit"]')])
  const view = await pg.locator('[data-testid="record-view"]').innerText().catch(() => '')
  ok('без JS: запись заменена', view.includes('Без скрипта') && view.includes('Комментарий')
    && view.includes('https://example.org') && view.includes('строка'), view)

  // отказ без JS: набранное возвращается в разметку, ошибка — у своего места
  await Promise.all([pg.waitForNavigation(), pg.click('nav[aria-label="Шаги"] a:text("Заполнение")')])
  await pg.setInputFiles(r('image'), { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('nope') })
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="record-submit"]')])
  ok('без JS: отказ — ошибка у изображения, набранное на месте',
    (await errorsOf(pg, 'image')).includes('не подходит') && (await pg.inputValue(r('title'))) === 'Без скрипта',
    await errorsOf(pg, 'image'))

  /* 8. сброс: всё очищает и возвращает на «Сборку» */
  await Promise.all([pg.waitForNavigation(), pg.click('nav[aria-label="Шаги"] a:text("Результат")')])
  ok('без JS: шаг «Результат» со сбросом справа от шагов', (await pg.locator('[data-testid="reset"]').count()) === 1)
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="reset"]')])
  ok('сброс: набор и запись очищены, снова «Сборка», шаги без ссылок',
    (await rows(pg)).length === 0 && (await pg.locator('h2').first().innerText()) === 'Создание полей'
    && (await navLinks(pg)).length === 0 && pg.url().includes('step=build'),
    `${pg.url().replace('http://127.0.0.1:5173', '')} / ${await navLinks(pg)}`)

  /* 8а. панель без скрипта: шаг страницы переживает применение опции */
  const panel = pg.locator('[data-testid="demo-panel"]')
  const hiddenStep = await panel.locator('input[type="hidden"][name="step"]').inputValue().catch(() => '—')
  ok('без JS: панель несёт чужие ключи адреса скрытыми полями', hiddenStep === 'build', hiddenStep)
  await panel.locator('select[name="limit"]').selectOption('2')
  await Promise.all([pg.waitForNavigation(), panel.locator('button[type="submit"]').click()])
  ok('без JS: опция применена нативной GET, шаг на месте',
    pg.url().includes('limit=2') && pg.url().includes('step=build'), pg.url())
  await ctx.close()
}

/* 9. демо-панель: предел набора — одна опция для обеих сторон */
{
  const ctx = await browser.newContext()
  const pg = await ctx.newPage()
  await pg.goto(`${BASE}?step=build`, { waitUntil: 'networkidle' })
  const panel = pg.locator('[data-testid="demo-panel"]')
  const limit = panel.locator('select[name="limit"]')
  ok('панель: у конструктора появилась опция — предел набора',
    (await limit.count()) === 1 && (await limit.inputValue()) === '8')
  await limit.selectOption('4')
  await pg.waitForURL(/limit=4/, { timeout: 10000 })
  ok('панель: предел уходит в адрес (полная навигация), шаг не теряется',
    pg.url().includes('limit=4') && pg.url().includes('step=build'), pg.url())
  for (const n of [1, 2, 3]) {
    await pg.locator('[data-testid="add-field"]').click()
    await pg.waitForFunction((k) => document.querySelectorAll('[data-set-row]').length === k, n)
  }
  const rowsNow = await pg.locator('[data-set-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-set-row')))
  for (const [i, key] of rowsNow.entries()) await pg.fill(b(`props.${key}.label`), `На пределе ${i + 1}`)
  await pg.click('[data-testid="save"]')
  await pg.waitForURL(/step=fill/, { timeout: 10000 })
  ok('панель: предел переживает переход шага', pg.url().includes('limit=4'), pg.url())

  // предел снижен ниже сохранённого набора — отказ называет и число, и предел
  await pg.goto(`${BASE}?step=build&limit=4`, { waitUntil: 'networkidle' })
  await limit.selectOption('2')
  await pg.waitForURL(/limit=2/, { timeout: 10000 })
  await pg.click('[data-testid="save"]')
  await pg.waitForTimeout(600)
  const text = await pg.locator('[data-field="props"]').innerText()
  ok('сервер проверяет тем же пределом: набор длиннее — отказ с причиной',
    text.includes('можно не больше 2'), text.replace(/\s+/g, ' ').slice(0, 120))
  await ctx.close()
}

await browser.close()

// Уборка: набор живёт в кэше сервера и переживает прогон. Без сброса следующий
// запуск (в том числе `npm run test:browser` следом) начинал бы не с пустого места.
{
  const reset = await fetch(BASE, {
    method: 'POST',
    headers: {
      origin: new URL(BASE).origin,
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      __form_id: 'fields-reset',
      __form_rev: '1',
      __form_instance: 'fields-reset:new',
      __form_submission: crypto.randomUUID(),
      intent: 'reset',
    }),
  })
  ok('уборка: сброс набора очистил кэш сервера', reset.ok, String(reset.status))
}

console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
