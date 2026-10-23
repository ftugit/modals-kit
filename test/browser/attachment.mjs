/**
 * Браузерная приёмка автономного примитива `Attachment`:
 *   - layouts (`row`, `tile`), размеры (`sm`, `md`, `lg`), 6 категорий + `file`;
 *   - 5 семантических состояний + progressbar (`strip` и `background`, determinate/indeterminate);
 *   - реальное декодирование локального PNG `File` в Blink и освобождение `blob:` URL
 *     при замене файла, ошибке декодирования (`onerror` → fallback значок) и разборке;
 *   - нативный выбор `single` (`radio`, взаимное исключение + стрелки клавиатуры)
 *     и `multiple` (`checkbox`, `Space` + указатель) с проверкой `FormData`;
 *   - строгая изоляция соседних `trigger` и `actions` вне `<label>` (0 вложенных контролов);
 *   - нулевое горизонтальное переполнение на ширине `390px`;
 *   - `axe-core` в темах `lemonade` (светлая) и `night` (тёмная): 0 нарушений.
 *
 *   npm run dev &
 *   node test/browser/attachment.mjs
 */
import { chromium } from 'playwright'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AXE = require.resolve('axe-core/axe.min.js')
const BASE = process.env.ATTACHMENT_BASE ?? 'http://127.0.0.1:5173/fields'
const PNG_BUF = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4cfPmfQAJAgN78S683AAAAABJRU5ErkJggg==',
  'base64',
)

let failed = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failed++
}

async function scanAxe(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t
  }, theme)
  await page.waitForTimeout(300)
  const res = await page.evaluate(() =>
    window.axe.run(document.querySelector('[data-testid="attachment-e2e-root"]'), {
      resultTypes: ['violations'],
    }),
  )
  return res.violations
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })

const pageErrors = []

