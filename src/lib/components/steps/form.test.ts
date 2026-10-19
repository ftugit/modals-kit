// Чистые части «паразита» form×step: карта поле→шаг и правило режима разбора.
import { describe, expect, it } from 'vitest'
import type { FormDescription, FormError, Result } from '#lib/form/index.js'
import { fieldStepMap, isReview } from './form.svelte.js'

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

  it('вложенный путь (`props.s1.max_length`) мапится по префиксу', () => {
    const nested = fieldStepMap(['extra'], [{ id: 'extra', subset: ['props'] }] as unknown as FormDescription['actions'])
    const e = err('props.s1.max_length')
    expect(isReview(result(false, [e]), [e], nested, 'save')).toBe(true)
    expect(isReview(result(false, [e]), [e], nested, 'extra')).toBe(false)
  })
})
