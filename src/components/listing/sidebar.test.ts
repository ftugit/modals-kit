import { describe, expect, it } from 'vitest'
import { FILTER_SIDEBAR_OFFSET, filtersUseSidebar } from './sidebar'

describe('filtersUseSidebar', () => {
  it('без зоны слота нет', () => {
    expect(filtersUseSidebar(undefined)).toBe(false)
  })

  it('зона есть — слот, ширина не аргумент', () => {
    expect(filtersUseSidebar('middle')).toBe(true)
    expect(filtersUseSidebar('top')).toBe(true)
    expect(filtersUseSidebar('bottom')).toBe(true)
    expect(filtersUseSidebar('auto')).toBe(true)
  })

  it('базовый offset формы — 999', () => {
    expect(FILTER_SIDEBAR_OFFSET).toBe(999)
  })
})
