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
 *  10. асинхронная проверка: ошибка приходит после паузы;
 *  11. серверные слои: неизвестное поле отклоняется, идемпотентность;
 *  12. сложность пароля: оценка вместо шаблона, шкала совпадает с проверкой;
 *  14. ещё поля (url, период, время, ползунок, цвет, файлы, скрытое), видимость
 *      по значению, проверка части полей, ответы сервера (переход, очередь, «неизвестно»),
 *      описания опций панели; то же без скрипта.
 *  Поля, которые собирает пользователь, — `test/browser/fields.mjs` (страница `/fields`).
 */
import { chromium } from 'playwright'

const BASE = process.env.FORMS_BASE ?? 'http://127.0.0.1:5173/form'
let failed = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failed++
}


/** Панель — select-поля механизма: выбор опции по подписи поля и подписи опции. */
const pick = async (pg, fieldText, optionText) => {
  const sel = pg.locator(`label:has-text("${fieldText}") select`)
  const value = await sel.locator('option', { hasText: optionText }).first().getAttribute('value')
  await sel.selectOption(value)
  await pg.waitForTimeout(350)
}
/** Тумблер механизма (Toggle над Switch-примитивом). */
const flip = (pg, labelText) =>
  pg.locator(`label:has-text("${labelText}") input`).first().check({ force: true })
    .then(() => pg.waitForTimeout(350))

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

/**
 * Ожидание готовности формы, а не фиксированной паузы.
 *
 * ХОЛОДНЫЙ `vite dev` отдаёт разметку раньше, чем ядро формы привязалось к
 * узлам (первый запрос догружает модули). Клик по «Создать аккаунт» в этот
 * момент уходит в никуда: в DOM не появляется НИ ОДНОЙ ошибки, и проверка
 * fetch-пути падает без причины (воспроизведено 2026-10-07: холодный прогон —
 * FAIL без текста, прогретый — зелёный; ожидание ПОСЛЕ клика не помогает —
 * потерян сам клик). Признак привязки даёт само ядро: оно ставит форме
 * `novalidate` (перехватывает отправку). Ждём этот факт до клика.
 */
async function readyToSubmit(pg) {
  await pg.waitForFunction(
    () =>
      !![...document.querySelectorAll('form')].find(
        (form) => form.hasAttribute('novalidate') && form.querySelector('#signup-email'),
      ),
    null,
    { timeout: 20000 },
  )
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })

