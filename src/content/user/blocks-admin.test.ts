/**
 * Наборные действия над блокировками (`blocks-admin.ts`) на портах в памяти:
 * проверяются правила набора, не транспорт. Токен доступа запечатан тем же
 * `seal`, что у гарда, а права берутся из строки аккаунта (как в домене).
 */
import { describe, expect, test } from 'vitest'
import { deleteBlocksBySet, liftBlocksBySet, resolveBlockSlice } from './blocks-admin.js'
import type { UserResult } from './auth.js'
import type { AuthFact } from './error.js'
import type { AuthPorts, AuthRow } from './ports.js'
import type { BlockView, SessionRecord } from './types.js'
import { BULK_IDS_LIMIT } from './bulk.js'

const ok_ = <T>(r: UserResult<T>): T => {
  if (!r.ok) throw new Error(`ожидали ok, получили факт: ${r.fact.code}`)
  return r.value
}
const fact_ = <T>(r: UserResult<T>): AuthFact => {
  if (r.ok) throw new Error('ожидали факт')
  return r.fact
}

const NOW = 1_000_000

type Row = { id: string; seed: string | null; deletedAt: number | null; permissions: string[] }
type Block = BlockView & { deletedAt: number | null }

function makePorts() {
  const rows = new Map<string, Row>()
  const blocks = new Map<string, Block>()
  const sessions = new Map<string, SessionRecord>()
  const seal = {
    async seal(payload: unknown, _ttl?: number) {
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
    clock: { now: () => NOW },
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    sessions: { async get(jti: string) { return sessions.get(jti) } },
    auths: {
      async get(_ctx: unknown, id: string, opts?: { includeDeleted?: boolean }) {
        const row = rows.get(id)
        if (!row) return undefined
        if (row.deletedAt !== null && !opts?.includeDeleted) return undefined
        return row as unknown as AuthRow
      },
    },
    profiles: { async get() { return undefined } },
    blocks: {
      async listByTarget() { return [] },
      async listByTargets() { return [] },
      async getById(_ctx: unknown, id: string, opts?: { includeDeleted?: boolean }) {
        const row = blocks.get(id)
        if (!row) return undefined
        if (row.deletedAt !== null && !opts?.includeDeleted) return undefined
        return row
      },
      async listPage(_ctx: unknown, args: { page: number; pageSize: number; includeDeleted?: boolean }) {
        const live = [...blocks.values()].filter((b) => args.includeDeleted || b.deletedAt === null)
        const start = (args.page - 1) * args.pageSize
        return { rows: live.slice(start, start + args.pageSize), total: live.length }
      },
      async update(_ctx: unknown, id: string, patch: { until?: number | null }) {
        const row = blocks.get(id)
        if (row && patch.until !== undefined) blocks.set(id, { ...row, until: patch.until })
      },
      async remove(_ctx: unknown, id: string, opts?: { hard?: boolean }) {
        if (opts?.hard) blocks.delete(id)
        else {
          const row = blocks.get(id)
          if (row) blocks.set(id, { ...row, deletedAt: NOW })
        }
      },
    },
  } as unknown as AuthPorts

  const addUser = (id: string, permissions: string[] = [], deletedAt: number | null = null) =>
    rows.set(id, { id, seed: `seed-${id}`, deletedAt, permissions })

  let seq = 0
  const addBlock = (authId: string, until: number | null) => {
    const id = `b${++seq}`
    const row: Block = {
      id,
      authId,
      scope: 'auth',
      reason: 'причина',
      at: NOW - 1000,
      until,
      by: 'moderator',
      deletedAt: null,
    }
    blocks.set(id, row)
    return id
  }

  const token = async (sub: string) => {
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

  return { ports, rows, blocks, addUser, addBlock, token }
}

describe('наборное снятие блокировок', () => {
  test('снимает живые, уже снятую — «без изменений», неизвестную — отказ', async () => {
    const { ports, blocks, addUser, addBlock, token } = makePorts()
    addUser('mod', ['moderator'])
    const live = addBlock('u1', null)
    const expired = addBlock('u2', NOW - 5)
    const access = await token('mod')

    const out = ok_(await liftBlocksBySet(ports, access, { ids: [live, expired, 'ghost'] }))

    expect(out.counts).toEqual({ requested: 3, changed: 1, unchanged: 1, rejected: 1 })
    expect(blocks.get(live)?.until).toBe(NOW)
    // Истёкшая запись остаётся с прежним сроком: действие её не трогает.
    expect(blocks.get(expired)?.until).toBe(NOW - 5)
  })

  test('разблокировка не удаляет запись: строка остаётся в истории', async () => {
    const { ports, blocks, addUser, addBlock, token } = makePorts()
    addUser('mod', ['moderator'])
    const id = addBlock('u1', null)
    const access = await token('mod')

    ok_(await liftBlocksBySet(ports, access, { ids: [id] }))

    const row = blocks.get(id)
    expect(row).toBeDefined()
    expect(row?.deletedAt).toBe(null)
    expect(row?.until).toBe(NOW)
  })
})

describe('наборное удаление блокировок', () => {
  test('мягко удаляет, повтор — «без изменений», строка остаётся с меткой', async () => {
    const { ports, blocks, addUser, addBlock, token } = makePorts()
    addUser('mod', ['moderator'])
    const a = addBlock('u1', null)
    const b = addBlock('u2', null)
    const access = await token('mod')

    const first = ok_(await deleteBlocksBySet(ports, access, { ids: [a, b] }))
    expect(first.counts).toEqual({ requested: 2, changed: 2, unchanged: 0, rejected: 0 })
    expect(blocks.get(a)?.deletedAt).toBe(NOW)

    const again = ok_(await deleteBlocksBySet(ports, access, { ids: [a] }))
    expect(again.counts).toEqual({ requested: 1, changed: 0, unchanged: 1, rejected: 0 })
  })
})

describe('срез и контракт отказа', () => {
  test('срез резолвится сервером и уходит тем же набором', async () => {
    const { ports, addUser, addBlock, token } = makePorts()
    addUser('mod', ['moderator'])
    addBlock('u1', null)
    addBlock('u2', null)
    const access = await token('mod')

    const slice = ok_(await resolveBlockSlice(ports, access, {}))
    expect(slice.sort()).toEqual(['b1', 'b2'])

    const out = ok_(await liftBlocksBySet(ports, access, { slice: {} }))
    expect(out.counts).toEqual({ requested: 2, changed: 2, unchanged: 0, rejected: 0 })
  })

  test('без права — отказ; пустой набор, смешивание форм и предел — отказ разбора', async () => {
    const { ports, addUser, addBlock, token } = makePorts()
    addUser('plain')
    addUser('mod', ['moderator'])
    const id = addBlock('u1', null)

    const plain = await token('plain')
    expect(fact_(await liftBlocksBySet(ports, plain, { ids: [id] })).code).toBe('auth.forbidden')
    expect(fact_(await deleteBlocksBySet(ports, plain, { ids: [id] })).code).toBe('auth.forbidden')

    const access = await token('mod')
    expect(fact_(await liftBlocksBySet(ports, access, {})).code).toBe('auth.confirm')
    expect(fact_(await deleteBlocksBySet(ports, access, { id, ids: [id] })).code).toBe('auth.confirm')

    const many = Array.from({ length: BULK_IDS_LIMIT + 1 }, (_, i) => `x-${i}`)
    expect(fact_(await deleteBlocksBySet(ports, access, { ids: many })).code).toBe('auth.limit')
  })

  test('срез больше предела — auth.limit, а не усечение', async () => {
    const { ports, addUser, addBlock, token } = makePorts()
    addUser('mod', ['moderator'])
    for (let i = 0; i <= BULK_IDS_LIMIT; i++) addBlock(`u${i}`, null)
    const access = await token('mod')

    expect(fact_(await liftBlocksBySet(ports, access, { slice: {} })).code).toBe('auth.limit')
  })
})
