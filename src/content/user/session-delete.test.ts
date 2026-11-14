import { describe, expect, it } from 'vitest'
import {
  MAX_SESSION_DELETE_IDS,
  parseSessionDeleteIds,
  parseSessionDeleteVariant,
} from './session-delete.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('вариант сессионной единицы', () => {
  it('знает два варианта и по умолчанию закрывает', () => {
    expect(parseSessionDeleteVariant('delete')).toBe('delete')
    expect(parseSessionDeleteVariant('logout')).toBe('logout')
    expect(parseSessionDeleteVariant(undefined)).toBe('delete')
    expect(parseSessionDeleteVariant('banana')).toBe('delete')
  })

  it('негативный контроль: вариант не берётся из строки как есть', () => {
    // Мутация «доверять адресу»: вернуть сырое значение. Такой разбор провалил бы тест.
    const naive = (raw: unknown) => (typeof raw === 'string' ? raw : 'delete')
    expect(naive('logout?x=1')).not.toBe('logout')
    expect(parseSessionDeleteVariant('logout?x=1')).toBe('delete')
  })
})

describe('набор сессий из адреса', () => {
  it('склеивает `id` и `ids`, убирает пустые части и повторы', () => {
    expect(parseSessionDeleteIds(id(1), `${id(2)}, ${id(1)} ,, ${id(3)}`)).toEqual({
      ids: [id(1), id(2), id(3)],
      tooMany: false,
    })
  })

  it('пустой адрес — пустой набор, а не «всё»', () => {
    expect(parseSessionDeleteIds(undefined, undefined)).toEqual({ ids: [], tooMany: false })
    expect(parseSessionDeleteIds('', ' , ')).toEqual({ ids: [], tooMany: false })
  })

  it(`держит предел ${MAX_SESSION_DELETE_IDS} и не усекает молча`, () => {
    const exact = Array.from({ length: MAX_SESSION_DELETE_IDS }, (_, i) => id(i + 1))
    expect(parseSessionDeleteIds(undefined, exact.join(',')).tooMany).toBe(false)

    const over = [...exact, id(MAX_SESSION_DELETE_IDS + 1)]
    const parsed = parseSessionDeleteIds(undefined, over.join(','))
    expect(parsed.tooMany).toBe(true)
    expect(parsed.ids).toHaveLength(MAX_SESSION_DELETE_IDS + 1)
  })

  it('негативный контроль: усечение вместо признака проваливает правило', () => {
    // Мутация «взять первые N»: набор уменьшился бы, а отказ не пришёл.
    const over = Array.from({ length: MAX_SESSION_DELETE_IDS + 1 }, (_, i) => id(i + 1))
    const truncating = { ids: parseSessionDeleteIds(undefined, over.join(',')).ids.slice(0, MAX_SESSION_DELETE_IDS), tooMany: false }
    expect(truncating.tooMany).toBe(false)
    expect(parseSessionDeleteIds(undefined, over.join(',')).tooMany).toBe(true)
  })
})