/* ── 1–2. расширение ──────────────────────────────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 3000 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)

  // Панель настроек — универсальный DemoPanel: id полей = имена ключей схемы.
  ok('панель — поля form: контролы с id=имени и значением из зеркала',
    await pg.locator('#mode').evaluate((el) => el.tagName === 'SELECT' && el.name === 'mode'
      && el.value === 'as-is')
    && await pg.locator('#with_type').evaluate((el) => el.getAttribute('role') === 'switch'))

  ok('свой тип значения даёт атрибуты',
    await pg.locator('#signup-rating').getAttribute('type') === 'range'
    && await pg.locator('#signup-rating').getAttribute('max') === '5')
  ok('своё правило с описанием даёт шаблон',
    await pg.locator('#signup-tax_id').getAttribute('pattern') === '\\d{10}|\\d{12}')
  ok('своё правило без описания атрибута не даёт',
    await pg.locator('#signup-card').getAttribute('pattern') === null)

  // Живой пример `variant: 'auto'` (вопрос №4 плана): ширина по значению, а не
  // во всю строку — поле-sizing, минимальная ширина в символах и класс `w-auto`.
  const auto = await pg.locator('#signup-tax_id').evaluate((el) => ({
    minWidth: el.style.getPropertyValue('--field-min-width'),
    auto: el.classList.contains('w-auto') && el.classList.contains('field-sizing-content'),
  }))
  ok('ширина по значению: у поля есть минимум в символах и класс авто-ширины',
    auto.minWidth === '8ch' && auto.auto, JSON.stringify(auto))
  const wideBox = await pg.locator('#signup-email').boundingBox()
  const autoBox = await pg.locator('#signup-tax_id').boundingBox()
  ok('ширина по значению: поле уже обычного текстового',
    !!wideBox && !!autoBox && autoBox.width < wideBox.width,
    `${autoBox?.width} против ${wideBox?.width}`)

  const report = await pg.locator('section:has-text("Ограничения → атрибуты") tbody').innerText()
  ok('причина отказа названа', report.includes('валидатор не описал себя'))

  // type=email недостаточно: fetch-путь ставит novalidate и обязан получить
  // тот же вердикт из общего ядра.
  await readyToSubmit(pg)
  await pg.fill('#signup-email', 'fffffffff')
  await click(pg, 'Создать аккаунт')
  // Вердикт приходит из того же ядра, но асинхронно (транспорт) — ждём ФАКТ,
  // а не время: на прогретом сервере он появляется почти сразу.
  const sawEmailVerdict = await pg
    .waitForFunction(
      () => [...document.querySelectorAll('p.text-destructive')].some((p) => /адрес почты/i.test(p.textContent ?? '')),
      null,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false)
  const emailErrors = await pg.locator('p.text-destructive').allInnerTexts()
  ok('fetch-путь отклоняет строку без формата email', sawEmailVerdict, emailErrors.join(' | '))

  /* ── 5–6. факт против показа ────────────────────────────────── */
  /* ── 13. сложность пароля ───────────────────────────────────── */
  ok('у пароля нет шаблона в разметке',
    await pg.locator('#signup-password').getAttribute('pattern') === null)
  ok('а нижняя граница длины есть',
    await pg.locator('#signup-password').getAttribute('minlength') === '10')

  await pg.fill('#signup-password', 'testtest1')
  await pg.waitForTimeout(200)
  const weakText = await pg.locator('div:has(> [data-password-input] > input#signup-password) span[aria-live]').innerText()
  ok('повтор слова с цифрой не считается надёжным',
    /слабый|средний/.test(weakText), weakText)

  await pg.fill('#signup-password', 'Tr0ub4dour&3')
  await pg.waitForTimeout(200)
  const strongText = await pg.locator('div:has(> [data-password-input] > input#signup-password) span[aria-live]').innerText()
  ok('знаки усиливают, а не мешают', /надёжный/.test(strongText), strongText)

  await pg.fill('#signup-password', '')
  await fill(pg, { 'signup-password': 'abc' })
  await click(pg, 'Создать аккаунт')
  // серверные асинхронные проверки выполняются всегда — ждём дольше
  await pg.waitForTimeout(1500)
  const texts = await pg.locator('p.text-destructive').allInnerTexts()
  ok('текст ошибки показан', texts.some((t) => t.includes('Минимум 10')), texts.join(' | '))

  await pick(pg, 'Обработчик ошибок', 'без minLength')
  await click(pg, 'Создать аккаунт')
  await pg.waitForTimeout(1500)
  const after = await pg.locator('p.text-destructive').allInnerTexts()
  ok('фильтр убрал текст', !after.some((t) => t.includes('Минимум 8')))
  ok('подсветка по факту осталась',
    await pg.locator('#signup-password').getAttribute('aria-invalid') === 'true')

  await pick(pg, 'Откуда берётся подсветка', 'по показу')
  await click(pg, 'Создать аккаунт')
  await pg.waitForTimeout(1500)
  ok('подсветка по показу погасла',
    await pg.locator('#signup-password').getAttribute('aria-invalid') === null)

  // Переключатель обязан переразложить уже показанные ошибки сразу, без
  // повторной отправки. Это и есть наглядный контракт панели демо.
  await pick(pg, 'Обработчик ошибок', 'всё в общий')
  await pg.waitForTimeout(50)
  const demoStatus = await pg.locator('[aria-live="polite"]:has-text("Фактов:")').innerText()
  ok('«всё в общий» сразу переносит текущие ошибки наверх',
    /общих: [1-9]/.test(demoStatus)
    && await pg.locator('div:has(> [data-password-input] > input#signup-password) p.text-destructive').count() === 0,
    demoStatus)
  ok('побочный эффект mode записан в зеркало: селектор подсветки стал «по показу»',
    (await pg.locator('#invalid_from').inputValue()) === 'shown')

  /* ── 7. песочница ───────────────────────────────────────────── */
  const sandbox = pg.locator('section:has-text("Расширение на лету")')
  const text = await sandbox.innerText()
  ok('без регистрации типа описание не объявляется', text.includes("тип значения 'rating'"))
  await flip(pg, 'Тип значения rating')
  ok('после регистрации описание собирается',
    (await sandbox.innerText()).includes('type="range"'))
  await flip(pg, 'Правило «шестизначный код» — с описанием')
  ok('правило с описанием даёт шаблон в песочнице',
    (await sandbox.innerText()).includes('pattern="\\d{6}"'))

  /* ── 8. чужая служба ────────────────────────────────────────── */
  const service = pg.locator('section:has-text("Чужая служба")')
  ok('имена службы переведены в наши',
    (await service.innerText()).includes('card external.LUHN_FAILED'))
  await pick(pg, 'Образец чужой службы', 'формат не распознан')
  ok('нераспознанный формат не даёт тишины',
    (await service.innerText()).includes('service.502'))

  await pg.close()
}

