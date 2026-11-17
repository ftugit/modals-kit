/**
 * Память процесса: срок, потолок, области, атомарные операции. Каждый тест —
 * граница, на которой самописные копии ломались или могли сломаться.
 */
import { describe, expect, it } from 'vitest'
import { isAtomic, memoryStore, requireAtomic, type Store } from './index'

function clock(start = 1_000) {
  let t = start
  return { now: () => t, tick: (ms: number) => { t += ms } }
}

describe('memoryStore: срок', () => {
  it('запись живёт ровно ttl: в последнюю миллисекунду жива, на границе — нет', () => {
    const c = clock()
    const s = memoryStore({ now: c.now })
    s.set('a', 1, 100)
    c.tick(99)
    expect(s.get('a')).toBe(1)
    c.tick(1)
    expect(s.get('a')).toBeUndefined()
    expect(s.size).toBe(0) // просроченное удалено при чтении
  })

  it('Infinity — без срока; ноль, отрицательный и NaN — ошибка, а не «мгновенно истекло»', () => {
    const c = clock()
    const s = memoryStore({ now: c.now })
    s.set('a', 1, Infinity)
    c.tick(10 ** 12)
    expect(s.get('a')).toBe(1)
    expect(() => s.set('b', 1, 0)).toThrow(RangeError)
    expect(() => s.set('b', 1, -5)).toThrow(RangeError)
    expect(() => s.add('b', 1, Number.NaN)).toThrow(RangeError)
    expect(() => s.incr('b', 0)).toThrow(RangeError)
  })

  it('просроченное вычищается обходом, даже если его никто не читает', () => {
    const c = clock()
    const s = memoryStore({ now: c.now })
    for (let i = 0; i < 50; i++) s.set(`k${i}`, i, 1_000)
    c.tick(61_000)
    s.set('fresh', 1, 1_000)
    expect(s.size).toBe(1)
  })
})

describe('memoryStore: потолок', () => {
  it('полная область вытесняет самую старую запись, а не все подряд', () => {
    const s = memoryStore({ max: 3 })
    s.set('a', 1, 1e6); s.set('b', 2, 1e6); s.set('c', 3, 1e6)
    s.set('d', 4, 1e6)
    expect(s.size).toBe(3)
    expect(s.get('a')).toBeUndefined()
    expect(s.get('d')).toBe(4)
  })

  it('перезапись переносит ключ в конец очереди', () => {
    const s = memoryStore({ max: 3 })
    s.set('a', 1, 1e6); s.set('b', 2, 1e6); s.set('c', 3, 1e6)
    s.set('a', 10, 1e6)
    s.set('d', 4, 1e6)
    expect(s.get('a')).toBe(10)
    expect(s.get('b')).toBeUndefined()
  })

  it('неверный потолок — ошибка при создании', () => {
    expect(() => memoryStore({ max: 0 })).toThrow(RangeError)
    expect(() => memoryStore({ max: 1.5 })).toThrow(RangeError)
    expect(() => memoryStore().scope('x', { max: -1 })).toThrow(RangeError)
  })
})

describe('memoryStore: области', () => {
  it('одинаковые ключи в разных областях не пересекаются', () => {
    const s = memoryStore()
    s.scope('a').set('k', 'A', 1e6)
    s.scope('b').set('k', 'B', 1e6)
    expect(s.scope('a').get('k')).toBe('A')
    expect(s.scope('b').get('k')).toBe('B')
    expect(s.get('k')).toBeUndefined()
  })

  it('поток уникальных ключей в одной области не вытесняет чужую', () => {
    const s = memoryStore()
    const noisy = s.scope('noisy', { max: 10 })
    const quiet = s.scope('quiet', { max: 10 })
    quiet.set('keep', 1, 1e6)
    for (let i = 0; i < 1_000; i++) noisy.set(`q${i}`, i, 1e6)
    expect(noisy.size).toBe(10)
    expect(quiet.get('keep')).toBe(1)
  })

  it('повторный scope отдаёт ту же область; scope("a:b") = scope("a").scope("b")', () => {
    const s = memoryStore()
    s.scope('a').scope('b').set('k', 1, 1e6)
    expect(s.scope('a:b').get('k')).toBe(1)
    expect(s.scope('a').scope('b').size).toBe(1)
  })

  it('то же имя с другим потолком — ошибка: два места делят одну область', () => {
    const s = memoryStore()
    s.scope('x', { max: 5 })
    expect(s.scope('x').size).toBe(0) // без max — та же область
    expect(() => s.scope('x', { max: 6 })).toThrow(/уже создана/)
    expect(() => s.scope('')).toThrow(TypeError)
  })

  it('промежуточная область из scope("a:b") принимает свой max позже, но только один раз', () => {
    const s = memoryStore()
    s.scope('a:b', { max: 5 })
    expect(() => s.scope('a', { max: 3 })).not.toThrow()
    expect(() => s.scope('a', { max: 4 })).toThrow(/уже создана/)
  })

  it('clear чистит свою область и вложенные, но не соседние', () => {
    const s = memoryStore()
    const a = s.scope('a')
    a.set('k', 1, 1e6)
    a.scope('inner').set('k', 2, 1e6)
    s.scope('b').set('k', 3, 1e6)
    a.clear()
    expect(a.get('k')).toBeUndefined()
    expect(a.scope('inner').get('k')).toBeUndefined()
    expect(s.scope('b').get('k')).toBe(3)
  })
})

describe('memoryStore: атомарные операции', () => {
  it('add занимает свободный ключ один раз; после срока ключ снова свободен', () => {
    const c = clock()
    const s = memoryStore({ now: c.now })
    expect(s.add('k', 'first', 100)).toBe(true)
    expect(s.add('k', 'second', 100)).toBe(false)
    expect(s.get('k')).toBe('first')
    c.tick(100)
    expect(s.add('k', 'third', 100)).toBe(true)
  })

  it('incr: окно фиксировано с первого вызова, следующие его не продлевают', () => {
    const c = clock()
    const s = memoryStore({ now: c.now })
    expect(s.incr('n', 100)).toBe(1)
    c.tick(60)
    expect(s.incr('n', 100)).toBe(2)
    c.tick(40)
    expect(s.incr('n', 100)).toBe(1) // окно истекло через 100 мс от ПЕРВОГО вызова
  })

  it('incr поверх не числа — ошибка, а не NaN', () => {
    const s = memoryStore()
    s.set('k', 'text', 1e6)
    expect(() => s.incr('k', 1e6)).toThrow(TypeError)
  })

  it('requireAtomic пропускает память и отказывает хранилищу без add/incr при подключении', () => {
    const plain: Store = {
      get: () => undefined, set: () => {}, delete: () => {}, clear: () => {},
      scope: () => plain,
    }
    expect(isAtomic(memoryStore())).toBe(true)
    expect(isAtomic(plain)).toBe(false)
    expect(() => requireAtomic(plain, 'бронь отправки')).toThrow(/бронь отправки: нужно хранилище/)
  })
})
