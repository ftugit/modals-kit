/**
 * public-api — у каждого пакета `src/lib/<pkg>` есть ОБЪЯВЛЕННЫЙ вход, и
 * снаружи пакета видно только его.
 *
 * Зачем это отдельно от `layer-guard` и `core-purity`:
 *   • те два сторожат направления слоёв и независимость ядра от фреймворка;
 *   • этот — переносимость: пакет обязан быть пригодным ВНЕ приложения, а
 *     значит его внешний вид — не «всё, что лежит в папке», а список того, что
 *     разработчик пакета обещает держать. Глубокий импорт `#lib/db/sync/plan.js`
 *     из маршрута привязывает маршрут к внутреннему устройству пакета: файл
 *     можно переименовать только вместе с чужим кодом, и никакой README об этом
 *     не предупредит.
 *
 * Правило ровно одно и проверяется буквально:
 *   импорт `#lib/<pkg>/<rest>` из файла ВНЕ `src/lib/<pkg>/` допустим, только
 *   если `<rest>` объявлен в `src/lib/<pkg>/entrypoints.json`.
 *
 * Объявление живёт рядом с кодом пакета, а не в этом файле: переносишь пакет —
 * переносишь и его контракт. Манифеста нет — снаружи виден только `index.js`.
 * Манифест, указывающий в пустоту, — тоже нарушение: вход, которого нет, хуже
 * отсутствующего входа.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Расширения, из которых Vite/Node резолвят спецификатор `.js`. */
const RESOLVE_EXT = ['.ts', '.js', '.mts', '.mjs', '.svelte']
/** Ассеты — тоже вход пакета (шрифт, иконка), но резолвятся как есть. */
const ASSET_EXT = ['.svg', '.png', '.jpg', '.woff2', '.txt', '.json']

/** Импорты всех четырёх форм, кроме относительных. */
const IMPORT_RE =
  /(?:^|[\s;{}()])(?:import|export)\s+[\s\S]{0,400}?\bfrom\s*['"]([^'"\n]+)['"]|(?:^|[\s;{}()])import\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g

const CODE_FILE = /\.(ts|mts|js|mjs|svelte)$/
const SKIP_DIRS = new Set(['node_modules', '.svelte-kit', 'build', 'dist', '.git'])

/**
 * Все спецификаторы импорта из текста модуля.
 * @param {string} code
 * @returns {string[]}
 */
export function collectSpecifiers(code) {
  const out = []
  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (spec) out.push(spec)
  }
  return out
}

/**
 * Файлы проекта под `dir` — рекурсивно, без каталогов сборки.
 * @param {string} dir
 * @returns {string[]}
 */
export function walkCode(dir) {
  /** @type {string[]} */
  const out = []
  const walk = (/** @type {string} */ d) => {
    for (const entry of readdirSync(d)) {
      if (SKIP_DIRS.has(entry)) continue
      const path = join(d, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (CODE_FILE.test(entry)) out.push(path)
    }
  }
  walk(dir)
  return out
}

/**
 * Манифест пакета: `{ entrypoints: ['index.js', 'sveltekit.js', …] }`.
 * Нет манифеста — снаружи виден только `index.js`.
 * @param {string} pkgDir абсолютный путь пакета
 * @returns {{ entrypoints: string[], manifest: boolean }}
 */
export function readManifest(pkgDir) {
  const file = join(pkgDir, 'entrypoints.json')
  if (!existsSync(file)) return { entrypoints: ['index.js'], manifest: false }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { entrypoints: [], manifest: true, error: `не разбирается JSON: ${error.message}` }
  }
  const list = Array.isArray(parsed?.entrypoints) ? parsed.entrypoints : []
  return { entrypoints: list.filter((e) => typeof e === 'string'), manifest: true }
}

/**
 * Существует ли объявленный вход на самом деле.
 * @param {string} pkgDir
 * @param {string} entry например `svelte/index.js`
 * @returns {boolean}
 */
export function entryExists(pkgDir, entry) {
  const exact = join(pkgDir, entry)
  if (existsSync(exact)) return true
  const base = entry.replace(/\.(js|mjs|ts)$/, '')
  for (const ext of RESOLVE_EXT) if (existsSync(join(pkgDir, base + ext))) return true
  if (/\.(js|mjs|ts)$/.test(entry)) {
    const stem = entry.replace(/\.(js|mjs|ts)$/, '')
    for (const ext of ASSET_EXT) if (existsSync(join(pkgDir, stem + ext))) return true
  }
  return false
}

