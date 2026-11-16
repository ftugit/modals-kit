import { describe, expect, it } from 'vitest'
import { catalogFilterRemoveGroupPatch, catalogFilterView } from './view'
import { describeAll } from './test-describe'
import type { CatalogFilterSchema } from './index'

const schema: CatalogFilterSchema = {
  source: 'shikimori',
  version: 1,
  fields: [
    {
      key: 'genres',
      label: 'Жанры',
      type: 'multiselect',
      modes: ['and', 'not'],
      options: [
        { value: '1', label: 'Экшен' },
        { value: '2', label: 'Драма' },
      ],
    },
    {
      key: 'kind',
      label: 'Тип',
      type: 'select',
      options: [
        { value: 'tv', label: 'ТВ' },
        { value: 'movie', label: 'Фильм' },
      ],
    },
    {
      key: 'status',
      label: 'Статус',
      type: 'select',
      options: [
        { value: 'latest', label: 'последние' },
        { value: 'anons', label: 'анонс' },
      ],
    },
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min', 'max'], min: 1, max: 10 },
    { key: 'year', label: 'Год', type: 'number', bounds: ['min', 'max'], min: 1900, max: 2028 },
  ],
  rules: [
    { id: 'search-with-latest', when: [{ field: 'status', value: 'latest' }], drop: 'q', reason: 'поиск не работает' },
    { id: 'score-with-anons', when: [{ field: 'status', value: 'anons' }], drop: { field: 'score' }, reason: 'у анонсов нет оценки' },
    { id: 'year-with-latest', when: [{ field: 'status', value: 'latest' }], drop: { field: 'year' }, reason: 'у последних нет года' },
  ],
}

const description = describeAll(schema, { prefix: 'page.' })

describe('catalogFilterRemoveGroupPatch', () => {
  it('снимает все значения одиночного select', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'latest,anons' }, { description, prefix: 'page' })
    const group = view.chips.filter((chip) => chip.key === 'status')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(patch['filters.status']).toBeUndefined()
    expect(Object.keys(patch).every((key) => key !== 'filters.status' || patch[key] === undefined)).toBe(true)
  })

  it('снимает оба режима multiselect одного поля', () => {
    const view = catalogFilterView(
      schema,
      { 'filters.genres.and': '1,2', 'filters.genres.not': '2', 'filters.kind': 'tv' },
      { description, prefix: 'page' },
    )
    const group = view.chips.filter((chip) => chip.key === 'genres')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(patch['filters.genres.and']).toBeUndefined()
    expect(patch['filters.genres.not']).toBeUndefined()
    expect(patch['filters.kind']).toBe('tv')
  })

  it('снимает обе границы number', () => {
    const view = catalogFilterView(
      schema,
      { 'filters.score.min': '7', 'filters.score.max': '9', 'filters.kind': 'tv' },
      { description, prefix: 'page' },
    )
    const group = view.chips.filter((chip) => chip.key === 'score')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(patch['filters.score.min']).toBeUndefined()
    expect(patch['filters.score.max']).toBeUndefined()
    expect(patch['filters.kind']).toBe('tv')
  })

  it('сохраняет соседнее поле', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'latest', 'filters.kind': 'tv' }, { description, prefix: 'page' })
    const group = view.chips.filter((chip) => chip.key === 'status')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(patch['filters.status']).toBeUndefined()
    expect(patch['filters.kind']).toBe('tv')
  })

  it('не возвращает значения по умолчанию', () => {
    const view = catalogFilterView(schema, { 'filters.score.min': '1', 'filters.score.max': '9' }, { description, prefix: 'page' })
    const group = view.chips.filter((chip) => chip.key === 'score')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(patch['filters.score.min']).toBeUndefined()
    expect(patch['filters.score.max']).toBeUndefined()
  })

  it('не возвращает подавленное связкой значение при снятии другой группы', () => {
    const view = catalogFilterView(
      schema,
      { 'filters.status': 'anons', 'filters.score.min': '5', 'filters.kind': 'tv' },
      { description, prefix: 'page' },
    )
    const group = view.chips.filter((chip) => chip.key === 'kind')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(patch['filters.kind']).toBeUndefined()
    expect(patch['filters.status']).toBe('anons')
    expect(patch['filters.score.min']).toBeUndefined()
  })

  it('пустая группа не создаёт мусорных ключей', () => {
    expect(catalogFilterRemoveGroupPatch([])).toEqual({})
  })

  it('снятие группы со смешанными значениями не сохраняет подавленное поле', () => {
    const view = catalogFilterView(
      schema,
      { 'filters.status': 'latest,anons', 'filters.score.min': '5' },
      { description, prefix: 'page' },
    )
    const group = view.chips.filter((chip) => chip.key === 'status')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(patch['filters.status']).toBeUndefined()
    expect(patch['filters.score.min']).toBe(5)
  })

  it('снятие группы оживляет поля, подавленные разными её значениями', () => {
    const view = catalogFilterView(
      schema,
      { 'filters.status': 'latest,anons', 'filters.score.min': '5', 'filters.year.min': '2000' },
      { description, prefix: 'page' },
    )
    const group = view.chips.filter((chip) => chip.key === 'status')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(patch['filters.status']).toBeUndefined()
    expect(patch['filters.score.min']).toBe(5)
    expect(patch['filters.year.min']).toBe(2000)
  })

  it('снимает все пути группы, а не только последний', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'latest,anons' }, { description, prefix: 'page' })
    const group = view.chips.filter((chip) => chip.key === 'status')
    const patch = catalogFilterRemoveGroupPatch(group)

    expect(group.every((chip) => patch[chip.path] === undefined)).toBe(true)
  })

  it('склейка патчей чипов оставляет значение группы', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'latest,anons' }, { description, prefix: 'page' })
    const group = view.chips.filter((chip) => chip.key === 'status')
    const merged = Object.assign({}, ...group.map((chip) => chip.patch))

    expect(group.some((chip) => merged[chip.path] !== undefined)).toBe(true)
  })
})
