import { describe, expect, it } from 'vitest'
import type { DriveTreeNode } from './types.js'
import { canMove, collectSubtreeIds, collectTrashedIds, restorePlan } from './tree.js'

function node(over: Partial<DriveTreeNode> & { id: string }): DriveTreeNode {
  return {
    ownerId: 'o1',
    parentId: null,
    kind: 'folder',
    trashedAt: null,
    trashedFrom: null,
    ...over,
  }
}

describe('дерево «Диска»', () => {
  it('собирает поддерево в ширину, включая корень', () => {
    const items = [
      node({ id: 'a' }),
      node({ id: 'b', parentId: 'a' }),
      node({ id: 'c', parentId: 'b' }),
      node({ id: 'd', parentId: 'a' }),
      node({ id: 'e' }),
    ]
    expect(collectSubtreeIds(items, 'a')).toEqual(['a', 'b', 'd', 'c'])
    expect(collectSubtreeIds(items, 'b')).toEqual(['b', 'c'])
    expect(collectSubtreeIds(items, 'e')).toEqual(['e'])
  })

  it('не зацикливается на битых данных', () => {
    const items = [
      node({ id: 'a', parentId: 'b' }),
      node({ id: 'b', parentId: 'a' }),
    ]
    expect(collectSubtreeIds(items, 'a')).toEqual(['a', 'b'])
  })

  it('неизвестный корень — пустое поддерево', () => {
    expect(collectSubtreeIds([node({ id: 'a' })], 'nope')).toEqual([])
  })

  it('скрывает детей удалённой папки, но не живых соседей', () => {
    const trashed = new Date('2026-01-02T03:04:05Z')
    const items = [
      node({ id: 'f', trashedAt: trashed }),
      node({ id: 'c', parentId: 'f' }),
      node({ id: 'g', parentId: 'c', kind: 'file' }),
      node({ id: 'live' }),
      node({ id: 'live-child', parentId: 'live' }),
    ]
    expect(collectTrashedIds(items).sort()).toEqual(['c', 'g'])
  })

  it('не считает корзиной сам удалённый узел', () => {
    const items = [node({ id: 'f', trashedAt: new Date() })]
    expect(collectTrashedIds(items)).toEqual([])
  })

  it('разрешает перенос в живую папку того же владельца', () => {
    const file = node({ id: 'n', kind: 'file', parentId: 'a' })
    const target = node({ id: 'b' })
    expect(canMove(file, target, collectSubtreeIds([file, target], 'n'))).toBeNull()
  })

  it('запрещает перенос в себя, в файл и к чужому владельцу', () => {
    const file = node({ id: 'n', kind: 'file' })
    expect(canMove(file, file, ['n'])).toBe('self')
    expect(canMove(file, node({ id: 'f', kind: 'file' }), ['n'])).toBe('not-folder')
    expect(canMove(file, node({ id: 'x', ownerId: 'o2' }), ['n'])).toBe('foreign-owner')
  })

  it('запрещает перенос в собственное поддерево и в корзину', () => {
    const folder = node({ id: 'a' })
    const child = node({ id: 'b', parentId: 'a' })
    expect(canMove(folder, child, collectSubtreeIds([folder, child], 'a'))).toBe('cycle')
    expect(canMove(folder, node({ id: 't', trashedAt: new Date() }), ['a'])).toBe('trashed-target')
  })

  it('возвращает узел к прежнему родителю, а без него — в корень', () => {
    expect(restorePlan({ trashedFrom: 'p' }, true)).toEqual({ parentId: 'p' })
    expect(restorePlan({ trashedFrom: 'p' }, false)).toEqual({ parentId: null })
    expect(restorePlan({ trashedFrom: null }, true)).toEqual({ parentId: null })
  })
})
