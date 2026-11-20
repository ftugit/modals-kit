import { describe, expect, it } from 'vitest'
import { applyHref, canApplyChosen, chosenSlice } from './picker.js'

describe('canApplyChosen', () => {
  it('только непустой набор, известный total и hidden=0', () => {
    expect(canApplyChosen({ pickedCount: 2, totalItems: 2, hiddenCount: 0 })).toBe(true)
    expect(canApplyChosen({ pickedCount: 0, totalItems: 0, hiddenCount: 0 })).toBe(false)
    expect(canApplyChosen({ pickedCount: 2, totalItems: null, hiddenCount: null })).toBe(false)
    expect(canApplyChosen({ pickedCount: 2, totalItems: 2, hiddenCount: 1 })).toBe(false)
    expect(canApplyChosen({ pickedCount: 2, totalItems: 3, hiddenCount: -1 })).toBe(false)
    expect(canApplyChosen({ pickedCount: 2, totalItems: 2, hiddenCount: 0.5 })).toBe(false)
  })
})

describe('chosenSlice', () => {
  it('пустой набор — явный none', () => {
    expect(chosenSlice([])).toEqual({ 'drive.ids': 'none' })
    expect(chosenSlice(['a', 'b'])).toEqual({ 'drive.ids': 'a,b' })
  })
})

describe('applyHref', () => {
  it('single: id заменяет param, корень удаляет', () => {
    expect(applyHref('/drive/move?x=1', 'target_id', { mode: 'single', id: 'u1' })).toBe(
      '/drive/move?x=1&target_id=u1',
    )
    expect(applyHref('/drive/move?x=1&target_id=old', 'target_id', { mode: 'single', id: null })).toBe(
      '/drive/move?x=1',
    )
  })

  it('multiple: список через запятую, пустой набор не применяется', () => {
    expect(applyHref('/drive/share', 'ids', { mode: 'multiple', ids: ['a', 'b'] })).toBe(
      '/drive/share?ids=a%2Cb',
    )
    expect(applyHref('/drive/share', 'ids', { mode: 'multiple', ids: [] })).toBeNull()
  })
})
