import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSessionDeleteViolations, run } from './session-delete-guard.mjs'

const ok = () => [
  { path: 'src/modules/user/base/svelte/session-delete/SessionDelete.svelte', source: 'const title = "Закрыть"' },
  { path: 'src/modules/user/sessions/svelte/SessionDeleteModal.svelte', source: 'const ldr = useLoader()' },
  {
    path: 'src/modules/user/sessions/service/session-delete.form.server.ts',
    source: 'redirectOnSuccess: () => "/user/sessions"',
  },
]

test('единица закрытия не уводит адрес и не закрывается сама', () => {
  assert.deepEqual(run(), [], 'нарушения: ' + run().join('; '))
})

test('негативный контроль: навигация в компоненте ловится', () => {
  const files = ok()
  files[0].source = 'await goto("/user/sessions")'
  const hits = findSessionDeleteViolations(files)
  assert.equal(hits.length, 1)
  assert.match(hits[0].rule, /адрес/)
})

test('негативный контроль: самовольное закрытие слоя ловится', () => {
  const files = ok()
  files[1].source = 'm.modals.close()'
  const hits = findSessionDeleteViolations(files)
  assert.equal(hits.length, 1)
  assert.match(hits[0].rule, /слой/)
})

test('негативный контроль: без объявленного перехода без JS ловится', () => {
  const files = ok()
  files[2].source = 'execute: async () => ({})'
  const hits = findSessionDeleteViolations(files)
  assert.equal(hits.length, 1)
  assert.match(hits[0].rule, /без JS/)
})

test('метка исключения действует на своей строке', () => {
  const files = ok()
  files[0].source = 'goto("/x") // session-delete-ok: объяснение'
  assert.deepEqual(findSessionDeleteViolations(files), [])
})
