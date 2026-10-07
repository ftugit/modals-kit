/**
 * Проба: адрес принадлежит ТРАНСПОРТУ, а не хосту (корректность порта пагинатора).
 *
 * Канон (`SolidHono`, `src/lib/paginate/solid.tsx`): вся работа с адресом живёт в
 * URL-ветке хоста, закрытой условием `bindsUrl = typeof adapter.setRouter === 'function'`.
 * У адаптеров без адреса (local/memory) метода нет → `null`, и хост адрес не трогает
 * вовсе: «переключение хранилища не рождает гибрид „страница из storage, фильтры из URL“».
 *
 * Проба ловит именно гибрид: открываем пагинатор на URL-транспорте с ?page=3,
 * переключаем хранилище на «Память» и смотрим страницу, которую показывает список.
 *   • корректно (канон) — память стартует с 1, адрес чужого транспорта не читается;
 *   • дефект порта      — память приезжает на 3 из адреса.
 * Заодно проверяется второй транспорт (`?gallery`): он не должен влиять на демо-список.
 *
 * Запуск: node probes/pag-store-hybrid.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.PAGINATE_BASE ?? 'http://127.0.0.1:4173/paginator'

/** «СТР N из M» — подпись текущей страницы у PageNav демо-хоста. */
async function demoNavText(page) {
  const nav = page.locator('[data-paginator-host] [data-testid="page-nav"]').first()
  await nav.waitFor({ state: 'visible' })
  return (await nav.innerText()).replace(/\s+/g, ' ').trim()
}

const pageOf = (text) => {
  const m = text.match(/СТР (\d+)/u)
  return m ? Number(m[1]) : null
}

const browser = await chromium.launch()
const page = await browser.newPage()
let failed = false
const fail = (msg) => {
  failed = true
  console.log(`  FAIL ${msg}`)
}

try {
  // ── 1. URL-транспорт на ?page=3: страница приходит из адреса ────────────────
  await page.goto(`${BASE}?page=3&page.size=5&gallery=2`, { waitUntil: 'networkidle' })
  const urlText = await demoNavText(page)
  const urlPage = pageOf(urlText)
  console.log(`1. URL-транспорт, ?page=3  →  «${urlText}»`)
  if (urlPage !== 3) fail(`URL-транспорт не встал на страницу 3 из адреса (получили ${urlPage})`)
  else console.log('  ok  страница из адреса приезжает (это и есть работа адаптера)')

  // ── 2. Переключение хранилища: адрес чужого транспорта читаться не должен ──
  await page.locator('select[name="store"]').selectOption('none')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="current-name"]')?.textContent?.includes('mem'),
    null,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(900) // транспорт демо-источника 500 мс + запас
  const memText = await demoNavText(page)
  const memPage = pageOf(memText)
  console.log(`2. Хранилище → «Память»     →  «${memText}»`)
  if (memPage === 3) {
    fail('ГИБРИД: страница приехала из ?page, хотя транспорт — память (канон: bindsUrl)')
  } else if (memPage === 1) {
    console.log('  ok  адрес не читается: память стартует со своей страницы')
  } else {
    fail(`неожиданная страница памяти: ${memPage}`)
  }

  // ── 3. Второй пагинатор (?gallery) свой адрес не потерял ───────────────────
  const galleryText = (await page
    .locator('[data-testid="gallery-nav"] [data-testid="page-nav"]')
    .first()
    .innerText()).replace(/\s+/g, ' ').trim()
  const galleryPage = pageOf(galleryText)
  console.log(`3. Галерея (?gallery=2)      →  «${galleryText}»`)
  if (galleryPage !== 2) fail(`галерея не встала на страницу 2 (получили ${galleryPage})`)
  else console.log('  ok  второй пагинатор живёт по своему ключу')

  // ── 4. Навигация всё ещё пишет адрес (адаптер, не прямой history) ──────────
  await page.locator('select[name="store"]').selectOption('url')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="current-name"]')?.textContent?.includes('url'),
    null,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(900)
  await page.locator('[data-paginator-host] [data-testid="page-nav"]').first()
    .locator('button, a').nth(2)
    .click()
  await page.waitForTimeout(500)
  const search = await page.evaluate(() => window.location.search)
  console.log(`4. Клик по номеру страницы     →  адрес: ${search || '(пусто)'}`)
  if (!/page=\d/.test(search)) fail('навигация не обновила адрес')
  else console.log('  ok  страница уехала в адрес (URL-транспорт пишет адрес)')
} finally {
  await browser.close()
}

console.log(failed ? '\nИТОГ: дефекты выше' : '\nИТОГ: адрес принадлежит транспорту ✓')
process.exit(failed ? 1 : 0)
