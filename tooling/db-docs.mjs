/**
 * db-docs — проверка актуальности документации слоя `$lib/db` против кода.
 *
 * README/PORTING перечисляют публичный API, коды ошибок, лимиты, env-ключи и
 * счётчики тестов. Такие списки расходятся с кодом первыми, и расхождение
 * молчаливое: typescript не видит markdown. Отсюда — разбор markdown здесь и
 * сверка с фактическими экспортами, FAILURE_STATUS, conservativeLimits и
 * путями импорта в приложении.
 *
 * Прежняя версия жила в пакете и сверялась с `dist`. Слое стал обычным `lib`
 * приложения, `dist` больше не существует, поэтому:
 *   • экспорты читаются из исходников (тот же разбор, что делает слой);
 *   • сами исходники подаёт вызывающий (`src/lib/db/test/db-docs.test.ts`),
 *     потому что `.ts` читается только там, где есть TS-транспиляция;
 *   • вместо `package.json#exports` проверяется контракт потребителя: приложение
 *     импортирует слой ТОЛЬКО через `$lib/db…` — это и есть то, что раньше
 *     гарантировала карта экспортов.
 *
 * Выход: пустой список — документация актуальна.
 */

export const DB_ROOT = 'src/lib/db'

/** Entry-поинты слоя: как их видит приложение → файл внутри `src/lib/db`. */
export const ENTRIES = {
  '$lib/db': 'index.ts',
  '$lib/db/schema': 'schema.ts',
  '$lib/db/adapters/pg': 'adapters/pg.ts',
  '$lib/db/adapters/pglite': 'adapters/pglite.ts',
  '$lib/db/adapters/proxy': 'adapters/proxy.ts',
  '$lib/db/adapters/hyperdrive': 'adapters/hyperdrive.ts',
  '$lib/db/sveltekit': 'sveltekit/index.ts',
  '$lib/db/sveltekit/node': 'sveltekit/node.ts',
  '$lib/db/zod': 'zod.ts',
  '$lib/db/testing': 'testing/index.ts',
}

/** Раздел README, где лежит таблица публичного API. */
export const API_HEADING = '## 7. Публичный API'
export const API_TAIL = '## 8.'

/* ── разбор исходников ──────────────────────────────────────────────────── */

/**
 * Имена, которые модуль отдаёт наружу. `resolve(spec)` возвращает текст
 * модуля, на который указывает `export * from spec` (или null, чтобы
 * остановиться: node-модули, драйверы, `$app/…`).
 *
 * @param {string} source
 * @param {((spec: string) => string | null)?} [resolve]
 * @param {(spec: string) => boolean}? [isBarrel] — стоит ли идти внутрь `export *`
 * @returns {string[]}
 */
export function collectExports(source, resolve = null, isBarrel = () => true) {
  const out = new Set()
  const seen = new Set([source])
  const queue = [source]
  while (queue.length) {
    const text = queue.shift()
    // re-export списком: export { a, b as c } from './x' (тип-импорт тоже считаем)
    for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '')
        if (!name) continue
        out.add(name.includes(' as ') ? name.split(/\s+as\s+/).pop() : name)
      }
    }
    // звёздный ре-экспорт: раскрываем, пока есть куда идти
    for (const m of text.matchAll(/export\s*\*\s*(?:as\s+(\w+)\s*)?from\s*['"]([^'"]+)['"]/g)) {
      if (m[1]) {
        out.add(m[1])
        continue
      }
      if (!resolve || !isBarrel(m[2])) continue
      const next = resolve(m[2])
      if (next && !seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
    for (const m of text.matchAll(
      /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_][\w$]*)/g,
    )) out.add(m[1])
  }
  return [...out].sort()
}

/**
 * Значения числового объекта-реестра вида `NAME = { key: 400, … }`.
 * Нужен, чтобы не импортировать TS ради трёх чисел.
 *
 * @param {string} source
 * @param {string} name
 * @returns {Record<string, number>}
 */
export function numberMapFrom(source, name) {
  const at = source.indexOf(`${name}`)
  if (at < 0) return {}
  const open = source.indexOf('{', at)
  const close = open < 0 ? -1 : source.indexOf('}', open)
  if (open < 0 || close < 0) return {}
  /** @type {Record<string, number>} */
  const out = {}
  for (const m of source.slice(open + 1, close).matchAll(/(\w+)\s*:\s*(\d+)/g)) out[m[1]] = Number(m[2])
  return out
}

