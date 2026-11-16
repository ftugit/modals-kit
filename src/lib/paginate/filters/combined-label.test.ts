import { describe, expect, it } from 'vitest'
import { catalogFilterCombinedLabel, catalogFilterView } from './view'
import { describeAll } from './test-describe'
import type { CatalogFilterSchema } from './index'

const schema: CatalogFilterSchema = {
  source: 'shikimori',
  version: 1,
  fields: [
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min', 'max'], min: 1, max: 10 },
    { key: 'status', label: 'Статус', type: 'select', options: [{ value: 'latest', label: 'последние' }] },
    { key: 'genres', label: 'Жанры', type: 'multiselect', modes: ['and', 'not'], options: [{ value: '1', label: 'Экшен' }] },
  ],
}

const description = describeAll(schema, { prefix: 'page.' })

describe('catalogFilterCombinedLabel', () => {
  it('пустая группа даёт пустую подпись', () => {
    expect(catalogFilterCombinedLabel([])).toBe('')
  })

  it('число с одной границей не дублирует направление', () => {
    const view = catalogFilterView(schema, { 'filters.score.min': '5' }, { description, prefix: 'page' })
    const group = view.chips.filter((chip) => chip.key === 'score')
    expect(catalogFilterCombinedLabel(group)).toBe('Оценка от 5')
  })

  it('число с двумя границами', () => {
    const view = catalogFilterView(schema, { 'filters.score.min': '5', 'filters.score.max': '9' }, { description, prefix: 'page' })
    const group = view.chips.filter((chip) => chip.key === 'score')
    expect(catalogFilterCombinedLabel(group)).toBe('Оценка от 5 до 9')
  })

  it('перечислимое значение', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'latest' }, { description, prefix: 'page' })
    const group = view.chips.filter((chip) => chip.key === 'status')
    expect(catalogFilterCombinedLabel(group)).toBe('Статус последние')
  })
})
