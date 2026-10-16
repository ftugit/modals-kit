/**
 * Браузерные проверки страницы `/fields` (поле `field.fields` и `defineForm({ from })`). Идут на УЖЕ
 * работающий сервер со свежим процессом: набор и запись живут в его кэше.
 *
 *   npm run build && npx vite preview --port 5173 &
 *   node test/browser/fields.mjs
 *
 * Что проверяется:
 *   1. набранное название открывает следующую ячейку, «Удалить» её прячет;
 *   2. сохранение: значение за пределом набора заменяется;
 *   3. после сохранения появляется форма записи с полями набора;
 *   4. правило, которого нет у вида, отклоняется у поля «Правила»;
 *   5. запись: обязательные поля, сверка содержимого файла на сервере;
 *   6. пример записи: название, изображение data URL, значения полей;
 *   7. путь без скрипта: сохранение набора, отправка записи, отказ с набранным на месте.
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

const browser = await chromium.launch()
const consoleErrors = []
{
  const ctx = await browser.newContext()
  const pg = await ctx.newPage()
  // 422 — ожидаемые отказы сервера в проверках ниже; браузер пишет их в консоль сам
  pg.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('status of 422')) consoleErrors.push(m.text()) })
  pg.on('pageerror', (e) => consoleErrors.push(String(e)))
  await pg.goto(BASE, { waitUntil: 'networkidle' })
  await pg.waitForFunction(() => !document.querySelector('[data-testid="remove-s1"][title]'))

  /* 1. ячейки */
  ok('пустая страница: одна ячейка, формы записи нет',
    (await pg.locator('[data-slot^="s"]').count()) === 1 && (await pg.locator('#fields-record').count()) === 0)
  await pg.fill(b('props.s1.label'), 'Сайт')
  await pg.locator(b('props.s1.kind')).selectOption('url')
  await pg.waitForSelector('[data-slot="s2"]')
  ok('название открывает следующую ячейку', (await pg.locator('[data-slot="s2"]').count()) === 1)
  ok('у вида «Ссылка» правило вида названо', (await pg.locator('[data-slot="s1"]').innerText()).includes('Всегда: проверка ссылки'))

  await pg.fill(b('props.s2.label'), 'Возраст')
  await pg.locator(b('props.s2.kind')).selectOption('number')
  await pg.locator(b('props.s2.rules')).selectOption(['required', 'maxValue'])
  await pg.waitForSelector(b('props.s2.max_value'))
  ok('выбранное правило со значением даёт поле числа', (await pg.locator(b('props.s2.max_value')).count()) === 1)
  await pg.fill(b('props.s2.max_value'), '99999999')

  await pg.fill(b('props.s3.label'), 'Лишнее')
  await pg.waitForSelector('[data-slot="s4"]')
  await pg.click('[data-testid="remove-s3"]')
  ok('«Удалить» прячет ячейку', (await pg.locator('[data-slot="s3"]').count()) === 0
    && (await pg.locator('[data-slot="s4"]').count()) === 1)

  /* 2–3. сохранение */
  await pg.click('[data-testid="save"]')
  await pg.waitForSelector('[data-testid="saved-set"]')
  const saved = await pg.locator('[data-testid="saved-set"]').innerText()
  ok('набор сохранён, версия 1, полей 2', saved.includes('версия 1') && saved.includes('полей: 2'), saved)
  ok('значение за пределом заменено при сохранении',
    (await pg.inputValue(b('props.s2.max_value'))) === '1000000')
  await pg.waitForSelector('#fields-record')
  ok('форма записи: название, изображение и поля набора',
    (await pg.locator(r('title')).count()) === 1 && (await pg.locator(r('image')).count()) === 1
    && (await pg.locator(r('u_s1')).count()) === 1 && (await pg.locator(r('u_s2')).count()) === 1)

  /* 4. правило не того вида */
  await pg.locator(b('props.s1.kind')).selectOption('text')
  await pg.locator(b('props.s1.rules')).selectOption(['minLength'])
  await pg.locator(b('props.s1.kind')).selectOption('number')
  await pg.click('[data-testid="save"]')
  await pg.waitForFunction(() => document.querySelector('[data-field="props.s1.rules"]')?.textContent?.includes('недоступно') ||
    document.querySelector('[data-field="props.s1.rules"] [id$="-error"]'))
  ok('правило не того вида — ошибка у «Правила»', (await errorsOf(pg, 'props.s1.rules')).length > 'Правила'.length,
    await errorsOf(pg, 'props.s1.rules'))
  ok('набор не перезаписан', (await pg.locator('[data-testid="saved-set"]').innerText()).includes('версия 1'))

  /* 5. запись */
  await pg.click('[data-testid="record-submit"]')
  await pg.waitForTimeout(400)
  ok('пустая запись: ошибки у названия, изображения и обязательного поля набора',
    (await errorsOf(pg, 'title')).length > 'Название'.length && (await errorsOf(pg, 'image')).includes('Изображение')
    && (await pg.locator(`${r('u_s2')}[aria-invalid="true"]`).count()) === 1)

  await pg.fill(r('title'), 'Котик')
  await pg.fill(r('u_s1'), 'https://example.com')
  await pg.fill(r('u_s2'), '42')
  await pg.setInputFiles(r('image'), { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image at all') })
  await pg.click('[data-testid="record-submit"]')
  await pg.waitForFunction(() => document.querySelector('[data-field="image"]')?.textContent?.includes('не подходит'))
  ok('сервер сверяет содержимое файла, а не заявленный тип', (await errorsOf(pg, 'image')).includes('не подходит'))

  /* 6. пример записи */
  await pg.setInputFiles(r('image'), { name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await pg.click('[data-testid="record-submit"]')
  await pg.waitForSelector('[data-testid="record-view"]')
  const view = await pg.locator('[data-testid="record-view"]').innerText()
  const src = await pg.locator('[data-testid="record-view"] img').getAttribute('src')
  ok('пример: название', view.includes('Котик'), view)
  ok('пример: изображение data URL по содержимому', src?.startsWith('data:image/png;base64,iVBOR'), src?.slice(0, 40))
  ok('пример: значения полей списком', view.includes('Сайт') && view.includes('https://example.com')
    && view.includes('Возраст') && view.includes('42'), view)
  ok('форма записи после отправки чистая', (await pg.inputValue(r('title'))) === '')
  ok('консоль без ошибок', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300))
  await ctx.close()
}

/* 7. без скрипта */
{
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const pg = await ctx.newPage()
  await pg.goto(BASE)
  ok('без JS: сохранённый набор и пустая ячейка на месте',
    (await pg.locator('[data-slot="s1"]').count()) === 1 && (await pg.locator('[data-slot="s3"]').count()) === 1)
  await pg.fill(b('props.s3.label'), 'Комментарий')
  await pg.locator(b('props.s3.kind')).selectOption('textarea')
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="save"]')])
  const saved = await pg.locator('[data-testid="saved-set"]').innerText()
  ok('без JS: набор сохранён (версия 2, полей 3)', saved.includes('версия 2') && saved.includes('полей: 3'), saved)
  ok('без JS: новое поле в форме записи', (await pg.locator(r('u_s3')).count()) === 1)

  await pg.fill(r('title'), 'Без скрипта')
  await pg.fill(r('u_s1'), 'https://example.org')
  await pg.fill(r('u_s2'), '7')
  await pg.fill(r('u_s3'), 'строка\nвторая')
  await pg.setInputFiles(r('image'), { name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="record-submit"]')])
  const view = await pg.locator('[data-testid="record-view"]').innerText().catch(() => '')
  ok('без JS: запись заменена', view.includes('Без скрипта') && view.includes('Комментарий') && view.includes('https://example.org'), view)

  // отказ без JS: набранное возвращается в разметку, ошибка — у своего места
  await pg.fill(b('props.s4.label'), 'Плохое')
  await pg.locator(b('props.s4.kind')).selectOption('number')
  await pg.locator(b('props.s4.rules')).selectOption(['minLength'])
  await Promise.all([pg.waitForNavigation(), pg.click('[data-testid="save"]')])
  ok('без JS: отказ — ошибка у «Правила» места, набранное на месте',
    (await errorsOf(pg, 'props.s4.rules')).includes('не подходит') && (await pg.inputValue(b('props.s4.label'))) === 'Плохое',
    await errorsOf(pg, 'props.s4.rules'))
  ok('без JS: набор после отказа не перезаписан', (await pg.locator('[data-testid="saved-set"]').innerText()).includes('версия 2'))
  await ctx.close()
}

await browser.close()
console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
