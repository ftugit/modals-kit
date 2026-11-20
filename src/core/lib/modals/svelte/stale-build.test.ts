// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStaleChunkError, reloadOnceForStale } from './stale-build.js'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('isStaleChunkError', () => {
  it('узнаёт устаревший чанк по текстам браузеров', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: /a.js'))).toBe(true)
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true)
  })

  it('сетевой обрыв и обычная ошибка — не stale', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isStaleChunkError(new Error('boom'))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
  })
})

describe('reloadOnceForStale', () => {
  it('перезагружает и не повторяет в пределах окна защиты', () => {
    const reload = vi.fn()
    expect(reloadOnceForStale(reload, 1_000)).toBe(true)
    expect(reloadOnceForStale(reload, 5_000)).toBe(false)
    expect(reloadOnceForStale(reload, 12_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