/* ── 10–11. асинхронная проверка ─────────────────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 3200 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)

  await pg.fill('#signup-email', 'taken@example.com')
  await pg.locator('#signup-email').blur()
  await pg.waitForTimeout(1200)
  const asyncErrors = await pg.locator('p.text-destructive').allInnerTexts()
  // Текст — из `messages` поля, как у синхронных ошибок; код наружу не
  // попадает (F57: раньше живая проверка показывала код; теперь код `unique`, текст — из `messages` поля).
  ok('асинхронная проверка дала ошибку с текстом', asyncErrors.includes('Этот адрес уже занят'), asyncErrors.join(' | '))
  ok('код проверки не показан вместо текста', !asyncErrors.some((t) => /email\.taken|\bunique\b/.test(t)), asyncErrors.join(' | '))
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
  // Панель настроек — универсальная DemoPanel: до оживления её поля выключены
  // (jsOnly), после — живые. Ждём ФАКТ, а не время.
  if (jsEnabled) {
    await pg.waitForFunction(() => {
      const selects = [...document.querySelectorAll('[data-testid="demo-panel"] select')]
      return selects.length >= 9 && selects.every((node) => !node.disabled)
    }, null, { timeout: 20000 })
  }
  const settingsState = await pg.evaluate(() => {
    const panel = document.querySelector('[data-testid="demo-panel"]')
    const form = document.querySelector('form:has(#signup-email)') ?? document.querySelector('form')
    const email = document.querySelector('#signup-email')
    const submit = form?.querySelector('button[value="submit"]')
    const route = [...document.querySelectorAll('a')].find((el) => el.getAttribute('href') === '/modals')
    const controls = [...(panel?.querySelectorAll('select, [role="switch"]') ?? [])]
    return {
      hasPanel: !!panel,
      count: controls.length,
      disabled: controls.map((node) => node.matches(':disabled')),
      emailDisabled: !email || email.matches(':disabled'),
      submitDisabled: !submit || submit.matches(':disabled'),
      routeHref: route?.getAttribute('href') ?? null,
      hint: [...(panel?.querySelectorAll('[data-field-hint]') ?? [])]
        .map((node) => node.textContent.trim()).filter(Boolean),
    }
  })
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
  return { errors, kept, settingsState }
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
ok('без скрипта настройки панели заблокированы',
  nojs.settingsState.hasPanel
    && nojs.settingsState.count >= 10
    && nojs.settingsState.disabled.every(Boolean), JSON.stringify(nojs.settingsState))
ok('без скрипта форма и переход на другую страницу остаются доступны',
  !nojs.settingsState.emailDisabled
    && !nojs.settingsState.submitDisabled
    && nojs.settingsState.routeHref === '/modals', JSON.stringify(nojs.settingsState))
ok('после гидратации настройки панели включены',
  js.settingsState.hasPanel
    && js.settingsState.count >= 10
    && js.settingsState.disabled.every((disabled) => !disabled), JSON.stringify(js.settingsState))
ok('пока страница не ожила, подсказка о неактивных настройках видна',
  nojs.settingsState.hint.length >= 10
    && nojs.settingsState.hint.every((text) => text === 'доступно после загрузки JavaScript'),
  String(nojs.settingsState.hint))
ok('после оживления подсказка о неактивных настройках скрыта',
  !js.settingsState.hint.includes('доступно после загрузки JavaScript'), String(js.settingsState.hint))
ok('без скрипта значения возвращаются', nojs.kept === 'a@b.io')
ok('пути дают одинаковые ошибки',
  JSON.stringify(nojs.errors) === JSON.stringify(js.errors),
  `${nojs.errors.join('|')} против ${js.errors.join('|')}`)

/* ── проверка клиента до отправки, ошибка сервера и её снятие правкой (ход 111) ── */
{
  console.log('— клиент до отправки, ошибка сервера за значением —')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 3000 } })
  const pg = await ctx.newPage()
  let posts = 0
  pg.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/form/submit') posts++ })
  await pg.goto(BASE, { waitUntil: 'networkidle' })
  await readyToSubmit(pg)
  await fill(pg, { ...scenario, 'signup-email': 'not-an-email' })
  await click(pg, 'Создать аккаунт')
  await pg.waitForTimeout(600)
  ok('клиент: неверное поле останавливает отправку до сети', posts === 0, `запросов: ${posts}`)
  ok('клиент: ошибка показана у поля', await pg.locator('#signup-email').getAttribute('aria-invalid') === 'true')

  // Ошибка, которую решает только сервер: адрес занят. Живая проверка в браузере идёт
  // с задержкой, отправка сразу после ввода её опережает — ответ сервера и есть ошибка.
  await fill(pg, { 'signup-email': 'taken@example.com', 'signup-confirm': scenario['signup-password'] })
  await click(pg, 'Создать аккаунт')
  await pg.waitForFunction(() => document.querySelector('#signup-email')?.getAttribute('aria-invalid') === 'true',
    null, { timeout: 10000 }).catch(() => {})
  const errorOf = () => pg.evaluate(() => {
    const input = document.querySelector('#signup-email')
    if (input?.getAttribute('aria-invalid') !== 'true') return null
    const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    return ids.map((id) => document.getElementById(id)).find((n) => n?.matches('.text-destructive'))?.textContent?.trim()
      ?? 'aria-invalid'
  })
  const shown = await errorOf()
  ok('сервер: отправка опередила живую проверку — ошибка адреса пришла ответом', posts === 1 && shown === 'Этот адрес уже занят', `${posts} / ${shown}`)
  const email = pg.locator('#signup-email')
  await email.focus()
  await email.press('End')
  await email.press('x')
  await pg.waitForTimeout(100)
  ok('сервер: правка значения снимает ошибку сразу, без ухода с поля', await errorOf() === null, String(await errorOf()))
  await email.press('Backspace')
  // Ошибку `unique` сервер дал по общему правилу (origin 'core'): клиент умеет проверить
  // её сам, поэтому возврат значения снова запускает живую проверку — без закрепа
  // (закреп — для ошибок, которые решает только сервер: см. db-demo.mjs).
  await pg.waitForFunction(() => document.querySelector('#signup-email')?.getAttribute('aria-invalid') === 'true',
    null, { timeout: 5000 }).catch(() => {})
  ok('сервер: возврат к отклонённому значению — живая проверка показывает ошибку снова', await errorOf() === shown, String(await errorOf()))
  ok('сервер: фокус остался в поле (без ухода)', await email.evaluate((el) => el === document.activeElement))
  await ctx.close()
}

