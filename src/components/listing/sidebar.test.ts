import { describe, expect, it } from 'vitest'
import { filtersUseSidebar } from './sidebar'

describe('filtersUseSidebar', () => {
  it('без зоны, до чтения ширины и на узком экране остаётся кнопка', () => {
    expect(filtersUseSidebar(undefined, true, false)).toBe(false)
    expect(filtersUseSidebar('middle', false, false)).toBe(false)
    expect(filtersUseSidebar('middle', true, true)).toBe(false)
    expect(filtersUseSidebar('auto', true, true)).toBe(false)
  })

  it('зона и известный широкий экран — sidebar', () => {
    expect(filtersUseSidebar('middle', true, false)).toBe(true)
    expect(filtersUseSidebar('auto', true, false)).toBe(true)
  })
})
