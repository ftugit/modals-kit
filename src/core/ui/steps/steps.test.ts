// Чистая алгебра цепочки ключей: первый сегмент уровня и остаток аддона.
import { describe, expect, it } from 'vitest'
import { segmentOf, suffixOf } from './keys.js'

describe('segmentOf', () => {
  it('первый сегмент цепочки; плоский ключ — сам', () => {
    expect(segmentOf('auth.restore')).toBe('auth')
    expect(segmentOf('auth.a.b')).toBe('auth')
    expect(segmentOf('blocked')).toBe('blocked')
  })

  it('нет ключа — нет сегмента', () => {
    expect(segmentOf(null)).toBeNull()
    expect(segmentOf('')).toBeNull()
  })
})

describe('suffixOf', () => {
  it('остаток после своего сегмента — ключ следующего уровня', () => {
    expect(suffixOf('auth.restore', 'auth')).toBe('restore')
    expect(suffixOf('auth.a.b', 'auth')).toBe('a.b') // глубже разбирает следующий уровень
  })

  it('ровно свой шаг — пустой остаток (внутри куста, под-ключа нет)', () => {
    expect(suffixOf('auth', 'auth')).toBe('')
  })

  it('чужой сегмент и похожий префикс — не наш куст', () => {
    expect(suffixOf('profile', 'auth')).toBeNull()
    expect(suffixOf('auth2.restore', 'auth')).toBeNull()
    expect(suffixOf(null, 'auth')).toBeNull()
  })
})
