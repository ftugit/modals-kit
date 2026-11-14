import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTargetRuleViolations, run } from './target-rule-guard.mjs'

test('в контенте пользователя нет выбора адреса по зеркалу и молчаливого вычитания себя', () => {
  assert.deepEqual(run(), [], 'нарушения: ' + run().join('; '))
})

test('негативный контроль: адрес по зеркалу ловится', () => {
  const hits = findTargetRuleViolations([
    {
      path: 'src/content/user/ui/Fixture.svelte',
      source: [
        'const foreign = session.authId !== vault.principal',
        'const action = foreign ? `${accountRoute.href({ id })}?/revoke` : list',
      ].join('\n'),
    },
  ])
  assert.equal(hits.length, 1, 'адрес по зеркалу должен ловиться')
  assert.equal(hits[0].line, 2)
  assert.match(hits[0].rule, /зеркал/)
})

test('негативный контроль: молчаливое вычитание себя ловится', () => {
  const hits = findTargetRuleViolations([
    {
      path: 'src/content/user/ui/Fixture.svelte',
      source: 'const ids = raw.filter((id) => Boolean(id) && id !== vault.principal)',
    },
  ])
  assert.equal(hits.length, 1, 'вычитание себя в filter должно ловиться')
  assert.match(hits[0].rule, /вычитание/)
})

test('сравнение зеркала для показа кнопки не ловится', () => {
  const hits = findTargetRuleViolations([
    {
      path: 'src/content/user/ui/Fixture.svelte',
      source: 'const canEdit = $derived(vault.principal !== null ? grant.current : Boolean(data?.canEdit))',
    },
  ])
  assert.deepEqual(hits, [])
})
