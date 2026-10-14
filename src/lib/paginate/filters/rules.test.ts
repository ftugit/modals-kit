/**
 * Связки схемы фильтров (R1): `filterParams` переводит `rules` в `disabledWhen`
 * полей формы, а запрет поиска, серверная защита и пояснения панели считаются
 * тем же условием формы (`catalogRuleState`). Перенос ожиданий удалённого
 * `lib/links/catalog.test.ts`; тексты — согласованные в R1: один текст на
 * подсказку и отказ, сработавшие связки называются ВСЕ.
 */
import { describe, expect, it } from 'vitest'
import {
  disabledState,
  makeRenderer,
  normalizeErrors,
  ru,
  validateForm,
} from '#lib/form/index.js'
import {
  catalogFilterValueMap,
  catalogFilterViolations,
  catalogRuleState,
  type CatalogFilterSchema,
} from './index'
import { describeAll } from './test-describe'

const schema: CatalogFilterSchema = {
  source: 'links',
  version: 1,
  builtAt: '2026-10-08T10:00:00.000Z',
  fields: [
    {
      key: 'genres',
      label: 'Жанры',
      type: 'multiselect',
      modes: ['and', 'not'],
      options: [
        { value: '1', label: 'Экшен' },
        { value: '2', label: 'Драма' },
        { value: '133', label: 'Комедия' },
      ],
    },
    { key: 'kind', label: 'Тип', type: 'select', options: [{ value: 'tv', label: 'ТВ' }] },
    {
      key: 'status',
      label: 'Статус',
      type: 'select',
      options: [
        { value: 'latest', label: 'последние' },
        { value: 'anons', label: 'анонс' },
      ],
    },
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min'], min: 1, max: 10 },
  ],
  rules: [
    { id: 'search-with-latest', when: [{ field: 'status', value: 'latest' }], drop: 'q', reason: 'поиск не работает' },
    { id: 'score-with-anons', when: [{ field: 'status', value: 'anons' }], drop: { field: 'score' }, reason: 'у анонсов нет оценки' },
    {
      id: 'score-with-genres-kind',
      when: [{ field: 'genres' }, { field: 'kind', value: 'tv' }],
      drop: { field: 'score' },
      reason: 'с жанрами при ТВ не фильтруем',
    },
  ],
}

/** Живая форма фильтров на адресных именах (`page.`), как в браузере. */
function liveForm(s: CatalogFilterSchema = schema) {
  const desc = describeAll(s, { prefix: 'page.' })
  const render = makeRenderer([desc.messages, ru], desc.policy.interpolate)
  return (name: string, values: Record<string, unknown>) => {
    const f = desc.byName[name]
    return f && disabledState(desc, f, values, render)
  }
}

describe('живая форма: кто гаснет и что написано под полем', () => {
  const state = liveForm()

  it('пустое поле — текст называет поле и виновника', () => {
    expect(state('page.filters.score.min', { 'page.filters.status': 'anons' })).toEqual({
      disabled: true,
      reason: '«Оценка» нельзя использовать вместе с «Статус»: у анонсов нет оценки',
    })
    expect(state('page.filters.status', { 'page.filters.status': 'anons' })).toBeUndefined()
  })

  it('заполненное поле — тот же текст (один на подсказку и отказ)', () => {
    expect(state('page.filters.score.min', { 'page.filters.status': 'anons', 'page.filters.score.min': 5 })).toEqual({
      disabled: true,
      reason: '«Оценка» нельзя использовать вместе с «Статус»: у анонсов нет оценки',
    })
  })

  it('несколько условий называются все: «А» и «Б»', () => {
    expect(state('page.filters.score.min', { 'page.filters.genres.and': ['1', '2'], 'page.filters.kind': 'tv' })?.reason)
      .toBe('«Оценка» нельзя использовать вместе с «Жанры» и «Тип»: с жанрами при ТВ не фильтруем')
  })

  it('две связки на одно поле — говорят ОБЕ: виновники и причины вместе', () => {
    const values = { 'page.filters.genres.and': ['1'], 'page.filters.kind': 'tv', 'page.filters.status': 'anons' }
    expect(state('page.filters.score.min', values)?.reason).toBe(
      '«Оценка» нельзя использовать вместе с «Статус», «Жанры» и «Тип»: у анонсов нет оценки; с жанрами при ТВ не фильтруем',
    )
  })

  it('новые значения — новый ответ: разблокировка приходит сама', () => {
    expect(state('page.filters.score.min', { 'page.filters.status': 'anons' })?.disabled).toBe(true)
    expect(state('page.filters.score.min', { 'page.filters.status': 'latest' })).toBeUndefined()
  })

  it('несработавшая связка молчит; имена без префикса расчёт не двигают', () => {
    expect(state('page.filters.score.min', {})).toBeUndefined()
    expect(state('page.filters.score.min', { 'page.filters.kind': 'tv' })).toBeUndefined()
    expect(state('page.filters.score.min', { 'filters.status': 'anons' })).toBeUndefined()
  })

  it('свой текст правила (`message`) — вместо словарного, с теми же подстановками', () => {
    const own = liveForm({
      ...schema,
      rules: [
        {
          id: 'score-with-anons',
          when: [{ field: 'status', value: 'anons' }],
          drop: { field: 'score' },
          reason: 'у анонсов нет оценки',
          message: '{field}: недоступно при {blockers} — {reason}',
        },
        schema.rules![2]!,
      ],
    })
    expect(own('page.filters.score.min', { 'page.filters.status': 'anons' })?.reason)
      .toBe('Оценка: недоступно при «Статус» — у анонсов нет оценки')
    // со своим текстом и без — говорят оба: общий словарный и свой
    expect(own('page.filters.score.min', {
      'page.filters.status': 'anons', 'page.filters.genres.and': ['1'], 'page.filters.kind': 'tv',
    })?.reason).toBe(
      '«Оценка» нельзя использовать вместе с «Жанры» и «Тип»: с жанрами при ТВ не фильтруем; Оценка: недоступно при «Статус» — у анонсов нет оценки',
    )
  })
})

