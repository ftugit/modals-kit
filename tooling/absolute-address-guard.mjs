/**
 * Гейт «адреса реестра абсолютны в рантайме» (S0 плана сессий).
 *
 * Зачем: `kitRoute.href()` у динамического адреса вычисляется внутри запроса, и при
 * включённых относительных адресах фреймворк отдаёт путь без ведущего `/`. Дальше
 * `safeRedirect` такой адрес отбрасывает, а обработчик, проверяющий «переход есть и
 * начинается с `/`», уходит в ветку отказа — успешное действие объявляется провалом
 * (ложный `?notice=revoke-failed` при фактически отозванной сессии).
 *
 * Что проверяется:
 *   1. в конфигурации сборки относительные адреса выключены (`paths.relative: false`);
 *   2. в обработчиках роутов нет строковой проверки адреса перехода — назначение
 *      решает `safeRedirect` библиотеки форм, а не `startsWith('/')` в роуте.
 *
 * Отключение по месту — комментарием в той же строке: `// absolute-address-ok: причина`.
 * Ослаблять `safeRedirect` вместо этого нельзя: он защита от увода на чужой хост.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './load-url-guard.mjs'

const ROUTES_DIR = 'src/routes'
const CONFIG = 'vite.config.ts'

/** Строковая проверка адреса перехода в роуте: `redirect?.startsWith('/')` и родня. */
const STRING_CHECK_RE = /redirect\s*(\?\.|\.)?startsWith\s*\(\s*['"`]\/['"`]\s*\)/

/**
 * Конфигурация сборки выключает относительные адреса.
 * Комментарии вырезаны: упоминание `relative: false` в пояснении не должно
 * считаться настройкой — иначе негативный контроль «убрать опцию» не ловится.
 */
export function configHasAbsolutePaths(source) {
  return /\brelative\s*:\s*false\b/.test(stripComments(source))
}

/**
 * Найти строковые проверки адреса перехода.
 * @param {{ path: string, source: string }[]} files
 * @returns {{ path: string, line: number, text: string }[]}
 */
export function findRedirectStringChecks(files) {
  const out = []
  for (const { path, source } of files) {
    source.split('\n').forEach((text, i) => {
      if (!STRING_CHECK_RE.test(text)) return
      if (text.includes('absolute-address-ok:')) return
      out.push({ path, line: i + 1, text: text.trim() })
    })
  }
  return out
}

/** Все серверные модули роутов. */
function routeSources() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (name.endsWith('.server.ts') || name.endsWith('.server.js')) {
        files.push({ path, source: readFileSync(path, 'utf8') })
      }
    }
  }
  walk(ROUTES_DIR)
  return files
}

export function run() {
  const problems = []
  if (!configHasAbsolutePaths(readFileSync(CONFIG, 'utf8'))) {
    problems.push(`${CONFIG}: нет \`paths.relative: false\` — адреса реестра снова относительные`)
  }
  for (const hit of findRedirectStringChecks(routeSources())) {
    problems.push(`${hit.path}:${hit.line}: строковая проверка адреса перехода — ${hit.text}`)
  }
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = run()
  if (problems.length) {
    console.error('absolute-address-guard: найдено нарушений:', problems.length)
    for (const p of problems) console.error('  ' + p)
    process.exit(1)
  }
  console.log('absolute-address-guard: ok')
}
