/**
 * Доступность формы через axe-core. Идёт на УЖЕ работающий сервер,
 * как остальные тесты репозитория: адрес в FORMS_BASE (по умолчанию dev).
 *
 *   npm run dev &          # или: npm run build && npm run preview
 *   node test/browser/forms-a11y.mjs
 *
 * Скан ограничен <main> — областью демонстрации формы. Каркас (шапка,
 * drawer) — отдельная история: у него есть собственный прогон, и его
 * дефекты не должны заглушать сигнал формы.
 *
 * Состояния подобраны так, чтобы каждая ветка показа успела отрисовать
 * свою разметку ДО скана:
 *   1. стартовая разметка без ошибок (light);
 *   2. ошибки после неудачной отправки: aria-invalid, тексты, подсветка;
 *   3. night-тема с ошибками: контраст проверяется на обеих;
 *   4. узкий экран: колонки складываются, таблицы становятся
 *      прокручиваемыми регионами;
 *   5. cardinality=all: списки из нескольких ошибок на поле;
 *   6. custom-идентификаторы: подменённая политика разметки адаптера;
 *   7. one-block через нативный POST: общий блок role=alert без имён полей;
 *   8. путь без скрипта: серверная разметка после отправки снимается и
 *      сканируется с инлайненными стилями — color-contrast считается
 *      по настоящим значениям, а не по догадке.
 *
 * Про «incomplete»: axe не всегда разрешает фон прозрачных предков.
 * Такие узлы проверены вручную: muted-foreground на фоне страницы 4.83:1,
 * на подложке футера 4.67:1 — оба выше порога. Поэтому проверка требует
 * нуля violations и не требует нуля incomplete.
 */
import { chromium } from 'playwright'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AXE = require.resolve('axe-core/axe.min.js')
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

/** Скан main. Возвращает список нарушений; пустой — норма. */
async function violations(pg) {
  await pg.addScriptTag({ path: AXE })
  const r = await pg.evaluate(() =>
    window.axe.run(document.querySelector('main'), { resultTypes: ['violations'] }))
  return r.violations
}

const describe = (vs) => vs.map((v) =>
  `${v.id} (${v.impact}): ` + v.nodes.slice(0, 3).map((n) => n.target).join(', ')).join(' | ')

/** Отправка, заведомо приводящая к ошибкам полей. */
async function failedSubmit(pg) {
  await pg.fill('#signup-password', 'abc').catch(() => {})
  await pg.locator('button[value=submit]').click({ force: true })
  await pg.waitForTimeout(1600)
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })

/* ── 1–2. светлая тема: старт и ошибки ────────────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)

  ok('форма на месте (скан не по пустой странице)',
    await pg.locator('main #signup-email').count() === 1)
  ok('стартовая разметка без нарушений', (await violations(pg)).length === 0,
    describe(await violations(pg)))

  await failedSubmit(pg)
  ok('ошибки видны до скана', await pg.locator('p.text-destructive').count() > 0)
  ok('разметка с ошибками без нарушений', (await violations(pg)).length === 0,
    describe(await violations(pg)))
  await pg.close()
}

/* ── 3. night-тема ────────────────────────────────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)
  // тот же механизм, что у переключателя шапки: data-theme на html
  await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'))
  await pg.waitForTimeout(300)
  await failedSubmit(pg)
  ok('night-тема: контраст проходит', (await violations(pg)).length === 0,
    describe(await violations(pg)))
  await pg.close()
}

/* ── 4. узкий экран ───────────────────────────────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)
  await failedSubmit(pg)
  ok('узкий экран без нарушений (скролл-регионы доступны с клавиатуры)',
    (await violations(pg)).length === 0, describe(await violations(pg)))
  await pg.close()
}

/* ── 5. cardinality=all: списки ошибок ────────────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)
  await click(pg, 'все')
  await failedSubmit(pg)
  ok('несколько ошибок на поле: списки без нарушений',
    (await violations(pg)).length === 0, describe(await violations(pg)))
  await pg.close()
}

/* ── 6. custom-идентификаторы ─────────────────────────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)
  await click(pg, 'свои')
  await failedSubmit(pg)
  ok('подменённые идентификаторы: связи целы',
    (await violations(pg)).length === 0, describe(await violations(pg)))
  await pg.close()
}

/* ── 7. one-block через нативный POST: общий блок ─────────────────── */
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(900)
  await click(pg, 'нативно')
  await click(pg, 'всё в общий')
  // Нативный POST вообще не уходит, пока молчит браузерная валидация: у полей
  // `required`/`minlength`, и пустая форма останавливается ДО сети (проверено:
  // 0 POST-запросов, браузер показывает свои пузыри). Заполняем так, чтобы
  // браузер пропустил отправку, а сервер нашёл свою ошибку (пароль minlength) —
  // ровно то, что проверяет сценарий: серверные ошибки попадают в общий блок.
  await pg.fill('#signup-email', 'a@b.io').catch(() => {})
  await pg.fill('#signup-age', '30').catch(() => {})
  await pg.fill('#signup-password', 'abc').catch(() => {})
  await pg.fill('#signup-confirm', 'abc').catch(() => {})
  await pg.check('#signup-agree').catch(() => {})
  await Promise.all([
    pg.waitForLoadState('load'),
    pg.locator('button[value=submit]').click({ force: true }),
  ])
  await pg.waitForTimeout(600)
  ok('общий блок отрисован', await pg.locator('main [role="alert"]').count() > 0)
  ok('общий блок без имён полей: разметка чиста',
    (await violations(pg)).length === 0, describe(await violations(pg)))
  await pg.close()
}

/* ── 8. путь без скрипта: серверная разметка ──────────────────────── */
{
  // Нативная валидация честно отражена в атрибутах (required, minlength),
  // поэтому сценарий проходит её целиком и падает только на серверной
  // проверке sameAs — её атрибутом не бывает.
  const scenario = {
    'signup-email': 'a@b.io',
    'signup-password': 'longenough1',
    'signup-confirm': 'ДРУГОЙ',
    'signup-age': '30',
    'signup-tax_id': '7712345678',
    'signup-card': '4242424242424242',
    'signup-agree': 'on',
  }
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const pg = await ctx.newPage()
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pg.waitForTimeout(500)
  for (const [id, value] of Object.entries(scenario)) {
    const el = pg.locator(`#${id}`)
    if (await el.getAttribute('type') === 'checkbox') await el.check({ force: true })
    else await el.fill(value)
  }
  await Promise.all([
    pg.waitForLoadState('load'),
    pg.locator('button[value=submit]').click({ force: true }),
  ])
  await pg.waitForTimeout(500)
  let html = await pg.content()
  await ctx.close()

  // setContent не грузит относительные ссылки: стили инлайнятся, чтобы
  // правила, зависящие от вычисленных стилей, видели настоящие цвета
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)]
  for (const link of links) {
    const css = await (await fetch(new URL(link[1], BASE))).text()
    html = html.replace(link[0], `<style>${css}</style>`)
  }

  const snapshot = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await snapshot.setContent(html, { waitUntil: 'load' })
  ok('снимок содержит серверные ошибки', (await snapshot.locator('p.text-destructive').count()) > 0)
  ok('без скрипта: серверная разметка без нарушений',
    (await violations(snapshot)).length === 0, describe(await violations(snapshot)))
  await snapshot.close()
}

await browser.close()
console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки прошли')
process.exit(failed ? 1 : 0)
