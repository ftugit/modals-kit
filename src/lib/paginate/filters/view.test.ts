/**
 * Api схемы глазами интерфейса: что компонент получает готовым.
 *
 * Проверяется то, ради чего этот слой существует: картина панели называет
 * ошибки формы над применённым набором (поля гасит форма — `disabledWhen`), патч хранилища снимает опустевшие ключи, не трогает
 * необъявленные и НЕ ПИШЕТ значение, снятое связкой (JS решает то же, что
 * делает браузер без JS, не отправляя выключенный контрол), а чипы несут
 * адрес, снимающий ровно одно значение.
 */
import { describe, expect, it } from 'vitest'
import {
  catalogFilterExtraPatch,
  catalogFilterRemoveValuePatch,
  catalogFilterView,
} from './view'
import { formParams, type CatalogFilterSchema } from './index'
import { defineForm, field } from '#lib/form/index.js'
import { describeAll } from './test-describe'

const schema: CatalogFilterSchema = {
  source: 'shikimori',
  version: 1,
  builtAt: '2026-10-07T10:00:00.000Z',
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
    { key: 'studios', label: 'Студии', type: 'multiselect', modes: ['and'], optionsTruncated: 5, options: [{ value: '858', label: 'Wit Studio' }] },
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
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min'], min: 1, max: 10 },
    { key: 'year', label: 'Год', type: 'number', min: 1900, max: 2028 },
  ],
  rules: [
    { id: 'search-with-latest', when: [{ field: 'status', value: 'latest' }], drop: 'q', reason: 'поиск не работает' },
    { id: 'score-with-anons', when: [{ field: 'status', value: 'anons' }], drop: { field: 'score' }, reason: 'у анонсов нет оценки' },
  ],
}

/** Описание со всеми полями — на адресных именах, как в браузере. */
const description = describeAll(schema, { prefix: 'page.' })

describe('связки и ошибки в картине панели', () => {
  it('запрет поиска виден отдельно — у поиска свой канал', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'latest' }, { description })
    expect(view.searchBlocked).toEqual({ id: 'search-with-latest', reason: 'поиск не работает' })
    expect(view.violations).toEqual([])
  })

  it('сработавшая связка названа в картине даже до выбора оценки', () => {
    // Объяснение блока нужно пользователю без JS и доступно у формы до её раскрытия.
    const view = catalogFilterView(schema, { 'filters.status': 'anons' }, { description })
    expect(view.violations.map((violation) => [violation.id, violation.keys[0]])).toEqual([['link.blocked', 'filters.score.min']])
    expect(view.searchBlocked).toBeUndefined()
  })

  it('no-JS: заблокированное значение остаётся чипом, ошибка формы объясняет отказ', () => {
    const view = catalogFilterView(schema, { 'filters.status': 'anons', 'filters.score.min': '5' }, { description })
    expect(view.violations).toEqual([{
      id: 'link.blocked',
      message: '«Оценка» нельзя использовать вместе с «Статус»: у анонсов нет оценки',
      keys: ['filters.score.min'],
    }])
    expect(view.chips.some((chip) => chip.key === 'score' && chip.value === '5')).toBe(true)
  })

  it('«все из» ∩ «кроме» и перевёрнутый диапазон — ошибки у своих полей', () => {
    const view = catalogFilterView(schema, {
      'filters.genres.and': '1', 'filters.genres.not': '1', 'filters.year.min': 2010, 'filters.year.max': 2001,
    }, { description })
    expect(view.violations.map((v) => [v.id, v.keys[0]])).toEqual([
      ['noOverlap', 'filters.genres.not'],
      ['notAbove', 'filters.year.min'],
    ])
  })

  it('подписи чипов — из описания; поля, которого в описании нет, нет и в чипах', () => {
    const filter = formParams(schema, { prefix: 'page.' })
    const own = defineForm({
      id: 'own',
      policy: filter.policy,
      fields: filter.fields({ kind: field.select({ label: 'Формат', ...filter.kind }) }),
    })
    const view = catalogFilterView(schema, { 'filters.kind': 'tv', 'filters.genres.and': '1' }, { description: own })
    expect(view.chips.map((chip) => [chip.path, chip.fieldLabel, chip.label])).toEqual([['filters.kind', 'Формат', 'ТВ']])
    expect(view.count).toBe(1)
  })
})