describe('отказ набора без JS — тот же текст, что под полем', () => {
  const desc = describeAll(schema)
  const render = makeRenderer([desc.messages, ru], desc.policy.interpolate)
  const messages = (values: Record<string, unknown>) =>
    normalizeErrors(validateForm(desc, values), render).filter((e) => e.code.startsWith('link.')).map((e) => [e.path, e.message])

  it('заполненное выключенное поле — одна ошибка со всеми виновниками', () => {
    expect(messages({ 'filters.status': 'anons', 'filters.genres.and': ['1'], 'filters.kind': 'tv', 'filters.score.min': 5 }))
      .toEqual([[
        'filters.score.min',
        '«Оценка» нельзя использовать вместе с «Статус», «Жанры» и «Тип»: у анонсов нет оценки; с жанрами при ТВ не фильтруем',
      ]])
  })

  it('пустое выключенное поле ничего не нарушает', () => {
    expect(messages({ 'filters.status': 'anons' })).toEqual([])
  })
})

describe('запрет поиска — то же условие, свой канал', () => {
  it('срабатывает по условию и снимает поиск, а не поле схемы', () => {
    const state = catalogRuleState(schema, catalogFilterValueMap({ 'filters.status': 'latest' }))
    expect(state.search).toMatchObject({ id: 'search-with-latest', reason: 'поиск не работает' })
    expect([...state.fields.keys()]).toEqual([])
  })

  it('не срабатывает при других значениях; поле гасится своей связкой', () => {
    const state = catalogRuleState(schema, catalogFilterValueMap({ 'filters.status': 'anons' }))
    expect(state.search).toBeUndefined()
    expect(state.fields.get('score')?.id).toBe('score-with-anons')
  })

  it('чужие ключи extra расчёт не двигают', () => {
    expect(catalogRuleState(schema, catalogFilterValueMap({ 'filters.q': 'x', junk: 'y' })).fired).toHaveLength(0)
  })

  it('условие по любому пути поля: срез `score.min` заполняет «Оценку»', () => {
    const s: CatalogFilterSchema = {
      ...schema,
      rules: [{ id: 'kind-with-score', when: [{ field: 'score' }], drop: { field: 'kind' }, reason: 'r' }],
    }
    expect(catalogRuleState(s, catalogFilterValueMap({ 'filters.score.min': '7' })).fields.has('kind')).toBe(true)
    expect(catalogRuleState(s, catalogFilterValueMap({})).fields.has('kind')).toBe(false)
  })
})

describe('пояснения панели — ошибки формы над применённым набором', () => {
  const desc = describeAll(schema, { prefix: 'page.' })
  const violations = (extra: Record<string, unknown>) => catalogFilterViolations(desc, schema, extra, { prefix: 'page.' })

  it('«все из» ∩ «кроме» — ошибка у «кроме», текст из словаря формы', () => {
    expect(violations({ 'filters.genres.and': '1,133', 'filters.genres.not': '133' })).toEqual([
      { id: 'noOverlap', message: 'Это значение выбрано и здесь, и в соседнем поле', keys: ['filters.genres.not'] },
    ])
  })

  it('связка с заполненным полем — тот же текст, что под полем; запрет поиска сюда не входит', () => {
    expect(violations({ 'filters.status': 'anons', 'filters.score.min': '5' })).toEqual([
      {
        id: 'link.blocked',
        message: '«Оценка» нельзя использовать вместе с «Статус»: у анонсов нет оценки',
        keys: ['filters.score.min'],
      },
    ])
    expect(violations({ 'filters.status': 'latest' })).toEqual([])
  })

  it('словарь приложения и описание меняют текст', () => {
    const own = catalogFilterViolations(desc, schema, { 'filters.genres.and': '1', 'filters.genres.not': '1' }, {
      prefix: 'page.',
      messages: { noOverlap: 'Жанр уже выбран' },
    })
    expect(own.map((v) => v.message)).toEqual(['Жанр уже выбран'])
  })

  it('без пересечения — тишина; сработавшая связка названа и при пустом поле', () => {
    expect(violations({ 'filters.genres.and': '1', 'filters.genres.not': '2' })).toEqual([])
    expect(violations({ 'filters.status': 'anons' })).toEqual([
      { id: 'link.blocked', message: '«Оценка» нельзя использовать вместе с «Статус»: у анонсов нет оценки', keys: ['filters.score.min'] },
    ])
  })
})
