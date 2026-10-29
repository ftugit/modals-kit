/**
 * Конфиг-API (`config-api.ts`) — над портами в памяти, как `accounts.test.ts`:
 * проверяются права по схемам ключей и правило «умолчание не хранится»,
 * не транспорт. Вход настоящий (`keys.ts`), БД — Map.
 */
import { describe, expect, test } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { issueChallenge, login, type UserResult } from './auth.js'
import {
  createUserKey,
  deleteDefaultKey,
  getEffective,
  getUserKey,
  listUserConfig,
  removeUserKey,
  saveUserConfig,
  setDefault,
  setUserKey,
} from './config-api.js'
import { createUserConfigDescription } from './ui/user-config/form.js'
import { generateKeyPair, sign } from './keys.js'
import { publicProfile, setVisibility } from './profile.js'
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

function makePorts() {
  const store = memoryStore()
  const auths = new Map<string, AuthRow & { blocked: Blocked[] }>()
  const sessions = new Map<string, SessionRecord>()
  const profileRows = new Map<string, ProfileView>()
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
      async create(_ctx: unknown, authId: string, patch: { nickname?: string; avatarUrl?: string }) {
        profileRows.set(authId, {
          id: `prof-${authId}`,
          authId,
          nickname: patch.nickname ?? null,
          avatarUrl: patch.avatarUrl ?? null,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        })
      },
      async get(_ctx: unknown, authId: string) {
        return profileRows.get(authId)
      },
      async update(_ctx: unknown, authId: string, patch: { nickname?: string; avatarUrl?: string | null }) {
        const r = profileRows.get(authId)
        if (r) profileRows.set(authId, { ...r, ...patch })
      },
      async remove(_ctx: unknown, authId: string) {
        profileRows.delete(authId)
      },
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
      async listPage() { return { rows: [], total: 0 } },
      async getById() { return undefined },
      async update(_ctx: unknown, id: string, patch: { until?: number | null; reason?: string }) {
        for (const r of auths.values()) {
          const i = r.blocked.findIndex((b, j) => `blk-${r.id}-${j}` === id)
          if (i >= 0) r.blocked = r.blocked.map((b, j) => (j === i ? { ...b, ...(patch.until != null ? { until: patch.until } : {}) } : b))
        }
      },
      async remove() {},
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
        async rowsByUser(authId: string | null) { return rows.filter((r) => r.authId === authId) },
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

  test('удаление умолчания при живых юзерских строках запрещено; произвольные валидные роли/права работают, мусорные токены отклоняются', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const user = await joined(ports, auths)
    const wizard = await joined(ports, auths, ['wizard', 'config.edit'])
    ok_(await setDefault(ports, admin.access, 'prefs.theme', {
      value: 'light',
      schema: { editDefault: ['admin'], assign: ['admin', 'owner'], editUser: ['owner'], deleteUser: ['owner'] },
    }))
    ok_(await setUserKey(ports, user.access, user.id, 'prefs.theme', 'dark'))

    expect(fact_(await deleteDefaultKey(ports, admin.access, 'prefs.theme')).code).toBe('auth.forbidden')
    ok_(await removeUserKey(ports, user.access, user.id, 'prefs.theme'))
    ok_(await deleteDefaultKey(ports, admin.access, 'prefs.theme'))
    expect(await getEffective(ports, user.id, 'prefs.theme')).toBeUndefined()

    // роли и права технически идентичны: произвольный валидный токен (`wizard`, `config.edit`, `a.b.c`) принимается и исполняется через checkGrants
    ok_(await setDefault(ports, admin.access, 'prefs.lang', {
      value: 'ru',
      schema: { assign: ['wizard'], editUser: ['config.edit'], deleteUser: ['a.b.c'] },
    }))
    ok_(await createUserKey(ports, wizard.access, user.id, 'prefs.lang', 'en'))
    ok_(await setUserKey(ports, wizard.access, user.id, 'prefs.lang', 'de'))
    expect(fact_(await removeUserKey(ports, wizard.access, user.id, 'prefs.lang')).code).toBe('auth.forbidden')

    // пустые/битые токены и неизвестные правила схемы отклоняются
    expect(fact_(await setDefault(ports, admin.access, 'prefs.bad', { schema: { assign: [''] } })).code)
      .toBe('permissions.unknown')
    expect(fact_(await setDefault(ports, admin.access, 'prefs.bad', { schema: { assign: ['bad token!'] } })).code)
      .toBe('permissions.unknown')
    expect(
      fact_(
        await setDefault(ports, admin.access, 'prefs.bad', {
          schema: { unknownRule: ['admin'] } as never,
        }),
      ).code,
    ).toBe('permissions.unknown')
    expect(fact_(await setUserKey(ports, admin.access, 'no-such-user', 'prefs.theme', 'x')).code).toBe('auth.identity-unknown')
  })
})

