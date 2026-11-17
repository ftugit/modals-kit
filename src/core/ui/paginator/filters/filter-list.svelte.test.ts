// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './FilterList.test.svelte'
import { filterLists, resetFilterList, setFilterListOpen, setFilterListSlot } from './filter-registry.svelte.js'

describe('реестр блоков по имени списка', () => {
  afterEach(() => {
    document.body.replaceChildren()
    resetFilterList('seed-users')
  })

  it('блок виден по имени, не через родителя списка', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Harness, { target })
    flushSync()
    await tick()
    flushSync()
    try {
      const list = filterLists['seed-users']
      expect(list?.blocks.ord?.label).toBe('Порядок')
      expect(list?.blocks.ord?.element.isConnected).toBe(true)
      expect(target.querySelector('[data-filter-block-state="mixed"]')).not.toBeNull()
      expect(list?.blocks.size).toBeUndefined()

      const slot = document.createElement('div')
      document.body.appendChild(slot)
      setFilterListSlot('seed-users', slot)
      setFilterListOpen('seed-users', 'ord')
      flushSync()
      await tick()
      flushSync()
      expect(slot.querySelector('[name="ord"]')).not.toBeNull()
      expect(target.querySelector('#seed-form')?.contains(slot.querySelector('[name="ord"]') ?? null)).toBe(false)
    } finally {
      await unmount(app)
    }
  })
})
