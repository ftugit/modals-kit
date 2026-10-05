/**
 * Браузерные проверки форм. Идут на УЖЕ работающий сервер, как остальные
 * тесты репозитория: адрес в FORMS_BASE (по умолчанию vite preview).
 *
 *   npm run build && npm run preview &
 *   node test/browser/forms.mjs
 *
 * Что проверяется:
 *   1. расширение: свой тип и своё правило дают атрибуты без правки библиотеки;
 *   2. правило без описания атрибута не даёт, причина названа;
 *   3. ПУТЬ БЕЗ СКРИПТА: javaScriptEnabled: false, обычная отправка;
 *   4. совпадение путей: один сценарий через action и через перехват;
 *   5. факт против показа: фильтр убирает текст, подсветка остаётся;
 *   6. подсветка по показу гаснет;
 *   7. песочница: без регистрации типа описание не объявляется;
 *   8. чужая служба: нормализация до обработчика;
 *   9. повторяемая группа: добавление и удаление строки по стабильному ключу;
 *  10. поле из рантайма: спецификация компилируется и даёт атрибуты;
 *  11. асинхронная проверка: ошибка приходит после паузы;
 *  12. серверные слои: неизвестное поле отклоняется, идемпотентность;
 *  13. сложность пароля: оценка вместо шаблона, шкала совпадает с проверкой.
 */
import { chromium } from 'playwright'

const BASE = process.env.FORMS_BASE ?? 'http://127.0.0.1:5173/form'
let failed = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failed++
}

const click = (pg, text) => pg.evaluate((t) => {
  const el = [...document.querySelectorAll('button')].find((n) => n.textContent.trim() === t)
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}, text).then(() => pg.waitForTimeout(350))

const fill = async (pg, values) => {
  for (const [id, value] of Object.entries(values)) {
    const el = pg.locator(`#${id}`)
    await el.scrollIntoViewIfNeeded().catch(() => {})
    // force: у приложения-хозяина шапка схлопывается при прокрутке, и Playwright
    // не дожидается «стабильности» элемента
    if (await el.getAttribute('type') === 'checkbox') await el.check({ force: true })
    else await el.fill(value)
  }
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })

/* ── 1–2. расширение ──────────────────────────────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 3000 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)

  ok('свой тип значения даёт атрибуты',
    await pg.locator('#signup-rating').getAttribute('type') === 'range'
    && await pg.locator('#signup-rating').getAttribute('max') === '5')
  ok('своё правило с описанием даёт шаблон',
    await pg.locator('#signup-tax_id').getAttribute('pattern') === '\\d{10}|\\d{12}')
  ok('своё правило без описания атрибута не даёт',
    await pg.locator('#signup-card').getAttribute('pattern') === null)

  const report = await pg.locator('section:has-text("Ограничения → атрибуты") tbody').innerText()
  ok('причина отказа названа', report.includes('валидатор не описал себя'))

  /* ── 5–6. факт против показа ────────────────────────────────── */
  /* ── 13. сложность пароля ───────────────────────────────────── */
  ok('у пароля нет шаблона в разметке',
    await pg.locator('#signup-password').getAttribute('pattern') === null)
  ok('а нижняя граница длины есть',
    await pg.locator('#signup-password').getAttribute('minlength') === '10')

  await pg.fill('#signup-password', 'testtest1')
  await pg.waitForTimeout(200)
  const weakText = await pg.locator('div:has(> input#signup-password) span[aria-live]').innerText()
  ok('повтор слова с цифрой не считается надёжным',
    /слабый|средний/.test(weakText), weakText)

  await pg.fill('#signup-password', 'Tr0ub4dour&3')
  await pg.waitForTimeout(200)
  const strongText = await pg.locator('div:has(> input#signup-password) span[aria-live]').innerText()
  ok('знаки усиливают, а не мешают', /надёжный/.test(strongText), strongText)

  await pg.fill('#signup-password', '')
  await fill(pg, { 'signup-password': 'abc' })
  await click(pg, 'Создать аккаунт')
  // серверные асинхронные проверки выполняются всегда — ждём дольше
  await pg.waitForTimeout(1500)
  const texts = await pg.locator('p.text-destructive').allInnerTexts()
  ok('текст ошибки показан', texts.some((t) => t.includes('Минимум 10')), texts.join(' | '))

  await click(pg, 'без minLength')
  await click(pg, 'Создать аккаунт')
  await pg.waitForTimeout(1500)
  const after = await pg.locator('p.text-destructive').allInnerTexts()
  ok('фильтр убрал текст', !after.some((t) => t.includes('Минимум 8')))
  ok('подсветка по факту осталась',
    await pg.locator('#signup-password').getAttribute('aria-invalid') === 'true')

  await click(pg, 'по показу')
  await click(pg, 'Создать аккаунт')
  await pg.waitForTimeout(1500)
  ok('подсветка по показу погасла',
    await pg.locator('#signup-password').getAttribute('aria-invalid') === null)

  /* ── 7. песочница ───────────────────────────────────────────── */
  const sandbox = pg.locator('section:has-text("Расширение на лету")')
  const text = await sandbox.innerText()
  ok('без регистрации типа описание не объявляется',
    text.includes('не зарегистрирован') && text.includes("тип значения 'rating'"))
  await click(pg, 'зарегистрирован')
  ok('после регистрации описание собирается',
    (await sandbox.innerText()).includes('type="range"'))
  await click(pg, 'с описанием')
  ok('правило с описанием даёт шаблон в песочнице',
    (await sandbox.innerText()).includes('pattern="\\d{6}"'))

  /* ── 8. чужая служба ────────────────────────────────────────── */
  const service = pg.locator('section:has-text("Чужая служба")')
  ok('имена службы переведены в наши',
    (await service.innerText()).includes('card external.LUHN_FAILED'))
  await click(pg, 'формат не распознан')
  ok('нераспознанный формат не даёт тишины',
    (await service.innerText()).includes('service.502'))

  await pg.close()
}

