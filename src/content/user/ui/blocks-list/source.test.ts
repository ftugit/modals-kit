/**
 * Снапшот, регистрация пагинатора и разбор query-параметров списка блокировок (`user.block`).
 */
import { describe, expect, test } from 'vitest'
import { getPaginator } from '#lib/paginate/index.js'
import {
  BLOCKS_EXTRA_SEARCH,
  BLOCKS_FILTER_KEYS,
  BLOCKS_INTERNAL_UID_KEY,
  BLOCKS_NAME,
  BLOCKS_PAGE_SIZE,
  BLOCKS_PAGE_SIZES,
  blocksSnapshot,
  ensureBlocksPaginator,
  parseBlocksScopesFromSearch,
} from './source.js'
import type { BlockView } from '../../types.js'

const row = (id: string): BlockView => ({
  id,
  authId: '11111111-1111-4111-8111-111111111111',
  scope: 'auth',
  reason: 'причина',
  at: 1_700_000_000_000,
  until: null,
  by: null,
  deletedAt: null,
})

describe('список блокировок: снапшот, регистрация и разбор фильтров', () => {
  test('снапшот глобального и персонального списка: внутренний _uid хранится только при переданном uid', () => {
    const globalSnap = blocksSnapshot(
      {
        items: [row('b1')],
        total: 40,
        page: 1,
        pageSize: 30,
        uid: null,
        canSeeDeleted: true,
        canSeeLive: true,
        canPickUsers: true,
        assignableScopes: ['auth'],
        canCreate: true,
      },
      { ord: 'until-asc', uids: '22222222-2222-4222-8222-222222222222' },
    )
    expect(globalSnap.name).toBe(BLOCKS_NAME)
    expect(globalSnap.extra[BLOCKS_INTERNAL_UID_KEY]).toBeUndefined()
    expect(globalSnap.extra.ord).toBe('until-asc')
    expect(globalSnap.extra.uids).toBe('22222222-2222-4222-8222-222222222222')
    expect(globalSnap.hasNext).toBe(true)

    const userSnap = blocksSnapshot(
      {
        items: [row('b1')],
        total: 1,
        page: 1,
        pageSize: 30,
        uid: '11111111-1111-4111-8111-111111111111',
        canSeeDeleted: false,
        canSeeLive: true,
        canPickUsers: false,
        assignableScopes: ['auth'],
        canCreate: true,
      },
      { uids: '22222222-2222-4222-8222-222222222222' },
    )
    expect(userSnap.extra[BLOCKS_INTERNAL_UID_KEY]).toBe('11111111-1111-4111-8111-111111111111')
    expect(userSnap.extra.uids).toBeUndefined()
  })

  test('регистрация идемпотентна, диапазон страницы 30..100, extraSearch не протекает внутренним _uid', () => {
    expect(ensureBlocksPaginator()).toBe(BLOCKS_NAME)
    expect(ensureBlocksPaginator()).toBe(BLOCKS_NAME)
    expect(getPaginator(BLOCKS_NAME).adapter).toBeDefined()
    expect(Object.keys(BLOCKS_EXTRA_SEARCH).sort()).toEqual([...BLOCKS_FILTER_KEYS].sort())
    expect(BLOCKS_PAGE_SIZE).toBe(30)
    expect(BLOCKS_PAGE_SIZES[0]).toBe(30)
    expect(BLOCKS_PAGE_SIZES.at(-1)).toBe(100)
  })

  test('parseBlocksScopesFromSearch разбирает и модальный CSV blocks.scopes, и no-JS чекбоксы blocks.sc.*', () => {
    const sp = new URLSearchParams(
      'blocks.scopes=auth,unknown.scope&blocks.sc.profile.delete=on&blocks.sc.account.delete=0',
    )
    expect(parseBlocksScopesFromSearch(sp).sort()).toEqual(['auth', 'profile.delete'])
  })
})
