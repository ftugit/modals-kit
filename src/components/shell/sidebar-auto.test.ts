import type { Snippet } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageState, placeSidebarSlots, type SlotItem } from './page.svelte'

const snippet = (() => {}) as Snippet

function item(id: number, extra: Partial<SlotItem> = {}): SlotItem {
  return { id, snippet, ...extra }
}

describe('placeSidebarSlots', () => {
  it('без занятой зоны auto не ставит и жалуется', () => {
    const placed = placeSidebarSlots(
      { top: [item(1, { frame: true })], middle: [], bottom: [] },
      [item(2)],
    )
    expect(placed.slots.top.map((entry) => entry.id)).toEqual([1])
    expect(placed.slots.middle).toEqual([])
    expect(placed.slots.bottom).toEqual([])
    expect(placed.warn).toBe('[sidebar] auto: нет занятого слота, блок не показан')
  })

  it('занят только низ — auto идёт сверху вниз по свободным', () => {
    const placed = placeSidebarSlots(
      { top: [], middle: [], bottom: [item(1)] },
      [item(2), item(3)],
    )
    expect(placed.slots.top.map((entry) => entry.id)).toEqual([2])
    expect(placed.slots.middle.map((entry) => entry.id)).toEqual([3])
    expect(placed.slots.bottom.map((entry) => entry.id)).toEqual([1])
    expect(placed.warn).toBeNull()
  })

  it('занят центр — auto берёт верх, затем низ', () => {
    const placed = placeSidebarSlots(
      { top: [item(9, { frame: true })], middle: [item(1)], bottom: [] },
      [item(2), item(3)],
    )
    expect(placed.slots.top.map((entry) => entry.id)).toEqual([9, 2])
    expect(placed.slots.middle.map((entry) => entry.id)).toEqual([1])
    expect(placed.slots.bottom.map((entry) => entry.id)).toEqual([3])
    expect(placed.warn).toBeNull()
  })

  it('offset auto вставляет в выбранную свободную зону, не дописывает вслепую', () => {
    const placed = placeSidebarSlots(
      { top: [item(9, { frame: true })], middle: [item(1)], bottom: [] },
      [item(2, { offset: 0 })],
    )
    expect(placed.slots.top.map((entry) => entry.id)).toEqual([2, 9])
    expect(placed.slots.middle.map((entry) => entry.id)).toEqual([1])
    expect(placed.warn).toBeNull()
  })

  it('свободной зоны нет — уже поставленное остаётся, лишний auto молчит в вёрстке', () => {
    const placed = placeSidebarSlots(
      { top: [item(1)], middle: [item(2)], bottom: [item(3)] },
      [item(4)],
    )
    expect(placed.slots.top.map((entry) => entry.id)).toEqual([1])
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
    expect(state.sidebar.top).toHaveLength(1)
    expect(state.sidebar.top[0]?.auto).toBe(true)
    expect(state.sidebar.bottom[0]?.auto).toBeUndefined()
    expect(state.sidebar.bottom).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()

    offBottom()
    expect(state.sidebar.top).toHaveLength(0)
    expect(state.sidebar.middle).toHaveLength(0)
    expect(state.sidebar.bottom).toHaveLength(0)
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
    expect(state.sidebar.top).toHaveLength(1)
    expect(state.sidebar.middle).toHaveLength(1)
    expect(state.sidebar.bottom).toHaveLength(1)

    state.registerSidebarSlot('bottom', snippet)
    state.registerSidebarSlot('auto', snippet)
    expect(state.sidebar.top).toHaveLength(2)
    expect(state.sidebar.middle).toHaveLength(2)
    expect(state.sidebar.bottom).toHaveLength(2)
  })
})
