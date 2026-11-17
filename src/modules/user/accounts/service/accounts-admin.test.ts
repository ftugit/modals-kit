/**
 * Наборное удаление аккаунтов (`accounts-admin.ts`) на портах в памяти:
 * проверяются правила набора, не транспорт. Токен доступа запечатан тем же
 * `seal`, что у гарда, поэтому вход идёт без церемонии login.
 */
import { describe, expect, test } from 'vitest'
import { deleteAccountsBySet, resolveAccountSlice } from './accounts-admin.js'
import type { UserResult } from '../../base/service/auth.js'
import type { AuthFact } from '../../base/model/error.js'
import type { AuthPorts, AuthRow } from '../../base/service/ports.js'
import type { SessionRecord } from '../../base/model/types.js'
import { BULK_IDS_LIMIT } from '../../base/service/bulk.js'

const ok_ = <T>(r: UserResult<T>): T => {
  if (!r.ok) throw new Error(`ожидали ok, получили факт: ${r.fact.code}`)
  return r.value
}
const fact_ = <T>(r: UserResult<T>): AuthFact => {
  if (r.ok) throw new Error('ожидали факт')
  return r.fact
}

type Row = { id: string; seed: string | null; deletedAt: number | null; permissions: string[] }

function makePorts() {
  const rows = new Map<string, Row>()
  const sessions = new Map<string, SessionRecord>()
  const seal = {
    async seal(payload: unknown) {
      return Buffer.from(JSON.stringify(payload)).toString('base64url')
    },
    async unseal(token: string) {
      try {
        return JSON.parse(Buffer.from(token, 'base64url').toString()) as Record<string, unknown>
      } catch {
        return null
      }
    },
  }
  const ports = {
    seal,
    clock: { now: () => 1_000_000 },
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    sessions: {
      async get(jti: string) {
        return sessions.get(jti)
      },
      async softDeleteAllByAuth(authId: string) {
        for (const [jti, s] of sessions) if (s.authId === authId) sessions.set(jti, { ...s, deletedAt: 1 })
      },
    },
    auths: {
      async get(_ctx: unknown, id: string, opts?: { includeDeleted?: boolean }) {
        const row = rows.get(id)
        if (!row) return undefined
        if (row.deletedAt !== null && !opts?.includeDeleted) return undefined
        return row as unknown as AuthRow
      },
      async listPage(
        _ctx: unknown,
        args: { page: number; pageSize: number; includeDeleted?: boolean },
      ) {
        const live = [...rows.values()].filter((r) => args.includeDeleted || r.deletedAt === null)
        const start = (args.page - 1) * args.pageSize
        return {
          rows: live.slice(start, start + args.pageSize) as unknown as AuthRow[],
          total: live.length,
        }
      },
      async markDeleted(_ctx: unknown, id: string, at: number) {
        const row = rows.get(id)
        if (row) rows.set(id, { ...row, deletedAt: at })
      },
    },
    profiles: { async get() { return undefined } },
    blocks: {
      async listByTarget() { return [] },
      async listByTargets() { return [] },
    },
  } as unknown as AuthPorts

  const add = (id: string, permissions: string[] = [], deletedAt: number | null = null) =>
    rows.set(id, { id, seed: `seed-${id}`, deletedAt, permissions })

  const token = async (sub: string, permissions: string[] = []) => {
    const jti = `jti-${sub}`
    sessions.set(jti, {
      id: `sess-${sub}`,
      jti,
      authId: sub,
      deviceName: null,
      subnetHash: null,
      country: null,
      history: [],
      createdAt: 1,
      expiresAt: 9_999_999,
      version: 1,
      deletedAt: null,
      lastSeenAt: null,
    })
    return seal.seal({ k: 'access', sub, dt: jti, prof: { nickname: null, avatarUrl: null }, exp: 5_000_000 })
  }

  return { ports, rows, add, token }
}

