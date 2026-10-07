/**
 * Проба: скелетоны пагинатора при подгрузке (реальный браузер, свежий preview).
 * Отвечает на три вопроса:
 *   1. появляются ли скелетоны во время подгрузки и живут ли они достаточно долго,
 *      чтобы их увидеть (порог заметности ~100 мс);
 *   2. живут ли они столько же, сколько идёт запрос (в исходнике это сеть,
 *      в порте — транспортная задержка демо-источника, 500 мс);
 *   3. живы ли страницы с ручным триггером и классическим режимом
 *      (сниппет-рекурсия в LoadMoreLink роняла SSR с 500).
 *
 * Запуск: node probes/pag-skel.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.PAGINATE_BASE ?? 'http://127.0.0.1:4173/paginator'
const STAKE = 100 // мс: короче — скелетон глазом не читается
const HOLD = 500 // транспортная задержка демо-источника (src/content/items.ts)

const ITEMS = '[data-paginator-host] [data-testid^="card-"], [data-paginator-host] [data-testid^="photo-"]'

async function installSampler(page) {
  await page.evaluate(
    ([items]) => {
      window.__tl = []
      window.__t0 = performance.now()
      window.__timer = setInterval(() => {
        window.__tl.push({
          at: Math.round(performance.now() - window.__t0),
          skel: document.querySelectorAll('[data-testid="skeleton"]').length,
          items: document.querySelectorAll(items).length,
        })
      }, 15)
    },
    [ITEMS],
  )
}

/** Только изменения счётчиков — читаемая хронология. */
async function readSampler(page) {
  return page.evaluate(() => {
    clearInterval(window.__timer)
    const out = []
    let prev = null
    for (const s of window.__tl) {
      const key = `${s.skel}/${s.items}`
      if (key !== prev) {
        out.push({ at: s.at, skel: s.skel, items: s.items })
        prev = key
      }
    }
    return out
  })
}

function printTimeline(samples) {
  for (const s of samples) console.log(`    ${String(s.at).padStart(4)} мс: скелетонов ${s.skel}, элементов ${s.items}`)
  const born = samples.find((s) => s.skel > 0)
  const gone = samples.find((s) => s.skel === 0 && born && s.at > born.at)
  if (!born) return console.log('    ⚠ скелетоны не появились вовсе')
  const life = (gone?.at ?? samples[samples.length - 1].at) - born.at
  const verdict = life >= STAKE ? 'ок' : `мигание ${life} мс < ${STAKE} мс — не читается`
  console.log(`    жизнь скелетонов ≈ ${life} мс — ${verdict}`)
  const withHold = gone && gone.at >= HOLD * 0.8
  console.log(
    `    задержка до появления содержимого: ${withHold ? `≈${gone.at} мс (задержка источника ${HOLD} мс)` : `нет (контент на ${gone?.at ?? '—'} мс)`}`,
  )
}

const browser = await chromium.launch({ headless: true })

// ── 1. Ручной триггер: ровно одна подгрузка ───────────────────────────────────
{
  console.log('— ручной триггер «показать следующую страницу» —')
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}?page.size=5&page.bottomTrigger=manual&page.topTrigger=off`, {
    waitUntil: 'networkidle',
  })
  const link = page.locator('[data-testid="load-next"]')
  await link.waitFor({ state: 'visible', timeout: 10_000 })
  await installSampler(page)
  await link.click()
  await page.waitForTimeout(1500)
  printTimeline(await readSampler(page))
  await page.close()
}

// ── 2. Краевой триггер (по умолчанию): внутренний скролл к кромке ─────────────
{
  console.log('\n— краевой триггер (direction) —')
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}?page.size=5`, { waitUntil: 'networkidle' })
  const host = page.locator('[data-paginator-host]').first()
  await host.waitFor({ state: 'visible' })
  await installSampler(page)
  await host.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    el.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(1800)
  printTimeline(await readSampler(page))
  await page.close()
}

// ── 3. Страж рекурсии: страницы с ручным триггером и классическим режимом ─────
{
  console.log('\n— страницы, которые падали с 500 (сниппет-рекурсия) —')
  for (const [label, q] of [
    ['ручной снизу', '?page.size=5&page.bottomTrigger=manual'],
    ['ручной сверху', '?page.size=5&page.topTrigger=manual'],
    ['классический режим', '?page.size=5&page.mode=single'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    let status = 0
    page.on('response', (r) => {
      if (r.url().includes('/paginator')) status = r.status()
    })
    await page.goto(BASE + q, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(600)
    const hosts = await page.locator('[data-paginator-host]').count()
    const links = await page.locator('[data-testid^="load-"]').count()
    console.log(`    ${label.padEnd(18)} HTTP ${status}, хостов ${hosts}, ссылок «показать» ${links}`)
    await page.close()
  }
}

await browser.close()
