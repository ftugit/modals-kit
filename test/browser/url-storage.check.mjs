/**
 * Проверка URL-хранилища пагинатора живым браузером: адрес обязан поспевать за
 * состоянием в ОБЕ стороны (в том числе при возврате к значению по умолчанию) и не
 * должен переносить указатель следующего шага через пересборку окна.
 *
 * Два класса отказов, из-за которых этот файл и появился:
 *   • echo-guard судил по срезу `$app/state.page.url`, который после `replaceState`
 *     отстаёт → запись адреса пропускалась («источник не переключается»);
 *   • `?page.after` переживал смену `ord`/`flt`/`cur` → источник отвечал 400,
 *     список пустел («на базе данных опции не работают»).
 *
 * Запуск: предпросмотр на 5173 (`npm run build && npm run preview`).
 */
import { chromium } from 'playwright'
const BASE = process.env.URL_CHECK_BASE ?? 'http://127.0.0.1:5173'
let failed = 0
let checked = 0
const ok = (cond, label, got) => {
  checked++
  if (cond) console.log(`  ✓ ${label}`)
  else { failed++; console.log(`  ✗ ${label} → получено: ${got}`) }
}
const b = await chromium.launch({ headless: true })
const p = await b.newPage({ viewport: { width: 1300, height: 1700 } })
const errs = []
const net4xx = []
const reqs = []
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
p.on('response', (r) => { if (r.status() >= 400 && /\/api\//.test(r.url())) net4xx.push(`${r.status()} ${r.url()}`) })
p.on('request', (r) => { if (/\/api\/db-posts/.test(r.url())) reqs.push(r.url()) })
const panel = (name) => p.locator(`[data-testid="demo-panel"] [name="${name}"]`)
const ctl = () =>
  p.evaluate(() => ({
    url: location.search,
    src: document.querySelector('[data-testid="demo-panel"] [name="page.src"]')?.value ?? null,
    size: document.querySelector('[data-testid="demo-panel"] [name="page.size"]')?.value ?? null,
  }))

// ── /paginator: источник и размер ─────────────────────────────────────────────
await p.goto(`${BASE}/paginator?page.size=5&page.src=products`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
let s = await ctl()
ok(s.src === 'products' && s.size === '5', 'вход: панель читает адрес (src=products, size=5)', JSON.stringify(s))
for (const [src, expect] of [['photos', 'page.src=photos'], ['db', 'page.src=db'], ['products', null]]) {
  await panel('page.src').selectOption(src)
  await p.waitForTimeout(1600)
  s = await ctl()
  ok(
    expect ? s.url.includes(expect) : !/page\.src=/.test(s.url),
    `источник → ${src}: адрес ${expect ? `несёт ${expect}` : 'без ключа (значение по умолчанию)'} и панель согласована`,
    JSON.stringify(s),
  )
  ok(s.src === src, `источник → ${src}: селект показывает ${src}`, s.src)
}
await panel('page.src').selectOption('db')
await panel('page.src').selectOption('animes')
await p.waitForTimeout(2000)
s = await ctl()
ok(s.url.includes('page.src=animes') && s.src === 'animes', 'две смены подряд без ожидания: вторая запись адреса не потеряна', JSON.stringify(s))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
s = await ctl()
ok(s.src === 'animes' && s.url.includes('page.src=animes'), 'перезагрузка: адрес восстановил источник', JSON.stringify(s))

// ── /db-demo: опции не должны ронять выдачу осевшим указателем ────────────────
const ord = encodeURIComponent('[["created_at","asc"]]')
await p.goto(`${BASE}/db-demo?page.size=3&page.cur=1&page.ord=${ord}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
const rows = () => p.evaluate(() => document.querySelectorAll('[data-testid="row"]').length)
const ptr = () => p.evaluate(() => document.querySelector('[data-testid="list-pointer"]')?.textContent?.trim() ?? null)
ok((await rows()) === 3, '/db-demo: вход по адресу даёт 3 строки курсорного окна', await rows())
await p.selectOption('select[name="page.size"]', '5')
await p.waitForTimeout(1400)
ok((await rows()) === 5 && net4xx.length === 0, 'смена размера в курсорном режиме: 5 строк, отказов источника нет', `rows=${await rows()} 4xx=${net4xx.length}`)
// Снимок ДО смены порядка: адрес (в нём указатель текущего окна) и число запросов.
const s0 = await ctl()
const reqBefore = reqs.length
const tokenBefore = new URL(BASE + '/db-demo' + s0.url).searchParams.get('page.after')
await p.selectOption('select[name="page.ord"]', 'default')
await p.waitForTimeout(1600)
// Что именно обязано быть честным при смене порядка: НЕ пустой адрес (указатель
// следующего шага — штатная часть адресной строки курсорного режима), а (1) запрос
// первой страницы нового окна — БЕЗ прежнего токена, иначе источник ответит 400, и
// (2) новый токен в адресе вместо старого, то есть ссылка ведёт в новое окно.
ok((await rows()) > 0 && net4xx.length === 0, 'смена сортировки: окно пересобрано, 400 нет', `rows=${await rows()} 4xx=${net4xx.join(',')}`)
const staleReq = reqs
  .slice(reqBefore)
  .filter((u) => tokenBefore && u.includes(encodeURIComponent(tokenBefore)))
ok(
  reqs.length > reqBefore && staleReq.length === 0,
  'ни один запрос после смены порядка не понёс СТАРЫЙ указатель',
  `${reqs.length - reqBefore} запросов, со старым токеном: ${staleReq.length}`,
)
s = await ctl()
const tokenAfter = new URL(BASE + s.url).searchParams.get('page.after')
ok(tokenAfter !== null && tokenAfter !== tokenBefore, 'в адресе указатель — НОВЫЙ (выдан этим окном), а не пережитый', `${String(tokenBefore).slice(0, 12)}… → ${String(tokenAfter).slice(0, 12)}…`)
ok((await ptr()) === 'в адресе (?page.after)', 'состояние списка сообщает об указателе как о своём ключе', await ptr())
await p.uncheck('input[name="page.cur"]')
await p.waitForTimeout(1400)
s = await ctl()
ok(!/page\.(after|cur)=/.test(s.url), 'курсор выключен: адрес без указателя и без флага режима', s.url)
await p.check('input[name="page.live"]')
await p.selectOption('select[name="page.err"]', 'remove')
await p.waitForTimeout(1400)
const before = (await ctl()).url
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const after = (await ctl()).url
ok(before.includes('page.live=true') && after === before, 'опции живого списка переживают перезагрузку без правки адреса', `${before} → ${after}`)

ok(errs.length === 0, 'нет ошибок в консоли за всю сессию', errs.slice(0, 3).join(' | '))
ok(net4xx.length === 0, 'ни одного 4xx/5xx ответа источника за сессию', net4xx.slice(0, 3).join(' | '))
await b.close()
console.log(failed === 0 ? `\nURL_STORAGE_OK (${checked} проверок)` : `\nURL_STORAGE_FAIL: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
