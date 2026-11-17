import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkRegistry, collectManifests } from './module-registry.mjs'

/** Собирает временный набор манифестов: { 'src/modules/a/manifest.json': {...} }. */
function fixture(manifests, { createEntries = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'module-registry-'))
  for (const [rel, data] of Object.entries(manifests)) {
    const file = join(root, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(data))
    if (!createEntries) continue
    const dir = file.slice(0, file.lastIndexOf('/'))
    for (const path of Object.values(data.entries ?? {})) {
      const target = join(dir, path)
      mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true })
      writeFileSync(target, '')
    }
  }
  return root
}

test('реестр проекта согласован', () => {
  assert.deepEqual(checkRegistry(collectManifests()), [])
})

test('ловит дубли имён, недостающие parent/dependsOn и пути входов', () => {
  const root = fixture({
    'src/modules/a/manifest.json': {
      name: 'a',
      entries: { '.': './index.ts', './model': './model/missing.ts' },
      dependsOn: ['ghost'],
    },
    'src/modules/b/manifest.json': { name: 'a', parent: 'nobody', entries: {} },
  }, { createEntries: false })
  const problems = checkRegistry(collectManifests(root)).join('\n')
  assert.match(problems, /name «a» уже объявлен/)
  assert.match(problems, /parent «nobody» не существует/)
  assert.match(problems, /dependsOn «ghost» не существует/)
  assert.match(problems, /entries\["\.\/model"\]/)
})

test('ловит циклы зависимостей и неверный submodules', () => {
  const root = fixture({
    'src/modules/a/manifest.json': { name: 'a', dependsOn: ['b'], submodules: ['c'], entries: {} },
    'src/modules/b/manifest.json': { name: 'b', parent: 'a', dependsOn: ['a'], entries: {} },
  })
  const problems = checkRegistry(collectManifests(root)).join('\n')
  assert.match(problems, /цикл зависимостей/)
  assert.match(problems, /submodule «c»/)
})
