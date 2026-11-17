// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { decideBlockClaim, reclaimBlock, type FilterBlockEntry } from './filter-block-store.js'

const entry = (element: HTMLElement, label = 'Порядок', home = document.createElement('div')): FilterBlockEntry => ({
  key: 'ord', label, element, home,
})
afterEach(() => document.body.replaceChildren())

describe('общие правила реестра блоков фильтров', () => {
  it('не заменяет живой чужой блок и различает режимы для отсоединённого', () => {
    const oldNode = document.createElement('div')
    const current = entry(oldNode)
    const replacement = entry(document.createElement('div'))
    expect(decideBlockClaim(undefined, current, false)).toBe('replace')
    expect(decideBlockClaim(current, replacement, false)).toBe('reject')
    expect(decideBlockClaim(current, replacement, true)).toBe('replace')
    document.body.append(oldNode)
    expect(decideBlockClaim(current, replacement, true)).toBe('reject')
    expect(decideBlockClaim(current, current, false)).toBe('keep')
    expect(decideBlockClaim(current, { ...current, label: 'Новое имя' }, false)).toBe('replace')
  })

  it('возвращает открытый узел в свой дом и не затрагивает остальные', () => {
    const node = document.createElement('div')
    const other = document.createElement('div')
    const slot = document.createElement('div')
    const home = document.createElement('div')
    slot.append(node, other)
    reclaimBlock({ ord: entry(node, 'Порядок', home) }, 'ord')
    expect(node.parentElement).toBe(home)
    expect(other.parentElement).toBe(slot)
    reclaimBlock({}, 'missing')
  })
})
