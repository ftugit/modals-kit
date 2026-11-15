import { describe, expect, test } from 'vitest'
import { selectionSliceKey } from './use-list-selection.svelte.js'

describe('selectionSliceKey', () => {
  test('порядок ключей и массивов не создаёт новый срез', () => {
    const a = selectionSliceKey({ actor: 'u1', filters: 'state=active', scopes: ['b', 'a'] })
    const b = selectionSliceKey({ scopes: ['a', 'b'], filters: 'state=active', actor: 'u1' })
    expect(a).toBe(b)
  })

  test('пустые значения не участвуют, а разделители экранируются', () => {
    expect(selectionSliceKey({ actor: 'u1', uid: '', filters: 'a|b' })).toBe(
      selectionSliceKey({ actor: 'u1', filters: 'a|b' }),
    )
    expect(selectionSliceKey({ actor: 'u|1' })).not.toBe(selectionSliceKey({ actor: 'u1' }))
  })
})