try {
  // 1) Прогреваем модуль `Attachment` в графе Vite/UnoCSS на временной вкладке,
  //    затем открываем чистую страницу со сгенерированными утилитами в SSR `<style id="__uno.css">`.
  const warmup = await context.newPage()
  await warmup.goto(BASE, { waitUntil: 'domcontentloaded' })
  await warmup.evaluate(() => import('/src/lib/components/ui/attachment/AttachmentBrowserFixture.test.svelte'))
  await warmup.close()

  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="add-field"][type="button"]')
  await page.addScriptTag({ path: AXE })

  // 2) Монтируем тестовый стенд `Attachment` + `FileAttachment` прямо внутри `<main>` через тот же инстанс рантайма Vite.
  await page.evaluate(async () => {
    const svelte = await import('/node_modules/.vite/deps/svelte.js')
    const mod = await import('/src/lib/components/ui/attachment/AttachmentBrowserFixture.test.svelte')
    const main = document.querySelector('main')
    main.innerHTML = ''
    const host = svelte.mount(mod.default, { target: main })
    window.__attachmentHost = host
    window.__unmountAttachmentHost = () => svelte.unmount(host)
  })
  await page.setInputFiles('#fa-browser-files', [
    { name: 'shot-a.png', mimeType: 'image/png', buffer: PNG_BUF },
    { name: 'spec.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') },
    { name: 'shot-b.png', mimeType: 'image/png', buffer: PNG_BUF },
  ])
  await page.waitForTimeout(150)

  // 1. Валидность DOM-иерархии, layouts, размеров, состояний и категорий
  const domReport = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="attachment-e2e-root"]')
    const nested = root.querySelectorAll('label button, label a, button button, a button').length
    const blobAnchors = root.querySelectorAll('a[href^="blob:"], iframe[src^="blob:"]').length
    const tile = root.querySelector('[data-testid="live-file-box"] [data-slot="attachment"]')
    const tileRect = tile.getBoundingClientRect()
    const rows = [...root.querySelectorAll('[data-testid="sizes-and-kinds"] [data-slot="attachment"]')]
    const [smH, mdH, lgH] = rows.slice(0, 3).map((el) => Math.round(el.getBoundingClientRect().height))
    const kinds = [...new Set(rows.map((el) => el.dataset.kind))].sort()
    const strip = root.querySelector('[data-slot="attachment-progress"][data-variant="strip"]')
    const bg = root.querySelector('[data-slot="attachment-progress"][data-variant="background"]')
    return {
      nested,
      blobAnchors,
      tileAspectDiff: Math.abs(tileRect.width - tileRect.height),
      smH,
      mdH,
      lgH,
      kinds,
      stripNow: strip?.getAttribute('aria-valuenow'),
      bgNow: bg?.getAttribute('aria-valuenow'),
    }
  })

  ok('нет вложенных интерактивных элементов внутри <label>/<button>/<a>', domReport.nested === 0 && domReport.blobAnchors === 0)
  ok('tile держит квадратную пропорцию aspect-square', domReport.tileAspectDiff <= 1.5, `diff=${domReport.tileAspectDiff}`)
  ok('размеры row масштабируются sm < md <= lg', domReport.smH > 0 && domReport.smH < domReport.mdH && domReport.mdH <= domReport.lgH, `${domReport.smH}/${domReport.mdH}/${domReport.lgH}px`)
  ok(
    'отрисованы все 6 категорий файлов и общий fallback file',
    JSON.stringify(domReport.kinds) === JSON.stringify(['archive', 'audio', 'code', 'document', 'file', 'image', 'video']),
    domReport.kinds.join(','),
  )
  ok(
    'progressbar корректно различает determinate (68) и indeterminate (null)',
    domReport.stripNow === '68' && domReport.bgNow === null,
  )

  // 2. axe-core на обеих темах (`lemonade` и `night`)
  const lightViolations = await scanAxe(page, 'lemonade')
  ok(
    'axe-core (тема lemonade): 0 нарушений WCAG',
    lightViolations.length === 0,
    lightViolations.map((v) => `${v.id}: ${v.help}`).join('; '),
  )

  const nightViolations = await scanAxe(page, 'night')
  ok(
    'axe-core (тема night): 0 нарушений WCAG',
    nightViolations.length === 0,
    nightViolations.map((v) => `${v.id}: ${v.help}`).join('; '),
  )
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'lemonade'
  })

  // 3. Проверка мобильного вьюпорта 390px: отсутствие горизонтального скролла
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(80)
  const overflow390 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  ok(
    'вьюпорт 390px: нет горизонтального переполнения страницы',
    overflow390.scrollWidth <= overflow390.innerWidth,
    `${overflow390.scrollWidth} <= ${overflow390.innerWidth}`,
  )
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(80)

  // 4. Реальный клик указателем и навигация стрелками/Space в группах single (radio) и multiple (checkbox)
  await page.locator('[data-testid="browser-single-group"] [data-slot="attachment-label"]').nth(1).click()
  let state = await page.evaluate(() => {
    const form = document.querySelector('[data-testid="browser-selection-form"]')
    return {
      snap: window.__attachmentHost.snapshot(),
      fdCover: new FormData(form).getAll('cover'),
    }
  })
  ok(
    'single (radio): клик по карточке выбирает cov-2 с взаимным исключением',
    state.snap.selectedCover === 'cov-2' && JSON.stringify(state.fdCover) === JSON.stringify(['cov-2']),
  )

  // Клавиатура: фокус на активном radio + ArrowDown переключает на cov-3
  await page.locator('[data-testid="browser-single-group"] input[type="radio"]').nth(1).focus()
  await page.keyboard.press('ArrowDown')
  state = await page.evaluate(() => {
    const form = document.querySelector('[data-testid="browser-selection-form"]')
    return {
      snap: window.__attachmentHost.snapshot(),
      fdCover: new FormData(form).getAll('cover'),
    }
  })
  ok(
    'single (radio): клавиша ArrowDown переносит выбор на cov-3 и обновляет FormData',
    state.snap.selectedCover === 'cov-3' && JSON.stringify(state.fdCover) === JSON.stringify(['cov-3']),
  )

  // Multiple (checkbox tile): клик по превью добавляет att-2, Space снимает att-1
  await page.locator('[data-testid="browser-multi-group"] [data-slot="attachment-label"]').nth(1).click()
  await page.locator('[data-testid="browser-multi-group"] input[type="checkbox"]').nth(0).focus()
  await page.keyboard.press('Space')
  state = await page.evaluate(() => {
    const form = document.querySelector('[data-testid="browser-selection-form"]')
    return {
      snap: window.__attachmentHost.snapshot(),
      fdDocs: new FormData(form).getAll('docs'),
    }
  })
  ok(
    'multiple (checkbox tile): клик по превью + Space по чекбоксу синхронны с FormData',
    JSON.stringify(state.snap.selectedDocs) === JSON.stringify(['att-2']) &&
      JSON.stringify(state.fdDocs) === JSON.stringify(['att-2']),
    JSON.stringify(state.fdDocs),
  )

  // 5. Независимость sibling trigger и sibling actions в row и tile
  await page.locator('[data-testid="browser-single-group"] button[aria-label="Удалить cover-first.png"]').click()
  await page.locator('[data-testid="browser-multi-group"] button[aria-label="Открыть invoice-q1.pdf"]').click()
  state = await page.evaluate(() => window.__attachmentHost.snapshot())
  ok(
    'клик по sibling trigger/action не меняет выбранные элементы в row и tile',
    state.selectedCover === 'cov-3' &&
      JSON.stringify(state.selectedDocs) === JSON.stringify(['att-2']) &&
      JSON.stringify(state.actionLog) === JSON.stringify(['cov-1']) &&
      JSON.stringify(state.openLog) === JSON.stringify(['att-1']),
  )

  // 5b. FileAttachment: нативный выбор через FileInput, DataTransfer-удаление и сохранение соседнего blob: URL
  const faBefore = await page.evaluate(async () => {
    const isAlive = async (url) => {
      try {
        return (await fetch(url)).ok
      } catch {
        return false
      }
    }
    const form = document.querySelector('[data-testid="browser-file-attachment-form"]')
    const imgs = [...form.querySelectorAll('[data-file-item] img')].map((el) => el.src)
    return {
      count: form.querySelectorAll('[data-file-item]').length,
      fd: new FormData(form).getAll('picked').map((f) => f.name),
      imgs,
      bothAlive: imgs.length === 2 && (await isAlive(imgs[0])) && (await isAlive(imgs[1])),
    }
  })
  await page.locator('[data-testid="browser-file-attachment-form"] button[aria-label="Убрать файл: shot-a.png"]').click()
  await page.waitForTimeout(80)
  const faAfter = await page.evaluate(async (prevImgs) => {
    const isAlive = async (url) => {
      try {
        return (await fetch(url)).ok
      } catch {
        return false
      }
    }
    const form = document.querySelector('[data-testid="browser-file-attachment-form"]')
    const imgs = [...form.querySelectorAll('[data-file-item] img')].map((el) => el.src)
    return {
      count: form.querySelectorAll('[data-file-item]').length,
      fd: new FormData(form).getAll('picked').map((f) => f.name),
      snapNames: window.__attachmentHost.snapshot().faNames,
      imgs,
      firstRevoked: !(await isAlive(prevImgs[0])),
      secondKeptSameUrl: imgs.length === 1 && imgs[0] === prevImgs[1] && (await isAlive(imgs[0])),
    }
  }, faBefore.imgs)
  ok(
    'FileAttachment: выбор FileList, DataTransfer-удаление файла и точечный отзыв blob: URL',
    faBefore.count === 3 &&
      JSON.stringify(faBefore.fd) === JSON.stringify(['shot-a.png', 'spec.pdf', 'shot-b.png']) &&
      faBefore.bothAlive &&
      faAfter.count === 2 &&
      JSON.stringify(faAfter.fd) === JSON.stringify(['spec.pdf', 'shot-b.png']) &&
      JSON.stringify(faAfter.snapNames) === JSON.stringify(['spec.pdf', 'shot-b.png']) &&
      faAfter.firstRevoked &&
      faAfter.secondKeptSameUrl,
    JSON.stringify({ faBefore, faAfter }),
  )

  // Дожимаем удаление оставшихся 2 → 1 → 0 файлов (включая одиночный сброс input.value = '' в Blink)
  await page.locator('[data-testid="browser-file-attachment-form"] button[aria-label="Убрать файл: shot-b.png"]').click()
  await page.waitForTimeout(60)
  await page.locator('[data-testid="browser-file-attachment-form"] button[aria-label="Убрать файл: spec.pdf"]').click()
  await page.waitForTimeout(60)
  const faEmpty = await page.evaluate(() => {
    const form = document.querySelector('[data-testid="browser-file-attachment-form"]')
    return {
      listExists: form.querySelector('[data-file-list]') !== null,
      fdCount: new FormData(form).getAll('picked').filter((f) => f instanceof File && f.size > 0).length,
      snapNames: window.__attachmentHost.snapshot().faNames,
    }
  })
  ok(
    'FileAttachment: удаление последнего файла полностью убирает список [data-file-list] в Blink',
    !faEmpty.listExists && faEmpty.fdCount === 0 && faEmpty.snapNames.length === 0,
    JSON.stringify(faEmpty),
  )

  // 6. Реальный жизненный цикл `blob:` URL в движке Chromium (`BlobURLStore`)
  const blobLifecycle = await page.evaluate(async () => {
    const isAlive = async (url) => {
      try {
        const res = await fetch(url)
        return res.ok
      } catch {
        return false
      }
    }
    const box = document.querySelector('[data-testid="live-file-box"]')
    const img1 = box.querySelector('img')
    const url1 = img1?.src ?? ''
    const decoded1 = Boolean(img1 && img1.complete && img1.naturalWidth === 1 && img1.naturalHeight === 1)
    const aliveBeforeSwap = await isAlive(url1)

    window.__attachmentHost.swapToSecondPng()
    await new Promise((r) => setTimeout(r, 80))
    const url2 = box.querySelector('img')?.src ?? ''
    const url1RevokedOnSwap = !(await isAlive(url1))
    const url2AliveAfterSwap = await isAlive(url2)

    window.__attachmentHost.swapToCorruptPng()
    await new Promise((r) => setTimeout(r, 120))
    const url2RevokedOnCorruptSwap = !(await isAlive(url2))
    const fellBackToSvgIcon = box.querySelector('img') === null && box.querySelector('svg') !== null

    window.__attachmentHost.swapToSecondPng()
    await new Promise((r) => setTimeout(r, 80))
    const url4 = box.querySelector('img')?.src ?? ''
    const aliveBeforeUnmount = await isAlive(url4)
    await window.__unmountAttachmentHost()
    const revokedOnUnmount = !(await isAlive(url4))

    return {
      decoded1,
      aliveBeforeSwap,
      distinctUrls: url1.startsWith('blob:') && url2.startsWith('blob:') && url1 !== url2,
      url1RevokedOnSwap,
      url2AliveAfterSwap,
      url2RevokedOnCorruptSwap,
      fellBackToSvgIcon,
      aliveBeforeUnmount,
      revokedOnUnmount,
    }
  })

  ok(
    'локальный PNG File декодируется в Chromium через blob: URL',
    blobLifecycle.decoded1 && blobLifecycle.aliveBeforeSwap && blobLifecycle.distinctUrls,
    JSON.stringify(blobLifecycle),
  )
  ok(
    'замена файла, битый PNG (onerror → SVG fallback) и unmount реально отзывают blob: URL в Chromium',
    blobLifecycle.url1RevokedOnSwap &&
      blobLifecycle.url2AliveAfterSwap &&
      blobLifecycle.url2RevokedOnCorruptSwap &&
      blobLifecycle.fellBackToSvgIcon &&
      blobLifecycle.aliveBeforeUnmount &&
      blobLifecycle.revokedOnUnmount,
    JSON.stringify(blobLifecycle),
  )

  ok('ноль необработанных ошибок страницы (pageerror)', pageErrors.length === 0, pageErrors.join('; '))
} catch (err) {
  console.error(err)
  failed++
} finally {
  await browser.close().catch(() => {})
}

if (failed) {
  console.error(`\nПровалено проверок: ${failed}`)
  process.exit(1)
}
console.log('\nвсе проверки прошли')
process.exit(0)
