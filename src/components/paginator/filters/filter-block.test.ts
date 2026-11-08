import { describe, expect, it } from 'vitest'
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'
import { filterBlockCut } from './filter-block.js'

const schema: CatalogFilterSchema = {
  source: 'test',
  version: 1,
  fields: [
    { key: 'year', label: 'Год', type: 'number', bounds: ['min', 'max'] },
    { key: 'genres', label: 'Жанры', type: 'multiselect', modes: ['and', 'not'] },
    { key: 'studios', label: 'Студии', type: 'multiselect', modes: ['and', 'not'] },
    { key: 'kind', label: 'Тип', type: 'select' },
  ],
}

describe('filterBlockCut', () => {
  it('один ключ схемы — метка этого поля, слой адреса снимается', () => {
    expect(filterBlockCut(['page.filters.year.min', 'page.filters.year.max'], schema, 'page')).toEqual({
      key: 'year',
      label: 'Год',
    })
  })

  it('без слоя имя читается как есть', () => {
    expect(filterBlockCut(['filters.kind'], schema)).toEqual({ key: 'kind', label: 'Тип' })
  })

  it('два ключа не становятся одной меткой', () => {
    expect(filterBlockCut(['filters.genres.and', 'filters.studios.and'], schema)).toEqual({
      key: null,
      reason: 'mixed',
    })
  })

  it('пусто и чужое имя метки не дают', () => {
    expect(filterBlockCut([], schema)).toEqual({ key: null, reason: 'empty' })
    expect(filterBlockCut(['size', 'page.filters.missing'], schema, 'page')).toEqual({ key: null, reason: 'empty' })
  })
})
