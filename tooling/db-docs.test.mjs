import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  API_HEADING,
  ENTRIES,
  auditDocs,
  collectExports,
  dirnamePosix,
  envKeysFrom,
  formatProblems,
  normalize,
  numberMapFrom,
  parseApiTable,
  parseStatusMatrix,
} from './db-docs.mjs'

/* ── разбор экспортов ────────────────────────────────────────────────── */

test('собирает экспорты всех форм и раскрывает export *', () => {
  const index = ["export { createDb, DbFailure } from './db'", "export * from './query'", 'export type Limits = object'].join('\n')
  const resolve = (spec) => (spec === './query' ? 'export const conservativeLimits = {}\nexport function splitSql() {}' : null)
  assert.deepEqual(collectExports(index, resolve), ['DbFailure', 'Limits', 'conservativeLimits', 'createDb', 'splitSql'])
})

test('as-переименование считается тем именем, что видно снаружи', () => {
  assert.deepEqual(collectExports('export { a as b, c as default } from "./x"'), ['b', 'default'])
})

test('звёздный ре-экспорт наружу (as ns) не раскрывается', () => {
  const got = collectExports('export * as internal from "./x"', () => 'export const hidden = 1')
  assert.deepEqual(got, ['internal'])
})

/* ── числовые реестры ────────────────────────────────────────────────── */

test('numberMapFrom читает реестр по имени, а не первый объект в файле', () => {
  const src = 'const noise = { a: 1 }\nexport const FAILURE_STATUS = {\n  validation: 422,\n  not_found: 404,\n};\n'
  assert.deepEqual(numberMapFrom(src, 'FAILURE_STATUS'), { validation: 422, not_found: 404 })
})

test('envKeysFrom берёт env(), process.env, деструктуризацию и имя в сообщении', () => {
  const texts = [
    'const s = env("DB_CURSOR_SECRET")',
    'if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL")',
    'const { DB_POOL_MAX, noise } = env',
    'throw new Error("DATABASE_DIR must be a path")',
    'const sql = "SELECT reltuples"',
  ]
  assert.deepEqual(envKeysFrom(texts), ['DATABASE_DIR', 'DATABASE_URL', 'DB_CURSOR_SECRET', 'DB_POOL_MAX'])
})

/* ── разбор таблиц README ────────────────────────────────────────────── */

const README = [
  API_HEADING,
  '',
  '| Экспорт | Что |',
  '|---|---|',
  "| `$lib/db` | `createDb`, `DbFailure`, `conservativeLimits` |",
  '| `$lib/db/schema` | `s`, `make` |',
  '',
  '| kind | 422 | 403 | 404 |',
  '|---|---|---|---|',
  '| `validation` | • | | |',
  '| `forbidden`, `not_found` | | • | |',
  ''].join('\n')

test('parseApiTable игнорирует соседние таблицы: только спецификаторы модулей', () => {
  const rows = parseApiTable(README)
  assert.equal(rows.size, 2)
  assert.deepEqual(rows.get('$lib/db'), ['createDb', 'DbFailure', 'conservativeLimits'])
})

test('общая строка матрицы даёт свой статус каждому из перечисленных kind', () => {
  const matrix = parseStatusMatrix(README)
  assert.deepEqual(matrix.header, [422, 403, 404])
  assert.deepEqual(matrix.rows, [
    { kind: 'validation', status: 422 },
    { kind: 'forbidden', status: 403 },
    { kind: 'not_found', status: 403 },
  ])
})

test('пустой README без таблицы — null, а не падение', () => {
  assert.equal(parseApiTable('# заголовок\n'), null)
  assert.equal(parseStatusMatrix('нет таблицы'), null)
})

/* ── контракт потребителя ─────────────────────────────────────────────── */

test('аудит ловит импорт старого пакета и обход $lib/db', () => {
  const problems = auditDocs({
    readme: README,
    porting: '',
    sources: Object.fromEntries(Object.values(ENTRIES).map((f) => [f, 'export const createDb = 1; export const s = 1; export const make = 1; export const DbFailure = 1; export const conservativeLimits = 1'])),
    appFiles: [
      { file: 'src/x.ts', text: "import { createDb } from '@ftugit/kit-db/sveltekit'" },
      { file: 'src/y.ts', text: "import { db } from '../../lib/db/sveltekit'" },
      { file: 'src/ok.ts', text: "import { db } from '$lib/db/sveltekit'" },
    ],
  })
  assert.ok(problems.some((p) => p.includes('src/x.ts') && p.includes('старого пакета')), problems.join('\n'))
  assert.ok(problems.some((p) => p.includes('src/y.ts') && p.includes('мимо $lib/db')), problems.join('\n'))
  assert.ok(!problems.some((p) => p.includes('src/ok.ts')), problems.join('\n'))
})

