import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { checkFile, collectSpecifiers, formatProblems, isFrameworkZone, CORE_MODULES } from './core-purity.mjs'

const ROOT = 'src/lib/modals'

/* ── разбор импортов ───────────────────────────────────────────────── */

test('собирает спецификаторы всех форм импорта', () => {
  const src = [
    "import { a } from 'pkg-a'",
    "import b from 'pkg-b'",
    "import type { C } from 'pkg-c'",
    "export { d } from 'pkg-d'",
    "export type { E } from 'pkg-e'",
    "import 'pkg-side-effect'",
  ].join('\n')
  const specs = collectSpecifiers(src)
  for (const p of ['pkg-a', 'pkg-b', 'pkg-c', 'pkg-d', 'pkg-e', 'pkg-side-effect']) {
    assert.ok(specs.includes(p), `не найден ${p}`)
  }
})

/* ── правила ───────────────────────────────────────────────────────── */

test('ловит импорт фреймворка в ядре', () => {
  for (const spec of ['svelte', '$app/navigation', 'react', 'solid-js', 'vue', '@ark-ui/svelte/dialog']) {
    const problems = checkFile('core.ts', `import x from '${spec}'`)
    assert.equal(problems.length, 1, `пропущен ${spec}`)
    assert.match(problems[0].reason, /без единого фреймворка/)
  }
})

test('ловит зависимость ядра от слоя фреймворка', () => {
  const problems = checkFile('registry.ts', "import { S } from './svelte/store.svelte'")
  assert.equal(problems.length, 1)
  assert.match(problems[0].reason, /только вниз/)
})

test('внутри зоны фреймворка импорты разрешены', () => {
  assert.deepEqual(checkFile('svelte/store.svelte.ts', "import { mount } from 'svelte'"), [])
  assert.deepEqual(checkFile('cores/sveltekit.ts', "import { page } from '$app/state'"), [])
})

test('зоны заданы явно и предсказуемо', () => {
  assert.equal(isFrameworkZone('svelte/host.svelte'), true)
  assert.equal(isFrameworkZone('react/host.tsx'), true)
  assert.equal(isFrameworkZone('cores/sveltekit.ts'), true)
  assert.equal(isFrameworkZone('build.ts'), false, 'общая проводка — не зона')
  assert.equal(isFrameworkZone('core.ts'), false)
})

test('обычные импорты ядра не задеваются', () => {
  const src = [
    "import type { Chain } from './types'",
    "import { decodeChain } from '../core'",
    "import { z } from 'some-pure-lib'",
  ].join('\n')
  assert.deepEqual(checkFile('build.ts', src), [])
})

test('отчёт говорит, куда переносить', () => {
  const report = formatProblems('core.ts', checkFile('core.ts', "import 'svelte'"))
  assert.match(report, /<фреймворк>\//)
  assert.match(report, /adapters\/<фреймворк>\.ts/)
  assert.match(report, /adapter-контракты/)
})

/* ── боевой прогон ─────────────────────────────────────────────────── */

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\./.test(name)) acc.push(p)
  }
  return acc
}

for (const root of CORE_MODULES) {
  test(`ядро ${root} не зависит ни от одного фреймворка`, () => {
    const files = walk(root)
    assert.ok(files.length > 2, 'нечего проверять — путь изменился?')
    const problems = []
    for (const file of files) {
      const rel = relative(root, file)
      const found = checkFile(rel, readFileSync(file, 'utf8'))
      if (found.length) problems.push(formatProblems(rel, found, root))
    }
    assert.equal(problems.length, 0, problems.join('\n'))
  })
}

test('зона фреймворка существует и непуста (иначе проверка бессмысленна)', () => {
  const zones = walk(ROOT).map((f) => relative(ROOT, f)).filter(isFrameworkZone)
  assert.ok(zones.length > 0, 'нет ни одного файла в зоне фреймворка — граница фиктивна')
})

test('зона фреймворка есть у каждого ядра с адаптерами (form/paginate/links)', () => {
  for (const root of ['src/lib/form', 'src/lib/paginate', 'src/lib/links']) {
    const zones = walk(root).map((f) => relative(root, f)).filter(isFrameworkZone)
    assert.ok(zones.length > 0, `${root}: нет ни одного файла в зоне фреймворка`)
  }
})
