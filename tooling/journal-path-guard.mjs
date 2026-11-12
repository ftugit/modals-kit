/**
 * Гейт «адрес журнала — из реестра, путь журнала разбирает одна функция».
 *
 * Зачем: путь `/sessions` объявлен в реестре (`sessionsJournalRoute`), а признак
 * журнала в адресе носителя разбирает `sessionsFiltersTarget`. Пока литерал
 * вшит в разметку, а регулярка продублирована в `load`, правка роута расходится
 * с кодом: форма фильтров уедет не на тот срез, а кнопка — не на ту страницу.
 * Обе ошибки молчаливые: адрес валидный, просто не тот.
 *
 * Как действовать при срабатывании:
 *   • литерал `'/sessions'` → `sessionsJournalRoute.href()`;
 *   • распознавание журнала по пути → `sessionsFiltersTarget(from)`.
 * Отключение по месту — комментарием в той же строке: `// journal-path-ok: причина`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './load-url-guard.mjs'

const SRC_DIR = 'src'

/** Адрес журнала вшит литералом: кавычки любые, но ровно `/sessions`. */
const LITERAL_RE = /['"`]\/sessions['"`]/

/** Своё распознавание журнала по пути вместо вызова `sessionsFiltersTarget`. */
const INLINE_RE = /\\\/sessions\s*\(\?:/i

const OK_MARK = 'journal-path-ok:'

/**
 * @param {string} source
 * @param {string} file
 * @returns {string[]}
 */
export function checkSource(source, file) {
  // Комментарии не код: упоминание правила в пояснении — не нарушение.
  const code = stripComments(source)
  const raw = source.split(/\r?\n/)
  const problems = []
  code.split(/\r?\n/).forEach((line, i) => {
    // Пометку ищем в исходной строке: `stripComments` её уже вырезал.
    if ((raw[i] ?? '').includes(OK_MARK)) return
    if (LITERAL_RE.test(line)) {
      problems.push(
        `${file}:${i + 1}: адрес журнала вшит строкой — берите sessionsJournalRoute.href() ` +
          '(реестр `src/content/user/routes.ts`); вшитый путь расходится с роутом при его правке',
      )
    }
    if (INLINE_RE.test(line)) {
      problems.push(
        `${file}:${i + 1}: путь журнала разбирается на месте — вызывайте sessionsFiltersTarget(from) ` +
          '(`src/content/user/ui/sessions-list/source.ts`), иначе признак журнала живёт в двух местах',
      )
    }
  })
  return problems
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function checkDir(dir = SRC_DIR) {
  const out = []
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      // Реестр сам объявляет путь — это источник, а не нарушение. Функция
      // разбора — единственное место, где путь журнала допустим.
      if (!/\.(ts|svelte)$/.test(name)) continue
      // Тесты намеренно пишут строку, которую страж запрещает.
      if (/\.test\./.test(name)) continue
      if (path.endsWith(join('content', 'user', 'routes.ts'))) continue
      if (path.endsWith(join('sessions-list', 'source.ts'))) continue
      if (path.endsWith(join('content', 'user', 'types.ts'))) continue
      out.push(...checkSource(readFileSync(path, 'utf8'), path))
    }
  }
  walk(dir)
  return out
}

/** @param {string[]} problems */
export function formatFindings(problems) {
  return problems.map((p) => `  • ${p}`).join('\n')
}
