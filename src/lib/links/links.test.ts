/**
 * Нейтральное ядро связок: расчёт, тексты, сборка набора.
 *
 * Здесь нет ни схемы, ни DOM — правила и значения поданы руками: эти тесты
 * и есть контракт для каждого словаря-потребителя (каталог, панель).
 */
import { describe, expect, it } from 'vitest'
import { computeLinks, linkHelperText, linkRefusalText, linkSubmission, type LinkRule } from './links'

const LABELS: Record<string, string> = { genres: 'Жанры', score: 'Оценка', status: 'Статус', type: 'Тип' }
const label = (field: string): string => LABELS[field] ?? field
const valuesOf = (initial: Record<string, readonly string[]>) => (field: string) => initial[field] ?? []

const scoreRule: LinkRule = {
  id: 'score-with-anons',
  when: [{ field: 'status', value: 'anons' }],
  effect: { kind: 'disable-field', field: 'score' },
  reason: 'у анонсов нет оценки',
}

describe('расчёт: что выключено при текущих значениях', () => {
  it('условие без значения — «поле заполнено»; пустое поле не гасит', () => {
    const rule: LinkRule = {
      id: 'r', when: [{ field: 'status' }], effect: { kind: 'disable-field', field: 'score' }, reason: 'r',
    }
    expect(computeLinks([rule], valuesOf({ status: ['x'] })).fields.has('score')).toBe(true)
    expect(computeLinks([rule], valuesOf({ status: [] })).fields.has('score')).toBe(false)
    expect(computeLinks([rule], valuesOf({})).fields.has('score')).toBe(false)
  })

  it('условие со значением — presence в списке, не равенство списка', () => {
    const outcome = computeLinks([scoreRule], valuesOf({ status: ['tv', 'anons'] }))
    expect(outcome.fields.get('score')?.rule.id).toBe('score-with-anons')
    expect(computeLinks([scoreRule], valuesOf({ status: ['latest'] })).firings).toHaveLength(0)
  })

  it('несколько условий: срабатывает только выполнение всех', () => {
    const rule: LinkRule = {
      id: 'r', when: [{ field: 'status', value: 'anons' }, { field: 'type', value: 'movie' }],
      effect: { kind: 'disable-field', field: 'score' }, reason: 'r',
    }
    expect(computeLinks([rule], valuesOf({ status: ['anons'] })).firings).toHaveLength(0)
    expect(computeLinks([rule], valuesOf({ status: ['anons'], type: ['movie'] })).firings).toHaveLength(1)
  })

  it('две связки на одно поле: в helper — последняя, в firings — обе', () => {
    const second: LinkRule = { ...scoreRule, id: 'other', reason: 'иное' }
    const outcome = computeLinks([scoreRule, second], valuesOf({ status: ['anons'] }))
    expect(outcome.firings.map((f) => f.rule.id)).toEqual(['score-with-anons', 'other'])
    expect(outcome.fields.get('score')?.rule.reason).toBe('иное')
  })

  it('гашение значения не гасит поле', () => {
    const rule: LinkRule = {
      id: 'c', when: [{ field: 'a' }, { field: 'b' }],
      effect: { kind: 'disable-option', field: 'genres', value: '133' }, reason: 'r',
    }
    const outcome = computeLinks([rule], valuesOf({ a: ['x'], b: ['y'] }))
    expect(outcome.fields.size).toBe(0)
    expect([...(outcome.options.get('genres') ?? [])]).toEqual(['133'])
  })

  it('виновники: без повторов, в порядке объявления', () => {
    const rule: LinkRule = {
      id: 'r', when: [{ field: 'status' }, { field: 'type' }, { field: 'status' }],
      effect: { kind: 'disable-field', field: 'score' }, reason: 'r',
    }
    expect(computeLinks([rule], valuesOf({ status: ['s'], type: ['t'] })).firings[0]?.blockers)
      .toEqual(['status', 'type'])
  })
})

describe('составитель текстов: один на helper и отказ', () => {
  const firing = (fields: readonly string[]) =>
    computeLinks(
      [{ id: 'r', when: fields.map((field) => ({ field })), effect: { kind: 'disable-field', field: 'score' }, reason: 'у анонсов нет оценки' }],
      valuesOf(Object.fromEntries(fields.map((f) => [f, ['x']]))),
    ).firings[0]!

  it('один виновник', () => {
    expect(linkHelperText(firing(['status']), label)).toBe('«Статус» блокирует поле: у анонсов нет оценки')
  })

  it('два виновника: «и» + множественное число', () => {
    expect(linkHelperText(firing(['status', 'type']), label))
      .toBe('«Статус» и «Тип» блокируют поле: у анонсов нет оценки')
  })

  it('отказ валидатора: те же данные, другая реплика', () => {
    expect(linkRefusalText('score', firing(['status']), label))
      .toBe('«Оценка» невозможно использовать совместно с «Статус»')
    expect(linkRefusalText('score', firing(['status', 'type']), label))
      .toBe('«Оценка» невозможно использовать совместно с «Статус», «Тип»')
  })
})

describe('сборка набора для отправки', () => {
  const values = {
    'filters.status': ['anons'],
    'filters.score.min': ['7'],
    'filters.genres.and': ['1', '2'],
  }

  it('выключенное поле исчезает из набора, остальное — без изменений', () => {
    const set = linkSubmission(values, (f) => f === 'filters.score.min', () => false)
    expect(set).toEqual({ 'filters.status': ['anons'], 'filters.genres.and': ['1', '2'] })
  })

  it('выключенное значение вырезается из списка; пустой список не едет', () => {
    const set = linkSubmission(
      { ...values, 'filters.genres.not': ['2'] },
      () => false,
      (_field, value) => value === '2',
    )
    expect(set['filters.genres.and']).toEqual(['1'])
    expect('filters.genres.not' in set).toBe(false)
  })

  it('значения не стираются: форма не меняется, а без блокирующего набор полный', () => {
    const blocked = linkSubmission(values, (f) => f === 'filters.score.min', () => false)
    expect(values['filters.score.min']).toEqual(['7']) // форма хранит выбор
    const free = linkSubmission(values, () => false, () => false)
    expect(free).toEqual(values) // блокирующий снят — всё вернулось само
    expect(blocked).not.toEqual(free)
  })

  it('порядок и содержимое сохранённых списков не меняются', () => {
    const set = linkSubmission(values, () => false, () => false)
    expect(set['filters.genres.and']).toEqual(['1', '2'])
  })
})