test('аудит ругается на обещанный в README экспорт, которого слой не отдаёт', () => {
  const problems = auditDocs({
    readme: README,
    porting: '',
    sources: Object.fromEntries(Object.values(ENTRIES).map((f) => [f, 'export const createDb = 1'])),
  })
  assert.ok(problems.some((p) => p.includes('$lib/db → DbFailure')), problems.join('\n'))
  assert.ok(problems.some((p) => p.includes('не описан в таблице API')), problems.join('\n'))
})

test('аудит сверяет матрицу статусов с FAILURE_STATUS в обе стороны', () => {
  const readme = README.replace(
    '| `validation` | • | | |',
    '| `validation` |  | • | |',
  )
  const problems = auditDocs({
    readme,
    porting: '',
    sources: Object.fromEntries(Object.values(ENTRIES).map((f) => [f, 'export const createDb = 1; export const s = 1; export const make = 1; export const DbFailure = 1; export const conservativeLimits = 1'])),
    status: { validation: 422, forbidden: 403, not_found: 404, extra_kind: 500 },
  })
  assert.ok(problems.some((p) => p.includes('«validation» не отмечает колонку 422')), problems.join('\n'))
  assert.ok(problems.some((p) => p.includes('extra_kind')), problems.join('\n'))
})

test('аудит требует назвать каждый лимит числом и каждый env-ключ', () => {
  const readme = `${README}\n\nenv: \`DB_CURSOR_SECRET\` — секрет курсора.\n`
  const problems = auditDocs({
    readme,
    porting: '',
    sources: {
      'index.ts': 'export const createDb = 1; export const s = 1; export const make = 1; export const DbFailure = 1; export const conservativeLimits = 1',
      'schema.ts': 'export const s = 1; export const make = 1; export const DbFailure = 1; export const createDb = 1; export const conservativeLimits = 1',
      'sveltekit/cursor.ts': 'const s = env("DB_CURSOR_SECRET"); const t = env("DB_BRAND_NEW")',
    },
    limits: { pageSize: 20, inValues: 100 },
  })
  assert.ok(problems.some((p) => p.includes('pageSize=20')), problems.join('\n'))
  assert.ok(problems.every((p) => !p.includes('DB_CURSOR_SECRET')), problems.join('\n'))
  assert.ok(problems.some((p) => p.includes('DB_BRAND_NEW')), problems.join('\n'))
})

test('аудит сверяет счётчики групп и число операторов миграции', () => {
  const base = {
    readme: README,
    porting: '',
    sources: Object.fromEntries(Object.values(ENTRIES).map((f) => [f, 'export const createDb = 1; export const s = 1; export const make = 1; export const DbFailure = 1; export const conservativeLimits = 1'])),
    groups: [['db-lib', 16], ['db-structure', 7, true]],
    splitSqlStatements: (sql) => sql.split(';').filter(Boolean),
    migrations: [['001-db-probe.sql', 'a;b;c;d;e']],
    expectedStatements: { '001-db-probe.sql': 5 },
  }
  const problems = auditDocs(base)
  assert.ok(problems.some((p) => p.includes('рядом с «db-lib»')), problems.join('\n'))
  assert.ok(problems.some((p) => p.includes('001-db-probe.sql')), problems.join('\n'))
  const fixed = auditDocs({
    ...base,
    porting: 'db-lib 16 групп, db-structure 7, всего 23; 001-db-probe.sql (5 операторов)',
  })
  assert.ok(!fixed.some((p) => p.includes('db-lib')), fixed.join('\n'))
  assert.ok(!fixed.some((p) => p.includes('оператор')), fixed.join('\n'))
})

test('аудит ловит ссылку на несуществующий файл, если вызывающий подтверждает отсутствие', () => {
  const problems = auditDocs({
    readme: README + '\nСм. `src/lib/db/query/missing.ts`.\n',
    porting: 'Путь `src/lib/db/index.ts` жив, `src/lib/db/nope.ts` — нет.',
    sources: { 'index.ts': 'export const createDb = 1; export const s = 1; export const make = 1; export const DbFailure = 1; export const conservativeLimits = 1' },
    exists: (rel) => rel === 'src/lib/db/index.ts',
  })
  assert.ok(problems.some((p) => p.includes('query/missing.ts')), problems.join('\n'))
  assert.ok(problems.some((p) => p.includes('db/nope.ts')), problems.join('\n'))
  assert.ok(!problems.some((p) => p.includes('db/index.ts')), problems.join('\n'))
})

/* ── путь и вывод ─────────────────────────────────────────────────────── */

test('posix-пути резолвятся как в бандле', () => {
  assert.equal(dirnamePosix('sveltekit/index.ts'), 'sveltekit')
  assert.equal(normalize('sveltekit/../errors'), 'errors')
  assert.equal(normalize('./../index'), 'index')
})

test('formatProblems печатает префикс и список', () => {
  assert.equal(formatProblems([]), '')
  const out = formatProblems(['a', 'b'])
  assert.match(out, /^\[db-docs\]/)
  assert.match(out, /- b$/)
})
