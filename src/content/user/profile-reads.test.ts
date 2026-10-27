/**
 * Инвалидация поверхностей чтения после записи профиля: кеши модалок и
 * маршрутов сбрасываются всегда, ячейка пагинатора правится на месте —
 * и только если список реально открывали и строка в нём есть.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { invalidateMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn(async (_fn: (url: URL) => boolean) => undefined),
}))
vi.mock('$app/navigation', () => ({ invalidate: invalidateMock }))

import { getClientStore, resetClientStore } from '#lib/paginate/index.js'
import { invalidateProfileReads } from './profile-reads.js'
import { ensureSeedUsersPaginator, seedUsersSnapshot, SEED_USERS_NAME } from './ui/seed-users/source.js'
import type { SeedUserView } from './types.js'

const row = (id: string, nickname?: string | null): SeedUserView => ({
  id,
  seed: `seed-${id}`,
  permissions: [],
  blocked: [],
  createdAt: 1000,
  deletedAt: null,
  ...(nickname !== undefined ? { nickname } : {}),
})

function hydrateList(items: SeedUserView[]): void {
  ensureSeedUsersPaginator()
  getClientStore().hydrate(
    SEED_USERS_NAME,
    seedUsersSnapshot({ items, total: items.length, page: 1, pageSize: 30, canSeeDeleted: false, canSeeNickname: true }),
  )
}

function listItem(id: string): SeedUserView | undefined {
  const state = getClientStore().state<SeedUserView>(SEED_USERS_NAME)()
  return Object.values(state.pages).flat().find((it) => it.id === id)
}

beforeEach(() => {
  resetClientStore()
  invalidateMock.mockClear()
})

describe('invalidateProfileReads', () => {
  test('кеши модалок и маршрутов инвалидируются всегда', () => {
    const invalidateLoader = vi.fn()
    invalidateProfileReads({ modals: { invalidateLoader }, subjectId: 'u1', nickname: 'New' })
    expect(invalidateLoader).toHaveBeenCalledWith('user.profile')
    expect(invalidateLoader).toHaveBeenCalledWith('user.list')
    expect(invalidateMock).toHaveBeenCalledTimes(1)
    const pred = invalidateMock.mock.calls[0][0]
    expect(pred(new URL('http://x/users'))).toBe(true)
    expect(pred(new URL('http://x/user/abc'))).toBe(true)
    expect(pred(new URL('http://x/usersx'))).toBe(false)
    expect(pred(new URL('http://x/db-demo'))).toBe(false)
  })

  test('без контекста модалок не падает', () => {
    expect(() =>
      invalidateProfileReads({ modals: null, subjectId: null }),
    ).not.toThrow()
    expect(invalidateMock).toHaveBeenCalledTimes(1)
  })

  test('строка списка получает новый никнейм на месте', () => {
    hydrateList([row('u1', null), row('u2', 'Other')])
    invalidateProfileReads({ modals: null, subjectId: 'u1', nickname: 'New' })
    expect(listItem('u1')?.nickname).toBe('New')
    expect(listItem('u2')?.nickname).toBe('Other')
  })

  test('пустой ник из формы строку не трогает (сервер его не записывает)', () => {
    hydrateList([row('u1', null)])
    invalidateProfileReads({ modals: null, subjectId: 'u1' })
    expect(listItem('u1')?.nickname).toBeNull()
  })

  test('столбец никнейма правкой не выдумывается', () => {
    hydrateList([row('u1')])
    invalidateProfileReads({ modals: null, subjectId: 'u1', nickname: 'New' })
    expect(listItem('u1')?.nickname).toBeUndefined()
  })

  test('список не открывали — ячейки нет, запросов не возникает', () => {
    expect(() =>
      invalidateProfileReads({ modals: null, subjectId: 'u1', nickname: 'New' }),
    ).not.toThrow()
    expect(getClientStore().isHydrated(SEED_USERS_NAME)).toBe(false)
  })

  test('строки нет в загруженном окне — молча пропускает', () => {
    hydrateList([row('u2', 'Other')])
    invalidateProfileReads({ modals: null, subjectId: 'u1', nickname: 'New' })
    expect(listItem('u2')?.nickname).toBe('Other')
  })
})
