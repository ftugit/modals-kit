import { describe, expect, it } from 'vitest'
import { isPinned, pinErrors, reconcilePins, sampleField } from './pins'
import type { FormError } from './result'

const err = (id: string, over: Partial<FormError> = {}): FormError =>
  ({ id, code: 'x', message: 'm', origin: 'server', ...over }) as FormError
const fd = (o: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(o)) d.append(k, v); return d }
const known = (n: string) => ['email', 'a', 'b'].includes(n)

describe('pins: серверная ошибка закреплена за значением', () => {
  it('закрепляются только серверные/внешние ошибки известных полей', () => {
    const pins = pinErrors([
      err('1', { path: 'email' }),
      err('2', { path: 'email', origin: 'core' }),
      err('3'),                                   // общая — не закрепляется
      err('4', { path: 'ghost' }),                // неизвестное поле
      err('5', { origin: 'external', params: { fields: ['a', 'b'] } }),
    ], known, fd({ email: 'x@y', a: '1', b: '2' }))
    expect(pins.map((p) => [p.error.id, p.fields, p.sent])).toEqual([['1', ['email'], ['x@y']], ['5', ['a', 'b'], ['1', '2']]])
  })

  it('правка скрывает, возврат показывает, без изменений — null', () => {
    const e = err('1', { path: 'email' })
    const pins = pinErrors([e], known, fd({ email: 'x@y' }))
    expect(reconcilePins(pins, [e], fd({ email: 'x@y' }))).toBeNull()
    expect(reconcilePins(pins, [e], fd({ email: 'x@yz' }))).toEqual([])
    expect(reconcilePins(pins, [], fd({ email: 'x@yz' }))).toBeNull()
    expect(reconcilePins(pins, [], fd({ email: 'x@y' }))).toEqual([e])
  })

  it('ошибка клиента на поле сильнее закреплённой', () => {
    const e = err('1', { path: 'email' })
    const own = err('c', { path: 'email', origin: 'core' })
    const pins = pinErrors([e], known, fd({ email: 'x@y' }))
    expect(reconcilePins(pins, [e, own], fd({ email: 'x@y' }))).toEqual([own])
  })

  it('ошибка нескольких полей видна, пока совпадают все', () => {
    const e = err('5', { params: { fields: ['a', 'b'] } })
    const pins = pinErrors([e], known, fd({ a: '1', b: '2' }))
    expect(reconcilePins(pins, [e], fd({ a: '1', b: '3' }))).toEqual([])
  })

  it('без отправленных данных значения снимаются при первой сверке', () => {
    const e = err('1', { path: 'email' })
    const pins = pinErrors([e], known)
    expect(pins[0].sent).toBeNull()
    expect(reconcilePins(pins, [e], fd({ email: '' }))).toBeNull()
    expect(pins[0].sent).toEqual([''])
    expect(isPinned(pins, e)).toBe(true)
    expect(reconcilePins(pins, [e], fd({ email: 'a' }))).toEqual([])
  })

  it('значение поля — все записи имени', () => {
    const d = new FormData(); d.append('t', 'a'); d.append('t', 'b')
    expect(sampleField(d, 't')).toBe('a\u0000b')
  })

  it('пустая заглушка File([], "") стабильна несмотря на разный lastModified у браузерного FormData', () => {
    const d1 = new FormData(); d1.append('f', new File([], '', { lastModified: 1000 }))
    const d2 = new FormData(); d2.append('f', new File([], '', { lastModified: 9999 }))
    const d3 = new FormData(); d3.append('f', new File(['ok'], 'a.jpg', { lastModified: 5000 }))
    const e = err('f1', { path: 'f' })
    const pins = pinErrors([e], (n) => n === 'f', d1)
    expect(reconcilePins(pins, [e], d2)).toBeNull()
    expect(reconcilePins(pins, [e], d3)).toEqual([])
  })
})
