// Чистая логика ошибки операции перехватчика: факт, закреп, блокировка.
import { describe as suite, expect, test } from 'vitest'
import { en, makeRenderer } from './index'
import { defaultPolicy } from './policy'
import { blockingOpErrors, opError, opPin } from './takeover'

const render = makeRenderer([en])
const limits = defaultPolicy.limits
const fd = (values: Record<string, string>): FormData => {
  const d = new FormData()
  for (const [k, v] of Object.entries(values)) d.set(k, v)
  return d
}

suite('opError / opPin', () => {
  test('факт: external, путь поля, стабильный id по коду и параметрам', () => {
    const a = opError('doc', { code: 'doc.unprepared', params: { max: 8 } }, render, limits)!
    const b = opError('doc', { code: 'doc.unprepared', params: { max: 8 } }, render, limits)!
    expect(a.origin).toBe('external')
    expect(a.path).toBe('doc')
    expect(a.id).toBe(b.id)
    expect(a.id.startsWith('doc:doc.unprepared:')).toBe(true)
  })

  test('закреп: сэмпл из FormData, файл — именем/размером/датой', () => {
    const e = opError('doc', { code: 'x' }, render, limits)!
    expect(opPin('doc', e, fd({ doc: 'abc' })).sent).toEqual(['abc'])
    expect(opPin('doc', e).sent).toBeNull() // снимет первая сверка
    const withFile = new FormData()
    withFile.set('doc', new File(['xy'], 'a.jpg', { type: 'image/jpeg', lastModified: 7 }))
    expect(opPin('doc', e, withFile).sent).toEqual(['a.jpg:2:7'])
  })
})

suite('blockingOpErrors', () => {
  const pinAt = (value: string) =>
    opPin('doc', opError('doc', { code: 'doc.unprepared' }, render, limits)!, fd({ doc: value }))

  test('полное действие + то же значение — блокирует; новое значение — нет', () => {
    const pins = [pinAt('сырьё')]
    expect(blockingOpErrors(pins, fd({ doc: 'сырьё' }), { validate: 'full' })).toHaveLength(1)
    expect(blockingOpErrors(pins, fd({ doc: 'готово' }), { validate: 'full' })).toEqual([])
  })

  test('частичное действие и действие без проверки не блокируются', () => {
    const pins = [pinAt('сырьё')]
    expect(blockingOpErrors(pins, fd({ doc: 'сырьё' }), { validate: 'partial' })).toEqual([])
    expect(blockingOpErrors(pins, fd({ doc: 'сырьё' }), { validate: 'none' })).toEqual([])
    expect(blockingOpErrors(pins, fd({ doc: 'сырьё' }), undefined)).toEqual([])
  })

  test('subset: чужое поле не блокирует шаг, своё — блокирует', () => {
    const pins = [pinAt('сырьё')]
    expect(blockingOpErrors(pins, fd({ doc: 'сырьё' }), { validate: 'full', subset: ['note'] })).toEqual([])
    expect(blockingOpErrors(pins, fd({ doc: 'сырьё' }), { validate: 'full', subset: ['doc'] })).toHaveLength(1)
  })

  test('закреп без сэмпла снимает его с отправляемых данных (первая сверка)', () => {
    const e = opError('doc', { code: 'x' }, render, limits)!
    const pins = [opPin('doc', e)]
    expect(blockingOpErrors(pins, fd({ doc: 'v1' }), { validate: 'full' })).toHaveLength(1)
    expect(pins[0]!.sent).toEqual(['v1'])
    expect(blockingOpErrors(pins, fd({ doc: 'v2' }), { validate: 'full' })).toEqual([])
  })
})
