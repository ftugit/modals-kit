import test from 'node:test'
import assert from 'node:assert/strict'
import { findModuleFiles, parseModulePaths } from './module-guard.mjs'

test('module-guard: parses module payload paths from the modules tag tree', () => {
  const paths = parseModulePaths(`
README.md
modules/demo/manifest.json
modules/demo/files/src/content/demo-catalog/items/items.ts
modules/demo/files/src/routes/(site)/(app)/db-demo/+page.svelte
modules/other/files/lib/other.ts
`)
  assert.deepEqual(
    [...paths].sort(),
    [
      'lib/other.ts',
      'src/content/demo-catalog/items/items.ts',
      'src/routes/(site)/(app)/db-demo/+page.svelte',
    ],
  )
})

test('module-guard: finds payload paths in the core tree', () => {
  const modulePaths = parseModulePaths(
    'modules/demo/files/src/content/demo-catalog/items/items.ts',
  )
  assert.deepEqual(
    findModuleFiles(
      [
        'src/content/demo-catalog/items/items.ts',
        'src/components/paginator/ui/PaginatorSettings.svelte',
      ],
      modulePaths,
    ),
    ['src/content/demo-catalog/items/items.ts'],
  )
})

test('module-guard: module payload path inside modules/ is not a core path', () => {
  const modulePaths = parseModulePaths(
    'modules/demo/files/src/content/demo-catalog/items/items.ts',
  )
  assert.deepEqual(
    findModuleFiles(
      ['modules/demo/files/src/content/demo-catalog/items/items.ts'],
      modulePaths,
    ),
    [],
  )
})
