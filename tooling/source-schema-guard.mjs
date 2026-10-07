/**
 * source-schema-guard — страж границы «схема живёт в зоне источника».
 *
 * Этап 3 дал источнику то, чего у локальных источников нет: СХЕМУ ФИЛЬТРОВ,
 * которая собирается на сервере из живых справочников (значения, связки,
 * `builtAt`) и приезжает клиенту готовой. Ценность такого устройства теряется
 * не одним решением, а тремя привычками:
 *   1. «тут проще посчитать на клиенте» — браузер снова начинает знать про API;
 *   2. «тут проще выписать ключ руками» — контракт имён расползается по файлам;
 *   3. «тут проще повторить конвейер» — SSR и клиент разъезжаются в правилах.
 *
 * Поэтому граница не декларируется в README, а проверяется: по каталогу
 * `src/**` гоняются правила ниже, и каждый файл знает, что ему позволено.
 *
 * Отключение по месту — комментарием в той же строке:
 *     const key = 'filters.kind' // source-schema-ok: причина
 */

/** Тесты и инструменты живут рядом с кодом, но границ не держат. */
const TEST_RE = /\.test\.(ts|mts|js|mjs)$|(^|\/)tooling\//

/** Зоны, которым позволено знать о внешнем API Shikimori. */
export const UPSTREAM_ZONES = [/^src\/lib\/server\//, /^src\/routes\/api\//]

/** Где объявлен контракт имён фильтров (единственное место, кроме тестов). */
export const KEY_ZONES = [/^src\/lib\/filters\//, /^src\/content\/shikimori-filters\.ts$/]

/** Зона сборки схемы: значения, связки, кэш `builtAt`. */
export const SCHEMA_ZONE = /^src\/lib\/server\/shikimori-schema\.ts$/

/** Зона конвейера «значения → параметры API»: один конвейер, один файл. */
export const PIPELINE_ZONE = /^src\/lib\/server\/shikimori-filters\.ts$/

/** Кому можно читать готовую схему `getShikimoriFilterSchema` (сервер целиком). */
export const SCHEMA_READERS = [/^src\/lib\/server\//, /^src\/routes\/api\//, /^src\/features\/paginator\/loader\.ts$/]

/**
 * Запрещённое в зоне чистых фильтров (`src/lib/filters`): модуль изоморфный и
 * framework-free — его импортируют и серверная зона, и форма в браузере.
 */
export const FILTERS_LIB = /^src\/lib\/filters\//
export const FILTERS_LIB_FORBIDDEN_SPECIFIERS = [
  /^svelte(\/|$)/,
  /^@sveltejs\//,
  /^\$app\//,
  /^react(-dom)?(\/|$)/,
  /^solid-js(\/|$)/,
  /^\$lib\/server\//,
  /^\$lib\/paginate(\/|$)/,
  /^\$lib\/modals(\/|$)/,
  /^\$lib\/form\/(svelte|react|solid|vue)(\/|$)/,
]
export const FILTERS_LIB_FORBIDDEN_GLOBALS = [/\bwindow\./, /\bdocument\./, /\blocalStorage\b/, /\bfetch\s*\(/]

/** Правила по содержимому: что искать и почему это ошибка. */
export const CONTENT_RULES = [
  {
    id: 'filter-key-literal',
    pattern: /(['"`])filters\.[a-z0-9_]+(\.[a-z0-9_]+)?\1/g,
    zones: [...KEY_ZONES, ...UPSTREAM_ZONES],
    why:
      'канонический ключ фильтра выписан в коде. Ключи объявлены один раз\n' +
      '    (`src/lib/filters` + `content/shikimori-filters`) и раздаются\n' +
      '    `catalogFilterFieldNames`; рукописный ключ в компоненте/роуте\n' +
      '    разъезжается со схемой молча — фильтр «есть», а параметра нет.',
  },
  {
    id: 'upstream-param',
    pattern: /(['"`])(genre_v2|exclude_ids|aired_on|censored|mylist)\1/g,
    zones: UPSTREAM_ZONES,
    why:
      'имя параметра внешнего API в несерверной зоне. Мэппинг «канонический\n' +
      '    ключ → параметр API» живёт в зоне источника: клиент не должен знать,\n' +
      '    что «жанры» — это `genre_v2`, иначе схема перестаёт быть серверной.',
  },
  {
    id: 'upstream-host',
    pattern: /shikimori\.(io|one)/g,
    zones: UPSTREAM_ZONES,
    why:
      'адрес внешнего API/сайта в несерверной зоне. Ссылки и медиа приходят\n' +
      '    абсолютными уже от сервера; второй источник правды о домене —\n' +
      '    расхождение при переезде (shikimori.one → shikimori.io).',
  },
  {
    id: 'schema-builder',
    pattern: /\b(buildShikimoriFilterSchema|readShikimoriRefs|resetShikimoriFilterSchema)\b/g,
    zones: [SCHEMA_ZONE],
    why:
      'сборка схемы вызвана вне её зоны. Значения и связки собираются в\n' +
      '    `$lib/server/shikimori-schema`; сборка «ещё разок» в роуте или\n' +
      '    лоадере — это второй кэш, вторая метка `builtAt` и два ответа на\n' +
      '    вопрос «какие фильтры у источника есть».',
  },
  {
    id: 'schema-reader',
    pattern: /\bgetShikimoriFilterSchema\b/g,
    zones: SCHEMA_READERS,
    why:
      'готовая схема читается не сервером. Она собирается из живых\n' +
      '    справочников и должна приходить клиенту роутом `/api/shikimori/filters`\n' +
      '    (или серверным транспортом) — на клиенте её вычислять нечем.',
  },
  {
    id: 'pipeline-call',
    pattern: /\banimesFilterQuery\s*\(/g,
    zones: [PIPELINE_ZONE],
    why:
      'конвейер «значения → параметры API» вызван в обход `fetchAnimesPage`.\n' +
      '    Роут и SSR-мост обязаны применять фильтры одинаково: второй вызов\n' +
      '    означает вторую реализацию правил и расхождение SSR с клиентом.',
  },
]

/**
 * Снимает комментарии, не тронув содержимое строк: `//` внутри `'https://…'`
 * комментарием не является. Понимает `//`, `/* *\/`, `<!-- -->`.
 * @param {string} source
 * @returns {string} — та же длина строк (позиции символов сохраняются)
 */
export function stripComments(source) {
  const out = source.split('')
  let i = 0
  const n = source.length
  // Переводы строк остаются на месте: по стрипнутому тексту считается номер
  // строки, и «строка 42» обязана вести в настоящий файл.
  const blank = (index) => {
    if (out[index] !== '\n') out[index] = ' '
  }
  while (i < n) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1
      while (i < n) {
        if (source[i] === '\\') i += 2
        else if (source[i] === ch) {
          i += 1
          break
        } else i += 1
      }
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') blank(i++)
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      blank(i)
      blank(i + 1)
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) blank(i++)
      if (i < n) {
        blank(i)
        blank(i + 1)
      }
      i += 2
      continue
    }
    if (ch === '<' && source.startsWith('<!--', i)) {
      while (i < n && !source.startsWith('-->', i)) blank(i++)
      if (i < n) {
        blank(i)
        blank(i + 1)
        blank(i + 2)
        i += 3
      }
      continue
    }
    i += 1
  }
  return out.join('')
}

/** @param {string} relPath @param {RegExp[]} zones */
const inZones = (relPath, zones) => zones.some((zone) => zone.test(relPath))

/** Номер строки по смещению (1-based) — сообщение должно вести к месту. */
function lineOf(source, index) {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === '\n') line += 1
  return line
}

/**
 * Проверяет ОДИН файл: правила содержимого + чистота зоны фильтров.
 * @param {string} relPath путь от корня проекта ('src/lib/filters/url.ts')
 * @param {string} source
 * @returns {Array<{rule: string, line: number, found: string, why: string}>}
 */
export function checkSource(relPath, source) {
  const path = relPath.replace(/\\/g, '/')
  if (TEST_RE.test(path)) return []
  const code = stripComments(source)
  const problems = []
  const allow = (index) => {
    const line = source.slice(source.lastIndexOf('\n', index) + 1, source.indexOf('\n', index))
    return line.includes('source-schema-ok')
  }

  for (const rule of CONTENT_RULES) {
    if (inZones(path, rule.zones)) continue
    rule.pattern.lastIndex = 0
    let match
    while ((match = rule.pattern.exec(code))) {
      if (allow(match.index)) continue
      problems.push({ rule: rule.id, line: lineOf(code, match.index), found: match[0], why: rule.why })
    }
  }

  if (FILTERS_LIB.test(path)) {
    for (const spec of importsOf(code)) {
      if (FILTERS_LIB_FORBIDDEN_SPECIFIERS.some((re) => re.test(spec))) {
        problems.push({
          rule: 'filters-lib-purity',
          line: 1,
          found: spec,
          why:
            'импорт из слоя фреймворка или серверной зоны в модуле фильтров.\n' +
            '    Этот модуль изоморфный: его собирают и браузер, и сервер, поэтому\n' +
            '    он не знает ни о SvelteKit, ни об источниках данных.',
        })
      }
    }
    for (const re of FILTERS_LIB_FORBIDDEN_GLOBALS) {
      const match = re.exec(code)
      if (match) {
        problems.push({
          rule: 'filters-lib-purity',
          line: lineOf(code, match.index),
          found: match[0],
          why:
            'обращение к среде (окно/документ/сеть) в модуле фильтров. Адрес,\n' +
            '    хранилище и запросы — дело адаптера; здесь только чистые функции\n' +
            '    над значениями и схемой.',
        })
      }
    }
  }

  return problems
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g

/** Импортированные спецификаторы файла. */
export function importsOf(code) {
  const out = []
  IMPORT_RE.lastIndex = 0
  let match
  while ((match = IMPORT_RE.exec(code))) out.push(match[1])
  return out
}

/** Человекочитаемый отчёт: что нашлось и почему это ошибка. */
export function formatProblems(relPath, problems) {
  if (!problems.length) return ''
  const lines = [`\n[source-schema] ${relPath}`]
  for (const problem of problems) {
    lines.push(`    строка ${problem.line}: ${problem.found}  (${problem.rule})`)
    lines.push(`    ${problem.why}`)
  }
  return lines.join('\n')
}
