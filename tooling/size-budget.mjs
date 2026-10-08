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
const GENERATED_APP = '.svelte-kit/generated/client-optimized/app.js'

// Лимиты подняты 2026-10-07 (этапы 1–4): общий слой источников с возможностями,
// серверная схема фильтров Shikimori, её клиентская часть (ключи адреса, схема,
// связки) и панель фильтров с формой на схеме добавили ~34 KiB gzip — это
// функциональность, а не случайная зависимость.
// Запас остаётся минимальным (факт 200.7 / 187.8 / 12.9 — с подписями полей фильтров и причиной сбоя схемы): гейт по-прежнему ловит
// и новую тяжёлую зависимость, и рост клиентской части схемы.
// Issue 11 (2026-10-08): Forms/Modals now share the demo controls and render
// their JS-only settings disabled until hydration. The measured 203.4 / 190.5
// KiB keeps a sub-1-KiB reserve instead of hiding an unbounded increase.
const LIMITS = {
  allImmutableGzip: 204 * KiB,
  allJsGzip: 191 * KiB,
  allCssGzip: 20 * KiB,
  largestJsGzip: 50 * KiB,
  largestCssGzip: 14 * KiB,
}

const ROUTE_LIMITS = {
  '/': 130 * KiB,
  '/form': 150 * KiB,
  '/modals': 135 * KiB,
  // Пагинатор с живым источником, lib/search и панелью фильтров (факт 120.3).
  // Лимит добавлен на этапе 4: раньше этот маршрут не проверялся вовсе.
  '/paginator': 126 * KiB,
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
  const out = {}
  for (const match of source.matchAll(/"([^"]+)"\s*:\s*\[([^\]]*)\]/g)) {
    out[match[1]] = match[2]
      .split(',')
      .map((x) => Number(x.trim()))
      .filter(Number.isFinite)
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
