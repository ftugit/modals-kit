// Правила выключения поля (`disabledWhen`, R1): условие формы, живое решение
// под полем и отказ набора в validateForm — одно объявление на обе стороны.
import { describe, expect, test } from 'vitest'
import {
  defineForm, disabledState, isFilled, makeFieldSugar, makeRenderer, matchesCondition,
  normalizeErrors, ru, validateForm,
  type FormDescription,
} from './index'

const field = makeFieldSugar()

describe('условие формы', () => {
  test('filled: непустая строка/список, число, true; пустое и false — нет', () => {
    for (const v of ['a', [' ', 'b'], 0, true]) expect(isFilled(v)).toBe(true)
    for (const v of ['', '  ', [], [''], false, null, undefined]) expect(isFilled(v)).toBe(false)
  })
  test('includes: элемент списка или скаляр, сравнение строковое', () => {
    const c = { field: 'x', includes: '5' } as const
    expect(matchesCondition(c, { x: ['1', '5'] })).toBe(true)
    expect(matchesCondition(c, { x: 5 })).toBe(true)
    expect(matchesCondition(c, { x: '55' })).toBe(false)
    expect(matchesCondition({ field: 'x', includes: 'false' }, { x: false })).toBe(true)
    expect(matchesCondition(c, {})).toBe(false)
  })
  test('all / any / not и прежние equals / notEquals', () => {
    const v = { a: 'x', b: '' }
    expect(matchesCondition({ all: [{ field: 'a', equals: 'x' }, { not: { field: 'b', filled: true } }] }, v)).toBe(true)
    expect(matchesCondition({ any: [{ field: 'b', filled: true }, { field: 'a', notEquals: 'x' }] }, v)).toBe(false)
  })
})

const form = (messages?: Record<string, string>): FormDescription => defineForm({
  id: 'f',
  messages,
  fields: {
    status: field.select({ label: 'Статус', options: ['anons', 'ongoing'] }),
    kind: field.select({ label: 'Тип', options: ['tv', 'movie'] }),
    score: field.text({
      label: 'Оценка',
      disabledWhen: [
        { when: { field: 'status', includes: 'anons' }, reason: 'у анонсов нет оценки' },
        { when: { all: [{ field: 'kind', includes: 'tv' }, { field: 'status', filled: true }] }, reason: 'у ТВ со статусом нет оценки' },
      ],
    }),
  },
})

describe('живое решение под полем', () => {
  const d = form()
  const render = makeRenderer([d.messages, ru], d.policy.interpolate)
  const state = (values: Record<string, unknown>) => disabledState(d, d.byName['score']!, values, render)

  test('правило не сработало — решения нет', () => {
    expect(state({ status: 'ongoing' })).toBeUndefined()
  })
  test('сработало — поле выключено, текст называет поле, виновника и причину', () => {
    expect(state({ status: 'anons' })).toEqual({
      disabled: true,
      reason: '«Оценка» нельзя использовать вместе с «Статус»: у анонсов нет оценки',
    })
  })
  test('сработало несколько — говорят все: виновники без повторов, причины через «; »', () => {
    expect(state({ status: 'anons', kind: 'tv' })?.reason).toBe(
      '«Оценка» нельзя использовать вместе с «Статус» и «Тип»: у анонсов нет оценки; у ТВ со статусом нет оценки',
    )
  })
  test('шаблон перекрывается словарём формы — с теми же подстановками', () => {
    const own = form({ 'link.blocked': '{field} и {blockers} нельзя использовать в связке' })
    const r = makeRenderer([own.messages, ru], own.policy.interpolate)
    expect(disabledState(own, own.byName['score']!, { status: 'anons' }, r)?.reason)
      .toBe('Оценка и «Статус» нельзя использовать в связке')
  })
})

describe('отказ набора (validateForm) — тот же текст', () => {
  const d = form()
  const render = makeRenderer([d.messages, ru], d.policy.interpolate)
  const errs = (values: Record<string, unknown>) =>
    normalizeErrors(validateForm(d, values), render).map((e) => [e.path, e.code, e.message])

  test('пустое выключенное поле ничего не нарушает', () => {
    expect(errs({ status: 'anons' })).toEqual([])
  })
  test('заполненное выключенное — link.blocked с текстом, как под полем', () => {
    expect(errs({ status: 'anons', score: '7' })).toEqual([
      ['score', 'link.blocked', '«Оценка» нельзя использовать вместе с «Статус»: у анонсов нет оценки'],
    ])
  })
  test('правило перестало срабатывать — значение снова проходит', () => {
    expect(errs({ status: 'ongoing', score: '7' })).toEqual([])
  })
})

describe('свой текст правила (`message`)', () => {
  const d = defineForm({
    id: 'm',
    fields: {
      status: field.select({ label: 'Статус', options: ['anons'] }),
      kind: field.select({ label: 'Тип', options: ['tv'] }),
      score: field.text({
        label: 'Оценка',
        disabledWhen: [
          { when: { field: 'status', includes: 'anons' }, reason: 'нет оценки', message: 'У анонсов {field} не бывает ({blockers})' },
          { when: { field: 'kind', includes: 'tv' }, reason: 'у ТВ нет оценки', label: 'Балл' },
        ],
      }),
    },
  })
  const render = makeRenderer([d.messages, ru], d.policy.interpolate)

  test('вместо словарного; остальные правила — общим текстом; всё через «; »', () => {
    expect(disabledState(d, d.byName['score']!, { status: 'anons' }, render)?.reason)
      .toBe('У анонсов Оценка не бывает («Статус»)')
    expect(disabledState(d, d.byName['score']!, { status: 'anons', kind: 'tv' }, render)?.reason)
      .toBe('«Балл» нельзя использовать вместе с «Тип»: у ТВ нет оценки; У анонсов Оценка не бывает («Статус»)')
  })
  test('в отказе — те же строки: общий link.blocked и свой link.message', () => {
    const errs = normalizeErrors(validateForm(d, { status: 'anons', kind: 'tv', score: '5' }), render)
    expect(errs.map((e) => [e.code, e.message])).toEqual([
      ['link.blocked', '«Балл» нельзя использовать вместе с «Тип»: у ТВ нет оценки'],
      ['link.message', 'У анонсов Оценка не бывает («Статус»)'],
    ])
  })
})
