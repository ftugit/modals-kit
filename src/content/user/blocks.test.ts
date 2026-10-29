/**
 * Доменные операции блокировок (`blocks.ts`): пагинированный список (глобальный
 * и по `uid`), чтение карточки с флагами редактирования / read-only просмотра,
 * создание и редактирование (`moderator` против `block.edit`), мягкое и полное
 * удаление (`hard` требует связку с `block.readDeleted` / `admin`).
 */
import { describe, expect, test } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { issueChallenge, login, type UserResult } from './auth.js'
import {
  blockCreateMeta,
  deleteBlock,
  listBlocksPage,
  readBlockDetail,
  saveBlock,
} from './blocks.js'
import type { AuthFact } from './error.js'
import { generateKeyPair, sign } from './keys.js'
import type { AuthPorts, AuthRow } from './ports.js'
import type { BlockView, SessionRecord } from './types.js'

const ok_ = <T>(r: UserResult<T>): T => {
  if (!r.ok) throw new Error(`ожидали ok, получили факт: ${r.fact.code}`)
  return r.value
}
const fact_ = <T>(r: UserResult<T>): AuthFact => {
  if (r.ok) throw new Error('ожидали факт')
  return r.fact
}

function makePorts() {
  const store = memoryStore()
  const auths = new Map<string, AuthRow>()
  const sessions = new Map<string, SessionRecord>()
  const blocks = new Map<string, BlockView>()
  let seq = 0
  let lastListSlice: {
    page: number
    pageSize: number
    filter?: unknown
    order?: unknown
    includeDeleted?: boolean
  } | null = null

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
      async update(jti: string, patch: Partial<SessionRecord>) {
        const s = sessions.get(jti)
        if (s) sessions.set(jti, { ...s, ...patch })
      },
      async revoke(jti: string) {
        const s = sessions.get(jti)
        if (s) sessions.set(jti, { ...s, deletedAt: Date.now() })
      },
      async revokeAllByAuth(authId: string) {
        for (const [jti, s] of sessions) {
          if (s.authId === authId) sessions.set(jti, { ...s, deletedAt: Date.now() })
        }
      },
    },
    auths: {
      async findBySeed(seed: string) {
        return [...auths.values()].find((r) => r.seed === seed && r.deletedAt === null)
      },
      async findDeletedBySeed(seed: string) {
        return [...auths.values()].find((r) => r.seed === seed && r.deletedAt !== null)
      },
      async create(seed: string, salt: string) {
        const row: AuthRow = {
          id: crypto.randomUUID(),
          seed,
          subnetSalt: salt,
          permissions: [],
          deletedAt: null,
        }
        auths.set(row.id, row)
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
      async wipeCredentials() {},
      async setPermissions(_ctx: unknown, id: string, permissions: readonly string[]) {
        const r = auths.get(id)
        if (r) auths.set(id, { ...r, permissions: [...permissions] })
      },
      async listDeletedBefore() {
        return []
      },
      async listPage() {
        return { rows: [], total: 0 }
      },
    },
    profiles: {
      async create() {},
      async get() {
        return undefined
      },
      async update() {},
      async remove() {},
    },
    sealKeys: {
      current: () => ({ id: 'k1', secret: 's'.repeat(32) }),
      secretOf: () => undefined,
      retire: async () => {},
    },
    seal,
    crypto: {
      sign: (payload: string, secret: string) => sign(payload, secret),
      verify: async () => true,
    },
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    blocks: {
      async listByTarget(_ctx: unknown, authId: string) {
        return [...blocks.values()].filter((b) => b.authId === authId && b.deletedAt == null)
      },
      async listByTargets(_ctx: unknown, ids: readonly string[]) {
        const set = new Set(ids)
        return [...blocks.values()].filter((b) => set.has(b.authId) && b.deletedAt == null)
      },
      async listPage(
        _ctx: unknown,
        slice: {
          page: number
          pageSize: number
          filter?: unknown
          order?: unknown
          includeDeleted?: boolean
        },
      ) {
        lastListSlice = slice
        const rows = [...blocks.values()].filter((b) =>
          slice.includeDeleted ? true : b.deletedAt == null,
        )
        return { rows, total: rows.length }
      },
      async getById(_ctx: unknown, id: string, opts?: { includeDeleted?: boolean }) {
        const row = blocks.get(id)
        if (!row) return undefined
        if (!opts?.includeDeleted && row.deletedAt != null) return undefined
        return row
      },
      async insert(
        _ctx: unknown,
        row: { authId: string; scope: string; reason: string; until?: number | null; by: string },
      ) {
        const id = `blk-${++seq}`
        blocks.set(id, {
          id,
          authId: row.authId,
          scope: row.scope,
          reason: row.reason,
          at: Date.now(),
          until: row.until ?? null,
          by: row.by,
          deletedAt: null,
        })
      },
      async update(_ctx: unknown, id: string, patch: { until?: number | null; reason?: string }) {
        const cur = blocks.get(id)
        if (!cur) return
        blocks.set(id, {
          ...cur,
          ...(patch.until !== undefined ? { until: patch.until } : {}),
          ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
        })
      },
      async remove(_ctx: unknown, id: string, opts?: { hard?: boolean }) {
        const cur = blocks.get(id)
        if (!cur) return
        if (opts?.hard) blocks.delete(id)
        else blocks.set(id, { ...cur, deletedAt: Date.now() })
      },
    },
    clock: { now: () => 1_700_000_000_000 },
    config: (() => {
      const defaults = {
        accessTtlSec: 3600,
        deviceTtlSec: 60 * 60 * 24 * 365,
        sessionRecreate: 'update',
        nicknameForbidden: [],
        challengeTtlSec: 120,
        deleteGraceDays: 30,
        holdSeconds: 2,
      } as const
      return {
        defaults,
        get: async (k: keyof typeof defaults) => defaults[k],
        set: async () => {},
        reset: async () => {},
      }
    })() as unknown as AuthPorts['config'],
    settings: {
      async row() {
        return undefined
      },
      async defaults() {
        return []
      },
      async anyUserRow() {
        return false
      },
      async insert() {},
      async update() {},
      async remove() {},
      cache: store.scope('cfg'),
    },
  } as unknown as AuthPorts

  return { ports, auths, blocks, lastSlice: () => lastListSlice }
}

