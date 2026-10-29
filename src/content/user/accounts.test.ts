/**
 * Список seed-юзеров (`accounts.ts`) — над портами в памяти, как `admin.test.ts`:
 * проверяются право, контекст чтения и пагинация, не транспорт. Крипто подписи —
 * настоящее (`keys.ts`), БД — Map.
 */
import { describe, expect, test } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { issueChallenge, login, type UserResult } from './auth.js'
import { listSeedUsers } from './accounts.js'
import { deleteProfile, profile } from './profile.js'
import { generateKeyPair, sign } from './keys.js'
import { addBlock, liftBlock, listBlocks } from './blocks.js'
import type { AuthFact } from './error.js'
import type { AuthPorts, AuthRow, SeedAccountRow } from './ports.js'
import type { ProfileView, SessionRecord, Blocked } from './types.js'

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
  const auths = new Map<string, AuthRow & { blocked: Blocked[] }>()
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
        const row = {
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
    blocks: {
      async listByTarget(_ctx: unknown, authId: string) {
        return (auths.get(authId)?.blocked ?? []).map((b, i) => ({
          id: `blk-${authId}-${i}`,
          authId,
          scope: b.scope,
          reason: b.reason,
          at: b.at,
          until: b.until ?? null,
          by: b.by ?? null,
        }))
      },
      async listByTargets(_ctx: unknown, ids: readonly string[]) {
        const out: unknown[] = []
        for (const id of ids) {
          for (const [i, b] of (auths.get(id)?.blocked ?? []).entries()) {
            out.push({ id: `blk-${id}-${i}`, authId: id, scope: b.scope, reason: b.reason, at: b.at, until: b.until ?? null, by: b.by ?? null })
          }
        }
        return out as never[]
      },
      async insert(_ctx: unknown, row: { authId: string; scope: string; reason: string; until?: number | null; by: string }) {
        const r = auths.get(row.authId)
        if (r) r.blocked = [...r.blocked, { scope: row.scope, reason: row.reason, at: Date.now(), ...(row.until != null ? { until: row.until } : {}), by: row.by }]
      },
      async update(_ctx: unknown, id: string, patch: { until: number }) {
        for (const r of auths.values()) {
          const i = r.blocked.findIndex((b, j) => `blk-${r.id}-${j}` === id)
          if (i >= 0) r.blocked = r.blocked.map((b, j) => (j === i ? { ...b, until: patch.until } : b))
        }
      },
    },
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
    settings: (() => {
      const rows: import('./types.js').ConfigKeyRow[] = []
      let seq = 0
      return {
        async row(authId: string | null, key: string) { return rows.find((r) => r.authId === authId && r.key === key) },
        async defaults() { return rows.filter((r) => r.authId === null) },
        async anyUserRow(key: string) { return rows.some((r) => r.authId !== null && r.key === key) },
        async insert(row: { authId: string | null; key: string; value?: unknown; schema?: import('./types.js').ConfigKeySchema | null }) {
          rows.push({ id: `cfg-${++seq}`, authId: row.authId, key: row.key, value: row.value ?? null, schema: row.schema ?? null })
        },
        async update(id: string, patch: { value?: unknown; schema?: import('./types.js').ConfigKeySchema | null }) {
          const r = rows.find((x) => x.id === id)
          if (!r) return
          if (patch.value !== undefined) r.value = patch.value
          if (patch.schema !== undefined) r.schema = patch.schema
        },
        async remove(id: string) { const i = rows.findIndex((x) => x.id === id); if (i >= 0) rows.splice(i, 1) },
        cache: store.scope('settings-fake'),
      }
    })(),
  } as unknown as AuthPorts
  return { ports, auths, ctxOf: () => lastCtx, listArgsOf: () => lastListArgs }
}

