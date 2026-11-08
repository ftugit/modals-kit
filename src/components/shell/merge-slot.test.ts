import type { Snippet } from 'svelte'
import { describe, expect, it } from 'vitest'
import { PageState, applySlot, isMergeSlot, mergeSlot, type SlotItem } from './page.svelte'

const snippet = (() => {}) as Snippet

function item(id: number, extra: Partial<SlotItem> = {}): SlotItem {
  return { id, snippet, ...extra }
}

describe('applySlot', () => {
  it('нет следующего набора — база остаётся', () => {
    const base = [item(1)]
    expect(applySlot(base, undefined)).toBe(base)
  })

  it('голый массив заменяет ячейку', () => {
    const next = [item(2)]
    expect(applySlot([item(1)], next)).toBe(next)
    expect(isMergeSlot(next)).toBe(false)
  })

  it('маркер дописывает, пара вставляет по offset', () => {
    const merged = mergeSlot([item(1), [0, item(2)]])
    expect(isMergeSlot(merged)).toBe(true)
    expect(applySlot([item(9)], merged)?.map((entry) => entry.id)).toEqual([2, 9, 1])
  })

  it('offset за краем дописывает, отрицательный встаёт в начало', () => {
    expect(applySlot([item(1)], mergeSlot([[5, item(2)]]))?.map((entry) => entry.id)).toEqual([1, 2])
    expect(applySlot([item(1)], mergeSlot([[-3, item(2)]]))?.map((entry) => entry.id)).toEqual([2, 1])
  })
})

describe('PageState складывает offset заново', () => {
  it('шапка: снятие соседа возвращает оставшихся на их offset', () => {
    const a = (() => {}) as Snippet
    const b = (() => {}) as Snippet
    const c = (() => {}) as Snippet
    const state = new PageState()
    state.registerHeaderSlot('middle.start', a)
    const offB = state.registerHeaderSlot('middle.start', b, { offset: 0 })
    state.registerHeaderSlot('middle.start', c, { offset: 1 })
    expect(state.header.middle.start.map((entry) => entry.snippet)).toEqual([b, c, a])

    offB()
    expect(state.header.middle.start.map((entry) => entry.snippet)).toEqual([a, c])
  })

  it('sidebar: та же функция, каркас остаётся каркасом', () => {
    const frame = (() => {}) as Snippet
    const form = (() => {}) as Snippet
    const extra = (() => {}) as Snippet
    const state = new PageState()
    state.registerSidebarSlot('middle', frame, { frame: true })
    const offForm = state.registerSidebarSlot('middle', form, { offset: 0 })
    state.registerSidebarSlot('middle', extra, { offset: 1 })
    expect(state.sidebar.middle.map((entry) => entry.snippet)).toEqual([form, extra, frame])
    expect(state.sidebar.middle[2]?.frame).toBe(true)

    offForm()
    expect(state.sidebar.middle.map((entry) => entry.snippet)).toEqual([frame, extra])
    expect(state.sidebar.middle[0]?.frame).toBe(true)
  })
})
