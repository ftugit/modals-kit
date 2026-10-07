import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { checkSource, formatProblems, importsOf, stripComments } from './source-schema-guard.mjs'

/* ── снятие комментариев ──────────────────────────────────────────── */

test('строчные комментарии снимаются, содержимое строк — нет', () => {
  const src = "const url = 'https://shikimori.io/api' // shikimori.io в комментарии\n"
  assert.match(stripComments(src), /shikimori\.io\/api'/)
  assert.doesNotMatch(stripComments(src), /в комментарии/)
})

test('блочные комментарии и разметка HTML снимаются', () => {
  const src = '/* genre_v2 */\n<!-- filters.kind -->\nconst a = 1\n'
  const stripped = stripComments(src)
  assert.doesNotMatch(stripped, /genre_v2|filters\.kind/)
  assert.match(stripped, /const a = 1/)
})

test('экранированные кавычки не рвут строку', () => {
  const src = "const s = 'it\\'s // не комментарий'\nconst t = 2\n"
  assert.match(stripComments(src), /не комментарий/)
  assert.match(stripComments(src), /const t = 2/)
})

test('позиции символов сохраняются (номер строки ведёт к месту)', () => {
  const src = '/* первая\nвторая */\nconst x = 1'
  assert.equal(stripComments(src).split('\n').length, src.split('\n').length)
})

/* ── правила содержимого ──────────────────────────────────────────── */

test('ключ фильтра в компоненте — ошибка', () => {
  const problems = checkSource('src/features/paginator/Filters.svelte', `const key = 'filters.kind'\n`)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].rule, 'filter-key-literal')
  assert.match(problems[0].why, /catalogFilterFieldNames/)
})

test('ключ фильтра в объявлении и в серверной зоне — норма', () => {
  assert.deepEqual(checkSource('src/content/shikimori-filters.ts', `const k = 'filters.kind'`), [])
  assert.deepEqual(checkSource('src/lib/filters/url.ts', `const p = 'filters.genres.and'`), [])
  assert.deepEqual(checkSource('src/lib/server/shikimori-filters.ts', `drop: 'filters.score.max'`), [])
})

test('отключение по месту работает и не расползается на строку', () => {
  const ok = checkSource('src/routes/paginator/+page.svelte', `const k = 'filters.kind' // source-schema-ok: ссылка на пример\n`)
  assert.deepEqual(ok, [])
  assert.equal(checkSource('src/routes/paginator/+page.svelte', `const k = 'filters.kind'`).length, 1)
})

test('выдуманное имя не заменяет параметр API', () => {
  // Правда о том, что «жанры» — это `genre_v2`, живёт на сервере.
  assert.equal(checkSource('src/features/paginator/definition.ts', `const p = 'genre_v2'`).length, 1)
  assert.deepEqual(checkSource('src/lib/server/shikimori.ts', `const p = 'genre_v2'`), [])
})

test('домен внешнего API в клиентской зоне — ошибка, в комментарии — нет', () => {
  assert.equal(checkSource('src/content/shikimori.ts', `const media = 'https://shikimori.io'`).length, 1)
  assert.deepEqual(
    checkSource('src/content/shikimori.ts', `// сервер ходит в shikimori.io сам\nconst media = 'ok'`),
    [],
  )
})

test('сборка схемы — только в её зоне', () => {
  assert.equal(checkSource('src/routes/api/shikimori/filters/+server.ts', `buildShikimoriFilterSchema(refs, 'x')`).length, 1)
  assert.deepEqual(checkSource('src/lib/server/shikimori-schema.ts', `buildShikimoriFilterSchema(refs, 'x')`), [])
})

test('чтение готовой схемы — только сервером', () => {
  assert.equal(checkSource('src/features/paginator/Filters.svelte', `getShikimoriFilterSchema()`).length, 1)
  assert.deepEqual(checkSource('src/routes/api/shikimori/filters/+server.ts', `getShikimoriFilterSchema()`), [])
  assert.deepEqual(checkSource('src/features/paginator/loader.ts', `getShikimoriFilterSchema()`), [])
})

test('конвейер применяется через общий вход, а не вызывается в обход', () => {
  assert.equal(checkSource('src/routes/api/shikimori/animes/+server.ts', `animesFilterQuery(schema, raw)`).length, 1)
  assert.deepEqual(checkSource('src/lib/server/shikimori-filters.ts', `animesFilterQuery(schema, raw)`), [])
})

test('тесты и сами инструменты правилам не подчиняются', () => {
  assert.deepEqual(checkSource('src/lib/server/shikimori.test.ts', `expect('genre_v2').toBe(1)`), [])
  assert.deepEqual(checkSource('tooling/source-schema-guard.mjs', `const p = /genre_v2/`), [])
})

/* ── чистота модуля фильтров ──────────────────────────────────────── */

test('модуль фильтров не тянет фреймворк и серверную зону', () => {
  const impure = checkSource(
    'src/lib/filters/url.ts',
    `import { page } from '$app/stores'\nimport { fetchAnimes } from '$lib/server/shikimori'`,
  )
  assert.equal(impure.length, 2)
  assert.equal(impure[0].rule, 'filters-lib-purity')
})

test('модуль фильтров не трогает среду', () => {
  const problems = checkSource('src/lib/filters/form.ts', `const v = window.location.search\nawait fetch('/api')\n`)
  assert.equal(problems.length, 2)
  assert.match(problems[0].why, /адаптер/)
})

test('здоровый модуль фильтров проходит', () => {
  const src = [
    `import { defineForm } from '$lib/form'`,
    `import { catalogFilterFieldNames } from './catalog-filter'`,
    `export const names = (field) => catalogFilterFieldNames(field)`,
  ].join('\n')
  assert.deepEqual(checkSource('src/lib/filters/form.ts', src), [])
})

test('импорты разбираются вместе с `export … from`', () => {
  const src = `export { x } from './rules'\nimport y from 'z'\nimport './side-effect'\n`
  assert.deepEqual(importsOf(src), ['./rules', 'z'])
})

/* ── боевой прогон по каталогу ────────────────────────────────────── */

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, acc)
    else if (/\.(ts|svelte)$/.test(name)) acc.push(path)
  }
  return acc
}

test('в проекте нет нарушений границы «схема живёт в зоне источника»', () => {
  const files = walk('src')
  assert.ok(files.length > 50, 'нечего проверять — путь изменился?')
  const problems = []
  for (const file of files) {
    const rel = relative('.', file)
    const found = checkSource(rel, readFileSync(file, 'utf8'))
    if (found.length) problems.push(formatProblems(rel, found))
  }
  assert.equal(problems.length, 0, problems.join('\n'))
})

test('граница не фиктивна: зоны, которые защищаются, существуют', () => {
  const files = walk('src').map((file) => relative('.', file))
  assert.ok(files.some((f) => f.startsWith('src/lib/filters/')), 'нет модуля фильтров')
  assert.ok(files.includes('src/lib/server/shikimori-schema.ts'), 'нет зоны схемы')
  assert.ok(files.includes('src/content/shikimori-filters.ts'), 'нет общего объявления ключей')
})
