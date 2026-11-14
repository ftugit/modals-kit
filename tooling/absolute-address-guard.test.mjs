import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { configHasAbsolutePaths, findRedirectStringChecks, run } from './absolute-address-guard.mjs'

test('конфигурация сборки: относительные адреса выключены', () => {
  const source = readFileSync('vite.config.ts', 'utf8')
  assert.equal(configHasAbsolutePaths(source), true, 'vite.config.ts: нужен paths.relative: false')
})

test('негативный контроль: возврат относительных адресов ловится', () => {
  const mutated = readFileSync('vite.config.ts', 'utf8').replace(/\n\s*relative:\s*false,?/, '')
  assert.equal(configHasAbsolutePaths(mutated), false, 'мутация «убрать relative: false» не поймана')
})

test('в роутах нет строковой проверки адреса перехода', () => {
  assert.deepEqual(run(), [], 'найдены нарушения: ' + run().join('; '))
})

test('негативный контроль: возврат startsWith по адресу перехода ловится', () => {
  const hits = findRedirectStringChecks([
    {
      path: 'src/routes/fixture/+page.server.ts',
      source: [
        'const handled = await handler(request)',
        "if (handled.result.ok && handled.result.redirect?.startsWith('/')) redirect(303, handled.result.redirect)",
        "redirect(303, handled.redirect.startsWith('/') ? handled.redirect : '/')",
      ].join('\n'),
    },
  ])
  assert.equal(hits.length, 2, 'обе формы проверки должны ловиться')
  assert.equal(hits[0].line, 2)
})

test('корректная форма без строковой проверки не ловится', () => {
  const hits = findRedirectStringChecks([
    {
      path: 'src/routes/fixture/+page.server.ts',
      source: "if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)",
    },
  ])
  assert.deepEqual(hits, [])
})
