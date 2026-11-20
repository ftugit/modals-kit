// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissNotice, noticeQueue, notify } from './notice.svelte.js'

afterEach(() => {
  vi.useRealTimers()
  for (const item of [...noticeQueue.items]) dismissNotice(item.id)
})

describe('notice queue', () => {
  it('не дублирует одинаковый активный текст', () => {
    const first = notify('Готово')
    const second = notify('Готово')
    expect(first).toBe(second)
    expect(noticeQueue.items.filter((item) => item.text === 'Готово')).toHaveLength(1)
  })

  it('автоскрытие по таймауту и ручное снятие', () => {
    vi.useFakeTimers()
    const id = notify('Удалено', { timeout: 1000 })
    expect(noticeQueue.items.some((item) => item.id === id)).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(noticeQueue.items.some((item) => item.id === id)).toBe(false)
    const manual = notify('Вручную', { timeout: 0 })
    expect(manual).not.toBeNull()
    dismissNotice(manual!)
    expect(noticeQueue.items.some((item) => item.id === manual)).toBe(false)
  })

  it('дедупликация различает тон', () => {
    const a = notify('Ошибка', { tone: 'error' })
    const b = notify('Ошибка', { tone: 'success' })
    expect(a).not.toBe(b)
    expect(noticeQueue.items.filter((item) => item.text === 'Ошибка')).toHaveLength(2)
  })

  it('повтор продлевает таймер, а не игнорируется', () => {
    vi.useFakeTimers()
    const id = notify('Долго', { timeout: 1000 })
    vi.advanceTimersByTime(800)
    notify('Долго', { timeout: 1000 })
    vi.advanceTimersByTime(800)
    expect(noticeQueue.items.some((item) => item.id === id)).toBe(true)
    vi.advanceTimersByTime(300)
    expect(noticeQueue.items.some((item) => item.id === id)).toBe(false)
  })

  it('держит не больше трёх плашек — старая вытесняется', () => {
    notify('a')
    notify('b')
    notify('c')
    notify('d')
    expect(noticeQueue.items.map((item) => item.text)).toEqual(['b', 'c', 'd'])
  })
})
