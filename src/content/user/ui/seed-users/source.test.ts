/**
 * Помощник снапшота и регистрация пагинатора списка: первая порция из `load`
 * обязана выглядеть для хоста как уже загруженная страница.
 */
import { describe, expect, test } from 'vitest'
import { getPaginator, type ExtraSearchSpec } from '#lib/paginate/index.js'
import {
  ensureSeedUsersPaginator,
  SEED_USERS_EXTRA_SEARCH,
  SEED_USERS_FILTER_KEYS,
  SEED_USERS_NAME,
  SEED_USERS_PAGE_SIZE,
  SEED_USERS_PAGE_SIZES,
  seedUsersSnapshot,
} from './source.js'
import type { SeedUserView } from '../../types.js'

const row = (id: string): SeedUserView => ({
  id,
  seed: `seed-${id}`,
  permissions: [],
  blocked: [],
  createdAt: 1000,
  deletedAt: null,
})

describe('список seed-юзеров: снапшот и регистрация', () => {
  test('снапшот: страница загружена, totals и hasNext посчитаны', () => {
    const snap = seedUsersSnapshot({ items: [row('1'), row('2')], total: 25, page: 2, pageSize: 10, canSeeDeleted: true, canSeeNickname: false })
    expect(snap.name).toBe(SEED_USERS_NAME)
    expect(snap.loadedPages).toEqual([2])
    expect(snap.pages[2]).toHaveLength(2)
    expect(snap.totalItems).toBe(25)
    expect(snap.totalPages).toBe(3)
    expect(snap.hasNext).toBe(true)
    expect(snap.hasPrev).toBe(true)
    expect(snap.status).toBe('idle')
  })

  test('снапшот пустой выдачи: страниц нет, дальше — некуда', () => {
    const snap = seedUsersSnapshot({ items: [], total: 0, page: 1, pageSize: 10, canSeeDeleted: false, canSeeNickname: false })
    expect(snap.totalPages).toBe(1)
    expect(snap.hasNext).toBe(false)
  })

  test('регистрация идемпотентна и видна реестру', () => {
    expect(ensureSeedUsersPaginator()).toBe(SEED_USERS_NAME)
    expect(ensureSeedUsersPaginator()).toBe(SEED_USERS_NAME)
    expect(getPaginator(SEED_USERS_NAME).adapter).toBeDefined()
  })

  // URL-хранилище: без объявления ключей в `extraSearch` адаптер поиск и
  // фильтры в адрес не пишет и из адреса не восстанавливает.
  test('адресному слою объявлены поиск и все ключи фильтров', () => {
    expect(Object.keys(SEED_USERS_EXTRA_SEARCH).sort()).toEqual(['q', ...SEED_USERS_FILTER_KEYS].sort())
    const adapter = getPaginator(SEED_USERS_NAME).adapter as {
      searchSpec?: { extra?: ExtraSearchSpec }
    }
    expect(adapter.searchSpec?.extra).toBe(SEED_USERS_EXTRA_SEARCH)
  })

  test('размер порции: умолчание и допустимый диапазон — 30..100', () => {
    expect(SEED_USERS_PAGE_SIZE).toBe(30)
    expect(SEED_USERS_PAGE_SIZES[0]).toBe(30)
    expect(SEED_USERS_PAGE_SIZES.at(-1)).toBe(100)
    expect(SEED_USERS_PAGE_SIZES).not.toContain(29)
    expect(SEED_USERS_PAGE_SIZES).toContain(30)
  })

  test('валидаторы адреса: форма пропускает, мусор отбрасывает', () => {
    expect(SEED_USERS_EXTRA_SEARCH.q!('demo-')).toBe('demo-')
    expect(SEED_USERS_EXTRA_SEARCH.q!('x'.repeat(121))).toBeUndefined()
    expect(SEED_USERS_EXTRA_SEARCH.ord!('id-asc')).toBe('id-asc')
    expect(SEED_USERS_EXTRA_SEARCH.ord!('banana')).toBeUndefined()
    expect(SEED_USERS_EXTRA_SEARCH.state!('deleted')).toBe('deleted')
    expect(SEED_USERS_EXTRA_SEARCH.state!('banana')).toBeUndefined()
    expect(SEED_USERS_EXTRA_SEARCH.cfrom!('2026-10-01T12:00')).toBe('2026-10-01T12:00')
  })
})