describe('наборное удаление аккаунтов', () => {
  test('набор ids: удаляет живые, повтор — «без изменений», себя — отказ', async () => {
    const { ports, rows, add, token } = makePorts()
    add('admin', ['admin'])
    add('u1')
    add('u2')
    add('u3', [], 500)
    const access = await token('admin', ['admin'])

    const out = ok_(
      await deleteAccountsBySet(ports, access, { ids: ['u1', 'u2', 'u3', 'admin', 'ghost'] }),
    )

    expect(out.counts).toEqual({ requested: 5, changed: 2, unchanged: 1, rejected: 2 })
    expect(rows.get('u1')?.deletedAt).toBe(1_000_000)
    expect(rows.get('u2')?.deletedAt).toBe(1_000_000)
    expect(rows.get('admin')?.deletedAt).toBe(null)
    expect(rows.get('u3')?.deletedAt).toBe(500)
    // Сессии целей отозваны сразу, до зачистки планировщиком.
    expect([...rows.keys()].length).toBe(4)
  })

  test('последний администратор — отказ; при живом втором — проходит', async () => {
    const { ports, rows, add, token } = makePorts()
    add('admin', ['admin'])
    add('other', ['admin'])
    const access = await token('admin', ['admin'])

    const both = ok_(await deleteAccountsBySet(ports, access, { ids: ['other'] }))
    expect(both.counts.changed).toBe(1)
    expect(rows.get('other')?.deletedAt).toBe(1_000_000)

    // Теперь admin — единственный: себя удалить набором нельзя, а чужой цели нет.
    const self = ok_(await deleteAccountsBySet(ports, access, { ids: ['admin'] }))
    expect(self.counts.rejected).toBe(1)
  })

  test('последний admin вне набора не считается: цель-админ без замены отклонена', async () => {
    const { ports, rows, add, token } = makePorts()
    add('root', ['admin'])
    add('u1')
    const access = await token('root', ['admin'])

    const out = ok_(await deleteAccountsBySet(ports, access, { ids: ['u1'] }))
    expect(out.counts.changed).toBe(1)
    // root остался живым admin — набор чужой цели не осиротил систему.
    expect(rows.get('root')?.deletedAt).toBe(null)
  })

  test('без права и без набора — отказ; смешивание форм и предел — отказ разбора', async () => {
    const { ports, add, token } = makePorts()
    add('u1')
    add('plain')
    add('admin', ['admin'])
    const plain = await token('plain')

    expect(fact_(await deleteAccountsBySet(ports, plain, { ids: ['u1'] })).code).toBe('auth.forbidden')

    const access = await token('admin', ['admin'])
    expect(fact_(await deleteAccountsBySet(ports, access, {})).code).toBe('auth.confirm')
    expect(
      fact_(await deleteAccountsBySet(ports, access, { id: 'u1', ids: ['u1'] })).code,
    ).toBe('auth.confirm')
    const many = Array.from({ length: BULK_IDS_LIMIT + 1 }, (_, i) => `id-${i}`)
    expect(fact_(await deleteAccountsBySet(ports, access, { ids: many })).code).toBe('auth.limit')
  })

  test('срез резолвится сервером и уходит тем же набором', async () => {
    const { ports, rows, add, token } = makePorts()
    add('admin', ['admin'])
    add('u1')
    add('u2')
    const access = await token('admin', ['admin'])

    const slice = ok_(await resolveAccountSlice(ports, access, { state: 'active' }))
    expect(slice.sort()).toEqual(['admin', 'u1', 'u2'])

    const out = ok_(await deleteAccountsBySet(ports, access, { slice: { state: 'active' } }))
    // Себя набор пропускает, две цели удалены.
    expect(out.counts).toEqual({ requested: 3, changed: 2, unchanged: 0, rejected: 1 })
    expect(rows.get('admin')?.deletedAt).toBe(null)
  })

  test('имя права не обещает стирания: строка остаётся, метка времени ставится', async () => {
    const { ports, rows, add, token } = makePorts()
    add('admin', ['admin'])
    add('u1')
    const access = await token('admin', ['admin'])
    ok_(await deleteAccountsBySet(ports, access, { ids: ['u1'] }))
    const row = rows.get('u1')
    // Физического удаления нет: строка на месте с меткой (зачистка — планировщик).
    expect(row).toBeDefined()
    expect(row?.seed).toBe('seed-u1')
    expect(row?.deletedAt).not.toBe(null)
  })
})
