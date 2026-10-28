/**
 * Выдача прав (`admin.ts`) — над портами в памяти, как `emulate.test.ts`:
 * проверяются правила, не транспорт. Крипто настоящее (`keys.ts`), БД — Map.
 */
import { describe, expect, test } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { issueChallenge, login, type UserResult } from './auth.js'
import { setPermissions } from './admin.js'
import { generateKeyPair, sign } from './keys.js'
import type { AuthFact } from './error.js'
import type { AuthPorts, AuthRow } from './ports.js'
import type { ProfileView, SessionRecord } from './types.js'

const ok_ = <T>(r: UserResult<T>): T => {
  if (!r.ok) throw new Error(`ожидали ok, получили факт: ${r.fact.code}`)
  return r.value
}
const fact_ = <T>(r: UserResult<T>): AuthFact => {
  if (r.ok) throw new Error('ожидали факт')
  return r.fact
}

/** Минимальные порты: вход, сессии, auth со списком прав. Профиль не нужен. */
function makePorts(): { ports: AuthPorts; auths: Map<string, AuthRow> } {
  const store = memoryStore()
  const auths = new Map<string, AuthRow>()
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
  return { ports, auths }
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
  return { access: out.access, id: sub.sub }
}

describe('выдача прав', () => {
  test('без админа — отказ, с админом — выдача и снятие', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const user = await joined(ports, auths)

    // обычный пользователь выдать права не может
    expect(
      fact_(await setPermissions(ports, user.access, { targetId: user.id, permissions: ['profile.read'] })).code,
    ).toBe('auth.forbidden')

    // аноним — тоже
    expect(fact_(await setPermissions(ports, undefined, { targetId: user.id, permissions: [] })).code).toBe(
      'auth.expired',
    )

    // админ выдаёт
    const granted = ok_(await setPermissions(ports, admin.access, { targetId: user.id, permissions: ['profile.read'] }))
    expect(granted.permissions).toEqual(['profile.read'])
    expect(auths.get(user.id)?.permissions).toEqual(['profile.read'])

    // и снимает
    const cleared = ok_(await setPermissions(ports, admin.access, { targetId: user.id, permissions: [] }))
    expect(cleared.permissions).toEqual([])
    expect(auths.get(user.id)?.permissions).toEqual([])

    // повтор в списке не плодится, `admin` — допустимое значение наравне с правами
    const both = ok_(
      await setPermissions(ports, admin.access, { targetId: user.id, permissions: ['admin', 'profile.read', 'admin'] }),
    )
    expect(both.permissions).toEqual(['admin', 'profile.read'])
  })

  test('свои права менять нельзя, незнакомое право — отказ, чужой id — нет такого', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const user = await joined(ports, auths)

    expect(fact_(await setPermissions(ports, admin.access, { targetId: admin.id, permissions: [] })).code).toBe(
      'permissions.self',
    )
    expect(
      fact_(await setPermissions(ports, admin.access, { targetId: user.id, permissions: ['profile.reed'] })).code,
    ).toBe('permissions.unknown')
    expect(
      fact_(await setPermissions(ports, admin.access, { targetId: crypto.randomUUID(), permissions: [] })).code,
    ).toBe('auth.identity-unknown')
    // ничего не записалось
    expect(auths.get(admin.id)?.permissions).toEqual(['admin'])
    expect(auths.get(user.id)?.permissions).toEqual([])
  })
})