describe('патч хранилища', () => {
  it('пустое значение снимает ключ, список едет строкой через запятую', () => {
    const patch = catalogFilterExtraPatch(schema, {
      'filters.genres.and': ['1', '2'],
      'filters.kind': 'tv',
      'filters.status': '',
    })
    expect(patch['filters.genres.and']).toBe('1,2')
    expect(patch['filters.kind']).toBe('tv')
    expect(patch['filters.status']).toBeUndefined()
    // Объявленные, но не упомянутые ключи тоже очищаются: патч — полный набор.
    expect(Object.keys(patch).sort()).toEqual([
      'filters.genres.and',
      'filters.genres.not',
      'filters.kind',
      'filters.score.min',
      'filters.status',
      'filters.studios.and',
      'filters.year.max',
      'filters.year.min',
    ])
  })

  it('FormData-границы числового поля остаются числами, края базы — не значения', () => {
    const patch = catalogFilterExtraPatch(schema, {
      'filters.score.min': ['7'],
      'filters.year.min': ['1900'],
      'filters.year.max': ['2028'],
    })
    expect(patch['filters.score.min']).toBe(7)
    expect(patch['filters.year.min']).toBeUndefined()
    expect(patch['filters.year.max']).toBeUndefined()
  })

  it('принимает по одному FormData-значению score/year и отвергает неоднозначный number', () => {
    const patch = catalogFilterExtraPatch(schema, {
      'filters.score.min': ['8'],
      'filters.year.min': ['1990'],
      'filters.year.max': ['1992'],
    })
    expect(patch['filters.score.min']).toBe(8)
    expect(patch['filters.year.min']).toBe(1990)
    expect(patch['filters.year.max']).toBe(1992)

    const ambiguous = catalogFilterExtraPatch(schema, { 'filters.score.min': ['7', '8'] })
    expect(ambiguous['filters.score.min']).toBeUndefined()
  })

  it('патчер — сериализатор: прямой вызов относит связку как есть (миграция 2026-10-10)', () => {
    // Буквальный перенос дропа в сборщик (решение оператора): вне панели
    // catalogFilterExtraPatch не знает о связках — подавляют их сборщики
    // входа (форма: скип disabled; чип: removeValuePatch).
    const patch = catalogFilterExtraPatch(schema, { 'filters.status': 'anons', 'filters.score.min': '5' })
    expect(patch['filters.status']).toBe('anons')
    expect(patch['filters.score.min']).toBe(5)
  })

  it('значение, снятое связкой, в хранилище не остаётся — но снимает его сборщик, не патчер', () => {
    // extra хранит сочетание, которое набор формы не производил (рука/URL):
    // снятие невинного чипа не должно его возвращать — score гасит anons.
    const clean = catalogFilterRemoveValuePatch(
      schema,
      { 'filters.status': 'anons', 'filters.score.min': '5', 'filters.kind': 'tv' },
      'filters.kind',
      'tv',
    )
    expect(clean['filters.status']).toBe('anons')
    expect(clean['filters.kind']).toBeUndefined()
    expect(clean['filters.score.min']).toBeUndefined()
    // Снятие САМОГО триггера оживляет соседа: связка считается после чипа.
    const revived = catalogFilterRemoveValuePatch(
      schema,
      { 'filters.status': 'anons', 'filters.score.min': '5' },
      'filters.status',
      'anons',
    )
    expect(revived['filters.status']).toBeUndefined()
    expect(revived['filters.score.min']).toBe(5)
  })

  it('необъявленный ключ в патч не попадает', () => {
    const patch = catalogFilterExtraPatch(schema, { 'filters.ghost': 'x', 'filters.kind': 'tv' })
    expect('filters.ghost' in patch).toBe(false)
  })

  it('снятие одного значения оставляет соседей и режимы поля', () => {
    const extra = { 'filters.genres.and': '1,2', 'filters.genres.not': '2', 'filters.kind': 'tv' }
    const patch = catalogFilterRemoveValuePatch(schema, extra, 'filters.genres.and', '1')
    expect(patch['filters.genres.and']).toBe('2')
    expect(patch['filters.genres.not']).toBe('2')
    expect(patch['filters.kind']).toBe('tv')
  })

  it('снятие последнего значения поля очищает ключ полностью', () => {
    const patch = catalogFilterRemoveValuePatch(schema, { 'filters.kind': 'tv' }, 'filters.kind', 'tv')
    expect(patch['filters.kind']).toBeUndefined()
  })
})

describe('адреса, которые получает компонент', () => {
  it('чипы несут адрес, снимающий ровно одно значение', () => {
    const view = catalogFilterView(
      schema,
      { 'filters.genres.and': '1,2', 'filters.kind': 'tv' },
      { description, url: { page: '/paginator', prefix: 'page', preserved: { 'page.size': '5' } } },
    )
    const chip = view.chips.find((item) => item.path === 'filters.genres.and' && item.value === '1')
    expect(chip?.href).toContain('page.filters.genres.and=2')
    expect(chip?.href).not.toContain('=1')
    expect(chip?.href).toContain('page.size=5')
    expect(chip?.label).toBe('Экшен')
    expect(chip?.fieldLabel).toBe('Жанры')
  })

  it('форма получает action без своих фильтров и скрытые чужие ключи', () => {
    const view = catalogFilterView(schema, { 'filters.kind': 'tv' }, {
      description,
      url: {
        page: '/paginator',
        preserved: { 'page.size': '5', 'page.filters.kind': 'tv', 'gallery.q': 'кот' },
      },
    })
    // `action` — с сохранёнными ключами каталога, но БЕЗ своих фильтров и без
    // указателя страницы: новый набор начинается с первой.
    expect(view.formAction).toBe('/paginator?gallery.q=%D0%BA%D0%BE%D1%82&page.size=5')
    expect(view.hidden).toEqual([
      { name: 'page.size', value: '5' },
      { name: 'gallery.q', value: 'кот' },
    ])
  })

  it('счётчик считает значения, а не поля', () => {
    const count = (extra: Record<string, string>) =>
      catalogFilterView(schema, extra, { description, url: { page: '/paginator', prefix: 'page', preserved: {} } }).count
    expect(count({ 'filters.genres.and': '1,2', 'filters.kind': 'tv' })).toBe(3)
    expect(count({})).toBe(0)
  })
})
