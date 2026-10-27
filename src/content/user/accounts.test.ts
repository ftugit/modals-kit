/**
 * Список seed-юзеров (`accounts.ts`) — над портами в памяти, как `admin.test.ts`:
 * проверяются право, контекст чтения и пагинация, не транспорт. Крипто подписи —
 * настоящее (`keys.ts`), БД — Map.
 */
import { describe, expect, test } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { issueChallenge, login, type UserResult } from './auth.js'
import { listSeedUsers } from './accounts.js'
import { generateKeyPair, sign } from './keys.js'
import type { AuthFact } from './error.js'
import type { AuthPorts, AuthRow, SeedAccountRow } from './ports.js'
import type { ProfileView, SessionRecord } from './types.js'

const ok_ = <T>(r: UserResult<T>): T => {
  if (!r.ok) throw new Error(`ожидали ok, получили факт: ${r.fact.code}`)
  return r.value
}
const fact_ = <T>(r: UserResult<T>): AuthFact => {
  if (r.ok) throw new Error('ожидали факт')
  return r.fact
}

/** Минимальные порты: вход и auth со списком. Профиль списку не нужен. */
function makePorts() {
  const store = memoryStore()
  const auths = new Map<string, AuthRow>()
  const sessions = new Map<string, SessionRecord>()
  const created = new Map<string, number>()
  let lastCtx: unknown = null
  let lastListArgs: unknown = null
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
    sessions: {
      async create(r: SessionRecord) {
        sessions.set(r.jti, { ...r })
      },
      async get(jti: string) {
        return sessions.get(jti)
      },
      async listByAuth(authId: string) {
        return [...sessions.values()].filter((s) => s.authId === authId)
      },
      async save(r: SessionRecord) {
        sessions.set(r.jti, { ...r })
      },
      async softDelete(jti: string) {
        const s = sessions.get(jti)
        if (s) sessions.set(jti, { ...s, deletedAt: Date.now() })
      },
      async softDeleteAllByAuth(authId: string) {
        for (const [jti, s] of sessions) if (s.authId === authId) sessions.set(jti, { ...s, deletedAt: Date.now() })
      },
    },
    auths: {
      async findBySeed(seed: string) {
        return [...auths.values()].find((r) => r.seed === seed && r.deletedAt === null)
      },
      async findDeletedBySeed(seed: string) {
        return [...auths.values()].find((r) => r.seed === seed && r.deletedAt !== null)
      },
      async create(seed: string) {
        if ([...auths.values()].some((r) => r.seed === seed)) return null
        const row: AuthRow = {
          id: crypto.randomUUID(),
          seed,
          deletedAt: null,
          blocked: [],
          permissions: [],
          subnetSalt: crypto.randomUUID().replaceAll('-', ''),
        }
        auths.set(row.id, row)
        created.set(row.id, created.size + 1)
        return row
      },
      async get(id: string) {
        return auths.get(id)
      },
      async markDeleted(id: string) {
        const r = auths.get(id)
        if (r) auths.set(id, { ...r, deletedAt: Date.now() })
      },
      async clearDeleted(id: string) {
        const r = auths.get(id)
        if (r) auths.set(id, { ...r, deletedAt: null })
      },
      async wipeCredentials(id: string) {
        const r = auths.get(id)
        if (r) auths.set(id, { ...r, seed: null })
      },
      async listDeletedBefore(cutoffMs: number) {
        return [...auths.values()].filter((r) => r.deletedAt !== null && r.deletedAt <= cutoffMs)
      },
      async setPermissions(_ctx: unknown, id: string, permissions: readonly string[]) {
        const r = auths.get(id)
        if (r) auths.set(id, { ...r, permissions: [...permissions] })
      },
      async listPage(
        ctx: unknown,
        args: { page: number; pageSize: number; filter?: unknown; order?: unknown; includeDeleted?: boolean },
      ) {
        lastCtx = ctx
        lastListArgs = args
        const { page, pageSize } = args
        const rows: SeedAccountRow[] = [...auths.values()]
          .map((r) => ({
            id: r.id,
            seed: r.seed,
            permissions: [...r.permissions],
            blocked: [...r.blocked],
            createdAt: (created.get(r.id) ?? 0) * 1000,
            deletedAt: r.deletedAt,
            // Фейк порта: никнейм приходит только с `withNickname` (как include адаптера).
            ...((args as { withNickname?: boolean }).withNickname ? { nickname: 'demo-nick' } : {}),
          }))
          .sort((a, b) => b.createdAt - a.createdAt)
        return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length }
      },
    },
    profiles: {
      async create() {},
      async get() {
        return undefined as ProfileView | undefined
      },
      async update() {},
      async remove() {},
    },
    sealKeys: { current: () => ({ id: 'k1', secret: 's'.repeat(32) }), secretOf: () => undefined, retire: async () => {} },
    seal,
    crypto: { sign: () => '', verify: async () => true },
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    clock: { now: () => Date.now() },
    config: (() => {
      const defaults = {
        accessTtlSec: 3600,
        deviceTtlSec: 60 * 60 * 24 * 365,
        sessionRecreate: 'update',
        nicknameForbidden: ['admin', 'root'],
        challengeTtlSec: 120,
        deleteGraceDays: 30,
        holdSeconds: 2,
      } as const
      return { defaults, get: async (k: keyof typeof defaults) => defaults[k], set: async () => {}, reset: async () => {} }
    })() as unknown as AuthPorts['config'],
  } as unknown as AuthPorts
  return { ports, auths, ctxOf: () => lastCtx, listArgsOf: () => lastListArgs }
}

