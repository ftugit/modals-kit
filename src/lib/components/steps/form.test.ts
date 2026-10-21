// Чистые части «паразита» form×step: карта поле→шаг и правило режима разбора.
import { describe, expect, it } from 'vitest'
import type { FormDescription, FormError, Result } from '#lib/form/index.js'
import { fieldStepMap, isReview, stepOfResult } from './form.svelte.js'

const actions = [
  { id: 'contacts', subset: ['name', 'email'] },
  { id: 'extra', subset: ['note'] },
  { id: 'save' }, // финальный: без subset
] as unknown as FormDescription['actions']

const err = (path?: string): FormError =>
  ({ id: `e:${path ?? '*'}`, code: 'test', origin: 'server', ...(path ? { path } : {}) }) as FormError

const result = (ok: boolean, errors: FormError[]): Result =>
  ({ ok, errors }) as unknown as Result

describe('fieldStepMap', () => {
  it('subset экшена шага → поля этого шага', () => {
    const map = fieldStepMap(['contacts', 'extra', 'save'], actions)
    expect(map.get('name')).toBe('contacts')
    expect(map.get('email')).toBe('contacts')
    expect(map.get('note')).toBe('extra')
    expect(map.size).toBe(3) // финальный без subset — в карте не участвует
  })

  it('свой actionOf: ключ шага ≠ id экшена', () => {
    const map = fieldStepMap(['one'], actions, (s) => (s === 'one' ? 'contacts' : s))
    expect(map.get('name')).toBe('one')
  })

  it('поле в двух subset: выигрывает первый шаг', () => {
    const dup = [{ id: 'a', subset: ['x'] }, { id: 'b', subset: ['x'] }] as unknown as FormDescription['actions']
    expect(fieldStepMap(['a', 'b'], dup).get('x')).toBe('a')
  })
})

describe('isReview', () => {
  const map = fieldStepMap(['contacts', 'extra', 'save'], actions)

  it('нет результата / успех / провал без ошибок — не разбор', () => {
    expect(isReview(undefined, [], map, 'extra')).toBe(false)
    expect(isReview(result(true, []), [], map, 'extra')).toBe(false)
    expect(isReview(result(false, []), [], map, 'extra')).toBe(false)
  })

  it('ошибки только текущего шага — не разбор (шаговый провал)', () => {
    expect(isReview(result(false, [err('note')]), [err('note')], map, 'extra')).toBe(false)
  })

  it('ошибка на чужом шаге — разбор (финал поймал чужое)', () => {
    expect(isReview(result(false, [err('name')]), [err('name')], map, 'extra')).toBe(true)
  })

  it('только общие (без пути) — разбор: свернуть всё, показать блок', () => {
    expect(isReview(result(false, [err()]), [err()], map, 'extra')).toBe(true)
  })

  it('показываемых ошибок не осталось (юзер всё исправил) — разбора нет', () => {
    // результат провала ещё висит, но ни одной показываемой ошибки — обычный вид
    expect(isReview(result(false, [err('name')]), [], map, 'extra')).toBe(false)
  })

  it('вложенный путь (`props.s1.max_length`) мапится по префиксу', () => {
    const nested = fieldStepMap(['extra'], [{ id: 'extra', subset: ['props'] }] as unknown as FormDescription['actions'])
    const e = err('props.s1.max_length')
    expect(isReview(result(false, [e]), [e], nested, 'save')).toBe(true)
    expect(isReview(result(false, [e]), [e], nested, 'extra')).toBe(false)
  })
})

describe('stepOfResult', () => {
  const parseAction = (intent: string) => intent.split(':')[0]!
  const res = (part: Record<string, unknown>): Result =>
    ({ ok: false, errors: [], ...part }) as unknown as Result
  const keys = ['contacts', 'extra']

  it('нет результата / нет интента — шаг не назван', () => {
    expect(stepOfResult(undefined, keys, { parseAction })).toBeUndefined()
    expect(stepOfResult(res({}), keys, { parseAction })).toBeUndefined()
  })

  it('успех: сервер называет следующий в data.step', () => {
    expect(stepOfResult(res({ ok: true, intent: 'contacts', data: { step: 'extra' } }), keys, { parseAction })).toBe('extra')
  })

  it('успех: чужой ключ в data.step не берётся — отправленный по интенту', () => {
    expect(stepOfResult(res({ ok: true, intent: 'contacts', data: { step: 'auth.restore' } }), keys, { parseAction })).toBe('contacts')
  })

  it('провал: отправленный шаг — по Result.intent (аргумент интента не мешает)', () => {
    expect(stepOfResult(res({ intent: 'extra' }), keys, { parseAction })).toBe('extra')
    expect(stepOfResult(res({ intent: 'extra:42' }), keys, { parseAction })).toBe('extra')
  })

  it('actionOf: интент сопоставляется через карту экшенов', () => {
    const actionOf = (s: string) => (s === 'contacts' ? 'check-contacts' : s)
    expect(stepOfResult(res({ intent: 'check-contacts' }), keys, { parseAction, actionOf })).toBe('contacts')
  })

  it('финальный экшен стоит на последнем шаге; неизвестный экшен — безымянно', () => {
    const o = { parseAction, final: 'save', last: 'extra' }
    expect(stepOfResult(res({ intent: 'save' }), keys, o)).toBe('extra')
    expect(stepOfResult(res({ intent: 'whatever' }), keys, o)).toBeUndefined()
  })

  it('data.step на провале не читается: следующий называет только успех', () => {
    expect(stepOfResult(res({ ok: false, intent: 'contacts', data: { step: 'extra' } }), keys, { parseAction })).toBe('contacts')
  })

  it('общий экшен двух срезов: отправленный по интенту не различить — безымянно', () => {
    // вход и создание делят интент login: провал с любого из двух не должен
    // уводить на первый срез списка
    const actionOf = (_s: string) => 'login'
    expect(stepOfResult(res({ intent: 'login' }), keys, { parseAction, actionOf })).toBeUndefined()
  })

  it('куст (at): data.step полным ключом — свой срез; чужой куст — мимо', () => {
    const o = { parseAction, at: 'auth' }
    expect(stepOfResult(res({ ok: true, intent: 'contacts', data: { step: 'auth.extra' } }), keys, o)).toBe('extra')
    expect(stepOfResult(res({ ok: true, intent: 'contacts', data: { step: 'extra' } }), keys, o)).toBe('extra') // и короткая запись
    expect(stepOfResult(res({ ok: true, intent: 'contacts', data: { step: 'other.extra' } }), keys, o)).toBe('contacts')
    expect(stepOfResult(res({ ok: true, intent: 'contacts', data: { step: 'auth.deep.er' } }), keys, o)).toBe('contacts')
  })
})