async function joined(
  ports: AuthPorts,
  auths: Map<string, AuthRow>,
  perms: readonly string[] = [],
) {
  const kp = await generateKeyPair()
  const ch = ok_(await issueChallenge(ports))
  const first = ok_(
    await login(ports, {
      seed: kp.seed,
      challenge: ch.token,
      signature: await sign(ch.token, kp.secret),
    }),
  )
  const row = [...auths.values()].find((r) => r.seed === kp.seed)!
  if (!perms.length) return { id: row.id, access: first.access }
  auths.set(row.id, { ...row, permissions: [...perms] })
  const ch2 = ok_(await issueChallenge(ports))
  const second = ok_(
    await login(ports, {
      seed: kp.seed,
      challenge: ch2.token,
      signature: await sign(ch2.token, kp.secret),
    }),
  )
  return { id: row.id, access: second.access }
}

describe('blocks.ts — список, карточка просмотра/правки и удаление', () => {
  test('глобальный и персональный список: canPickUsers отключается при переданном uid', async () => {
    const { ports, auths, lastSlice } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const modOnly = await joined(ports, auths, ['moderator'])
    const target = await joined(ports, auths)

    const globalAdmin = ok_(
      await listBlocksPage(ports, admin.access, {
        uids: [target.id],
        scopes: ['auth', 'profile.delete'],
        state: 'active',
        order: 'until-asc',
        pageSize: 45,
      }),
    )
    expect(globalAdmin.canPickUsers).toBe(true)
    expect(globalAdmin.canSeeDeleted).toBe(true)
    expect(globalAdmin.canCreate).toBe(true)
    expect(lastSlice()?.order).toEqual([['until', 'asc']])
    expect(lastSlice()?.pageSize).toBe(45)

    // Модератор без account.read не получает canPickUsers, но видит глобальный список
    const globalMod = ok_(await listBlocksPage(ports, modOnly.access))
    expect(globalMod.canPickUsers).toBe(false)

    // При переданном uid пикер всегда выключен даже у админа
    const scopedAdmin = ok_(await listBlocksPage(ports, admin.access, { uid: target.id }))
    expect(scopedAdmin.uid).toBe(target.id)
    expect(scopedAdmin.canPickUsers).toBe(false)

    // На самого себя кнопка создания отключена
    const selfBlocks = ok_(await listBlocksPage(ports, admin.access, { uid: admin.id }))
    expect(selfBlocks.canCreate).toBe(false)
    expect(fact_(await blockCreateMeta(ports, admin.access, admin.id)).code).toBe('auth.forbidden')
  })

  test('readBlockDetail: читатель открывает запись без возможности отправить; moderator правит срок без причины; block.edit правит и причину', async () => {
    const { ports, auths, blocks } = makePorts()
    const reader = await joined(ports, auths, ['block.read'])
    const moderator = await joined(ports, auths, ['moderator'])
    const editor = await joined(ports, auths, ['block.edit'])
    const target = await joined(ports, auths)

    ok_(
      await saveBlock(ports, moderator.access, {
        targetId: target.id,
        scope: 'auth',
        reason: 'исходная причина',
        forever: true,
      }),
    )
    const createdId = [...blocks.keys()][0]!

    // Читатель: открывает карточку, но canSubmit = false и canDelete = false
    const asReader = ok_(await readBlockDetail(ports, reader.access, { blockId: createdId }))
    expect(asReader.canSubmit).toBe(false)
    expect(asReader.canEditReason).toBe(false)
    expect(asReader.canEditUntil).toBe(false)
    expect(asReader.canDelete).toBe(false)
    expect(asReader.canHardDelete).toBe(false)

    // Модератор: может отправить срок и мягко удалить, но не может править reason и не может hard-delete
    const asMod = ok_(await readBlockDetail(ports, moderator.access, { blockId: createdId }))
    expect(asMod.canSubmit).toBe(true)
    expect(asMod.canEditReason).toBe(false)
    expect(asMod.canEditUntil).toBe(true)
    expect(asMod.canDelete).toBe(true)
    expect(asMod.canHardDelete).toBe(false)

    // Попытка модератора прислать изменённую причину её не перезаписывает, но меняет срок
    ok_(
      await saveBlock(ports, moderator.access, {
        blockId: createdId,
        reason: 'попытка сменить причину',
        forever: false,
        until: 1_700_000_060_000,
      }),
    )
    expect(blocks.get(createdId)?.reason).toBe('исходная причина')
    expect(blocks.get(createdId)?.until).toBe(1_700_000_060_000)

    // block.edit меняет и причину, и срок
    ok_(
      await saveBlock(ports, editor.access, {
        blockId: createdId,
        reason: 'обновлённая причина',
        forever: true,
      }),
    )
    expect(blocks.get(createdId)?.reason).toBe('обновлённая причина')
    expect(blocks.get(createdId)?.until).toBeNull()
  })

  test('deleteBlock: мягкое удаление доступно кругу записи, полное — только связке записи + block.readDeleted или admin', async () => {
    const { ports, auths, blocks } = makePorts()
    const moderator = await joined(ports, auths, ['moderator'])
    const auditor = await joined(ports, auths, ['block.readDeleted'])
    const cleaner = await joined(ports, auths, ['block.edit', 'block.readDeleted'])
    const target = await joined(ports, auths)

    ok_(
      await saveBlock(ports, moderator.access, {
        targetId: target.id,
        scope: 'profile.delete',
        reason: 'защита',
        forever: true,
      }),
    )
    const id = [...blocks.keys()][0]!

    // Модератор без block.readDeleted не может запросить hard: true
    expect(fact_(await deleteBlock(ports, moderator.access, { blockId: id, hard: true })).code).toBe('auth.forbidden')

    // Мягкое удаление модератором проходит
    const soft = ok_(await deleteBlock(ports, moderator.access, { blockId: id }))
    expect(soft.hard).toBe(false)
    expect(blocks.get(id)?.deletedAt).not.toBeNull()

    // Чистый аудитор (только block.readDeleted) видит удалённую запись read-only без кнопки удаления
    const deletedForAuditor = ok_(await readBlockDetail(ports, auditor.access, { blockId: id }))
    expect(deletedForAuditor.canSubmit).toBe(false)
    expect(deletedForAuditor.canDelete).toBe(false)
    expect(fact_(await deleteBlock(ports, auditor.access, { blockId: id, hard: true })).code).toBe('auth.forbidden')

    // Связка block.edit + block.readDeleted видит canDelete = true и стирает запись окончательно
    const deletedForCleaner = ok_(await readBlockDetail(ports, cleaner.access, { blockId: id }))
    expect(deletedForCleaner.canSubmit).toBe(false)
    expect(deletedForCleaner.canDelete).toBe(true)
    expect(deletedForCleaner.canHardDelete).toBe(true)

    const hard = ok_(await deleteBlock(ports, cleaner.access, { blockId: id }))
    expect(hard.hard).toBe(true)
    expect(blocks.has(id)).toBe(false)
  })
})
