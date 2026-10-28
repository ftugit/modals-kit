/**
 * Конфиг-API (`config-api.ts`) — над портами в памяти, как `accounts.test.ts`:
 * проверяются права по схемам ключей и правило «умолчание не хранится»,
 * не транспорт. Вход настоящий (`keys.ts`), БД — Map.
 */
import { describe, expect, test } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { issueChallenge, login, type UserResult } from './auth.js'
import {
  createUserKey, deleteDefaultKey, getEffective, getUserKey, removeUserKey, setDefault, setUserKey,
} from './config-api.js'
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

describe('конфиг-API: умолчания и схемы', () => {
  test('новый ключ умолчания создаёт только админ; эффективное значение — строка умолчания поверх бутстрапа', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const plain = await joined(ports, auths)

    // бутстрап без строк: session.ipLock выключен (`spec-config.ts`)
    expect(await getEffective(ports, plain.id, 'session.ipLock')).toBe(false)

    expect(fact_(await setDefault(ports, plain.access, 'session.ipLock', { value: true })).code).toBe('auth.forbidden')
    ok_(await setDefault(ports, admin.access, 'session.ipLock', {
      value: false,
      schema: { editDefault: ['admin'], assign: ['admin'], editUser: ['admin'], deleteUser: ['admin'] },
    }))
    expect(await getEffective(ports, plain.id, 'session.ipLock')).toBe(false)

    // кэш умолчаний сброшен записью: новое значение видно сразу
    ok_(await setDefault(ports, admin.access, 'session.ipLock', { value: true }))
    expect(await getEffective(ports, plain.id, 'session.ipLock')).toBe(true)
  })

  test('assign создаёт ключ за юзером; владелец не может ни создать, ни изменить ipLock, но читает', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const user = await joined(ports, auths)
    ok_(await setDefault(ports, admin.access, 'session.ipLock', {
      value: false,
      schema: { editDefault: ['admin'], assign: ['admin'], editUser: ['admin'], deleteUser: ['admin'] },
    }))

    expect(fact_(await createUserKey(ports, user.access, user.id, 'session.ipLock', true)).code).toBe('auth.forbidden')
    ok_(await createUserKey(ports, admin.access, user.id, 'session.ipLock', true))
    expect(await getEffective(ports, user.id, 'session.ipLock')).toBe(true)

    const seen = ok_(await getUserKey(ports, user.access, user.id, 'session.ipLock'))
    expect(seen).toEqual({ key: 'session.ipLock', value: true, assigned: true })
    expect(fact_(await setUserKey(ports, user.access, user.id, 'session.ipLock', false)).code).toBe('auth.forbidden')
    expect(fact_(await removeUserKey(ports, user.access, user.id, 'session.ipLock')).code).toBe('auth.forbidden')
  })

  test('умолчание не хранится: создание с эффективным значением молча без строки, запись умолчания удаляет строку', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const user = await joined(ports, auths)
    ok_(await setDefault(ports, admin.access, 'prefs.theme', {
      value: 'light',
      schema: { editDefault: ['admin'], assign: ['admin', 'owner'], editUser: ['owner'], deleteUser: ['owner'] },
    }))

    // значение = умолчание, строки нет — успех без записи
    expect(ok_(await createUserKey(ports, admin.access, user.id, 'prefs.theme', 'light'))).toEqual({ stored: false })
    expect(ok_(await getUserKey(ports, admin.access, user.id, 'prefs.theme')).assigned).toBe(false)

    // своё значение хранится, владелец меняет сам (editUser: owner)
    ok_(await setUserKey(ports, user.access, user.id, 'prefs.theme', 'dark'))
    expect(await getEffective(ports, user.id, 'prefs.theme')).toBe('dark')
    // запись обратно в умолчание удалила строку юзера
    expect(ok_(await setUserKey(ports, user.access, user.id, 'prefs.theme', 'light'))).toEqual({ stored: false })
    expect(ok_(await getUserKey(ports, admin.access, user.id, 'prefs.theme')).assigned).toBe(false)
  })

  test('упрощённая схема строки перекрывает editUser умолчания', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const user = await joined(ports, auths)
    ok_(await setDefault(ports, admin.access, 'prefs.lang', {
      value: 'ru',
      schema: { editDefault: ['admin'], assign: ['admin'], editUser: ['admin'], deleteUser: ['admin'] },
    }))
    ok_(await createUserKey(ports, admin.access, user.id, 'prefs.lang', 'en', { editUser: ['owner'], deleteUser: ['owner'] }))
    // умолчание говорит «только админ», но у строки своя упрощённая схема — владелец правит и снимает своё
    ok_(await setUserKey(ports, user.access, user.id, 'prefs.lang', 'de'))
    expect(await getEffective(ports, user.id, 'prefs.lang')).toBe('de')
    ok_(await removeUserKey(ports, user.access, user.id, 'prefs.lang'))
  })

  test('удаление умолчания при живых юзерских строках запрещено; схема с незнакомой ролью отклоняется', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const user = await joined(ports, auths)
    ok_(await setDefault(ports, admin.access, 'prefs.theme', {
      value: 'light',
      schema: { editDefault: ['admin'], assign: ['admin', 'owner'], editUser: ['owner'], deleteUser: ['owner'] },
    }))
    ok_(await setUserKey(ports, user.access, user.id, 'prefs.theme', 'dark'))

    expect(fact_(await deleteDefaultKey(ports, admin.access, 'prefs.theme')).code).toBe('auth.forbidden')
    ok_(await removeUserKey(ports, user.access, user.id, 'prefs.theme'))
    ok_(await deleteDefaultKey(ports, admin.access, 'prefs.theme'))
    expect(await getEffective(ports, user.id, 'prefs.theme')).toBeUndefined()

    expect(fact_(await setDefault(ports, admin.access, 'prefs.lang', { schema: { assign: ['wizard'] } })).code)
      .toBe('permissions.unknown')
    expect(fact_(await setUserKey(ports, admin.access, 'no-such-user', 'prefs.theme', 'x')).code).toBe('auth.identity-unknown')
  })
})
