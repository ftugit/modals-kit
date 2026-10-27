// Опции с условием (`Option.when`): сброс зависимого значения на умолчание
// при выключении условия — серверная половина контракта (coercion в
// конвейере отправки); клиентская фильтрация/сброс — bind.svelte.ts.
import { describe, expect, test } from 'vitest'
import { coerceOptionGates, defineForm, makeFieldSugar, type FormDescription } from './index'

const field = makeFieldSugar()

const form = (): FormDescription =>
  defineForm({
    id: 'opt-gate',
    fields: {
      nick: field.select({
        label: 'Никнейм',
        options: [
          { value: '', label: 'Не отображать' },
          { value: '1', label: 'Отображать' },
        ],
        defaultValue: '',
      }),
      ord: field.select({
        label: 'Порядок',
        options: [
          { value: 'created-desc', label: 'Сначала новые' },
          { value: 'nickname-asc', label: 'По никнейму', when: { field: 'nick', equals: '1' } },
        ],
        defaultValue: 'created-desc',
      }),
    },
  })

describe('Option.when: coercion зависимого значения', () => {
  test('опция включена — значение по ней остаётся', () => {
    const values: Record<string, unknown> = { nick: '1', ord: 'nickname-asc' }
    coerceOptionGates(form(), values)
    expect(values.ord).toBe('nickname-asc')
  })

  test('опцию выключили — значение сброшено на умолчание поля', () => {
    const values: Record<string, unknown> = { nick: '', ord: 'nickname-asc' }
    coerceOptionGates(form(), values)
    expect(values.ord).toBe('created-desc')
  })

  test('обычные опции без условия не трогаются', () => {
    const values: Record<string, unknown> = { nick: '', ord: 'created-desc' }
    coerceOptionGates(form(), values)
    expect(values).toEqual({ nick: '', ord: 'created-desc' })
  })
})