describe('UserConfig: срез listUserConfig, сохранение saveUserConfig и защита софт-удалённых', () => {
  test('владелец видит profile.visibility редактируемым и session.ipLock в read-only; незнакомые ключи БД скрыты; описание формы не включает read-only поля', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const owner = await joined(ports, auths)
    const reader = await joined(ports, auths, ['config.read'])
    const stranger = await joined(ports, auths)

    ok_(await setDefault(ports, admin.access, 'profile.visibility', {
      value: 'nobody',
      schema: { editDefault: ['admin'], assign: ['admin', 'owner'], editUser: ['admin', 'owner'], deleteUser: ['admin', 'owner'] },
    }))
    ok_(await setDefault(ports, admin.access, 'session.ipLock', {
      value: false,
      schema: { editDefault: ['admin'], assign: ['admin'], editUser: ['admin'], deleteUser: ['admin'] },
    }))
    ok_(await setDefault(ports, admin.access, 'internal.unknownKey', {
      value: 'secret',
      schema: { editDefault: ['admin'], assign: ['admin', 'owner'], editUser: ['owner'], deleteUser: ['owner'] },
    }))
    ok_(await createUserKey(ports, admin.access, owner.id, 'session.ipLock', true))

    const ownSlice = ok_(await listUserConfig(ports, owner.access))
    expect(ownSlice.isOwn).toBe(true)
    expect(ownSlice.canSave).toBe(true)
    expect(ownSlice.items.map((i) => i.key)).toEqual(['profile.visibility', 'session.ipLock'])
    const visItem = ownSlice.items.find((i) => i.key === 'profile.visibility')!
    const ipItem = ownSlice.items.find((i) => i.key === 'session.ipLock')!
    expect(visItem.editable).toBe(true)
    expect(ipItem.editable).toBe(false)
    expect(ipItem.value).toBe(true)
    expect(ipItem.overridden).toBe(true)

    const desc = createUserConfigDescription(ownSlice.items.filter((i) => i.editable))
    expect(Object.keys(desc.byName).sort()).toEqual(['profile_visibility', 'subject'])

    // config.read видит оба параметра чужого пользователя в режиме read-only (canSave = false)
    const readSlice = ok_(await listUserConfig(ports, reader.access, owner.id))
    expect(readSlice.isOwn).toBe(false)
    expect(readSlice.canSave).toBe(false)
    expect(readSlice.items.every((i) => !i.editable)).toBe(true)

    // посторонний без прав получает auth.forbidden
    expect(fact_(await listUserConfig(ports, stranger.access, owner.id)).code).toBe('auth.forbidden')

    // сохранение и сброс к умолчанию владельцем + запрет изменения read-only ключа
    const saved = ok_(await saveUserConfig(ports, owner.access, { patch: { 'profile.visibility': 'users' } }))
    expect(saved.items.find((i) => i.key === 'profile.visibility')?.value).toBe('users')
    expect(saved.items.find((i) => i.key === 'profile.visibility')?.overridden).toBe(true)

    expect(
      fact_(await saveUserConfig(ports, owner.access, { patch: { 'session.ipLock': false } })),
    ).toEqual({ code: 'config.rule-forbidden', path: 'session_ip_lock' })
    expect(
      fact_(await saveUserConfig(ports, owner.access, { patch: { 'profile.visibility': 'invalid' } })),
    ).toEqual({ code: 'config.value-invalid', path: 'profile_visibility' })
    expect(
      fact_(await saveUserConfig(ports, owner.access, { patch: { 'unknown.key': 1 } })),
    ).toEqual({ code: 'config.key-unknown' })

    const afterReset = ok_(await saveUserConfig(ports, owner.access, { resetKey: 'profile.visibility' }))
    expect(afterReset.items.find((i) => i.key === 'profile.visibility')?.value).toBe('nobody')
    expect(afterReset.items.find((i) => i.key === 'profile.visibility')?.overridden).toBe(false)
  })

  test('софт-удалённый чужой аккаунт скрыт (auth.identity-unknown) без права чтения удалённых', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const reader = await joined(ports, auths, ['config.read'])
    const auditReader = await joined(ports, auths, ['config.read', 'account.read', 'account.readDeleted'])
    const victim = await joined(ports, auths)

    await ports.auths.markDeleted(victim.id, Date.now())

    expect(fact_(await listUserConfig(ports, reader.access, victim.id)).code).toBe('auth.identity-unknown')
    expect(ok_(await listUserConfig(ports, auditReader.access, victim.id)).uid).toBe(victim.id)
    expect(ok_(await listUserConfig(ports, admin.access, victim.id)).uid).toBe(victim.id)
  })
})

describe('приватность профиля (этап 8): публичный показ и смена уровня', () => {
  test('гость видит all-проекцию без технических полей; users — отказ; вошедший видит users', async () => {
    const { ports, auths } = makePorts()
    const admin = await joined(ports, auths, ['admin'])
    const user = await joined(ports, auths)
    const guest2 = await joined(ports, auths)
    await ports.profiles.create({ principal: { roles: ['server'] } }, user.id, { nickname: 'Вася' })
    ok_(await setDefault(ports, admin.access, 'profile.visibility', {
      value: 'nobody',
      schema: { editDefault: ['admin'], assign: ['admin', 'owner'], editUser: ['admin', 'owner'], deleteUser: ['admin', 'owner'] },
    }))

    // nobody (умолчание): никому
    expect(fact_(await publicProfile(ports, undefined, user.id)).code).toBe('auth.identity-unknown')
    expect(fact_(await publicProfile(ports, guest2.access, user.id)).code).toBe('auth.identity-unknown')

    ok_(await setVisibility(ports, user.access, 'all'))
    const pub = ok_(await publicProfile(ports, undefined, user.id))
    expect(pub).toEqual({ nickname: 'Вася', avatarUrl: null, createdAt: 1700000000000 })
    expect(Object.keys(pub).sort()).toEqual(['avatarUrl', 'createdAt', 'nickname'])

    ok_(await setVisibility(ports, user.access, 'users'))
    expect(fact_(await publicProfile(ports, undefined, user.id)).code).toBe('auth.identity-unknown')
    expect(ok_(await publicProfile(ports, guest2.access, user.id)).nickname).toBe('Вася')

    // уровень не из каталога; чужую видимость менять некому (setter — только свою)
    expect(fact_(await setVisibility(ports, user.access, 'friends')).code).toBe('permissions.unknown')
    expect(ok_(await setVisibility(ports, guest2.access, 'nobody'))).toEqual({ stored: false })
    expect(fact_(await publicProfile(ports, undefined, guest2.id)).code).toBe('auth.identity-unknown')
  })
})
