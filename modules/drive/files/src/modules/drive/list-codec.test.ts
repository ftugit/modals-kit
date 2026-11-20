import { describe, expect, it } from 'vitest'
import {
  decodeDriveList,
  driveListStateFromExtra,
  driveListStateHref,
  encodeDriveListExtra,
  encodeDriveListQuery,
  resolveDriveList,
} from './list-codec.js'

const root = { kind: 'root' } as const

describe('drive list codec', () => {
  it('decode читает фильтры, срез и страницу; пустой ids — none', () => {
    const params = new URLSearchParams('drive.q=отчёт&drive.ord=size&drive=2&drive.size=50&drive.ids=none')
    const { state, idsOverflow } = decodeDriveList(params, root)
    expect(state.filters.search).toBe('отчёт')
    expect(state.filters.sort).toBe('size')
    expect(state.page).toBe(2)
    expect(state.pageSize).toBe(50)
    expect(state.ids).toEqual([])
    expect(idsOverflow).toBe(false)
  })

  it('resolve: [] остаётся пустым срезом, а не отсутствием', () => {
    const { state } = decodeDriveList(new URLSearchParams(''), root)
    const empty = resolveDriveList(state, { ids: [] }).state
    expect(empty.ids).toEqual([])
    const untouched = resolveDriveList(state).state
    expect(untouched.ids).toBeNull()
  })

  it('extra и query опускают умолчания и пишут ids=none', () => {
    const { state } = decodeDriveList(new URLSearchParams(''), root)
    const withIds = resolveDriveList(state, { ids: [] }).state
    expect(encodeDriveListExtra(withIds)).toEqual({ ids: 'none' })
    expect(encodeDriveListQuery(withIds).get('drive.ids')).toBe('none')
    expect(encodeDriveListQuery(state).toString()).toBe('')
  })

  it('href выводит путь из identity', () => {
    const { state } = decodeDriveList(new URLSearchParams(''), { kind: 'trash' })
    expect(driveListStateHref(state)).toContain('/drive/trash')
    expect(driveListStateHref(state)).not.toContain('?')
  })

  it('fromExtra читает _list и коды ключей extra', () => {
    const state = driveListStateFromExtra({ q: 'счёт', ids: 'none', _list: 'starred' }, 3, 30)
    expect(state.identity).toEqual({ kind: 'starred' })
    expect(state.filters.search).toBe('счёт')
    expect(state.ids).toEqual([])
    expect(state.page).toBe(3)
  })
})
