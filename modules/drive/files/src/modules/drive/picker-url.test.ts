import { describe, expect, it } from 'vitest'
import {
  DRIVE_IDS_URL_MAX,
  normalizePickerState,
  parseDriveIdsUrl,
  parseFilterOwner,
  parsePickerMode,
  parsePickerStep,
  pickerFrom,
  pickerHref,
  type DrivePickerState,
} from './picker-url.js'

const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')

const state = (patch: Partial<DrivePickerState> = {}): DrivePickerState => ({
  from: '/drive/move?node_id=x',
  param: 'target_id',
  kind: 'folder',
  folderId: null,
  mode: 'multiple',
  step: 'pick',
  picked: [],
  filters: { q: null, type: 'all', from: null, to: null },
  filterOwner: null,
  ...patch,
})

describe('parseDriveIdsUrl', () => {
  it('null — без среза, пусто/none — пустой набор', () => {
    expect(parseDriveIdsUrl(null)).toEqual({ ids: null, overflow: false })
    expect(parseDriveIdsUrl('')).toEqual({ ids: [], overflow: false })
    expect(parseDriveIdsUrl('none')).toEqual({ ids: [], overflow: false })
  })

  it('100 — ок, 101 — overflow без усечения', () => {
    const ok = Array.from({ length: DRIVE_IDS_URL_MAX }, (_, i) => uuid(i + 1))
    expect(parseDriveIdsUrl(ok.join(','))).toEqual({ ids: ok, overflow: false })
    const over = [...ok, uuid(999)].join(',')
    expect(parseDriveIdsUrl(over)).toEqual({ ids: [], overflow: true })
  })

  it('дубликаты не тратят лимит, мусор отбрасывается', () => {
    const dup = [uuid(1), uuid(1), 'oops', uuid(2)].join(',')
    expect(parseDriveIdsUrl(dup).ids).toEqual([uuid(1), uuid(2)])
  })

  it('строка длиннее 4000 — overflow', () => {
    expect(parseDriveIdsUrl('x'.repeat(4001))).toEqual({ ids: [], overflow: true })
  })
})

describe('нормализация', () => {
  it('single не держит шаг, набор и маркер', () => {
    const next = normalizePickerState(state({ mode: 'single', step: 'chosen', picked: [uuid(1)], filterOwner: 'chosen' }))
    expect(next.step).toBe('pick')
    expect(next.picked).toEqual([])
    expect(next.filterOwner).toBeNull()
  })

  it('неизвестные значения отбрасываются без 400', () => {
    expect(parsePickerMode('SINGLE')).toBe('single')
    expect(parsePickerStep('CHOSEN')).toBe('pick')
    expect(parseFilterOwner('true')).toBeNull()
    expect(parseFilterOwner('chosen')).toBe('chosen')
  })
})

describe('pickerHref', () => {
  it('pick: mode и picked, без upicks/drive.ids', () => {
    const href = pickerHref(state({ picked: [uuid(1), uuid(2)] }))
    expect(href).toContain('/drive/pick?')
    expect(href).toContain('mode=multiple')
    expect(href).toContain('picked=')
    expect(href).not.toContain('upicks')
    expect(href).not.toContain('drive.ids')
  })

  it('chosen: upicks и drive.ids, пустой набор — none', () => {
    const href = pickerHref(state({ step: 'chosen' }))
    expect(href).toContain('upicks=chosen')
    expect(href).toContain('drive.ids=none')
    expect(href).not.toContain('picked=')
  })

  it('single не пишет picked/upicks/drive.ids/filter_owner', () => {
    const href = pickerHref(state({ mode: 'single', picked: [uuid(1)], filterOwner: 'chosen' }))
    expect(href).not.toContain('picked')
    expect(href).not.toContain('upicks')
    expect(href).not.toContain('drive.ids')
    expect(href).not.toContain('filter_owner')
  })

  it('маркер только в pick и только chosen', () => {
    expect(pickerHref(state({ filterOwner: 'chosen' }))).toContain('filter_owner=chosen')
    expect(pickerHref(state({ step: 'chosen', filterOwner: 'chosen' }))).not.toContain('filter_owner')
  })
})

describe('pickerFrom', () => {
  it('внешний, пикер и слишком длинный — /drive', () => {
    expect(pickerFrom('https://evil.example/')).toBe('/drive')
    expect(pickerFrom('//evil.example/')).toBe('/drive')
    expect(pickerFrom('/drive/pick?from=x')).toBe('/drive')
    expect(pickerFrom('/' + 'x'.repeat(2050))).toBe('/drive')
    expect(pickerFrom('/drive/move?node_id=x')).toBe('/drive/move?node_id=x')
  })
})
