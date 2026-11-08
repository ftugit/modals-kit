import { describe, expect, it } from 'vitest'
import { activeFilterItems } from './active-filters.js'

const filters = {
  keys: ['ord', 'state', 'nick'],
  defaults: { ord: 'created-desc', state: 'active', nick: '' },
  pageSize: 30,
  labels: { ord: 'Порядок', state: 'Состояние', nick: 'Показывать никнейм', size: 'Элементов на страницу' },
  text: (key: string, value: string) => (key === 'ord' && value === 'id-asc' ? 'По id: по возрастанию' : value),
}

describe('activeFilterItems', () => {
  it('берёт те же отличия, что счётчик кнопки, и подпись из описания', () => {
    expect(activeFilterItems(filters, { ord: 'id-asc', state: 'active', nick: '1' }, 30)).toEqual([
      { key: 'ord', kind: 'extra', value: 'id-asc', label: 'Порядок', text: 'По id: по возрастанию' },
      { key: 'nick', kind: 'extra', value: '1', label: 'Показывать никнейм', text: '1' },
    ])
  })

  it('пустое, умолчание и пропущенный ключ не чипы', () => {
    expect(
      activeFilterItems(
        { ...filters, ignore: ['nick'] },
        { ord: 'created-desc', state: '', nick: '1' },
        30,
      ),
    ).toEqual([])
  })

  it('нестандартный размер порции — чип поля size, не ключ extra', () => {
    expect(activeFilterItems(filters, {}, 50)).toEqual([
      { key: 'size', kind: 'pageSize', value: '50', label: 'Элементов на страницу', text: '50' },
    ])
  })

  it('число и отсутствие ключа счётчик не видит', () => {
    expect(activeFilterItems(filters, { ord: 1 }, 30)).toEqual([])
  })
})
