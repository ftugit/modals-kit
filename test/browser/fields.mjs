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
 *      правки: прежние значения на месте, прежнее изображение видно;
 *   5. запись: обязательные поля, сверка содержимого файла на сервере;
 *   6. результат: значения по ключу, подписи — из текущего набора, удалённое поле не выводится;
 *   7. путь без скрипта: «+ поле» и «Удалить» отправкой формы, набранное не теряется,
 *      смена вида сбрасывает правила после отправки, шаги и сохранения через адрес;
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
  // ожила: кнопки набора стали type="button"
  await pg.waitForSelector('[data-testid="add-field"][type="button"]')

  /* 1. шаги и места */
  ok('старт: «Сборка», мест нет, формы записи нет, шаги без ссылок',
    (await rows(pg)).length === 0 && (await pg.locator('#fields-record').count()) === 0
    && (await pg.locator('h2').first().innerText()) === 'Создание полей'
    && (await navLinks(pg)).length === 0, (await navLinks(pg)).join(','))
  await pg.click('[data-testid="add-field"]')
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

  await pg.click('[data-testid="add-field"]')
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

  await pg.click('[data-testid="add-field"]')
  const k3 = (await rows(pg))[2]
  await pg.fill(b(`props.${k3}.label`), 'Лишнее')
  await pg.click(`[data-testid="remove-${k3}"]`)
  await pg.click('[data-testid="add-field"]')
  const after = await rows(pg)
  ok('«Удалить» убирает место; новое место — под новым ключом',
    after.length === 3 && !after.includes(k3) && KEY.test(after[2] ?? ''), after.join(','))
  await pg.click(`[data-testid="remove-${after[2]}"]`)

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
  await pg.click('[data-testid="record-submit"]')
  await pg.waitForFunction(() => document.querySelector('[data-field="image"]')?.textContent?.includes('не подходит'))
  ok('сервер сверяет содержимое файла, а не заявленный тип', (await errorsOf(pg, 'image')).includes('не подходит'))

  /* 6. результат */
  await pg.setInputFiles(r('image'), { name: 'dot.png', mimeType: 'image/png', buffer: PNG })
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
  await pg.click('a:text("Вернуться к сборке")')
  await waitH2(pg, 'Создание полей')
  const saved = await pg.locator('[data-testid="saved-set"]').innerText()
  ok('назад: сборка в режиме правки — сохранённый набор на месте (версия 1, полей 2)',
    saved.includes('версия 1') && saved.includes('полей: 2') && (await rows(pg)).join() === [k1, k2].join(), saved)
  ok('значение за пределом заменено при сохранении',
    (await pg.inputValue(b(`props.${k2}.max_value`))) === '1000000')

  // подпись — из текущего набора; поле убрали из набора — значение не выводится
  await pg.fill(b(`props.${k1}.label`), 'Адрес')
  await pg.click(`[data-testid="remove-${k2}"]`)
  await pg.click('[data-testid="save"]')
  await waitH2(pg, 'Заполнение')
  await goStep(pg, 'Результат')
  await waitH2(pg, 'Просмотр')
  const renamed = await viewText()
  ok('пример: новая подпись из набора, удалённого поля нет',
    renamed.includes('Адрес') && !renamed.includes('Сайт') && !renamed.includes('Возраст') && renamed.includes('https://example.com'), renamed)
  ok('консоль без ошибок', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300))
  await ctx.close()
}

/* 7. без скрипта */
{
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const pg = await ctx.newPage()
  await pg.goto(`${BASE}?step=build`)
  ok('без JS: сохранённый набор на месте, пустого места нет', (await rows(pg)).join() === k1, (await rows(pg)).join())

  // набранное до «+ поле» не теряется
  await pg.fill(b(`props.${k1}.label`), 'Адрес')
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="add-field"]')])
  const two = await rows(pg)
  ok('без JS: «+ поле» — новое место, набранное на месте',
    two.length === 2 && two[0] === k1 && KEY.test(two[1] ?? '') && (await pg.inputValue(b(`props.${k1}.label`))) === 'Адрес', two.join(','))
  const k4 = two[1]
  await pg.fill(b(`props.${k4}.label`), 'Комментарий')

  // смена вида без скрипта: правила прежнего вида сбрасываются после отправки
  await pg.locator(b(`props.${k4}.rules`)).selectOption(['minLength'])
  await pg.locator(b(`props.${k4}.kind`)).selectOption('number')
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="add-field"]')])
  ok('без JS: смена вида сбрасывает выбранные правила после отправки',
    (await chosenRules(pg, k4)).length === 0, (await chosenRules(pg, k4)).join(','))
  const k5 = (await rows(pg))[2]
  await Promise.all([pg.waitForNavigation(), pg.click(`[data-testid="remove-${k5}"]`)])
  ok('без JS: «Удалить» убирает место, остальное на месте', (await rows(pg)).join() === [k1, k4].join())
  // возвращаем комментарию многострочный вид
  await pg.locator(b(`props.${k4}.kind`)).selectOption('textarea')
  ok('без JS: кнопки набора ничего не сохранили', (await pg.locator('[data-testid="saved-set"]').innerText()).includes('версия 2'))

  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="save"]')])
  ok('без JS: сохранение уводит на «Заполнение»',
    pg.url().includes('step=fill') && (await pg.locator('h2').first().innerText()) === 'Заполнение', pg.url())
  ok('без JS: новое поле в форме записи', (await pg.locator(r(`u_${k4}`)).count()) === 1)

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
  await ctx.close()
}

await browser.close()
console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