/** Вошёл новым ключом; `permissions` — сразу выданные права. */
async function joined(ports: AuthPorts, auths: Map<string, AuthRow & { blocked: Blocked[] }>, permissions: string[] = []) {
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

  test('срез по списку id: список уходит в порт; пустой — без среза', async () => {
    const { ports, auths, listArgsOf } = makePorts()
    const reader = await joined(ports, auths, ['account.read'])
    const a = await joined(ports, auths)

    // Срез — DB-фильтр `in` по первичному ключу в общем фильтре порта.
    ok_(await listSeedUsers(ports, reader.access, { ids: [a.id, reader.id] }))
    expect((listArgsOf() as { filter?: unknown }).filter).toEqual({
      field: 'id',
      op: 'in',
      value: [a.id, reader.id],
    })

    ok_(await listSeedUsers(ports, reader.access, { ids: [] }))
    expect((listArgsOf() as { filter?: unknown }).filter).toBeUndefined()
  })

  test('размер порции: потолок домена — 100', async () => {
    const { ports, auths } = makePorts()
    const reader = await joined(ports, auths, ['account.read'])

    expect(ok_(await listSeedUsers(ports, reader.access, { pageSize: 101 })).pageSize).toBe(100)
    expect(ok_(await listSeedUsers(ports, reader.access, { pageSize: 100 })).pageSize).toBe(100)
    expect(ok_(await listSeedUsers(ports, reader.access, { pageSize: 37 })).pageSize).toBe(37)
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
    }
    expect(args.includeDeleted).toBe(true)
    expect(args.order).toEqual([['deleted_at', 'desc']])
    // Поиск — DB-фильтр (подстроковые операторы валидируют фрагмент, не
    // значение поля): seed и id одним `or`, без полной выгрузки среза.
    expect(args.filter).toEqual({
      and: [
        {
          or: [
            { field: 'seed', op: 'icontains', value: 'AbC' },
            { field: 'id', op: 'icontains', value: 'AbC' },
          ],
        },
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

  test('состояние профиля: узел exists по модели профиля; без права читать профили — молча игнорируется', async () => {
    const { ports, auths, listArgsOf } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const reader = await joined(ports, auths, ['account.read'])

    ok_(await listSeedUsers(ports, admin.access, { profile: 'created' }))
    const created = listArgsOf() as { filter?: { exists?: { from?: { key?: string }; on?: unknown } } }
    expect(created.filter?.exists?.from?.key).toBe('user.profile.v1')
    expect(created.filter?.exists?.on).toEqual([['id', 'auth_id']])

    ok_(await listSeedUsers(ports, admin.access, { profile: 'missing' }))
    const missing = listArgsOf() as { filter?: { not?: { exists?: { from?: { key?: string } } } } }
    expect(missing.filter?.not?.exists?.from?.key).toBe('user.profile.v1')

    // account.read без profile.read чужие профили не читает — аргумент отброшен, фильтра нет.
    ok_(await listSeedUsers(ports, reader.access, { profile: 'created' }))
    expect((listArgsOf() as { filter?: unknown }).filter).toBeUndefined()
  })
})

describe('чтение профиля: возможности по цели (этапы 5–6)', () => {
  test('права: владелец и profile.edit могут править/удалять чужой профиль; простой — нет', async () => {
    const { ports, auths } = makePorts()
    const editor = await joined(ports, auths, ['profile.edit'])
    const plain = await joined(ports, auths)
    const target = await joined(ports, auths)

    const byEditor = ok_(await profile(ports, editor.access, target.id))
    expect(byEditor.canEdit).toBe(true)
    expect(byEditor.canDeleteProfile).toBe(true)
    expect(byEditor.canDeleteSeed).toBe(false)

    const byPlain = ok_(await profile(ports, plain.access, target.id))
    expect(byPlain.canEdit).toBe(false)
    expect(byPlain.canDeleteProfile).toBe(false)

    const bySelf = ok_(await profile(ports, target.access, target.id))
    expect(bySelf.canEdit).toBe(true)
    expect(bySelf.canDeleteProfile).toBe(true)
    expect(bySelf.canDeleteSeed).toBe(true)
  })

  test('запрет на цели сильнее права и владельца; причина полной блокировки — за правами', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const reader = await joined(ports, auths, ['profile.read'])
    const target = await joined(ports, auths)
    const row = auths.get(target.id)!
    auths.set(target.id, {
      ...row,
      blocked: [
        { scope: 'profile.delete', reason: 'нельзя', at: 1 },
        { scope: 'auth', reason: 'полный бан', at: 1, until: Date.now() + 60_000 },
      ],
    })

    const byAdmin = ok_(await profile(ports, admin.access, target.id))
    expect(byAdmin.canDeleteProfile).toBe(false)
    expect(byAdmin.fullBlock?.reason).toBe('полный бан')

    // Владелец под запретом удаления (без полного бана): флаг погашен и у него.
    const guarded = await joined(ports, auths)
    const grow = auths.get(guarded.id)!
    auths.set(guarded.id, {
      ...grow,
      blocked: [{ scope: 'profile.delete', reason: 'нельзя', at: 1 }],
    })
    const bySelf = ok_(await profile(ports, guarded.access, guarded.id))
    expect(bySelf.canDeleteProfile).toBe(false)

    // Читатель профиля без прав чтения аккаунтов: факт есть, причины нет.
    const byReader = ok_(await profile(ports, reader.access, target.id))
    expect(byReader.fullBlock).not.toBeNull()
    expect(byReader.fullBlock?.reason).toBeNull()
  })
})

describe('удаление профиля и seed по цели (этап 7)', () => {
  test('чужой без права — запрет; запрет сферы сильнее админа; с seed — метка удаления', async () => {
    const { ports, auths } = makePorts()
    const plain = await joined(ports, auths)
    const admin = await joined(ports, auths, ['admin'])
    const target = await joined(ports, auths)

    const denied = await deleteProfile(ports, plain.access, target.id, {})
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.fact.code).toBe('auth.forbidden')

    const row = auths.get(target.id)!
    auths.set(target.id, {
      ...row,
      blocked: [{ scope: 'profile.delete', reason: 'нельзя', at: 1 }],
    })
    const banned = await deleteProfile(ports, admin.access, target.id, {})
    expect(banned.ok).toBe(false)
    if (!banned.ok) expect(banned.fact.code).toBe('profile.delete-blocked')

    auths.set(target.id, { ...row, blocked: [] })
    const done = await deleteProfile(ports, admin.access, target.id, { withSeed: true })
    expect(done.ok).toBe(true)
    expect(auths.get(target.id)?.deletedAt).not.toBeNull()
  })

  test('владелец удаляет свой профиль без seed: аккаунт жив', async () => {
    const { ports, auths } = makePorts()
    const self = await joined(ports, auths)
    const done = await deleteProfile(ports, self.access, self.id, {})
    expect(done.ok).toBe(true)
    expect(auths.get(self.id)?.deletedAt).toBeNull()
  })
})

describe('блокировки (этап 9): домен поверх фейка порта', () => {
  test('круг накладывает и снимает; вне круга и на себя — отказы; истёкшая неактивна', async () => {
    const { ports, auths } = makePorts()
    const moderator = await joined(ports, auths, ['moderator'])
    const editor = await joined(ports, auths, ['block.edit'])
    const plain = await joined(ports, auths)
    const target = await joined(ports, auths)

    expect(fact_(await addBlock(ports, plain.access, { targetId: target.id, scope: 'auth', reason: 'x' })).code).toBe('auth.forbidden')
    expect(fact_(await addBlock(ports, moderator.access, { targetId: moderator.id, scope: 'auth', reason: 'x' })).code).toBe('auth.forbidden')
    expect(fact_(await addBlock(ports, moderator.access, { targetId: target.id, scope: 'site.read', reason: 'x' })).code).toBe('permissions.unknown')

    ok_(await addBlock(ports, moderator.access, { targetId: target.id, scope: 'auth', reason: 'спам', forever: true }))
    ok_(await addBlock(ports, editor.access, { targetId: target.id, scope: 'profile.delete', reason: 'защита', until: Date.now() + 60_000 }))

    const listed = ok_(await listBlocks(ports, moderator.access, target.id))
    expect(listed.blocks.map((b) => b.scope).sort()).toEqual(['auth', 'profile.delete'])
    expect(fact_(await listBlocks(ports, plain.access, target.id)).code).toBe('auth.forbidden')

    const authBlock = listed.blocks.find((b) => b.scope === 'auth')!
    ok_(await liftBlock(ports, editor.access, { targetId: target.id, blockId: authBlock.id }))
    const after = ok_(await listBlocks(ports, moderator.access, target.id))
    expect(after.blocks.find((b) => b.id === authBlock.id)?.until).not.toBeNull()
    // уже снятая повторно не снимается
    expect(fact_(await liftBlock(ports, editor.access, { targetId: target.id, blockId: authBlock.id })).code).toBe('auth.forbidden')
  })
})
