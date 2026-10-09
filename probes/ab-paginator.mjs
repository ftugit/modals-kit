/**
 * Проба A/B: поведение по умолчанию, не зависящее от внутренностей ветки.
 *   BASE=http://127.0.0.1:4173/paginator node probes/ab-paginator.mjs
 *
 * 1. Глубинная ссылка ?page=3: какая страница активна в URL-хранилище.
 * 2. Переключение хранилища на «Память»: стартует ли она с 1 (канон: у адаптера
 *    без адреса хост адрес не читает) или с 3 (гибрид «страница из адреса»).
 * 3. Сколько строк «Загрузка страницы…» рисуется во время подгрузки при
 *    выключенных скелетонах (дубли над/под списком — отклонение от канона).
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/paginator'
const browser = await chromium.launch({ headless: true })

/** Активная страница по PageNav внутри хоста (aria-current="page"). */
async function activePage(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-paginator-host] [aria-current="page"]')
    return el ? el.textContent.trim() : null
  })
}

// ── 1-2. Глубинная ссылка и переключение хранилища ────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}?page=3`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const urlStore = await activePage(page)
  console.log(`?page=3 · URL-хранилище: активная страница = ${urlStore}`)

  await page.locator('select[name="store"]').selectOption({ label: 'Память (без персиста)' })
  await page.waitForTimeout(600)
  const memStore = await activePage(page)
  const name = await page.locator('[data-testid="current-name"]').innerText()
  console.log(`→ «Память»: активная страница = ${memStore} (пагинатор ${name})`)
  console.log(
    `   вердикт: ${memStore === '1' ? 'адрес не протёк в память (канон)' : `АДРЕС ПРОТЁК: память стартует на ${memStore}`}`,
  )
  await page.close()
}

// ── 3. Дубли строк «Загрузка страницы…» при выключенных скелетонах ────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}?page.size=5&page.bottomTrigger=manual`, { waitUntil: 'networkidle' })
  const skel = page.getByRole('switch', { name: 'Скелетоны' })
  if (await skel.count()) {
    if (await skel.isChecked()) await skel.click({ force: true })
    await page.waitForTimeout(250)
  }
  await page.evaluate(() => {
    window.__rows = []
    window.__t = setInterval(() => {
      const rows = [...document.querySelectorAll('[data-paginator-host] *')].filter((e) =>
        /^Загрузка страницы/.test((e.textContent || '').trim()) && !e.children.length,
      ).length
      window.__rows.push(rows)
    }, 20)
  })
  const link = page.locator('[data-testid="load-next"]')
  await link.scrollIntoViewIfNeeded()
  await link.click()
  await page.waitForTimeout(1200)
  const rows = await page.evaluate(() => {
    clearInterval(window.__t)
    return { max: Math.max(...window.__rows), nonZero: window.__rows.filter((n) => n > 0).length }
  })
  console.log(`скелетоны off, ручная подгрузка: строк «Загрузка страницы» максимум = ${rows.max}`)
  await page.close()
}

await browser.close()