/* ── 9–11. динамика и асинхронная проверка ───────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 3200 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)

  const rows = () => pg.locator('fieldset[class*="space-y-3"] [data-row]').count()
  ok('группа начинается с одной строки', await rows() === 1)
  await click(pg, '+ Позиция')
  ok('строка добавлена', await rows() === 2)
  const keys = await pg.locator('[data-row]').evaluateAll((els) => els.map((e) => e.dataset['row']))
  await pg.evaluate((k) => {
    const row = document.querySelector(`[data-row="${k}"]`)
    row?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, keys[0])
  await pg.waitForTimeout(300)
  ok('удалена именно своя строка', await rows() === 1
    && (await pg.locator('[data-row]').getAttribute('data-row')) === keys[1])

  await click(pg, '+ Поле из рантайма')
  ok('поле из рантайма появилось', await pg.locator('#signup-u_extra1').count() === 1)
  ok('и получило атрибуты из реестра',
    (await pg.locator('#signup-u_extra1').getAttribute('pattern'))?.includes('[1-9]') === true)

  await pg.fill('#signup-email', 'taken@example.com')
  await pg.locator('#signup-email').blur()
  await pg.waitForTimeout(1200)
  const asyncErrors = await pg.locator('p.text-destructive').allInnerTexts()
  ok('асинхронная проверка дала ошибку', asyncErrors.some((t) => t.includes('email.taken')
    || t.includes('занят')), asyncErrors.join(' | '))
  await pg.close()
}

/* ── 3–4. путь без скрипта и совпадение путей ─────────────────────── */
const scenario = {
  'signup-email': 'a@b.io',
  'signup-password': 'longenough1',
  'signup-confirm': 'ДРУГОЙ',          // ловится ТОЛЬКО сервером
  'signup-age': '30',
  'signup-tax_id': '7712345678',
  'signup-card': '4242424242424242',
  'signup-agree': 'on',
}

async function run(jsEnabled) {
  const ctx = await browser.newContext({ javaScriptEnabled: jsEnabled,
                                         viewport: { width: 1280, height: 3000 } })
  const pg = await ctx.newPage()
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  if (jsEnabled) await pg.waitForTimeout(900)
  await fill(pg, scenario)
  if (jsEnabled) {
    await click(pg, 'Создать аккаунт')
    await pg.waitForTimeout(1800)
  } else {
    await Promise.all([
      pg.waitForLoadState('load'),
      pg.locator('button[value=submit]').click({ force: true }),
    ])
    await pg.waitForTimeout(300)
  }
  const errors = (await pg.locator('p.text-destructive').allInnerTexts()).sort()
  const kept = await pg.inputValue('#signup-email')
  await ctx.close()
  return { errors, kept }
}

/* ── 12. серверные слои ───────────────────────────────────────────── */
{
  const ctx = await browser.newContext()
  const envelope = {
    __form_id: 'signup', __form_rev: '1', __form_instance: 'signup:new',
    __form_submission: '0192f3c1-4b8e-7c2a-9d1f-6e5a4b3c2d10', intent: 'submit',
  }
  // preview-сервер строже dev: POST без Origin считается межсайтовым и
  // отвергается CSRF-защитой. Браузер Origin шлёт всегда — шлём и мы.
  const post = (extra = {}) => ctx.request.post(new URL('/form/submit', BASE).href, {
    headers: { origin: new URL(BASE).origin },
    multipart: { ...envelope, ...extra },
  })
  const unexpected = await (await post({ ghost: 'x' })).json()
  ok('неизвестное поле отклоняется слоем имён',
    unexpected.errors?.[0]?.code === 'request.unexpected-field')

  const good = { email: 'ok@example.com', password: 'longenough1', confirm: 'longenough1',
                 age: '30', tax_id: '7712345678', card: '4242424242424242', agree: 'on' }
  const first = await (await post(good)).json()
  const again = await (await post(good)).json()
  ok('успех фиксируется явно', first.outcome === 'committed', first.outcome)
  ok('повтор возвращает прежний результат, обработчик не зовётся',
    again.outcome === 'committed' && again.submissionId === first.submissionId)
  await ctx.close()
}

const nojs = await run(false)
const js = await run(true)

ok('без скрипта форма работает', nojs.errors.length > 0, nojs.errors.join(' | '))
ok('без скрипта значения возвращаются', nojs.kept === 'a@b.io')
ok('пути дают одинаковые ошибки',
  JSON.stringify(nojs.errors) === JSON.stringify(js.errors),
  `${nojs.errors.join('|')} против ${js.errors.join('|')}`)

await browser.close()
console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
