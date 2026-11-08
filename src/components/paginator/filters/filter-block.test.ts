import { describe, expect, it } from 'vitest'
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'
import { filterBlockCut, filterFieldCut, resolveFilterBlockCut } from './filter-block.js'

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

const labels = {
  ord: 'Порядок',
  size: 'Элементов на страницу',
  scopes: 'Сферы блокировок',
}

describe('filterFieldCut', () => {
  it('одно имя поля — подпись из описания формы', () => {
    expect(filterFieldCut(['ord'], labels)).toEqual({ key: 'ord', label: 'Порядок' })
  })

  it('два поля не становятся одной меткой', () => {
    expect(filterFieldCut(['ord', 'size'], labels)).toEqual({ key: null, reason: 'mixed' })
  })

  it('псевдоним пакует несколько полей в один ключ чипа', () => {
    expect(filterFieldCut(['sc.auth', 'sc.profile.delete'], labels, { 'sc.auth': 'scopes', 'sc.profile.delete': 'scopes' })).toEqual({
      key: 'scopes',
      label: 'Сферы блокировок',
    })
  })

  it('два разных псевдонима — не нарезка', () => {
    expect(filterFieldCut(['sc.auth', 'ord'], labels, { 'sc.auth': 'scopes' })).toEqual({ key: null, reason: 'mixed' })
  })

  it('чужое имя и пустой блок метки не дают', () => {
    expect(filterFieldCut(['paginator'], labels)).toEqual({ key: null, reason: 'empty' })
    expect(filterFieldCut([], labels)).toEqual({ key: null, reason: 'empty' })
  })
})

describe('resolveFilterBlockCut', () => {
  it('схема каталога важнее подписей формы, если путь её знает', () => {
    expect(resolveFilterBlockCut(['filters.kind'], { schema, labels })).toEqual({ key: 'kind', label: 'Тип' })
  })

  it('имя поля формы берётся, когда схема пути не знает', () => {
    expect(resolveFilterBlockCut(['ord'], { schema, labels })).toEqual({ key: 'ord', label: 'Порядок' })
  })

  it('два ключа схемы не падают в поля', () => {
    expect(resolveFilterBlockCut(['filters.genres.and', 'filters.studios.and'], { schema, labels: { genres: 'не это' } })).toEqual({
      key: null,
      reason: 'mixed',
    })
  })
})