/**
 * Ключи окружения, о которых говорит слой: `env("X")`, `process.env.X`,
 * `const { X } = env` и просто `"X"` в строке с env/config (слой читает env через
 * `env`-функцию SvelteKit, а имя дублирует в сообщении об ошибке — это тоже контракт).
 * Префиксы фильтруют мусор: `SELECT`, `EXPLAIN`, имена констрейнтов.
 */
export const ENV_PREFIXES = ['DB_', 'DATABASE_', 'KIT_', 'POSTGRES_']

/**
 * @param {string[]} texts
 * @returns {string[]}
 */
export function envKeysFrom(texts) {
  const out = new Set()
  const keep = (k) => {
    if (k && ENV_PREFIXES.some((p) => k.startsWith(p)) && /^[A-Z][A-Z0-9_]{3,}$/.test(k)) out.add(k)
  }
  for (const t of texts) {
    // env-контракт в коде
    for (const m of t.matchAll(/env\(\s*["\']([A-Z0-9_]+)["\']\s*\)|process\.env\.([A-Z0-9_]+)/g)) keep(m[1] ?? m[2])
    for (const m of t.matchAll(/\{([^}]*)\}\s*=\s*(?:env|process\.env)\b/g)) {
      for (const part of m[1].split(',')) keep(part.trim().split(/\s*:\s*/).pop().split('=')[0].trim())
    }
    // имя ключа внутри строки (сообщение об ошибке, дефолт) — тоже контракт для README.
    // только строки: `DB_ROOT` как идентификатор константы ключом окружения не является
    for (const m of t.matchAll(/["\']([^"'\n]{3,120})["\']/g)) {
      for (const k of m[1].matchAll(/\b((?:DB|DATABASE|KIT|POSTGRES)_[A-Z0-9_]+)\b/g)) keep(k[1])
    }
  }
  return [...out].sort()
}

/* ── разбор markdown ────────────────────────────────────────────────────── */

/**
 * Таблица «| Экспорт | Что |»: спецификатор → заявленные имена.
 * @param {string} markdown
 */
export function parseApiTable(markdown, heading = API_HEADING, tail = API_TAIL, only = (spec) => spec.startsWith('$lib/') || spec.startsWith('@')) {
  const from = markdown.indexOf(heading)
  const to = tail ? markdown.indexOf(tail) : -1
  if (from < 0) return null
  const section = markdown.slice(from, to > from ? to : undefined)
  /** @type {Map<string, string[]>} */
  const rows = new Map()
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 2 || /^:?-{2,}:?$/.test(cells[0] ?? '')) continue
    const spec = /^`([^`]+)`$/.exec(cells[0] ?? '')?.[1]
    if (!spec || !only(spec)) continue
    rows.set(spec, [...(rows.get(spec) ?? []), ...[...cells[1].matchAll(/`([A-Za-z_][\w]*)`/g)].map((m) => m[1])])
  }
  return rows
}

/**
 * Матрица статусов: строка `| kind | 422 | 403 | … |` + строки с точкой в нужной
 * колонке. Возвращает для каждого kind его статус, как его понимает документация.
 * @param {string} markdown
 */
export function parseStatusMatrix(markdown) {
  const headerAt = markdown.split('\n').findIndex((l) => /^\|\s*kind\s*\|/.test(l))
  if (headerAt < 0) return null
  const lines = markdown.split('\n').slice(headerAt)
  const header = lines[0].split('|').slice(1, -1).map((c) => c.trim())
  /** @type {Array<{kind: string, status: number | null}>} */
  const rows = []
  for (const line of lines.slice(2)) {
    if (!line.trim().startsWith('|')) break
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    const kinds = [...(cells[0] ?? '').matchAll(/`([a-z_]+)`/g)].map((m) => m[1])
    if (!kinds.length) continue
    const marked = cells.findIndex((c, i) => i > 0 && c.startsWith('•') && /^\d+$/.test(header[i] ?? ''))
    for (const kind of kinds) rows.push({ kind, status: marked < 0 ? null : Number(header[marked]) })
  }
  return { header: header.slice(1).map((h) => Number(h)).filter(Number.isFinite), rows }
}

/* ── сами проверки ──────────────────────────────────────────────────────── */

/**
 * @typedef {{
 *   readme: string,
 *   porting: string,
 *   extraDocs?: Array<[string, string]>,
 *   sources: Record<string, string>,              // путь внутри слоя → текст
 *   appFiles?: Array<{ file: string, text: string }>,
 *   limits?: Record<string, number>,              // conservativeLimits из кода
 *   status?: Record<string, number>,              // FAILURE_STATUS из кода
 *   groups?: Array<[string, number, boolean?]>,   // имя файла-проверки → число групп
 *   splitSqlStatements?: (sql: string) => string[],
 *   migrations?: Array<[string, string]>,         // имя миграции → текст
 *   expectedStatements?: Record<string, number>,
 *   exists?: (path: string) => boolean,          // проверка путей из документации
 * }} AuditInput
 */

/**
 * Один вызов — полный список расхождений. Функция не трогает файловую систему:
 * всё, что нужно, приносят аргументами, поэтому её можно проверить на игрушечных
 * входах (см. `tooling/db-docs.test.mjs`).
 *
 * @param {AuditInput} input
 * @returns {string[]}
 */
export function auditDocs(input) {
  /** @type {string[]} */
  const problems = []
  const note = (msg) => problems.push(msg)
  const readme = input.readme
  const docs = [readme, input.porting, ...(input.extraDocs ?? []).map(([, t]) => t)]
  const allDocs = docs.join('\n')
  const layer = (rel) => input.sources[rel] ?? ''

  /* 1. Экспорты: всё заявленное существует и живёт в правильном entry-поинте. */
  const table = parseApiTable(readme)
  if (!table) note(`в README нет таблицы публичного API («${API_HEADING}»)`)
  else {
    for (const [entry, file] of Object.entries(ENTRIES)) {
      const source = layer(file)
      if (!source) {
        note(`${entry}: слой не отдаёт файл ${file} (нет в дереве)`)
        continue
      }
      const real = new Set(collectExports(source, (spec) => {
        // идеём только по относительным ре-экспортам внутри слоя
        if (!spec.startsWith('.')) return null
        const rel = normalize(joinPosix(dirnamePosix(file), spec))
        return input.sources[rel] ?? null
      }))
      const row = table.get(entry)
      if (!row) {
        note(`${entry} (${file}) не описан в таблице API README`)
        continue
      }
      for (const name of row) {
        if (real.has(name)) continue
        // типы и vendor-реэкспорт (z) в README помечены так же, но их может не быть в бандле
        if (/^[A-Z]/.test(name) && real.has(name[0].toLowerCase() + name.slice(1))) continue
        note(`README обещает ${entry} → ${name}, но слой такого экспорта не отдаёт`)
      }
    }
    for (const spec of table.keys()) {
      if (!(spec in ENTRIES)) note(`README описывает ${spec}, которого нет в ENTRIES аудита`)
    }
    // каждая ссылка вида `$lib/db…` в README обязана быть entry-поинтом: именно так
    // потребитель узнаёт, что можно импортировать, а что — внутренность слоя
    for (const m of readme.matchAll(/`\$lib\/db[\w./-]*`/g)) {
      const spec = m[0].slice(1, -1)
      if (!(spec in ENTRIES)) note(`README предлагает импортировать ${spec}, которого нет в карте entry-поинтов`)
    }
  }

  /* 2. Потребитель: приложение обязано импортировать слой через $lib/db. */
  for (const { file, text } of input.appFiles ?? []) {
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      if (/^@ftugit\/kit-db/.test(spec)) note(`${file}: импорт старого пакета ${spec} — слоя больше нет в npm`)
      else if (/(^|\/)lib\/db(\/|$)/.test(spec) && !spec.startsWith('$lib/db')) {
        note(`${file}: слой импортирован мимо $lib/db (${spec})`)
      }
    }
  }

  /* 3. Матрица статусов == FAILURE_STATUS из кода. */
  if (input.status) {
    const matrix = parseStatusMatrix(readme)
    if (!matrix) note('в README нет матрицы статусов (`| kind | 422 | …`)')
    else {
      for (const [kind, status] of Object.entries(input.status)) {
        const row = matrix.rows.find((r) => r.kind === kind)
        if (!row) {
          note(`kind «${kind}» отсутствует в таблице статусов README`)
          continue
        }
        if (row.status !== status) note(`README: строка «${kind}» не отмечает колонку ${status}`)
      }
      for (const r of matrix.rows) {
        if (!(r.kind in input.status)) note(`README перечисляет kind «${r.kind}», которого нет в FAILURE_STATUS`)
      }
      const kindsSrc = layer('errors.ts')
      for (const m of kindsSrc.matchAll(/export type FailureKind =([\s\S]*?);/g)) {
        for (const kind of m[1].split('|').map((x) => x.trim().replace(/["']/g, '')).filter(Boolean)) {
          if (!(kind in input.status)) note(`kind «${kind}» объявлен в FailureKind, но не замапан в FAILURE_STATUS`)
        }
      }
    }
  }

  /* 4. Лимиты: README обязан назвать каждый conservativeLimits по числу. */
  for (const [key, value] of Object.entries(input.limits ?? {})) {
    if (!new RegExp(`${escapeRe(key)}\\D{0,40}?${value}\\b`).test(readme)) {
      note(`лимит ${key}=${value} не задокументирован в README`)
    }
  }

  /* 5. Env-ключи: что слой называет (читает через `env` или требует в сообщении об
        ошибке) — то обязано быть в README. Обратного правила нет намеренно: приложение
        читает и свои ключи (`DB_POOL_MAX`, `KIT_TRUSTED_ORIGINS`), а слой принимает
        значения. */
  const envKeys = envKeysFrom(Object.values(input.sources))
  for (const key of envKeys) {
    if (!readme.includes(key)) note(`env «${key}» называется слоем, но не описан в README`)
  }

  /* 6. Счётчики групп: документация обязана называть честные числа. */
  let total = 0
  for (const [name, n, tolerant] of input.groups ?? []) {
    const found = [...allDocs.matchAll(new RegExp(`${escapeRe(name)}[^0-9]{0,80}(\\d{1,3})`, 'g'))].map((m) => Number(m[1]))
    const ok = found.some((f) => (tolerant ? f >= n - 1 && f <= n : f === n))
    if (!ok) note(`рядом с «${name}» в README/PORTING нет числа ${n} (найдено: ${found.join(', ') || 'нет'})`)
    total += tolerant ? Math.min(n, found[0] ?? n) : n
  }
  if (total && !allDocs.includes(String(total))) note(`суммарное число групп (${total}) не упоминается в документации`)

  /* 7. Миграции: заявленное число операторов совпадает с фактическим. */
  if (input.splitSqlStatements) {
    for (const [name, sql] of input.migrations ?? []) {
      const n = input.splitSqlStatements(sql).length
      const expected = input.expectedStatements?.[name]
      if (expected !== undefined && expected !== n) {
        note(`${name}: splitSqlStatements даёт ${n} операторов, а в документации «${expected}»`)
      }
      if (!new RegExp(`\\(?\\s*${n}\\s*оператор`).test(allDocs)) note(`${name}: в документации нет «${n} операторов»`)
    }
  }

  /* 8. Ссылки на файлы: путь из документации обязан существовать. Проверка идёт по
        всему дереву приложения (слой теперь внутри него), поэтому существование
        уточняет вызывающий — через `exists`. */
  const exists = input.exists ?? ((rel) => rel in input.sources)
  for (const doc of docs) {
    for (const m of doc.matchAll(/`((?:src|tooling|migrations)\/[\w./-]+\.(?:ts|mts|mjs|js|sql))`/g)) {
      if (!exists(m[1])) note(`документация ссылается на отсутствующий ${m[1]}`)
    }
  }

  return problems
}

/** @param {string[]} problems */
export function formatProblems(problems) {
  if (!problems.length) return ''
  return ['[db-docs] документация расходится с кодом:', ...problems.map((p) => `  - ${p}`)].join('\n')
}

/* ── мелкие хелперы путей (POSIX, без node:path, чтобы работало в браузере) ── */

export function dirnamePosix(p) {
  const i = p.lastIndexOf('/')
  return i < 0 ? '.' : p.slice(0, i)
}

export function normalize(p) {
  /** @type {string[]} */
  const out = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

const joinPosix = (a, b) => (a === '.' || a === '' ? b : `${a}/${b}`)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
