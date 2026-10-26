/**
 * Помощник снапшота и регистрация пагинатора списка: первая порция из `load`
 * обязана выглядеть для хоста как уже загруженная страница.
 */
import { describe, expect, test } from 'vitest'
import { getPaginator } from '#lib/paginate/index.js'
import { ensureSeedUsersPaginator, SEED_USERS_NAME, seedUsersSnapshot } from './source.js'
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
    const snap = seedUsersSnapshot({ items: [row('1'), row('2')], total: 25, page: 2, pageSize: 10, canSeeDeleted: true })
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
    const snap = seedUsersSnapshot({ items: [], total: 0, page: 1, pageSize: 10, canSeeDeleted: false })
    expect(snap.totalPages).toBe(1)
    expect(snap.hasNext).toBe(false)
  })

  test('регистрация идемпотентна и видна реестру', () => {
    expect(ensureSeedUsersPaginator()).toBe(SEED_USERS_NAME)
    expect(ensureSeedUsersPaginator()).toBe(SEED_USERS_NAME)
    expect(getPaginator(SEED_USERS_NAME).adapter).toBeDefined()
  })
})
