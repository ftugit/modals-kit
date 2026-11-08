import { describe, expect, it } from 'vitest'
import { applySeedFilters } from './filters-form.js'

const caps = { canSeeDeleted: true, canSeeNickname: true }

describe('applySeedFilters', () => {
  it('умолчания не пишет, размер отдаёт отдельно', () => {
    const applied = applySeedFilters(
      { ord: 'created-desc', state: 'active', cfrom: '', cto: '', dfrom: '', dto: '', nick: false, size: 30 },
      caps,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.pageSize).toBe(30)
    expect(applied.patch).toEqual({
      ord: undefined,
      state: undefined,
      cfrom: undefined,
      cto: undefined,
      dfrom: undefined,
      dto: undefined,
      nick: undefined,
    })
  })

  it('диапазон «с» позже «по» — отказ, не молчаливый сброс', () => {
    const applied = applySeedFilters(
      {
        ord: 'created-desc',
        state: 'active',
        cfrom: '2024-02-02T10:00',
        cto: '2024-01-01T10:00',
        dfrom: '',
        dto: '',
        nick: false,
        size: 40,
      },
      caps,
    )
    expect(applied).toMatchObject({ ok: false, path: 'cfrom', code: 'filters.range' })
  })

  it('без права на удалённые даты удаления не применяет', () => {
    const applied = applySeedFilters(
      {
        ord: 'deleted-desc',
        state: 'deleted',
        cfrom: '',
        cto: '',
        dfrom: '2024-01-01T00:00',
        dto: '',
        nick: true,
        size: 40,
      },
      { canSeeDeleted: false, canSeeNickname: false },
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.patch.ord).toBeUndefined()
    expect(applied.patch.state).toBeUndefined()
    expect(applied.patch.dfrom).toBeUndefined()
    expect(applied.patch.nick).toBeUndefined()
    expect(applied.pageSize).toBe(40)
  })
})
