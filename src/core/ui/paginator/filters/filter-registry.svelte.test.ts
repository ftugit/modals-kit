// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import Probe from './FilterRegistryProbe.test.svelte'
import type { FilterBlocksContext, FilterBlockEntry } from './filter-blocks.svelte.js'
import { claimFilterList, filterLists, releaseFilterList, resetFilterList, setFilterListOpen, reclaimFilterList } from './filter-registry.svelte.js'

afterEach(() => { document.body.replaceChildren(); resetFilterList('probe') })

describe('адаптеры реестра фильтров', () => {
  it('сохраняют собственные правила пересоздания и игнорируют чужое освобождение', async () => {
    let panel!: FilterBlocksContext
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(Probe, { target, props: { capture: (value) => { panel = value } } })
    flushSync()
    try {
      const home = document.createElement('div')
      const a = document.createElement('div')
      const b = document.createElement('div')
      const first: FilterBlockEntry = { key: 'ord', label: 'Порядок', element: a, home }
      const next: FilterBlockEntry = { ...first, element: b }
      document.body.append(home)
      home.append(a)
      expect(panel.claim(first)).toBe(true)
      expect(claimFilterList('probe', first)).toBe(true)
      expect(panel.claim(next)).toBe(false)
      expect(claimFilterList('probe', next)).toBe(false)
      a.remove()
      expect(panel.claim(next)).toBe(false)
      expect(claimFilterList('probe', next)).toBe(true)
      releaseFilterList('probe', 'ord', a)
      expect(filterLists.probe.blocks.ord.element).toBe(b)
      panel.release('ord', b)
      expect(panel.blocks.ord.element).toBe(a)
      const slot = document.createElement('div')
      slot.append(b)
      setFilterListOpen('probe', 'ord')
      reclaimFilterList('probe')
      expect(b.parentElement).toBe(home)
      panel.release('ord', a)
      expect(panel.blocks.ord).toBeUndefined()
    } finally { await unmount(app) }
  })
})