/** Вошёл новым ключом; `permissions` — сразу выданные права. */
async function joined(ports: AuthPorts, auths: Map<string, AuthRow>, permissions: string[] = []) {
  const pair = await generateKeyPair()
  const challenge = await issueChallenge(ports)
  if (!challenge.ok) throw new Error('challenge не выдался')
  const signature = await sign(challenge.value.token, pair.secret)
  const out = ok_(await login(ports, { seed: pair.seed, challenge: challenge.value.token, signature }))
  const sub = JSON.parse(Buffer.from(out.access, 'base64url').toString()) as { sub: string }
  const row = auths.get(sub.sub)
  if (row) auths.set(row.id, { ...row, permissions })
  return { access: out.access, id: sub.sub, seed: pair.seed }
}

describe('список seed-юзеров', () => {
  test('без входа — факт сессии, без права — auth.forbidden', async () => {
    const { ports, auths } = makePorts()
    const user = await joined(ports, auths)

    expect(fact_(await listSeedUsers(ports, undefined)).code).toBe('auth.expired')
    expect(fact_(await listSeedUsers(ports, user.access)).code).toBe('auth.forbidden')
  })

  test('account.read и admin видят всех; чтение идёт от principal вызывающего', async () => {
    const { ports, auths, ctxOf } = makePorts()
    const reader = await joined(ports, auths, ['account.read'])
    const admin = await joined(ports, auths, ['admin'])
    await joined(ports, auths)

    const page = ok_(await listSeedUsers(ports, reader.access))
    expect(page.total).toBe(3)
    expect(page.items.map((i) => i.id)).toContain(reader.id)
    // контекст чтения — сам читатель с его правами, не сервер
    expect(ctxOf()).toEqual({ principal: { id: reader.id, roles: ['account.read'] } })

    expect(ok_(await listSeedUsers(ports, admin.access)).total).toBe(3)
  })

  test('порции не пересекаются, проекция не несёт соль подсети', async () => {
    const { ports, auths } = makePorts()
    const reader = await joined(ports, auths, ['account.read'])
    for (let i = 0; i < 4; i++) await joined(ports, auths)

    const p1 = ok_(await listSeedUsers(ports, reader.access, { page: 1, pageSize: 2 }))
    const p2 = ok_(await listSeedUsers(ports, reader.access, { page: 2, pageSize: 2 }))
    expect(p1.total).toBe(5)
    expect(p1.items).toHaveLength(2)
    expect(p2.items).toHaveLength(2)
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(4)
    expect(Object.keys(p1.items[0]!).sort()).toEqual(
      ['blocked', 'createdAt', 'deletedAt', 'id', 'permissions', 'seed'].sort(),
    )
  })

  test('поиск, фильтры и порядок собираются в срез порта одним набором', async () => {
    const { ports, auths, listArgsOf } = makePorts()
    const reader = await joined(ports, auths, ['account.read'])

    const page = ok_(
      await listSeedUsers(ports, reader.access, {
        search: '  AbC ',
        order: 'deleted-desc',
        state: 'deleted',
        createdFrom: 100,
        createdTo: 200,
        deletedFrom: 300,
      }),
    )
    expect(page.canSeeDeleted).toBe(true)
    const args = listArgsOf() as {
      filter?: unknown
      order?: unknown
      includeDeleted?: boolean
      searchSeed?: string
    }
    expect(args.includeDeleted).toBe(true)
    expect(args.order).toEqual([['deleted_at', 'desc']])
    // Поиск — отдельным аргументом порта, не DB-фильтром (схема seed — 43–44 знака).
    expect(args.searchSeed).toBe('AbC')
    expect(args.filter).toEqual({
      and: [
        { field: 'created_at', op: 'gte', value: new Date(100).toISOString() },
        { field: 'created_at', op: 'lte', value: new Date(200).toISOString() },
        { field: 'deleted_at', op: 'gte', value: new Date(300).toISOString() },
      ],
    })
  })

  test('по умолчанию — только действующие, порядок модели не навязан поиском', async () => {
    const { ports, auths, listArgsOf } = makePorts()
    const reader = await joined(ports, auths, ['account.read'])

    ok_(await listSeedUsers(ports, reader.access))
    const args = listArgsOf() as { filter?: unknown; order?: unknown; includeDeleted?: boolean }
    expect(args.includeDeleted).toBe(false)
    expect(args.filter).toBeUndefined()
    expect(args.order).toEqual([['created_at', 'desc']])
  })

  test('никнейм: право — политика профиля; без права параметр молча игнорируется', async () => {
    const { ports, auths, listArgsOf } = makePorts()
    const reader = await joined(ports, auths, ['account.read'])

    // account.read сам чужие профили не открывает: флага нет, порт include не просит,
    // порядок по никнейму сброшен на умолчание, поля никнейма в выдаче нет.
    const blind = ok_(await listSeedUsers(ports, reader.access, { nickname: true, order: 'nickname-asc' }))
    expect(blind.canSeeNickname).toBe(false)
    expect(blind.items[0]).not.toHaveProperty('nickname')
    const blindArgs = listArgsOf() as { withNickname?: boolean; order?: unknown }
    expect(blindArgs.withNickname).toBeUndefined()
    expect(blindArgs.order).toEqual([['created_at', 'desc']])
  })

  test('никнейм: при праве и включённом параметре — проекция, include и порядок по связи', async () => {
    const { ports, auths, listArgsOf } = makePorts()
    const admin = await joined(ports, auths, ['admin'])

    const page = ok_(await listSeedUsers(ports, admin.access, { nickname: true, order: 'nickname-asc' }))
    expect(page.canSeeNickname).toBe(true)
    expect(page.items[0]).toHaveProperty('nickname', 'demo-nick')
    const args = listArgsOf() as { withNickname?: boolean; order?: unknown }
    expect(args.withNickname).toBe(true)
    // Порядок — путь по связи модели; join подтягивает слой.
    expect(args.order).toEqual([['profile.nickname', 'asc']])

    // Параметр выключен — никнеймов в выдаче нет даже у админа.
    const off = ok_(await listSeedUsers(ports, admin.access, {}))
    expect(off.items[0]).not.toHaveProperty('nickname')
  })
})
