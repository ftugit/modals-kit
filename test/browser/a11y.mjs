/**
 * Дымовой прогон доступности через axe.
 *
 * Идёт на уже работающий сервер, как остальные browser-проверки:
 *
 *   npm run build && npm run preview -- --host 0.0.0.0 &
 *   node test/browser/a11y.mjs
 *
 * База настраивается переменной A11Y_BASE, по умолчанию http://127.0.0.1:4173.
 */
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

/**
 * axe берётся из ЗАВИСИМОСТЕЙ ПРОЕКТА (`axe-core`) и вкладывается в страницу,
 * как в `forms-a11y.mjs`: пакет `@axe-core/playwright` в package.json не
 * объявлен, и с чистого `npm ci` этот файл просто не запускался
 * (`ERR_MODULE_NOT_FOUND`). Вложение скрипта — тот же приём, что уже принят
 * в наборе, и никаких новых зависимостей не требует.
 */
const require = createRequire(import.meta.url)
const AXE = require.resolve('axe-core/axe.min.js')

const BASE = (process.env.A11Y_BASE ?? 'http://127.0.0.1:4173').replace(/\/$/, '')

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
let failed = 0

function url(path) {
  return new URL(path, `${BASE}/`).href
}

function formatViolation(violation) {
  const nodes = violation.nodes.slice(0, 5).map((node) => {
    const target = node.target.join(' ')
    const summary = node.failureSummary?.replace(/\s+/g, ' ').trim() ?? 'нет подробностей'
    return `      • ${target}: ${summary}`
  }).join('\n')
  const tail = violation.nodes.length > 5 ? `\n      … и ещё ${violation.nodes.length - 5}` : ''
  return [
    `    ${violation.id} [${violation.impact ?? 'unknown'}]: ${violation.help}`,
    `      ${violation.helpUrl}`,
    nodes,
    tail,
  ].filter(Boolean).join('\n')
}

async function check(page, name, path, prepare) {
  await page.goto(url(path), { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
  await prepare?.(page)
  await page.waitForTimeout(250)

  await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(
    (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    wcagTags,
  )

  if (result.violations.length === 0) {
    console.log(`  ok   ${name}`)
    return
  }

  failed += result.violations.length
  console.log(` FAIL ${name}: ${result.violations.length} violation(s)`)
  for (const violation of result.violations) console.log(formatViolation(violation))
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 1280, height: 1800 },
  reducedMotion: 'reduce',
})
const page = await context.newPage()

await check(page, 'главная страница', '/')
await check(page, 'демо форм: исходное состояние', '/form')
await check(page, 'демо форм: ошибки после отправки', '/form', async (pg) => {
  await pg.getByRole('button', { name: 'Создать аккаунт' }).click()
  await pg.waitForTimeout(1600)
})
await check(page, 'демо модалок: открытая карточка', '/modals', async (pg) => {
  await pg.getByRole('link', { name: 'Открыть карточку' }).first().click()
  await pg.waitForTimeout(900)
})

// Пагинатор — самая насыщенная формами страница: панель настроек с селектами,
// поле запроса, навигация. Панель фильтров живёт только у живого источника,
// поэтому её проверка включается, лишь когда бэкенд отвечает: оффлайн-набор
// остаётся оффлайновым.
await check(page, 'пагинатор: настройки, поиск, выдача', '/paginator?page.src=products&page.size=5')

const live = await fetch(new URL('/api/shikimori/filters', `${BASE}/`).href)
  .then((r) => r.ok)
  .catch(() => false)
if (live) {
  await check(
    page,
    'пагинатор: панель фильтров живого источника',
    '/paginator?page.src=animes&page.size=5&page.filters.status=anons&page.filters.score.min=5',
    async (pg) => {
      await pg.waitForSelector('[data-testid="filters-panel"]', { timeout: 20000 })
      await pg.locator('[data-testid="filters-toggle"]').click()
      await pg.waitForTimeout(400)
    },
  )
} else {
  console.log('  --   панель фильтров: пропущено (живой источник недоступен)')
}

await context.close()
await browser.close()

console.log(failed ? `\nнарушений axe: ${failed}` : '\naxe: нарушений не найдено')
process.exit(failed ? 1 : 0)
