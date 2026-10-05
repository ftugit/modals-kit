import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  BUDGETS, checkBudgets, checkImports, collectSpecifiers,
  isAdapterZone, isRuntimeFile, measure, report,
} from './form-size.mjs'

const ROOT = 'src/lib/form'

/* ── состав рантайма ──────────────────────────────────────────────── */

test('рантайм — код, но не тесты и не документация', () => {
  assert.equal(isRuntimeFile('describe.ts'), true)
  assert.equal(isRuntimeFile('svelte/bind.svelte.ts'), true)
  assert.equal(isRuntimeFile('form.test.ts'), false, 'тесты не поставляются')
  assert.equal(isRuntimeFile('REFACTOR.md'), false, 'документация не считается')
})

test('зона адаптера — только svelte/', () => {
  assert.equal(isAdapterZone('svelte/bind.svelte.ts'), true)
  assert.equal(isAdapterZone('describe.ts'), false)
  assert.equal(isAdapterZone('svelte\\config.ts'), true, 'windows-разделители нормализуются')
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

test('svelte разрешён только в зоне адаптера', () => {
  assert.deepEqual(checkImports('svelte/bind.svelte.ts', ['svelte', 'svelte/attachments']), [])
  const problems = checkImports('state.ts', ['svelte'])
  assert.equal(problems.length, 1)
  assert.match(problems[0].reason, /без фреймворка/)
})

test('внешний пакет — нарушение с причиной', () => {
  const problems = checkImports('validate.ts', ['zod'])
  assert.equal(problems.length, 1)
  assert.match(problems[0].reason, /не тянет зависимостей/)
  assert.match(problems[0].reason, /приложени/)
})

/* ── измерение ────────────────────────────────────────────────────── */

test('мера разделяет ядро и адаптер', () => {
  const m = measure([
    { path: 'core.ts', source: 'a'.repeat(1000) },
    { path: 'svelte/bind.ts', source: 'b'.repeat(200) },
  ])
  assert.equal(m.files, 2)
  assert.equal(m.coreRaw, 1000)
  assert.equal(m.adapterRaw, 200)
  assert.equal(m.raw, 1200)
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
    { ...m, gzip: m.gzip + 1000 }, { raw: 1, gzip: 10, adapterGzip: 0 })
  assert.equal(violations.length, 3)
  for (const v of violations) assert.match(v.line, />/)
  assert.match(violations[0].why, /причину|причина/i)
})

test('в пределах бюджета — тишина', () => {
  const m = measure([{ path: 'core.ts', source: 'x'.repeat(100) }])
  assert.deepEqual(checkBudgets(m, { raw: 10_000, gzip: 10_000, adapterGzip: 10_000 }), [])
})

test('отчёт печатает цифры и пороги рядом', () => {
  const m = measure([{ path: 'core.ts', source: 'x'.repeat(100) }])
  const text = report(m, { raw: 1000, gzip: 1000, adapterGzip: 1000 })
  assert.match(text, /ядро:/)
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

test('адаптер существует и непуст (иначе бюджет фиктивен)', () => {
  const zones = walk(ROOT).map((f) => relative(ROOT, f)).filter(isAdapterZone)
  assert.ok(zones.length > 0, 'нет зоны адаптера — граница фиктивна')
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
