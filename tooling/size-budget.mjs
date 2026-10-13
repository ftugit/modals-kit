#!/usr/bin/env node
/**
 * Проверка бюджетов веса клиентской сборки.
 *
 * Требует готовой сборки SvelteKit:
 *
 *   npm run build
 *   node tooling/size-budget.mjs
 *
 * Считаем gzip по реальным файлам из .svelte-kit/output/client. Бюджеты
 * заданы с небольшим запасом к текущей демо-сборке: они ловят случайное
 * добавление тяжёлой зависимости, но не заставляют править хэшированные имена.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const KiB = 1024
const CLIENT_ROOT = '.svelte-kit/output/client'
const IMMUTABLE_ROOT = join(CLIENT_ROOT, '_app/immutable')
const MANIFEST = join(CLIENT_ROOT, '.vite/manifest.json')
// Сгенерированное SvelteKit лежит раздельно: `generated/build` (сборка) и `generated/dev`.
// Читать надо именно файл сборки — иначе бюджет считается по чужому app.js (ход 16, B9).
const GENERATED_APP = '.svelte-kit/generated/build/client-optimized/app.js'

// Лимиты подняты 2026-10-07 (этапы 1–4): общий слой источников с возможностями,
// серверная схема фильтров Shikimori, её клиентская часть (ключи адреса, схема,
// связки) и панель фильтров с формой на схеме добавили ~34 KiB gzip — это
// функциональность, а не случайная зависимость.
// Запас остаётся минимальным (факт 200.7 / 187.8 / 12.9 — с подписями полей фильтров и причиной сбоя схемы): гейт по-прежнему ловит
// и новую тяжёлую зависимость, и рост клиентской части схемы.
// Issue 11 (2026-10-08): shared demo controls and JS-only settings fit the
// original global budgets; do not raise them to accommodate this change.
// REVISION 2026-10-09 (решение оператора, этап 6–7 закрытия): «подними на 10%
// все» — лимиты подняты ровно на 10% (факты после этапов 5–6: 208.5 / 195.5 /
// 13.0 / 47.7; маршруты /form 151.5, /paginator 123.0). Правило «рост докладывать»
// остаётся: поднятие — акт оператора, не исполнителя.
// REVISION 2026-10-11 (решение оператора, ход 12): исправления F28/F36 (проверка
// цвета/якоря из адреса) и загрузчика F30/F32–F34 дали 209.2 > 209.0 KiB «весь JS».
// Оператор: «поднимай сейчас и в подобных сценариях на 5кб сразу всегда» —
// allJsGzip 209 → 214. Прочие лимиты не тронуты (не превышены).
// REVISION 2026-10-11 (ход 16, переезд на SvelteKit 3, B1): рантайм Kit 3 дал +3.5 KiB
// (226.8 > 223.3 все immutable; /modals 153.6 > 150.0); код приложения между замерами —
// только замена pushState/replaceState на goto({ shallow }). По постоянному решению
// оператора («поднимай на 5кб сразу») — allImmutableGzip 223.3 → 228.3, /modals 150 → 155.
// REVISION 2026-10-11 (ход 27, C2 — каркас и модальные системы по группам папок):
// весь JS 213.8 → 218.1, все immutable 227.0 → 231.3, /modals 154.0 → 157.5; прочие
// маршруты легче на 4.9 (реестр демо-модалок больше не в корневом layout). Модули
// не дублируются — большой общий чанк (51.6) разошёлся на несколько (svelte 32.5,
// primitives 10.8, classes 9.8, shell 5.9): gzip по частям хуже, плюс узлы групп.
// По постоянному решению оператора — +5: 228.3 → 233.3, 214 → 219, /modals 155 → 160.
// REVISION 2026-10-12 (ход 40, F54 — Rick and Morty REST/GraphQL в демо-пагинаторе):
// весь JS 220.0 > 219.0 (+2 вьюхи персонажа, клиент источника, статическая схема).
// По постоянному решению оператора — +5: 219 → 224. /paginator 188.5 / 196.5 — в пределах;
// все immutable 233.3 / 233.3 — на границе, не превышен, не тронут.
// REVISION 2026-10-12 (ход 42, F39 — якорь при открытом слое заменяет запись истории):
// все immutable 233.6 > 233.3 (обработчик клика по якорю в слое роутера). По постоянному
// решению оператора — +5: 233.3 → 238.3. Остальные лимиты не тронуты.
// REVISION 2026-10-14 (ход 112 — серверная ошибка закреплена за значением поля, `pins.ts`;
// экран схемы на перехваченной отправке): весь JS 224.02 > 224.0. По постоянному решению
// оператора — +5: 224 → 229. Остальные лимиты не тронуты.
// REVISION 2026-10-14 (ход 117 — поля формы на примитивах: PasswordInput, NumberField,
// OtpInput, SearchInput, Switch): сборщик кладёт их в общий чанк примитивов (рядом с
// Select), поэтому +1.5 приходят на каждый маршрут, как в ходе 95. Все immutable
// 240.6 > 238.3; /modals 165.4, /db-demo 184.5, /cycle 130.6, /spike 125.4,
// /cards/[id] 132.2. По постоянному решению оператора — +5 каждому превышенному.
const LIMITS = {
  allImmutableGzip: 243.3 * KiB,
  allJsGzip: 229 * KiB,
  allCssGzip: 22 * KiB,
  largestJsGzip: 55 * KiB,
  largestCssGzip: 15.4 * KiB,
}

const ROUTE_LIMITS = {
  '/': 143 * KiB,
  '/form': 165 * KiB,
  // ВРЕМЕННО 148.5 → 150 (решение оператора, ход 10, 2026-10-11): /modals тянет
  // весь lib/form через панель настроек (bind статически несёт отправку, async,
  // конверт, редактор). Тексты ошибок F23 (+0.4) и очередь адреса F12 (+0.1)
  // дали 148.6. Вернуть 148.5 после F25 (docs/design/universal-demo-panel.md).
  // Ход 16: 150 → 155 — рантайм Kit 3 (см. REVISION выше). Ход 27: 155 → 160 —
  // три узла layout вместо одного (C2, см. REVISION у LIMITS). Ход 95: 160 → 165 —
  // поиск вариантов Select через matchesQuery lib/search (R4, решение B): ядро fuzzy
  // (foldKey, взвешенный DL) едет в общий чанк примитивов, +1.4 на каждом маршруте;
  // /modals 161.0 > 160. По постоянному решению оператора — +5.
  '/modals': 170 * KiB,
  // Пагинатор с живым источником, lib/search и панелью фильтров. Ход 16 (решение
  // оператора): 138.6 → 196.5 = факт 191.5 + 5. Прежние «факт 120.3» и 138.6 были
  // замером БЕЗ страницы: узел записан в app.js как `~8` (серверные данные), и
  // разбор выбрасывал его (см. routeDictionary). Рост Kit 3 здесь ≈3.5, как у
  // остальных маршрутов; вес самой страницы — отдельная находка (kit3-upgrade §12).
  '/paginator': 196.5 * KiB,
  // C16 (решение оператора, ход 34: «прибавь размера»): маршруты без лимита
  // получили «факт + 5» по сборке хода 34 — 175.5 / 124.1 / 118.8 / 125.6.
  // Ход 109: + экран переноса схемы (SchemaPending, форма решений) — факт 180.8;
  // ленивый импорт не годится: без JS сервер отрисовал бы пустое место вместо экрана.
  // Ход 112: + закреплённые ошибки формы (pins) и смена источника в ядре пагинатора
  // (общее со списком БД) — факт 181.6 → 182.5.
  '/db-demo': 187.5 * KiB,
  '/cycle': 134.1 * KiB,
  '/spike': 128.8 * KiB,
  '/cards/[id]': 135.6 * KiB,
}

if (!existsSync(MANIFEST) || !existsSync(IMMUTABLE_ROOT)) {
  console.error('Нет клиентской сборки. Сначала запустите `npm run build`.')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const failures = []

function fmt(bytes) {
  return `${(bytes / KiB).toFixed(1)} KiB`
}

function failIf(label, value, limit) {
  const ok = value <= limit
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}: ${fmt(value)} / ${fmt(limit)}`)
  if (!ok) failures.push(`${label}: ${fmt(value)} > ${fmt(limit)}`)
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path, out)
    else if (/\.(js|css)$/.test(path)) out.push(path)
  }
  return out
}

function assetStats(file) {
  const buf = readFileSync(file)
  return { raw: buf.length, gzip: gzipSync(buf).length }
}

function immutableStats() {
  const files = walk(IMMUTABLE_ROOT).map((path) => {
    const rel = path.replace(`${CLIENT_ROOT}/`, '')
    return { file: rel, type: path.endsWith('.css') ? 'css' : 'js', ...assetStats(path) }
  })
  const sum = (type) => files.filter((f) => !type || f.type === type).reduce((n, f) => n + f.gzip, 0)
  const largest = (type) => files.filter((f) => f.type === type).sort((a, b) => b.gzip - a.gzip)[0]
  return { files, total: sum(), js: sum('js'), css: sum('css'), largestJs: largest('js'), largestCss: largest('css') }
}

function manifestKeyByName(name) {
  return Object.keys(manifest).find((key) => manifest[key]?.name === name)
}

function nodeKey(n) {
  const suffix = `/nodes/${n}.js`
  return Object.keys(manifest).find((key) => key.endsWith(suffix))
}

function resolveManifestKey(key) {
  if (manifest[key]) return key
  return Object.keys(manifest).find((candidate) => manifest[candidate]?.file === key)
}

function collectManifestFiles(keys, seenKeys = new Set(), files = new Set()) {
  for (const key of keys) {
    const resolved = resolveManifestKey(key)
    if (!resolved || seenKeys.has(resolved)) continue
    seenKeys.add(resolved)

    const entry = manifest[resolved]
    if (entry.file && /\.(js|css)$/.test(entry.file)) files.add(entry.file)
    for (const css of entry.css ?? []) files.add(css)
    collectManifestFiles(entry.imports ?? [], seenKeys, files)
  }
  return files
}

function routeDictionary() {
  if (!existsSync(GENERATED_APP)) return {}
  const source = readFileSync(GENERATED_APP, 'utf8')
  // Словарь Kit: `"/(site)/(app)/form": [лист, [layouts], [errors]]`. Разбор —
  // JSON после двух замен, а не регулярка по `[…]`: с группами (C2) значения
  // вложенные, и `\[([^\]]*)\]` обрезал их на первой `]`, теряя layouts.
  //   • `~n` — узел n с серверной загрузкой (в app.js это JS-выражение `~n`);
  //     без снятия `~` узел выпадает и /paginator, /db-demo мерятся без
  //     собственной страницы (так было до хода 16);
  //   • пропуски массива (`[,4]` — слот layout без файла) → `null`.
  const body = source.match(/export const dictionary = (\{[\s\S]*?\});/)?.[1]
  if (!body) return {}
  const dictionary = JSON.parse(
    body.replace(/~(\d+)/g, '$1').replace(/\[\s*,/g, '[null,').replace(/,\s*(?=[,\]])/g, ',null'),
  )
  const out = {}
  for (const [id, [leaf, layouts = []]] of Object.entries(dictionary)) {
    // Адрес маршрута — id без групп: `/(site)/(app)` → `/`. Вес — корень (0,
    // добавляет routeGzip) + layouts ветки + лист; узлы ошибок Kit грузит только
    // при ошибке — их нет в начальной загрузке, как не было и до групп.
    const url = id.replace(/\/\([^/]+\)/g, '') || '/'
    out[url] = [leaf, ...layouts].filter(Number.isFinite)
  }
  return out
}

function routeGzip(route, nodes) {
  const start = manifestKeyByName('entry/start')
  const app = manifestKeyByName('entry/app')
  if (!start || !app) throw new Error('Не найдены entry/start или entry/app в manifest')

  const requiredNodes = [...new Set([0, ...nodes])]
  const keys = [start, app, ...requiredNodes.map(nodeKey)]
  if (keys.some((key) => !key)) throw new Error(`Не найдены client nodes для маршрута ${route}`)

  const files = [...collectManifestFiles(keys)]
  const total = files.reduce((n, file) => n + assetStats(join(CLIENT_ROOT, file)).gzip, 0)
  return { total, files }
}

const stats = immutableStats()
console.log('Бюджеты клиентской сборки gzip')
failIf('все immutable-ресурсы', stats.total, LIMITS.allImmutableGzip)
failIf('весь JS', stats.js, LIMITS.allJsGzip)
failIf('весь CSS', stats.css, LIMITS.allCssGzip)
failIf(`самый большой JS (${stats.largestJs.file})`, stats.largestJs.gzip, LIMITS.largestJsGzip)
failIf(`самый большой CSS (${stats.largestCss.file})`, stats.largestCss.gzip, LIMITS.largestCssGzip)

const routes = routeDictionary()
console.log('\nБюджеты начальной загрузки маршрутов')
for (const [route, limit] of Object.entries(ROUTE_LIMITS)) {
  if (!routes[route]) {
    console.log(` FAIL ${route}: маршрут не найден в generated app`)
    failures.push(`${route}: маршрут не найден`)
    continue
  }
  const { total } = routeGzip(route, routes[route])
  failIf(`${route}`, total, limit)
}

console.log('\nКрупнейшие gzip-ресурсы')
for (const file of stats.files.sort((a, b) => b.gzip - a.gzip).slice(0, 8)) {
  console.log(`  ${fmt(file.gzip).padStart(9)}  ${file.file}`)
}

if (failures.length) {
  console.error(`\nБюджет превышен:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('\nбюджеты веса соблюдены')