/**
 * Проверка одного спецификатора.
 * @param {string} spec
 * @param {string} importer путь от корня проекта (`src/…`)
 * @param {Record<string, string[]>} manifests пакет → объявленные входы
 * @returns {{ pkg: string, rest: string, importer: string } | null} нарушение
 */
export function checkSpecifier(spec, importer, manifests) {
  if (!spec.startsWith('#lib/')) return null
  const [, pkg, ...tail] = spec.split('/')
  const rest = tail.join('/') || 'index.js'
  // Внутри своего пакета — любая глубина: это его собственное устройство.
  if (importer.startsWith(`src/lib/${pkg}/`)) return null
  const allowed = manifests[pkg]
  if (!allowed) return null // пакета нет — пусть падает резолв, а не наш страж
  if (allowed.includes(rest)) return null
  return { pkg, rest, importer }
}

/**
 * Полная проверка дерева.
 * @param {string} root корень проекта
 * @returns {{ violations: { pkg: string, rest: string, importer: string }[], manifests: Record<string, string[]>, lies: { pkg: string, entry: string }[] }}
 */
export function checkTree(root) {
  const libDir = join(root, 'src', 'lib')
  /** @type {Record<string, string[]>} */
  const manifests = {}
  /** @type {{ pkg: string, entry: string }[]} */
  const lies = []
  for (const pkg of readdirSync(libDir)) {
    const pkgDir = join(libDir, pkg)
    if (!statSync(pkgDir).isDirectory()) continue
    const { entrypoints, error } = readManifest(pkgDir)
    if (error) lies.push({ pkg, entry: error })
    manifests[pkg] = entrypoints
    for (const entry of entrypoints) {
      if (!entryExists(pkgDir, entry)) lies.push({ pkg, entry })
    }
  }

  /** @type {{ pkg: string, rest: string, importer: string }[]} */
  const violations = []
  for (const file of walkCode(join(root, 'src'))) {
    const importer = relative(root, file).split(sep).join('/')
    const code = readFileSync(file, 'utf8')
    for (const spec of collectSpecifiers(code)) {
      const bad = checkSpecifier(spec, importer, manifests)
      if (bad) violations.push(bad)
    }
  }
  return { violations, manifests, lies }
}

/**
 * Человеческое объяснение нарушений.
 * @param {{ violations: { pkg: string, rest: string, importer: string }[], lies: { pkg: string, entry: string }[] }} result
 * @returns {string}
 */
export function formatReport(result) {
  const { violations, lies } = result
  if (!violations.length && !lies.length) return ''
  /** @type {string[]} */
  const out = []

  if (lies.length) {
    out.push('[public-api] Манифест входа указывает в пустоту:')
    for (const lie of lies) out.push(`    src/lib/${lie.pkg}/entrypoints.json → ${lie.entry}`)
    out.push('  Вход, которого нет, хуже отсутствующего: он обещает контракт и молча не отдаёт его.')
    out.push('')
  }

  if (violations.length) {
    /** @type {Map<string, { rest: string, importers: string[] }[]>} */
    const byPkg = new Map()
    for (const v of violations) {
      const list = byPkg.get(v.pkg) ?? []
      const hit = list.find((x) => x.rest === v.rest)
      if (hit) hit.importers.push(v.importer)
      else list.push({ rest: v.rest, importers: [v.importer] })
      byPkg.set(v.pkg, list)
    }
    out.push(`[public-api] Глубокий импорт мимо объявленного входа (${violations.length}):`)
    for (const [pkg, list] of [...byPkg.entries()].sort()) {
      for (const { rest, importers } of list) {
        out.push(`    #lib/${pkg}/${rest}`)
        for (const imp of importers) out.push(`        ← ${imp}`)
      }
    }
    out.push('')
    out.push('  Что делать:')
    out.push('    • символ принадлежит внешнему контракту пакета → экспортируй его из `index.ts`')
    out.push('      (или из другого УЖЕ объявленного входа) и импортируй оттуда;')
    out.push('    • модуль — отдельная платформенная точка (svelte / sveltekit / node / адаптер)')
    out.push('      → объяви её в `src/lib/<pkg>/entrypoints.json`;')
    out.push('    • импорт из другого пакета `src/lib/*` — то же правило: пакеты общаются входами.')
    out.push('')
  }
  return out.join('\n')
}

/* ── боевой прогон ─────────────────────────────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkTree(process.cwd())
  const report = formatReport(result)
  if (report) {
    console.error(report)
    process.exit(1)
  }
  const total = Object.values(result.manifests).reduce((n, list) => n + list.length, 0)
  console.log(
    `[public-api] входы объявлены и соблюдены: пакетов ${Object.keys(result.manifests).length}, входов ${total}`,
  )
}
