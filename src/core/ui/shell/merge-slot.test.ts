import type { Snippet } from 'svelte'
import { describe, expect, it } from 'vitest'
import { PageState, applySlot, isMergeSlot, mergeSlot, renderMergeSlot, type SlotItem, type SlotValue } from './page.svelte'

const snippet = (() => {}) as Snippet

function item(id: number, extra: Partial<SlotItem> = {}): SlotItem {
  return { id, snippet, ...extra }
}

function ids(value: SlotValue | undefined): number[] {
  return renderMergeSlot(value).map((entry) => entry.id)
}

// Проверка публичного TypeScript-контракта, без исполнения.
if (false) {
  const marker = mergeSlot([])
  // @ts-expect-error Маркер не является массивом слотов.
  const array: SlotItem[] = marker
  const value: SlotValue = marker
  if (isMergeSlot(value)) value.entries
  renderMergeSlot(value).map((entry) => entry.id)
  void array
}

describe('applySlot', () => {
  it('mergeSlot возвращает маркер, а не массив', () => {
    const marker = mergeSlot([item(1)])
    expect(Array.isArray(marker)).toBe(false)
    expect(isMergeSlot(marker)).toBe(true)
    expect(renderMergeSlot(marker)).toEqual([item(1)])
  })

  it('нет следующего набора — база остаётся', () => {
    const base = [item(1)]
    expect(applySlot(base, undefined)).toBe(base)
  })

  it('голый массив заменяет ячейку и не является маркером', () => {
    const next = [item(2)]
    expect(applySlot([item(1)], next)).toBe(next)
    expect(isMergeSlot(next)).toBe(false)
    expect(renderMergeSlot(next)).toBe(next)
  })

  it('маркер не превращает offset в индекс', () => {
    const merged = applySlot([item(9)], mergeSlot([item(1), [0, item(2)]]))
    expect(isMergeSlot(merged)).toBe(true)
    expect(ids(merged)).toEqual([9, 1, 2])
  })
})

describe('renderMergeSlot', () => {
  it('999 последний, если остальные 1, 600 и 888, независимо от порядка', () => {
    const merged = mergeSlot([
      [999, item(9)],
      [888, item(8)],
      [1, item(1)],
      [600, item(6)],
    ])
    expect(ids(merged)).toEqual([1, 6, 8, 9])
  })

  it('тот же offset перезаписывается, новый дополняет', () => {
    const first = mergeSlot([
      [1, item(1)],
      [999, item(9)],
    ])
    const next = applySlot(first, mergeSlot([[1, item(11)], [600, item(6)]]))
    expect(ids(next)).toEqual([11, 6, 9])
  })
})

describe('PageState хранит offset до рендера', () => {
  it('шапка: поздний маленький offset встаёт перед ранним 999', () => {
    const profile = (() => {}) as Snippet
    const early = (() => {}) as Snippet
    const late = (() => {}) as Snippet
    const state = new PageState()
    state.registerHeaderSlot('top.end', profile, { offset: 999 })
    state.registerHeaderSlot('top.end', early, { offset: 888 })
    state.registerHeaderSlot('top.end', late, { offset: 1 })
    expect(isMergeSlot(state.header.top.end)).toBe(true)
    expect(renderMergeSlot(state.header.top.end).map((entry) => entry.snippet)).toEqual([late, early, profile])
  })

  it('sidebar: снятие соседа не сдвигает оставшийся offset', () => {
    const frame = (() => {}) as Snippet
    const form = (() => {}) as Snippet
    const extra = (() => {}) as Snippet
    const state = new PageState()
    state.registerSidebarSlot('middle', frame, { frame: true })
    const offForm = state.registerSidebarSlot('middle', form, { offset: 0 })
    state.registerSidebarSlot('middle', extra, { offset: 1 })
    expect(renderMergeSlot(state.sidebar.middle).map((entry) => entry.snippet)).toEqual([frame, form, extra])
    expect(renderMergeSlot(state.sidebar.middle)[0]?.frame).toBe(true)

    offForm()
    expect(renderMergeSlot(state.sidebar.middle).map((entry) => entry.snippet)).toEqual([frame, extra])
  })
})
