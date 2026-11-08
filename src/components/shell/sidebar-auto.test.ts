import type { Snippet } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageState, placeSidebarSlots, renderMergeSlot, type SlotItem } from './page.svelte'

const snippet = (() => {}) as Snippet

function item(id: number, extra: Partial<SlotItem> = {}): SlotItem {
  return { id, snippet, ...extra }
}

function ids(zone: SlotItem[]): number[] {
  return renderMergeSlot(zone).map((entry) => entry.id)
}

describe('placeSidebarSlots', () => {
  it('без занятой зоны auto не ставит и жалуется', () => {
    const placed = placeSidebarSlots(
      { top: [item(1, { frame: true })], middle: [], bottom: [] },
      [item(2)],
    )
    expect(ids(placed.slots.top)).toEqual([1])
    expect(placed.slots.middle).toEqual([])
    expect(placed.slots.bottom).toEqual([])
    expect(placed.warn).toBe('[sidebar] auto: нет занятого слота, блок не показан')
  })

  it('занят только низ — auto идёт сверху вниз по свободным', () => {
    const placed = placeSidebarSlots(
      { top: [], middle: [], bottom: [item(1)] },
      [item(2), item(3)],
    )
    expect(ids(placed.slots.top)).toEqual([2])
    expect(ids(placed.slots.middle)).toEqual([3])
    expect(ids(placed.slots.bottom)).toEqual([1])
    expect(placed.warn).toBeNull()
  })

  it('занят центр — auto берёт верх, затем низ', () => {
    const placed = placeSidebarSlots(
      { top: [item(9, { frame: true })], middle: [item(1)], bottom: [] },
      [item(2), item(3)],
    )
    expect(ids(placed.slots.top)).toEqual([9, 2])
    expect(ids(placed.slots.middle)).toEqual([1])
    expect(ids(placed.slots.bottom)).toEqual([3])
    expect(placed.warn).toBeNull()
  })

  it('offset auto остаётся числом: 0 не перепрыгивает слот без числа', () => {
    const placed = placeSidebarSlots(
      { top: [item(9, { frame: true })], middle: [item(1)], bottom: [] },
      [item(2, { offset: 0 })],
    )
    expect(ids(placed.slots.top)).toEqual([9, 2])
    expect(ids(placed.slots.middle)).toEqual([1])
    expect(placed.warn).toBeNull()
  })

  it('свободной зоны нет — уже поставленное остаётся, лишний auto молчит в вёрстке', () => {
    const placed = placeSidebarSlots(
      { top: [item(1)], middle: [item(2)], bottom: [item(3)] },
      [item(4)],
    )
    expect(ids(placed.slots.top)).toEqual([1])
    expect(placed.warn).toBe('[sidebar] auto: свободной зоны нет, блок не показан')
  })
})

describe('PageState sidebar auto', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('снятие явной зоны убирает auto и пишет в консоль браузера', async () => {
    vi.stubGlobal('window', globalThis)
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = new PageState()
    const offBottom = state.registerSidebarSlot('bottom', snippet)
    const offAuto = state.registerSidebarSlot('sidebar.auto', snippet)
    const top = renderMergeSlot(state.sidebar.top)
    const bottom = renderMergeSlot(state.sidebar.bottom)
    expect(top).toHaveLength(1)
    expect(top[0]?.auto).toBe(true)
    expect(bottom[0]?.auto).toBeUndefined()
    expect(bottom).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()

    offBottom()
    expect(renderMergeSlot(state.sidebar.top)).toHaveLength(0)
    expect(renderMergeSlot(state.sidebar.middle)).toHaveLength(0)
    expect(renderMergeSlot(state.sidebar.bottom)).toHaveLength(0)
    await vi.runAllTimersAsync()
    expect(warn).toHaveBeenCalledWith('[sidebar] auto: нет занятого слота, блок не показан')
    offAuto()
  })

  it('каркас не считается занятым, явная зона — считается', () => {
    const state = new PageState()
    state.registerSidebarSlot('top', snippet, { frame: true })
    state.registerSidebarSlot('middle', snippet, { frame: true })
    state.registerSidebarSlot('bottom', snippet, { frame: true })
    state.registerSidebarSlot('auto', snippet)
    expect(renderMergeSlot(state.sidebar.top)).toHaveLength(1)
    expect(renderMergeSlot(state.sidebar.middle)).toHaveLength(1)
    expect(renderMergeSlot(state.sidebar.bottom)).toHaveLength(1)

    state.registerSidebarSlot('bottom', snippet)
    state.registerSidebarSlot('auto', snippet)
    expect(renderMergeSlot(state.sidebar.top)).toHaveLength(2)
    expect(renderMergeSlot(state.sidebar.middle)).toHaveLength(2)
    expect(renderMergeSlot(state.sidebar.bottom)).toHaveLength(2)
  })
})
