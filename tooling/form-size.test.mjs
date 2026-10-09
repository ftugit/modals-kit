import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  BUDGETS, checkBudgets, checkImports, collectSpecifiers,
  isAdapterZone, isRuntimeFile, measure, report, zoneOf,
} from './form-size.mjs'

const ROOT = 'src/lib/form'

/* ── состав рантайма ──────────────────────────────────────────────── */

test('рантайм — код, но не тесты и не документация', () => {
  assert.equal(isRuntimeFile('describe.ts'), true)
  assert.equal(isRuntimeFile('svelte/bind.svelte.ts'), true)
  assert.equal(isRuntimeFile('form.test.ts'), false, 'тесты не поставляются')
  assert.equal(isRuntimeFile('REFACTOR.md'), false, 'документация не считается')
})

test('зона адаптера — svelte/, react/, solid/', () => {
  assert.equal(isAdapterZone('svelte/bind.svelte.ts'), true)
  assert.equal(isAdapterZone('react/bind.ts'), true)
  assert.equal(isAdapterZone('solid/bind.ts'), true)
  assert.equal(isAdapterZone('describe.ts'), false)
  assert.equal(zoneOf('svelte\\config.ts'), 'svelte', 'windows-разделители нормализуются')
  assert.equal(zoneOf('react/bind.ts'), 'react')
  assert.equal(zoneOf('solid/config.ts'), 'solid')
  assert.equal(zoneOf('state.ts'), null)
})

/* ── импорты ──────────────────────────────────────────────────────── */

test('собирает спецификаторы всех форм импорта', () => {
  const src = [
    "import { a } from './a'",
    "import type { B } from 'svelte'",
    "export { c } from './c'",
    "import 'side-effect'",
  ].join('\n')
  assert.deepEqual(collectSpecifiers(src), ['./a', 'svelte', './c', 'side-effect'])
})

test('относительные пути разрешены везде', () => {
  assert.deepEqual(checkImports('describe.ts', ['./a', '../core', '/abs']), [])
})

test('пакет движка разрешён только в своей зоне', () => {
  assert.deepEqual(checkImports('svelte/bind.svelte.ts', ['svelte', 'svelte/attachments']), [])
  assert.deepEqual(checkImports('react/bind.ts', ['react']), [])
  assert.deepEqual(checkImports('solid/bind.ts', ['solid-js']), [])
  const problems = checkImports('state.ts', ['svelte', 'react', 'solid-js'])
  assert.equal(problems.length, 3)
  for (const p of problems) assert.match(p.reason, /без фреймворка/)
  const cross = checkImports('react/bind.ts', ['solid-js'])
  assert.equal(cross.length, 1, 'пакет чужого движка — нарушение зоны')
})

test('внешний пакет — нарушение с причиной', () => {
  const problems = checkImports('validate.ts', ['zod'])
  assert.equal(problems.length, 1)
  assert.match(problems[0].reason, /не тянет зависимостей/)
  assert.match(problems[0].reason, /приложени/)
})

/* ── измерение ────────────────────────────────────────────────────── */

test('мера разделяет ядро и адаптеры по зонам', () => {
  const m = measure([
    { path: 'core.ts', source: 'a'.repeat(1000) },
    { path: 'svelte/bind.ts', source: 'b'.repeat(200) },
    { path: 'react/bind.ts', source: 'c'.repeat(100) },
  ])
  assert.equal(m.files, 3)
  assert.equal(m.coreRaw, 1000)
  assert.equal(m.adapters.svelte.raw, 200)
  assert.equal(m.adapters.react.raw, 100)
  assert.equal(m.adapters.solid.raw, 0, 'зона пустая — весит ноль')
  assert.ok(m.gzip < m.raw, 'сжатие обязано уменьшать повторяющийся текст')
  assert.equal(m.heaviest[0].path, 'core.ts')
})

