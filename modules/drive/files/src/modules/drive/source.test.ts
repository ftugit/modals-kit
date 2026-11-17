import { describe, expect, it } from 'vitest'
import {
  DRIVE_PAGE_DEFAULT,
  driveDateRange,
  driveFilterQuery,
  driveFiltersDirty,
  driveListHref,
  parseDriveFilters,
} from './source.js'

const params = (query: string) => new URLSearchParams(query)

describe('фильтры списка «Диска»', () => {
  it('пустой адрес — умолчания', () => {
    expect(parseDriveFilters(params(''))).toEqual({
      search: null,
      sort: 'name',
      type: 'all',
      starred: false,
      pageSize: DRIVE_PAGE_DEFAULT,
      from: null,
      to: null,
    })
  })

  it('читает активные фильтры и отбрасывает мусор', () => {
    const filters = parseDriveFilters(
      params('drive.q=%20отчёт%20&drive.ord=size&drive.type=folder&drive.starred=1&drive.size=100&drive.from=2026-01-01&drive.to=2026-02-01'),
    )
    expect(filters).toEqual({
      search: 'отчёт',
      sort: 'size',
      type: 'folder',
      starred: true,
      pageSize: 100,
      from: '2026-01-01',
      to: '2026-02-01',
    })
    expect(
      parseDriveFilters(
        params('drive.ord=bad&drive.type=bad&drive.size=33&drive.from=01.01.2026&drive.to=nope'),
      ),
    ).toMatchObject({ sort: 'name', type: 'all', pageSize: 30, from: null, to: null })
  })

  it('курсор не фильтр: разбор его не читает, сборка добавляет отдельно', () => {
    const filters = parseDriveFilters(params('drive.q=а&drive.after=old-cursor'))
    expect(driveFilterQuery(filters)).toBe('drive.q=%D0%B0')
    expect(driveListHref('/drive', filters)).toBe('/drive?drive.q=%D0%B0')
    expect(driveListHref('/drive', filters, 'next')).toBe('/drive?drive.q=%D0%B0&drive.after=next')
    expect(driveFiltersDirty(filters)).toBe(true)
    expect(driveFiltersDirty(parseDriveFilters(params('')))).toBe(false)
  })

  it('даты режутся в UTC: от начала from до конца to', () => {
    expect(driveDateRange({ from: '2026-01-01', to: '2026-01-31' })).toEqual({
      from: Date.parse('2026-01-01T00:00:00.000Z'),
      to: Date.parse('2026-01-31T23:59:59.999Z'),
    })
    expect(driveDateRange({ from: null, to: null })).toEqual({ from: null, to: null })
  })
})
