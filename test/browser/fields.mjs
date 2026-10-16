/**
 * Браузерные проверки страницы `/fields` (поле `field.fields` и `defineForm({ from })`). Идут на УЖЕ
 * работающий сервер со свежим процессом: набор и запись живут в его кэше.
 *
 *   npm run build && npx vite preview --port 5173 &
 *   node test/browser/fields.mjs
 *
 * Что проверяется:
 *   1. мест нет, пока их не добавили; «+ поле» и «Удалить» — кнопки разметки страницы;
 *   2. ключ места случайный (`f` + 6 знаков), удалённое место не возвращается под тем же ключом;
 *   3. Enter в поле сохраняет набор, а не нажимает «Удалить» первого места;
 *   4. сохранение: значение за пределом набора заменяется; появляется форма записи;
 *   5. правило, которого нет у вида, отклоняется у поля «Правила»;
 *   6. запись: обязательные поля, сверка содержимого файла на сервере;
 *   7. пример записи: значения по ключу, подписи — из текущего набора, удалённое поле не выводится;
 *   8. путь без скрипта: «+ поле» и «Удалить» отправкой формы, набранное не теряется,
 *      сохранение набора, отправка записи, отказ с набранным на месте.
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

const KEY = /^f[a-z0-9]{6}$/
const rows = (pg) => pg.locator('[data-set-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-set-row')))

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

  /* 1–2. места */
  ok('пустая страница: мест нет, формы записи нет',
    (await rows(pg)).length === 0 && (await pg.locator('#fields-record').count()) === 0)
  await pg.click('[data-testid="add-field"]')
  ;[k1] = await rows(pg)
  ok('«+ поле» добавляет место со случайным ключом', KEY.test(k1 ?? ''), k1)
  await pg.fill(b(`props.${k1}.label`), 'Сайт')
  await pg.locator(b(`props.${k1}.kind`)).selectOption('url')
  ok('название не открывает место само', (await rows(pg)).length === 1)
  ok('у вида «Ссылка» правило вида названо', (await pg.locator(`[data-set-row="${k1}"]`).innerText()).includes('Всегда: проверка ссылки'))

  await pg.click('[data-testid="add-field"]')
  k2 = (await rows(pg))[1]
  await pg.fill(b(`props.${k2}.label`), 'Возраст')
  await pg.locator(b(`props.${k2}.kind`)).selectOption('number')
  await pg.locator(b(`props.${k2}.rules`)).selectOption(['required', 'maxValue'])
  await pg.waitForSelector(b(`props.${k2}.max_value`))
  ok('выбранное правило со значением даёт поле числа', (await pg.locator(b(`props.${k2}.max_value`)).count()) === 1)
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

  /* 3–4. сохранение по Enter */
  await pg.focus(b(`props.${k1}.label`))
  await pg.keyboard.press('Enter')
  await pg.waitForSelector('[data-testid="saved-set"]')
  const saved = await pg.locator('[data-testid="saved-set"]').innerText()
  ok('Enter сохраняет набор (версия 1, полей 2), места целы',
    saved.includes('версия 1') && saved.includes('полей: 2') && (await rows(pg)).join() === [k1, k2].join(), saved)
  ok('значение за пределом заменено при сохранении',
    (await pg.inputValue(b(`props.${k2}.max_value`))) === '1000000')
  await pg.waitForSelector('#fields-record')
  ok('форма записи: название, изображение и поля набора по ключам',
    (await pg.locator(r('title')).count()) === 1 && (await pg.locator(r('image')).count()) === 1
    && (await pg.locator(r(`u_${k1}`)).count()) === 1 && (await pg.locator(r(`u_${k2}`)).count()) === 1)

  /* 5. правило не того вида */
  await pg.locator(b(`props.${k1}.kind`)).selectOption('text')
  await pg.locator(b(`props.${k1}.rules`)).selectOption(['minLength'])
  await pg.locator(b(`props.${k1}.kind`)).selectOption('number')
  await pg.click('[data-testid="save"]')
  await pg.waitForFunction((k) => document.querySelector(`[data-field="props.${k}.rules"]`)?.textContent?.includes('недоступно') ||
    document.querySelector(`[data-field="props.${k}.rules"] [id$="-error"]`), k1)
  ok('правило не того вида — ошибка у «Правила»', (await errorsOf(pg, `props.${k1}.rules`)).length > 'Правила'.length,
    await errorsOf(pg, `props.${k1}.rules`))
  ok('набор не перезаписан', (await pg.locator('[data-testid="saved-set"]').innerText()).includes('версия 1'))
  await pg.locator(b(`props.${k1}.kind`)).selectOption('url')
  await pg.locator(b(`props.${k1}.rules`)).selectOption([])

  /* 6. запись */
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

  /* 7. пример записи */
  await pg.setInputFiles(r('image'), { name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await pg.click('[data-testid="record-submit"]')
  await pg.waitForSelector('[data-testid="record-view"]')
  const viewText = () => pg.locator('[data-testid="record-view"]').innerText()
  const view = await viewText()
  const src = await pg.locator('[data-testid="record-view"] img').getAttribute('src')
  ok('пример: название', view.includes('Котик'), view)
  ok('пример: изображение data URL по содержимому', src?.startsWith('data:image/png;base64,iVBOR'), src?.slice(0, 40))
  ok('пример: значения полей списком', view.includes('Сайт') && view.includes('https://example.com')
    && view.includes('Возраст') && view.includes('42'), view)
  ok('форма записи после отправки чистая', (await pg.inputValue(r('title'))) === '')

  // подпись — из текущего набора; поле убрали из набора — значение не выводится
  await pg.fill(b(`props.${k1}.label`), 'Адрес')
  await pg.click(`[data-testid="remove-${k2}"]`)
  await pg.click('[data-testid="save"]')
  await pg.waitForFunction(() => document.querySelector('[data-testid="saved-set"]')?.textContent?.includes('версия 2'))
  await pg.waitForFunction(() => document.querySelector('[data-testid="record-view"]')?.textContent?.includes('Адрес'))
  const renamed = await viewText()
  ok('пример: новая подпись из набора, удалённого поля нет',
    renamed.includes('Адрес') && !renamed.includes('Сайт') && !renamed.includes('Возраст') && renamed.includes('https://example.com'), renamed)
  ok('консоль без ошибок', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300))
  await ctx.close()
}

