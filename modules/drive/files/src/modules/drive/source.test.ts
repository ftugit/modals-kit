import { describe, expect, it } from 'vitest'
import {
  DRIVE_IDS_MAX,
  DRIVE_IDS_NONE,
  DRIVE_PAGE_DEFAULT,
  driveDateRange,
  driveFilterExtras,
  driveFiltersDirty,
  driveIdentityExtra,
  driveIdentityPath,
  driveListHref,
  driveSnapshot,
  parseDriveFilters,
  parseDriveIdentity,
  parseDriveIds,
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
      params(
        'drive.q=%20отчёт%20&drive.ord=size&drive.type=folder&drive.starred=1&drive.size=100&drive.from=2026-01-01&drive.to=2026-02-01',
      ),
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

  it('умолчания в адрес не пишутся, страница — ключ пагинатора', () => {
    const filters = parseDriveFilters(params('drive.q=а'))
    expect(driveFilterExtras(filters)).toEqual({ q: 'а' })
    expect(driveListHref('/drive', filters)).toBe('/drive?drive.q=%D0%B0')
    expect(driveListHref('/drive', filters, 2)).toBe('/drive?drive=2&drive.q=%D0%B0')
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

describe('срез выбранных id и личность списка', () => {
  const one = '11111111-1111-4111-8111-111111111111'
  const two = '22222222-2222-4222-8222-222222222222'

  it('отсутствие ключа — без ограничения, none — пустой набор', () => {
    expect(parseDriveIds(null)).toBeNull()
    expect(parseDriveIds('')).toEqual([])
    expect(parseDriveIds(DRIVE_IDS_NONE)).toEqual([])
  })

  it('UUID списком: мусор отброшен, повтор не задваивает', () => {
    expect(parseDriveIds(`${one},${two},${one},bad`)).toEqual([one, two])
    expect(driveFilterExtras(parseDriveFilters(params('')), [one])).toEqual({ ids: one })
    expect(driveFilterExtras(parseDriveFilters(params('')), [])).toEqual({ ids: DRIVE_IDS_NONE })
  })

  it('набор ограничен потолком: лишние UUID за границей не читаются', () => {
    const many = Array.from(
      { length: DRIVE_IDS_MAX + 50 },
      (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
    )
    const parsed = parseDriveIds(many.join(','))
    expect(parsed).toHaveLength(DRIVE_IDS_MAX)
    expect(parsed?.[0]).toBe(many[0])
    expect(parsed?.at(-1)).toBe(many[DRIVE_IDS_MAX - 1])
    // Повтор не тратит место в потолке.
    const repeated = parseDriveIds([...many.slice(0, DRIVE_IDS_MAX), many[0]].join(','))
    expect(repeated).toHaveLength(DRIVE_IDS_MAX)
  })

  it('личность списка переживает снапшот и восстанавливает адрес', () => {
    expect(parseDriveIdentity('folder:' + one)).toEqual({ kind: 'folder', id: one })
    expect(parseDriveIdentity('trash')).toEqual({ kind: 'trash' })
    expect(parseDriveIdentity('что-то')).toEqual({ kind: 'root' })
    expect(driveIdentityPath({ kind: 'folder', id: one })).toBe(`/drive/${one}`)
    expect(driveIdentityPath({ kind: 'trash' })).toBe('/drive/trash')
    expect(driveIdentityExtra({ kind: 'root' })).toBe('root')
  })

  it('снапшот несёт личность и активные ключи, страница — одна', () => {
    const snapshot = driveSnapshot(
      {
        items: [],
        page: 2,
        pageSize: 30,
        total: 31,
        totalPages: 2,
        hasNext: false,
        hasPrev: true,
      },
      'root',
      { q: 'а' },
    )
    expect(snapshot.extra).toEqual({ _list: 'root', q: 'а' })
    expect(snapshot.loadedPages).toEqual([2])
    expect(snapshot.totalItems).toBe(31)
    expect(snapshot.hasPrev).toBe(true)
  })
})
