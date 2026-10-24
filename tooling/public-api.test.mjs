// Страж публичных входов: проверяем и правило, и само дерево.
//
// Две части намеренно разделены. Юнит-часть держит правило честным (иначе страж
// пройдёт по проекту просто потому, что ничего не умеет ловить), а прогон по
// дереву — то, ради чего страж и существует: обход в 34 глубоких импорта
// (`#lib/db/sync/plan.js` из хука, `#lib/paginate/types.js` из контента) не
// виден ни компилятору, ни линтеру — только этой проверке.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkSpecifier,
  checkTree,
  collectSpecifiers,
  entryExists,
  formatReport,
  readManifest,
} from './public-api.mjs'

/* ── разбор импортов ───────────────────────────────────────────────── */

test('собирает спецификаторы всех четырёх форм', () => {
  const src = [
    "import { a } from '#lib/db/index.js'",
    "import b from '#lib/db/sync/index.js'",
    "export type { C } from '#lib/form/server.js'",
    "import '#lib/assets/favicon.svg'",
    "const lazy = await import('#lib/image/node.js')",
  ].join('\n')
  const specs = collectSpecifiers(src)
  for (const want of [
    '#lib/db/index.js',
    '#lib/db/sync/index.js',
    '#lib/form/server.js',
    '#lib/assets/favicon.svg',
    '#lib/image/node.js',
  ]) {
    assert.ok(specs.includes(want), `не найден ${want}`)
  }
})

/* ── правило ───────────────────────────────────────────────────────── */

const MANIFESTS = {
  db: ['index.js', 'sync/index.js', 'adapters/pglite.js'],
  form: ['index.js', 'server.js'],
}

test('объявленный вход — не нарушение, из любой формы импорта', () => {
  for (const spec of [
    '#lib/db/index.js',
    '#lib/db/sync/index.js',
    '#lib/db/adapters/pglite.js',
    '#lib/form/server.js',
  ]) {
    assert.equal(checkSpecifier(spec, 'src/routes/+page.svelte', MANIFESTS), null, spec)
  }
})

test('необъявленный вход внутри пакета — нарушение', () => {
  const bad = checkSpecifier('#lib/db/sync/plan.js', 'src/hooks/db-schema.ts', MANIFESTS)
  assert.deepEqual(bad, { pkg: 'db', rest: 'sync/plan.js', importer: 'src/hooks/db-schema.ts' })
})

test('внутри своего пакета глубина — личное дело пакета', () => {
  assert.equal(checkSpecifier('#lib/db/sync/plan.js', 'src/lib/db/sync/index.ts', MANIFESTS), null)
  // Другой пакет нижнего слоя — уже снаружи: библиотеки общаются входами.
  assert.ok(checkSpecifier('#lib/db/sync/plan.js', 'src/lib/form/index.ts', MANIFESTS))
})

test('пакеты вне `#lib/*` и неизвестные пакеты не трогаем', () => {
  assert.equal(checkSpecifier('$lib/db/sync/plan.js', 'src/routes/+page.svelte', MANIFESTS), null)
  assert.equal(checkSpecifier('svelte', 'src/routes/+page.svelte', MANIFESTS), null)
  assert.equal(checkSpecifier('#lib/неизвестный/plan.js', 'src/routes/+page.svelte', MANIFESTS), null)
})

/* ── манифест ──────────────────────────────────────────────────────── */

test('без манифеста снаружи виден только index.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'public-api-'))
  try {
    writeFileSync(join(dir, 'index.ts'), 'export const a = 1\n')
    assert.deepEqual(readManifest(dir), { entrypoints: ['index.js'], manifest: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('манифест читается, мусор в нём отбрасывается', () => {
  const dir = mkdtempSync(join(tmpdir(), 'public-api-'))
  try {
    writeFileSync(join(dir, 'entrypoints.json'), JSON.stringify({ entrypoints: ['index.js', 42] }))
    assert.deepEqual(readManifest(dir).entrypoints, ['index.js'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('объявленный вход обязан существовать', () => {
  const dir = mkdtempSync(join(tmpdir(), 'public-api-'))
  try {
    writeFileSync(join(dir, 'index.ts'), '')
    writeFileSync(join(dir, 'svelte.ts'), '')
    mkdirSync(join(dir, 'sveltekit'))
    writeFileSync(join(dir, 'sveltekit', 'node.ts'), '')
    writeFileSync(join(dir, 'svg-shape.svg'), '')
    assert.equal(entryExists(dir, 'index.js'), true)
    assert.equal(entryExists(dir, 'svelte.js'), true)
    assert.equal(entryExists(dir, 'sveltekit/node.js'), true)
    assert.equal(entryExists(dir, 'svg-shape.js'), true, 'ассет с другим расширением — тоже вход')
    assert.equal(entryExists(dir, 'нет-такого.js'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ── боевой прогон по дереву ───────────────────────────────────────── */

test('в проекте нет глубоких импортов мимо объявленных входов', () => {
  const { violations, lies } = checkTree(process.cwd())
  const report = formatReport({ violations, lies })
  assert.equal(violations.length, 0, report)
  assert.equal(lies.length, 0, report)
})

test('страж не фиктивен: пакеты и входы существуют на самом деле', () => {
  const { manifests } = checkTree(process.cwd())
  // Каждый пакет нижнего слоя что-то объявляет — иначе правило «только index.js»
  // молча разошлось бы с реальностью и страж был бы пустым прогоном.
  for (const pkg of ['address', 'cache', 'db', 'fetch', 'form', 'image', 'modals', 'paginate', 'task']) {
    assert.ok(manifests[pkg]?.length, `у пакета ${pkg} нет объявленного входа`)
    assert.ok(manifests[pkg].includes('index.js'), `у пакета ${pkg} нет index.js`)
    assert.ok(existsSync(join('src', 'lib', pkg, 'entrypoints.json')), `нет манифеста ${pkg}`)
  }
})