/* ── примитивы полей (ход 117): пароль с показом, число с шагом, код, переключатель, список ── */
{
  console.log('— примитивы полей формы —')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 3000 } })
  const pg = await ctx.newPage()
  await pg.goto(BASE, { waitUntil: 'networkidle' })
  await pg.waitForSelector('[data-password-input] button[aria-pressed]', { timeout: 20000 })

  const pass = pg.locator('#signup-password')
  await pass.fill('secret-123')
  const eye = pg.locator('[data-password-input]:has(#signup-password) button[aria-pressed]')
  await eye.click()
  ok('пароль: глаз показывает введённое', await pass.getAttribute('type') === 'text')
  ok('пароль: значение при показе не теряется', await pass.inputValue() === 'secret-123')
  await eye.click()
  ok('пароль: второй щелчок снова прячет', await pass.getAttribute('type') === 'password')

  // Вариант 'strength' выбирает другой примитив: PasswordStrength = PasswordInput + шкала.
  const meter = pg.locator('[data-password-input]:has(#signup-password) + [data-strength]')
  ok('пароль (strength): шкала под полем', await meter.count() === 1)
  ok('пароль (strength): оценка от strengthOf, 1–4',
    ['1', '2', '3', '4'].includes(await meter.getAttribute('data-score') ?? ''), await meter.getAttribute('data-score'))
  ok('пароль (strength): подпись с битами', /бит$/.test((await meter.innerText()).trim()), await meter.innerText())
  await pass.fill('')
  ok('пароль (strength): пустое поле — шкалы нет', await meter.count() === 0)
  await pass.fill('secret-123')
  await pg.locator('#signup-confirm').fill('secret-123')
  ok('повтор пароля: без варианта — глаз есть, шкалы нет',
    await pg.locator('[data-password-input]:has(#signup-confirm) button[aria-pressed]').count() === 1
      && await pg.locator('[data-password-input]:has(#signup-confirm) + [data-strength]').count() === 0)

  const age = pg.locator('#signup-age')
  await age.fill('')
  await pg.locator('[data-number-field]:has(#signup-age) [data-number-step="up"]').click()
  ok('число: «+» с пустого начинает с min (18)', await age.inputValue() === '18', await age.inputValue())
  await pg.locator('[data-number-field]:has(#signup-age) [data-number-step="up"]').click()
  ok('число: «+» шагает на 1', await age.inputValue() === '19', await age.inputValue())
  ok('число: «−» у границы min выключается после шага вниз',
    await (async () => {
      await pg.locator('[data-number-field]:has(#signup-age) [data-number-step="down"]').click()
      return pg.locator('[data-number-field]:has(#signup-age) [data-number-step="down"]').isDisabled()
    })())

  ok('код: шесть ячеек из правила длины', await pg.locator('[data-otp-slot]').count() === 6)
  const otp = pg.locator('#signup-invite')
  await otp.pressSequentially('12a34')
  ok('код: в поле попадают только цифры', await otp.inputValue() === '1234', await otp.inputValue())
  // Дописываем до шести: иначе ошибка шаблона появится на уходе из поля и сдвинет
  // разметку между нажатием и отпусканием мыши на следующем шаге.
  await otp.pressSequentially('56')
  ok('код: шесть цифр — без ошибки', await otp.inputValue() === '123456', await otp.inputValue())

  const sw = pg.locator('#signup-digest')
  ok('переключатель: роль switch', await sw.getAttribute('role') === 'switch')
  await pg.locator('label[for="signup-digest"]').click()
  ok('переключатель: подпись переключает', await sw.isChecked())

  ok('интересы: нативный список — множественный',
    await pg.locator('select[name="topics"]').evaluate((el) => el.multiple))

  // Телефон: код страны внутри поля, значение — одна строка в скрытом поле с именем.
  const tel = pg.locator('#signup-phone')
  const phoneValue = () => pg.locator('input[type=hidden][name=phone]').inputValue()
  ok('телефон: видимые части без имени, имя — у скрытого поля',
    await tel.getAttribute('name') === null && await pg.locator('input[type=hidden][name=phone]').count() === 1)
  ok('телефон: код внутри рамки поля (слева от текста номера)', await pg.evaluate(() => {
    const input = document.querySelector('#signup-phone').getBoundingClientRect()
    const code = document.querySelector('[data-phone-code]').getBoundingClientRect()
    return code.left > input.left && code.right <= input.left + 0.5 + parseFloat(getComputedStyle(document.querySelector('#signup-phone')).paddingLeft)
  }))
  await tel.pressSequentially('89991234567')
  ok('телефон: маска и префикс 8 на пределе', await tel.inputValue() === '999 123-45-67', await tel.inputValue())
  ok('телефон: значение — одна строка', await phoneValue() === '+79991234567', await phoneValue())
  await tel.fill('+375 29 123-45-67')
  ok('телефон: вставка номера целиком выбирает код',
    (await pg.locator('[data-phone-code] [data-select-trigger]').innerText()).trim() === '+375'
      && await phoneValue() === '+375291234567',
    await phoneValue())
  await tel.fill('+86 138 0013 8000')
  ok('телефон: незнакомый код не теряется («другая страна»)', await phoneValue() === '+8613800138000', await phoneValue())
  // Код выбирается примитивом Select: открыть, найти по стране, выбрать.
  ok('телефон: код — примитив Select (носитель без имени)',
    await pg.locator('[data-phone-code] [data-select-root] select[data-select-native]:not([name])').count() === 1
      && await pg.locator('[data-phone-code] [data-select-trigger]').count() === 1)
  await pg.locator('[data-phone-code] select[data-select-native]').click({ force: true })
  const codeList = pg.locator('[data-select-listbox]').last()
  await codeList.waitFor({ state: 'visible' })
  await pg.locator('[data-select-search-row] input').last().fill('Финл')
  const finland = codeList.locator('[role="option"]', { hasText: '+358' })
  ok('телефон: поиск кода по названию страны', await finland.count() === 1
    && (await codeList.locator('[role="option"]').count()) === 1)
  await finland.click()
  await codeList.waitFor({ state: 'hidden' }).catch(() => {})
  await pg.waitForTimeout(300)
  ok('телефон: выбранный код виден в поле',
    (await pg.locator('[data-phone-code] [data-select-trigger]').innerText()).trim() === '+358')
  await tel.fill('401234567')
  ok('телефон: смена кода из списка', await phoneValue() === '+358401234567', await phoneValue())
  // Длина по стране: у +7 ровно 10 цифр после кода. Недобранный номер — ошибка у поля
  // до отправки (живая проверка, та же функция, что на сервере).
  const telErr = () => pg.locator('#signup-phone').evaluate((el) => {
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
  })
  await tel.fill('+7 999 123-45-6')
  await tel.blur()
  await pg.waitForFunction(() => document.querySelector('#signup-phone')?.getAttribute('aria-invalid') === 'true',
    null, { timeout: 3000 }).catch(() => {})
  ok('телефон: девять цифр у +7 — ошибка у поля до отправки',
    await tel.getAttribute('aria-invalid') === 'true' && (await telErr()).includes('Введите номер полностью'),
    `${await tel.getAttribute('aria-invalid')} | ${await telErr()}`)
  await tel.fill('+7 999 123-45-67')
  await tel.blur()
  await pg.waitForTimeout(300)
  ok('телефон: добрали десятую — ошибки нет', await tel.getAttribute('aria-invalid') === null)
  await tel.fill('')

  // Вариант 'auto' у «О себе»: AutoTextarea растёт по тексту в пределах 3–8 строк.
  const about = pg.locator('#signup-about')
  const height = () => about.evaluate((el) => el.getBoundingClientRect().height)
  await about.fill('')
  const h0 = await height()
  await about.fill('1\n2\n3\n4\n5')
  const h5 = await height()
  await about.fill('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12')
  const h12 = await height()
  await about.fill('1\n2\n3\n4\n5\n6\n7\n8')
  const h8 = await height()
  ok('о себе (auto): растёт по тексту', h5 > h0 + 20, `${h0} → ${h5}`)
  ok('о себе (auto): потолок — восемь строк', Math.abs(h12 - h8) < 1 && h8 > h5, `${h8} / ${h12}`)
  await about.fill('')
  ok('о себе (auto): пустое — обратно к трём строкам', Math.abs(await height() - h0) < 1)

  await ctx.close()

  // Без JS: обычные поля, без кнопок оживления; сервер принимает новые значения.
  const nctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 3000 } })
  const npg = await nctx.newPage()
  await npg.goto(BASE, { waitUntil: 'domcontentloaded' })
  ok('без JS: у пароля нет глаза', await npg.locator('[data-password-input] button').count() === 0)
  ok('без JS: у числа нет кнопок шага', await npg.locator('[data-number-step]').count() === 0)
  ok('без JS: телефон — одно поле type=tel с именем, без списка кодов',
    await npg.locator('#signup-phone').getAttribute('name') === 'phone'
      && await npg.locator('#signup-phone').getAttribute('type') === 'tel'
      && await npg.locator('[data-phone-code]').count() === 0)
  await npg.locator('#signup-phone').fill('+7 (999) 123-45-67')
  ok('без JS: номер со скобками и дефисами браузер пропускает',
    await npg.locator('#signup-phone').evaluate((el) => el.validity.valid))
  ok('без JS: код — обычное поле с шаблоном',
    await npg.locator('#signup-invite').getAttribute('pattern') === '\\d{6}'
      && await npg.locator('[data-otp-slot]').count() === 0)
  const post = (extra) => nctx.request.post(new URL('/form/submit', BASE).href, {
    headers: { origin: new URL(BASE).origin },
    multipart: {
      __form_id: 'signup', __form_rev: '1', __form_instance: 'signup:new',
      __form_submission: crypto.randomUUID(), intent: 'submit',
      email: 'prim@example.com', password: 'longenough1', confirm: 'longenough1',
      age: '30', tax_id: '7712345678', card: '4242424242424242', agree: 'on', ...extra,
    },
  })
  const good = await (await post({ invite: '123456', topics: 'tips', digest: 'on' })).json()
  ok('сервер: код, интерес и переключатель принимаются', good.outcome === 'committed', JSON.stringify(good.errors ?? good.outcome))
  const phone = await (await post({ phone: '+7 (999) 123-45-67' })).json()
  ok('сервер: телефон приводится к одной строке', phone.outcome === 'committed' && phone.values?.phone === '+79991234567',
    JSON.stringify(phone.values?.phone ?? phone.errors))
  const noCode = await (await post({ phone: '8 999 123-45-67' })).json()
  ok('сервер: номер без кода страны отклоняется у поля',
    (noCode.errors ?? []).some((e) => e.path === 'phone' && e.code === 'type.phone'), JSON.stringify(noCode.errors))
  const short = await (await post({ phone: '+7 999 123-45-6' })).json()
  ok('сервер: недобранный номер (+7, девять цифр) отклоняется у поля',
    (short.errors ?? []).some((e) => e.path === 'phone' && e.code === 'type.phone'), JSON.stringify(short.errors))
  const bad = await (await post({ invite: '12ab56' })).json()
  ok('сервер: код не из цифр отклоняется правилом шаблона',
    (bad.errors ?? []).some((e) => e.path === 'invite' && e.code === 'pattern'), JSON.stringify(bad.errors))
  await nctx.close()
}

