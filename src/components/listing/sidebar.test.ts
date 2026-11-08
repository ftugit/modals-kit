import { describe, expect, it } from 'vitest'
import { filtersUseSidebar } from './sidebar'

describe('filtersUseSidebar', () => {
  it('без зоны или на узком экране — кнопка', () => {
    expect(filtersUseSidebar(undefined, false)).toBe(false)
    expect(filtersUseSidebar('middle', true)).toBe(false)
    expect(filtersUseSidebar('auto', true)).toBe(false)
  })

  it('зона и ПК — sidebar', () => {
    expect(filtersUseSidebar('middle', false)).toBe(true)
    expect(filtersUseSidebar('auto', false)).toBe(true)
  })
})