test('пустой набор не ломает меру', () => {
  const m = measure([])
  assert.equal(m.raw, 0)
  assert.equal(m.gzip, 0)
})

/* ── бюджеты ──────────────────────────────────────────────────────── */

test('превышение названо числами и протоколом', () => {
  const m = measure([
    { path: 'core.ts', source: 'x'.repeat(100) },
    { path: 'svelte/bind.ts', source: 'y'.repeat(80) },
  ])
  const violations = checkBudgets(
    { ...m, gzip: m.gzip + 1000 },
    { raw: 1, gzip: 10, adapters: { svelte: 0, react: 10_000, solid: 10_000 } })
  assert.equal(violations.length, 3, 'raw + gzip + адаптер svelte')
  for (const v of violations) assert.match(v.line, />/)
  assert.match(violations[0].why, /причину|причина/i)
})

test('в пределах бюджета — тишина', () => {
  const m = measure([{ path: 'core.ts', source: 'x'.repeat(100) }])
  assert.deepEqual(
    checkBudgets(m, { raw: 10_000, gzip: 10_000, adapters: { svelte: 10_000, react: 10_000, solid: 10_000 } }),
    [])
})

test('отчёт печатает цифры и пороги рядом', () => {
  const m = measure([{ path: 'core.ts', source: 'x'.repeat(100) }])
  const text = report(m, { raw: 1000, gzip: 1000, adapters: { svelte: 1000, react: 1000, solid: 1000 } })
  assert.match(text, /ядро:/)
  assert.match(text, /адаптер svelte/)
  assert.match(text, /адаптер react/)
  assert.match(text, /адаптер solid/)
  assert.match(text, /бюджеты:/)
  assert.match(text, /самое тяжёлое:/)
})

/* ── боевой прогон ────────────────────────────────────────────────── */

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (isRuntimeFile(name)) acc.push(p)
  }
  return acc
}

test('форма в пределах бюджетов', () => {
  const files = walk(ROOT)
  assert.ok(files.length > 10, 'нечего мерить — путь изменился?')
  const m = measure(files.map((f) => ({
    path: relative(ROOT, f), source: readFileSync(f, 'utf8'),
  })))
  const violations = checkBudgets(m)
  assert.equal(violations.length, 0,
    violations.map((v) => `${v.line}\n    ${v.why}`).join('\n') + '\n\n' + report(m))
})

test('рантайм формы не импортирует пакетов', () => {
  const problems = []
  for (const f of walk(ROOT)) {
    const rel = relative(ROOT, f)
    for (const p of checkImports(rel, collectSpecifiers(readFileSync(f, 'utf8')))) {
      problems.push(`${rel}: ${p.spec} — ${p.reason}`)
    }
  }
  assert.deepEqual(problems, [])
})

test('адаптеры существуют и непусты (иначе бюджет фиктивен)', () => {
  const zones = walk(ROOT).map((f) => relative(ROOT, f)).filter(isAdapterZone)
  assert.ok(zones.length > 0, 'нет зоны адаптера — граница фиктивна')
  for (const z of ['svelte', 'react', 'solid'])
    assert.ok(zones.some((p) => zoneOf(p) === z), `зона ${z} пуста — бюджет фиктивен`)
})

test('бюджеты не забыли обновить после большого роста', () => {
  // ловит случай, когда BUDGETS задали ниже текущего веса: проверка выше
  // уже красная, этот тест объясняет ЧТО именно — сами пороги
  const files = walk(ROOT)
  const m = measure(files.map((f) => ({
    path: relative(ROOT, f), source: readFileSync(f, 'utf8'),
  })))
  assert.ok(BUDGETS.raw >= m.raw, `BUDGETS.raw (${BUDGETS.raw}) ниже факта (${m.raw})`)
  assert.ok(BUDGETS.gzip >= m.gzip, `BUDGETS.gzip (${BUDGETS.gzip}) ниже факта (${m.gzip})`)
})