/* ── 14. ещё поля, видимость, часть полей, ответы сервера ─────────── */
{
  const valid = {
    'signup-password': 'longenough1', 'signup-confirm': 'longenough1', 'signup-age': '30',
    'signup-tax_id': '7712345678', 'signup-card': '4242424242424242', 'signup-agree': 'on',
  }
  const errorOf = (pg, id) => pg.locator(`#${id}`).evaluate((el) => {
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    return ids.map((x) => document.getElementById(x)?.textContent ?? '').join(' ')
  })
  const open = async (ctx) => {
    const pg = await ctx.newPage()
    const warnings = []
    pg.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()) })
    await pg.goto(BASE, { waitUntil: 'networkidle' })
    await readyToSubmit(pg)
    return { pg, warnings }
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 3600 } })
  const { pg, warnings } = await open(ctx)
  ok('ещё поля: загрузка без предупреждений в консоли', warnings.length === 0, warnings.join(' | '))

  // описания опций панели — рядом с подписью, как у пагинатора, и в aria-describedby
  const hint = () => pg.locator('#answer-help').innerText()
  ok('панель: у выбранной опции есть описание, на него указывает select',
    await pg.locator('#answer').getAttribute('aria-describedby') === 'answer-help'
      && /готово/.test(await hint()), await hint())
  await pick(pg, 'Ответ сервера', 'переход')
  ok('панель: описание меняется вместе с опцией', /303/.test(await hint()), await hint())
  ok('скрытое поле несёт выбор панели', await pg.locator('input[type=hidden][name=answer]').inputValue() === 'redirect')
  const table = await pg.locator('section:has-text("Ограничения → атрибуты") tbody').innerText()
  ok('скрытое поле видно только в таблице атрибутов',
    /answer\s.*type="hidden"/.test(table) && await pg.locator('label[for="signup-answer"]').count() === 0)

  const attr = (id, name) => pg.locator(`#${id}`).getAttribute(name)
  ok('ещё поля: представления дают свои типы',
    await attr('signup-site', 'type') === 'url' && await attr('signup-call_at', 'type') === 'time'
      && await attr('signup-meet_at', 'type') === 'datetime-local' && await attr('signup-letters', 'type') === 'range'
      && await attr('signup-letters', 'max') === '30' && await attr('signup-accent', 'type') === 'color')
  ok('цвет: значение по умолчанию из описания', await pg.inputValue('#signup-accent') === '#2563eb')
  // умолчание описания — значение формы, а не только атрибут разметки (ход 224/269)
  ok('умолчание: множественный выбор показывает выбранное',
    JSON.stringify(await pg.locator('select[name="topics"]').evaluate((el) => [...el.selectedOptions].map((o) => o.value)))
      === '["tips"]')
  ok('умолчание: текстовое поле начинается со значения описания',
    await pg.inputValue('#signup-site') === 'https://example.com')
  await pg.fill('#signup-site', '')
  ok('умолчание: стёртое поле остаётся пустым',
    await pg.inputValue('#signup-site') === '', await pg.locator('#signup-site').getAttribute('value') ?? 'без атрибута')
  ok('период: границы дат в разметке',
    await attr('signup-from_date', 'min') === '2026-01-01' && await attr('signup-to_date', 'max') === '2027-12-31')

  await pg.fill('#signup-site', 'не адрес')
  await pg.locator('#signup-site').blur()
  await pg.waitForTimeout(300)
  ok('ссылка: строка без схемы — ошибка у поля', await attr('signup-site', 'aria-invalid') === 'true', await errorOf(pg, 'signup-site'))
  await pg.fill('#signup-site', 'https://example.com')
  await pg.fill('#signup-from_date', '2026-05-10')
  await pg.fill('#signup-to_date', '2026-05-01')
  await pg.locator('#signup-to_date').blur()
  await pg.waitForTimeout(300)
  ok('период: «по» раньше «с» — ошибка сравнения полей', /нижней границы/.test(await errorOf(pg, 'signup-to_date')),
    await errorOf(pg, 'signup-to_date'))
  await pg.fill('#signup-to_date', '2026-05-20')
  await pg.locator('#signup-to_date').blur()

  ok('видимость: «Компания» скрыта, пока флажок не отмечен', await pg.locator('#signup-company').count() === 0)
  await pg.locator('label[for="signup-from_company"]').click()
  await pg.waitForTimeout(200)
  ok('видимость: флажок показывает «Компанию» и файлы',
    await pg.locator('#signup-company').count() === 1 && await attr('signup-docs', 'multiple') !== null)
  await pg.locator('label[for="signup-from_company"]').click()

  // часть полей: проверяются только почта и телефон
  await pg.fill('#signup-email', 'плохо')
  await click(pg, 'Проверить контакты')
  await pg.waitForTimeout(1200)
  ok('часть полей: ошибка у почты, пароль не проверялся',
    await attr('signup-email', 'aria-invalid') === 'true' && await attr('signup-password', 'aria-invalid') === null)
  await pg.fill('#signup-email', 'contacts@example.com')
  await click(pg, 'Проверить контакты')
  await pg.locator('[data-checked]').waitFor({ timeout: 10000 }).catch(() => {})
  ok('часть полей: почта и телефон в порядке', await pg.locator('[data-checked]').count() === 1)

  // переход: сервер велел перейти — страница переходит сама
  await fill(pg, { ...valid, 'signup-email': 'redirect@example.com' })
  await click(pg, 'Создать аккаунт')
  const moved = await pg.waitForURL(/\/form\?sent=1$/, { timeout: 10000 }).then(() => true).catch(() => false)
  ok('переход: после ответа адрес /form?sent=1 и сообщение', moved && await pg.locator('[data-sent]').count() === 1, pg.url())
  await ctx.close()

  // «неизвестно»: сервер не подтвердил успех — исход unknown и событие в канале
  const uctx = await browser.newContext({ viewport: { width: 1280, height: 3600 } })
  const { pg: upg } = await open(uctx)
  await pick(upg, 'Ответ сервера', 'неизвестно')
  await fill(upg, { ...valid, 'signup-email': 'unknown@example.com' })
  await click(upg, 'Создать аккаунт')
  await upg.locator('[data-system-channel]').waitFor({ timeout: 10000 }).catch(() => {})
  const channel = await upg.locator('[data-system-channel]').innerText().catch(() => '')
  ok('«неизвестно»: событие outcome-unknown в канале системных ошибок', /outcome-unknown/.test(channel), channel)
  ok('«неизвестно»: успехом не показано', await upg.locator('text=Готово. Исход').count() === 0)
  await uctx.close()

  // «в очереди»: ответ сразу, запись готова через 5 секунд — страница опрашивает сама
  const qctx = await browser.newContext({ viewport: { width: 1280, height: 3600 } })
  const { pg: qpg } = await open(qctx)
  await pick(qpg, 'Ответ сервера', 'в очереди')
  await fill(qpg, { ...valid, 'signup-email': 'queued@example.com' })
  const t0 = Date.now()
  await click(qpg, 'Создать аккаунт')
  const sawQueued = await qpg.locator('[data-queued]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false)
  ok('очередь: сразу «Принято» и ссылка на статус',
    sawQueued && /\/form\?job=/.test(await qpg.locator('[data-queued] a').getAttribute('href') ?? ''))
  const done = await qpg.locator('text=Готово. Исход: committed').waitFor({ timeout: 12000 }).then(() => true).catch(() => false)
  const took = Date.now() - t0
  ok('очередь: через ~5 с запись успешна, баннер очереди снят',
    done && took >= 4500 && await qpg.locator('[data-queued]').count() === 0, `${took} мс`)
  await qctx.close()

  // без скрипта
  const nctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 3600 } })
  const npg = await nctx.newPage()
  await npg.goto(BASE, { waitUntil: 'domcontentloaded' })
  ok('без JS: кнопки частичной проверки не требуют всех полей (formnovalidate)',
    await npg.locator('button[value="check-contacts"]').getAttribute('formnovalidate') !== null
      && await npg.locator('button[value="save-draft"]').getAttribute('formnovalidate') !== null
      && await npg.locator('button[value="submit"]').getAttribute('formnovalidate') === null)
  await Promise.all([npg.waitForLoadState('load'), npg.locator('button[value="check-contacts"]').click()])
  await npg.waitForTimeout(300)
  ok('без JS: «Проверить контакты» — ошибка только у почты',
    await npg.locator('#signup-email').getAttribute('aria-invalid') === 'true'
      && await npg.locator('#signup-password').getAttribute('aria-invalid') === null)
  await fill(npg, { ...valid, 'signup-email': 'nojs-company@example.com' })
  await npg.locator('#signup-from_company').check({ force: true })
  await Promise.all([npg.waitForLoadState('load'), npg.locator('button[value="submit"]').click()])
  await npg.waitForTimeout(300)
  ok('без JS: после отправки с флажком «Компания» появилась и требуется',
    await npg.locator('#signup-company').count() === 1
      && await npg.locator('#signup-company').getAttribute('aria-invalid') === 'true')
  const docsText = await npg.locator('[data-field="docs"]').innerText().catch(() => '')
  ok('без JS: файлы — правило «хотя бы один»', /хотя бы один файл/.test(docsText), docsText)

  const redirect = await nctx.request.post(BASE, {
    // accept: text/html — как у браузера; иначе SvelteKit отвечает JSON для use:enhance
    headers: { origin: new URL(BASE).origin, accept: 'text/html' }, maxRedirects: 0,
    multipart: {
      __form_id: 'signup', __form_rev: '1', __form_instance: 'signup:new',
      __form_submission: crypto.randomUUID(), intent: 'submit', answer: 'redirect',
      email: 'nojs-redirect@example.com', password: 'longenough1', confirm: 'longenough1',
      age: '30', tax_id: '7712345678', card: '4242424242424242', agree: 'on',
    },
  })
  const queuedRes = await nctx.request.post(new URL('/form/submit', BASE).href, {
    headers: { origin: new URL(BASE).origin },
    multipart: {
      __form_id: 'signup', __form_rev: '1', __form_instance: 'signup:new',
      __form_submission: crypto.randomUUID(), intent: 'submit', answer: 'queued',
      email: 'nojs-queued@example.com', password: 'longenough1', confirm: 'longenough1',
      age: '30', tax_id: '7712345678', card: '4242424242424242', agree: 'on',
    },
  })
  const q = await queuedRes.json()
  ok('сервер: «в очереди» — 202, исход queued, адреса опроса и статуса',
    queuedRes.status() === 202 && q.outcome === 'queued' && /job=/.test(q.data?.pollUrl ?? '') && /job=/.test(q.data?.statusUrl ?? ''),
    JSON.stringify({ status: queuedRes.status(), outcome: q.outcome, data: q.data }))
  const early = await (await nctx.request.get(new URL(q.data.pollUrl, BASE).href)).json()
  await npg.goto(new URL(q.data.statusUrl, BASE).href, { waitUntil: 'domcontentloaded' })
  ok('без JS: статус заявки — ещё в очереди', early.done === false
    && /ещё в очереди/.test(await npg.locator('[data-job-status]').innerText()))
  await npg.waitForTimeout(5200)
  await npg.reload({ waitUntil: 'domcontentloaded' })
  const late = await (await nctx.request.get(new URL(q.data.pollUrl, BASE).href)).json()
  ok('без JS: через 5 с заявка выполнена, опрос отдаёт итог committed',
    /выполнена/.test(await npg.locator('[data-job-status]').innerText()) && late.done === true && late.result?.outcome === 'committed',
    JSON.stringify(late))

  ok('без JS: «переход» — ответ 303 на /form?sent=1',
    redirect.status() === 303 && redirect.headers()['location'] === '/form?sent=1',
    `${redirect.status()} ${redirect.headers()['location']}`)
  await nctx.close()
}

await browser.close()
console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