/* 8. без скрипта */
{
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const pg = await ctx.newPage()
  await pg.goto(BASE)
  ok('без JS: сохранённый набор на месте, пустого места нет', (await rows(pg)).join() === k1, (await rows(pg)).join())

  // набранное до «+ поле» не теряется
  await pg.fill(b(`props.${k1}.label`), 'Сайт')
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="add-field"]')])
  const two = await rows(pg)
  ok('без JS: «+ поле» — новое место, набранное на месте',
    two.length === 2 && two[0] === k1 && KEY.test(two[1] ?? '') && (await pg.inputValue(b(`props.${k1}.label`))) === 'Сайт', two.join(','))
  const k4 = two[1]
  await pg.fill(b(`props.${k4}.label`), 'Комментарий')
  await pg.locator(b(`props.${k4}.kind`)).selectOption('textarea')
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="add-field"]')])
  const k5 = (await rows(pg))[2]
  await Promise.all([pg.waitForNavigation(), pg.click(`[data-testid="remove-${k5}"]`)])
  ok('без JS: «Удалить» убирает место, остальное на месте',
    (await rows(pg)).join() === [k1, k4].join() && (await pg.inputValue(b(`props.${k4}.label`))) === 'Комментарий')
  ok('без JS: кнопки набора ничего не сохранили', (await pg.locator('[data-testid="saved-set"]').innerText()).includes('версия 2'))

  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="save"]')])
  const saved = await pg.locator('[data-testid="saved-set"]').innerText()
  ok('без JS: набор сохранён (версия 3, полей 2)', saved.includes('версия 3') && saved.includes('полей: 2'), saved)
  ok('без JS: новое поле в форме записи', (await pg.locator(r(`u_${k4}`)).count()) === 1)

  await pg.fill(r('title'), 'Без скрипта')
  await pg.fill(r(`u_${k1}`), 'https://example.org')
  await pg.fill(r(`u_${k4}`), 'строка\nвторая')
  await pg.setInputFiles(r('image'), { name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="record-submit"]')])
  const view = await pg.locator('[data-testid="record-view"]').innerText().catch(() => '')
  ok('без JS: запись заменена', view.includes('Без скрипта') && view.includes('Комментарий') && view.includes('https://example.org'), view)

  // отказ без JS: набранное возвращается в разметку, ошибка — у своего места
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="add-field"]')])
  const k6 = (await rows(pg))[2]
  await pg.fill(b(`props.${k6}.label`), 'Плохое')
  await pg.locator(b(`props.${k6}.kind`)).selectOption('number')
  await pg.locator(b(`props.${k6}.rules`)).selectOption(['minLength'])
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="save"]')])
  ok('без JS: отказ — ошибка у «Правила» места, набранное на месте',
    (await errorsOf(pg, `props.${k6}.rules`)).includes('не подходит') && (await pg.inputValue(b(`props.${k6}.label`))) === 'Плохое',
    await errorsOf(pg, `props.${k6}.rules`))
  ok('без JS: набор после отказа не перезаписан', (await pg.locator('[data-testid="saved-set"]').innerText()).includes('версия 3'))
  await ctx.close()
}

await browser.close()
console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
