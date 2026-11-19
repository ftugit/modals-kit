import { describe, expect, it } from 'vitest'
import {
  applyDriveFilters,
  driveFilterText,
  driveFilterValues,
  driveFiltersForm,
} from './filters-form.js'
import { DRIVE_FILTER_KEYS, driveListHref, type DriveListFilters } from './source.js'
import { driveFiltersRoute } from './routes.js'

describe('drive filters form', () => {
  it('умолчания снимаются из адреса', () => {
    const applied = applyDriveFilters({ size: 30, ord: 'name', type: 'all' })
    expect(applied).toMatchObject({ ok: true, pageSize: 30, patch: {} })
  })

  it('активные значения становятся patch-ключами extra', () => {
    const applied = applyDriveFilters({
      size: 50,
      ord: 'updated',
      type: 'folder',
      scope: 'global',
      from_date: '2026-01-01',
      to_date: '2026-01-31',
    })
    expect(applied).toMatchObject({
      ok: true,
      pageSize: 50,
      patch: {
        ord: 'updated',
        type: 'folder',
        scope: 'global',
        from: '2026-01-01',
        to: '2026-01-31',
      },
    })
  })

  it('неверный диапазон дат не применяется', () => {
    const applied = applyDriveFilters({
      size: 30,
      from_date: '2026-02-01',
      to_date: '2026-01-01',
    })
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.path).toBe('from_date')
  })

  it('неверный размер/сортировка/тип отклоняются', () => {
    expect(applyDriveFilters({ size: 1 }).ok).toBe(false)
    expect(applyDriveFilters({ size: 30, ord: 'nope' }).ok).toBe(false)
    expect(applyDriveFilters({ size: 30, type: 'nope' }).ok).toBe(false)
  })

  it('значения формы читаются из extra и pageSize', () => {
    expect(
      driveFilterValues(
        { ord: 'size', type: 'file', scope: 'global', from: '2026-03-01', to: '' },
        100,
      ),
    ).toEqual({
      ord: 'size',
      type: 'file',
      scope: 'global',
      size: 100,
      from_date: '2026-03-01',
      to_date: '',
    })
  })

  it('страница фильтров строит ссылку с адресом носителя', () => {
    expect(driveFiltersRoute.href({ from: '/drive?ord=size' })).toBe(
      '/drive/filters?from=%2Fdrive%3Ford%3Dsize',
    )
  })

  it('применённые фильтры попадают в адрес списка, страница — первая', () => {
    const applied = applyDriveFilters({
      size: 50,
      ord: 'updated',
      type: 'file',
      scope: 'global',
    })
    if (!applied.ok) throw new Error('ожидался успех')
    const filters: DriveListFilters = {
      search: null,
      sort: 'updated',
      type: 'file',
      scope: 'global',
      pageSize: applied.pageSize,
      from: null,
      to: null,
    }
    expect(driveListHref('/drive', filters, 1)).toBe(
      '/drive?drive.size=50&drive.ord=updated&drive.type=file&drive.scope=global',
    )
    expect(applied.patch).toEqual({ ord: 'updated', type: 'file', scope: 'global' })
  })

  it('ключи фильтров — extra, а не адресные', () => {
    expect(DRIVE_FILTER_KEYS).toEqual(['ord', 'type', 'scope', 'from', 'to'])
    expect(driveFilterText('type', 'folder')).toBe('Папки')
    expect(Object.keys(driveFiltersForm.byName)).toEqual(
      expect.arrayContaining(['ord', 'type', 'scope', 'size', 'from_date', 'to_date']),
    )
  })
})
