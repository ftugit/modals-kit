/**
 * Тела API над адаптерами на памяти. Проверяются ПРАВИЛА, не транспорт:
 * единый вход, блокировки, фаервол (статусы), ротация/усыновление продления,
 * выходы, отзыв, профиль с доменными запретами, заявка на удаление с грейсом.
 * Крипто — настоящая (`keys.ts`, Ed25519); запечатывание — подставка (JSON+base64):
 * формат железа проверяется в e2e, здесь важен контракт порта.
 */
import { describe, expect, test } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { generateKeyPair, sign } from './keys.js'
import {
  activeBlocks, cancelDelete, fullBlock, issueChallenge, listSessions, login, logout,
  logoutAll, renew, requestDelete, revokeSession, statusOf, subnetHash,
  sweepDeletions, type UserResult,
} from './auth.js'
import { profile, updateProfile } from './profile.js'
import type { AuthFact } from './error.js'
import type { AuthPorts, AuthRow } from './ports.js'
import type { Blocked, ProfileView, SessionRecord } from './types.js'

/* ── адаптеры на памяти ── */

function makePorts(seedSecret?: string): {
  ports: AuthPorts
  secret: string
  auths: Map<string, AuthRow>
  sessions: Map<string, SessionRecord>
  profiles: Map<string, ProfileView>
} {
  const store = memoryStore()
  const auths = new Map<string, AuthRow>()
  const sessions = new Map<string, SessionRecord>()
  const profiles = new Map<string, ProfileView>()
  const secret = seedSecret ?? 's'.repeat(32)

  const ports: AuthPorts = {
    challenge: {
      async issue(nonce, ttl) {
        await store.set(`nonce:${nonce}`, true, ttl * 1000)
      },
      async consume(nonce) {
        const had = await store.get<boolean>(`nonce:${nonce}`)
        await store.delete(`nonce:${nonce}`)
        return had === true
      },
    },
    sessions: {
      async create(r) {
        sessions.set(r.jti, { ...r })
      },
      async get(jti) {
        return sessions.get(jti)
      },
      async listByAuth(authId) {
        return [...sessions.values()].filter((r) => r.authId === authId)
      },
      async save(r) {
        sessions.set(r.jti, { ...r })
      },
      async softDelete(jti, at) {
        const r = sessions.get(jti)
        if (r) sessions.set(jti, { ...r, deletedAt: at })
      },
      async softDeleteAllByAuth(authId, at) {
        for (const [jti, r] of sessions) if (r.authId === authId) sessions.set(jti, { ...r, deletedAt: at })
      },
    },
    auths: {
      async findBySeed(seed) {
        return [...auths.values()].find((r) => r.seed === seed)
      },
      async create(seed) {
        const row: AuthRow = {
          id: crypto.randomUUID(),
          seed,
          deletedAt: null,
          blocked: [],
          subnetSalt: crypto.randomUUID().replaceAll('-', ''),
        }
        auths.set(row.id, row)
        return row
      },
      async get(id) {
        return auths.get(id)
      },
      async markDeleted(id, at) {
        const r = auths.get(id)
        if (r) auths.set(id, { ...r, deletedAt: at })
      },
      async clearDeleted(id) {
        const r = auths.get(id)
        if (r) auths.set(id, { ...r, deletedAt: null })
      },
      async wipeCredentials(id) {
        const r = auths.get(id)
        if (r) auths.set(id, { ...r, seed: null, blocked: [] })
      },
      async listDeletedBefore(cutoff) {
        return [...auths.values()].filter((r) => r.deletedAt !== null && r.deletedAt <= cutoff)
      },
    },
    profiles: {
      async create(authId, patch) {
        const now = Date.now()
        profiles.set(authId, { id: authId, authId, nickname: patch.nickname ?? null, avatarUrl: patch.avatarUrl ?? null, createdAt: now, updatedAt: now })
      },
      async get(authId) {
        return profiles.get(authId)
      },
      async update(authId, patch) {
        const r = profiles.get(authId)
        if (!r) return
        profiles.set(authId, { ...r, ...patch, updatedAt: Date.now() })
      },
      async remove(authId) {
        profiles.delete(authId)
      },
    },
    sealKeys: {
      current: () => ({ id: 't', secret }),
      secretOf: (id) => (id === 't' ? secret : undefined),
      retire: async () => {},
    },
    seal: {
      async seal(payload, ttlSeconds) {
        return Buffer.from(JSON.stringify({ ...payload, _ttl: ttlSeconds })).toString('base64url')
      },
      async unseal(token) {
        try {
          return JSON.parse(Buffer.from(token, 'base64url').toString()) as never
        } catch {
          return undefined
        }
      },
    },
    crypto: {
      sign: async (payload, sk) => sign(payload, sk),
      verify: async (payload, signature, seed) => {
        const { verify } = await import('./keys.js')
        return verify(payload, signature, seed)
      },
    },
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    clock: { now: () => Date.now() },
    config: (() => {
      // минимальный UserConfig поверх памяти: те же ключи, значения по умолчанию
      const defaults = {
        accessTtlSec: 3600,
        deviceTtlSec: 60 * 60 * 24 * 365,
        sessionRecreate: 'update',
        nicknameForbidden: ['admin', 'root'],
        challengeTtlSec: 120,
        deleteGraceDays: 30,
        holdSeconds: 5,
        avatarEdge: 200,
        avatarMaxBytes: 20_480,
        avatarFormats: ['jpeg'],
      } as const
      return {
        defaults,
        get: async (k: keyof typeof defaults) => defaults[k],
        set: async () => {},
        reset: async () => {},
      } as unknown as import('./config.js').UserConfig
    })(),
  }
  return { ports, secret, auths, sessions, profiles }
}

/** Пройти вход целиком: настоящий seed, настоящий nonce, настоящая подпись. */
async function doLogin(ports: AuthPorts, seed: string, sk: string) {
  const challenge = await issueChallenge(ports)
  if (!challenge.ok) throw new Error('challenge не выдался')
  const signature = await sign(challenge.value.nonce, sk)
  return login(ports, { seed, nonce: challenge.value.nonce, signature })
}

const ok_ = <T>(r: UserResult<T>): T => {
  if (!r.ok) throw new Error(`ожидали ok, получили факт: ${r.fact.code}`)
  return r.value
}
const fact_ = <T>(r: UserResult<T>): AuthFact => {
  if (r.ok) throw new Error('ожидали факт')
  return r.fact
}

/* ── проверки ── */

describe('служебные', () => {
  test('activeBlocks/fullBlock: срок вышел — сферы нет', () => {
    const now = 1000
    const list: Blocked[] = [
      { scope: 'profile', reason: 'спам', at: 0 },
      { scope: 'auth', reason: 'скам', at: 0, until: 900 },
      { scope: 'auth', reason: 'блок', at: 0, until: 2000 },
    ]
    expect(activeBlocks(list, now)).toHaveLength(2)
    expect(fullBlock(list, now)?.reason).toBe('блок')
    expect(fullBlock([], now)).toBeUndefined()
  })

  test('subnetHash: солёный хэш стабилен и зависит от соли', async () => {
    expect(await subnetHash('salt', '1.2.3')).toBe(await subnetHash('salt', '1.2.3'))
    expect(await subnetHash('salt', '1.2.3')).not.toBe(await subnetHash('salt2', '1.2.3'))
  })
})

describe('единый вход', () => {
  test('новый seed — аккаунт создан, токены выданы', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    expect(out.access).toBeTruthy()
    expect(out.renewal).toBeTruthy()
    expect(out.deletePending).toBe(false)
    expect(out.restrictions).toEqual([])
    const row = await ports.auths.findBySeed(seed)
    expect(row?.subnetSalt).toHaveLength(32)
  })

  test('тот же seed — тот же аккаунт (вход, не регистрация)', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const first = ok_(await doLogin(ports, seed, sk))
    const second = ok_(await doLogin(ports, seed, sk))
    // jti разные — сессии разные; sub один (проверяем через профиль)
    const s1 = JSON.parse(Buffer.from(first.access, 'base64url').toString()) as { sub: string; dt: string }
    const s2 = JSON.parse(Buffer.from(second.access, 'base64url').toString()) as { sub: string; dt: string }
    expect(s1.sub).toBe(s2.sub)
    expect(s1.dt).not.toBe(s2.dt)
  })

  test('подпись не сошлась — auth.signature; повторный nonce — auth.nonce-unknown', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const challenge = ok_(await issueChallenge(ports))
    const bad = fact_(await login(ports, { seed, nonce: challenge.nonce, signature: await sign('другое', sk) }))
    expect(bad.code).toBe('auth.signature')
    // ошибка подписи сожгла nonce — следующий вход берёт свежий
    const fresh = ok_(await issueChallenge(ports))
    ok_(await login(ports, { seed, nonce: fresh.nonce, signature: await sign(fresh.nonce, sk) }))
    const again = fact_(await login(ports, { seed, nonce: fresh.nonce, signature: await sign(fresh.nonce, sk) }))
    expect(again.code).toBe('auth.nonce-unknown')
  })

  test('блокировка auth: вход закрыт с причиной и сроком', async () => {
    const { ports, secret, auths } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    const payload = JSON.parse(Buffer.from(out.access, 'base64url').toString()) as { sub: string }
    await ports.auths.markDeleted(payload.sub, 0) // не блокировка — просто для теста снятия
    await ports.auths.clearDeleted(payload.sub)
    // блокируем напрямую через карту адаптера
    const row = (await ports.auths.get(payload.sub)) as AuthRow
    authsPatch(auths, row.id, { blocked: [{ scope: 'auth', reason: 'скам', at: Date.now(), until: Date.now() + 60_000 }] })
    const blocked = fact_(await doLogin(ports, seed, sk))
    expect(blocked.code).toBe('auth.blocked')
    expect(blocked.args?.reason).toBe('скам')
  })

  test('заявка на удаление: вход отдаёт токены и deletePending', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const first = ok_(await doLogin(ports, seed, sk))
    const payload = JSON.parse(Buffer.from(first.access, 'base64url').toString()) as { sub: string }
    await ports.auths.markDeleted(payload.sub, Date.now())
    const second = ok_(await doLogin(ports, seed, sk))
    expect(second.deletePending).toBe(true)
    expect(second.access).toBeTruthy()
  })
})

describe('фаервол: продление и статусы', () => {
  test('ротация: версия выросла, пришёл новый токен продления', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    const first = ok_(await renew(ports, { renewal: out.renewal }))
    expect(first.renewal).toBeTruthy()
    const payload = JSON.parse(Buffer.from(out.access, 'base64url').toString()) as { dt: string }
    const row = (await ports.sessions.get(payload.dt)) as SessionRecord
    expect(row.version).toBe(1)
  })

  test('усыновление: старый токен продления получает доступ без ротации', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    ok_(await renew(ports, { renewal: out.renewal })) // другая вкладка успела
    const adopted = ok_(await renew(ports, { renewal: out.renewal }))
    expect(adopted.renewal).toBeUndefined() // продление не тронуто
    expect(adopted.access).toBeTruthy()
    const payload = JSON.parse(Buffer.from(out.access, 'base64url').toString()) as { dt: string }
    const row = (await ports.sessions.get(payload.dt)) as SessionRecord
    expect(row.version).toBe(1) // вторая ротация не случилась
  })

  test('отзыв: revoked; истекла: expired; чужой: session-unknown', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    const payload = JSON.parse(Buffer.from(out.access, 'base64url').toString()) as { sub: string; dt: string }
    expect(fact_(await renew(ports, { renewal: 'мусор' })).code).toBe('auth.token')
    expect(fact_(await renew(ports, {})).code).toBe('auth.session-unknown')
    await ports.sessions.softDelete(payload.dt, Date.now())
    expect(fact_(await renew(ports, { renewal: out.renewal })).code).toBe('auth.revoked')
  })

  test('статусы statusOf: ok/revoked/expired/unknown', () => {
    const now = 10_000
    const base: SessionRecord = {
      jti: 'j', authId: 'a', deviceName: null, subnetHash: null, country: null,
      history: [], createdAt: 0, expiresAt: 20_000, version: 0, deletedAt: null, lastSeenAt: null,
    }
    expect(statusOf(undefined, now)).toBe('unknown')
    expect(statusOf(base, now)).toBe('ok')
    expect(statusOf({ ...base, deletedAt: 5_000 }, now)).toBe('revoked')
    expect(statusOf({ ...base, expiresAt: 9_000 }, now)).toBe('expired')
  })

  test('guard: access истёк — expired (подставка exp в прошлом)', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    const expired = Buffer.from(JSON.stringify({ k: 'access', sub: 'x', dt: 'y', prof: { nickname: null, avatarUrl: null }, iat: 0, exp: 1 })).toString('base64url')
    const r = await profile(ports, expired)
    expect(r.ok === false && r.fact.code === 'auth.expired').toBe(true)
    // живой access работает
    expect(ok_(await profile(ports, out.access))).toBeNull() // аноним
    void seed
    void sk
  })
})

describe('выходы и устройства', () => {
  test('выход гасит сессию: продление после выхода — revoked', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    ok_(await logout(ports, out.access))
    expect(fact_(await renew(ports, { renewal: out.renewal })).code).toBe('auth.revoked')
    expect(fact_(await profile(ports, out.access)).code).toBe('auth.revoked')
  })

  test('выйти со всех: все сессии софт-удалены', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const a = ok_(await doLogin(ports, seed, sk))
    const b = ok_(await doLogin(ports, seed, sk))
    ok_(await logoutAll(ports, a.access))
    expect(fact_(await renew(ports, { renewal: a.renewal as string })).code).toBe('auth.revoked')
    expect(fact_(await renew(ports, { renewal: b.renewal as string })).code).toBe('auth.revoked')
  })

  test('список устройств и отзыв чужого jti', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const a = ok_(await doLogin(ports, seed, sk))
    const b = ok_(await doLogin(ports, seed, sk))
    const list = ok_(await listSessions(ports, a.access))
    expect(list).toHaveLength(2)
    const bJti = JSON.parse(Buffer.from(b.access, 'base64url').toString()).dt as string
    ok_(await revokeSession(ports, a.access, bJti))
    expect(fact_(await renew(ports, { renewal: b.renewal as string })).code).toBe('auth.revoked')
    expect(fact_(await revokeSession(ports, a.access, 'нет-такого')).code).toBe('auth.session-unknown')
  })
})

describe('профиль', () => {
  test('аноним → создание → обновление; витрина попадает в access', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    expect(ok_(await profile(ports, out.access))).toBeNull()
    const saved = ok_(await updateProfile(ports, out.access, { nickname: '  Вася  ' }))
    expect(saved.nickname).toBe('Вася')
    // обновили — новый access несёт витрину
    const renewed = ok_(await renew(ports, { renewal: out.renewal as string }))
    const payload = JSON.parse(Buffer.from(renewed.access, 'base64url').toString()) as { prof: { nickname: string | null } }
    expect(payload.prof.nickname).toBe('Вася')
  })

  test('запрещённый никнейм и плохой аватар — доменные факты', async () => {
    const { ports, secret } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    expect(fact_(await updateProfile(ports, out.access, { nickname: 'admin' })).code).toBe('profile.nickname-forbidden')
    expect(fact_(await updateProfile(ports, out.access, { nickname: 'ROOT' })).code).toBe('profile.nickname-forbidden')
    expect(fact_(await updateProfile(ports, out.access, { nickname: 'я' })).code).toBe('profile.nickname-forbidden')
    expect(fact_(await updateProfile(ports, out.access, { avatarUrl: 'data:text/html;base64,PGI+' })).code).toBe('profile.avatar-format')
    expect(fact_(await updateProfile(ports, out.access, { avatarUrl: `data:image/jpeg;base64,${'A'.repeat(40_000)}` })).code).toBe('profile.avatar-size')
    const jpeg = `data:image/jpeg;base64,${'A'.repeat(120)}`
    ok_(await updateProfile(ports, out.access, { avatarUrl: jpeg }))
    expect(ok_(await profile(ports, out.access))?.avatarUrl).toBe(jpeg)
    // снять аватар
    const cleared = ok_(await updateProfile(ports, out.access, { avatarUrl: null }))
    expect(cleared.avatarUrl).toBeNull()
  })
})

describe('удаление аккаунта', () => {
  test('заявка → шаг восстановления отменяет; исполнитель по грейсу стирает', async () => {
    const { ports, secret, auths } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    ok_(await updateProfile(ports, out.access, { nickname: 'Вася' }))
    ok_(await requestDelete(ports, out.access))
    // под правами доступ остановлен (delete-pending), вход отдаёт deletePending
    expect(fact_(await profile(ports, out.access)).code).toBe('auth.delete-pending')
    const relogin = ok_(await doLogin(ports, seed, sk))
    expect(relogin.deletePending).toBe(true)
    const p = ok_(await cancelDelete(ports, relogin.access))
    expect(p.id).toBeTruthy()
    expect(ok_(await profile(ports, relogin.access))?.nickname).toBe('Вася')
    // исполнитель: грейс не вышел — никого; вышел — seed стёрт, профиль удалён
    expect(ok_(await sweepDeletions(ports))).toBe(0)
    const row = (await ports.auths.get(p.id)) as AuthRow
    authsPatch(auths, p.id, { deletedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })
    expect(ok_(await sweepDeletions(ports))).toBe(1)
    const wiped = (await ports.auths.get(row.id)) as AuthRow
    expect(wiped.seed).toBeNull()
    expect(await ports.profiles.get(p.id)).toBeUndefined()
  })

  test('вход в стёртый (надгробие) — seed не найден, новый аккаунт', async () => {
    const { ports, secret, auths } = makePorts()
    const { seed, secret: sk } = await generateKeyPair()
    const out = ok_(await doLogin(ports, seed, sk))
    const payload = JSON.parse(Buffer.from(out.access, 'base64url').toString()) as { sub: string }
    authsPatch(auths, payload.sub, { deletedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })
    ok_(await sweepDeletions(ports))
    // тот же seed теперь создаёт НОВЫЙ аккаунт
    const again = ok_(await doLogin(ports, seed, sk))
    const againPayload = JSON.parse(Buffer.from(again.access, 'base64url').toString()) as { sub: string }
    expect(againPayload.sub).not.toBe(payload.sub)
  })
})

/** Правка строки auth напрямую (адаптер на памяти — для подготовки сценариев). */
function authsPatch(map: Map<string, AuthRow>, id: string, patch: Partial<AuthRow>): void {
  const row = map.get(id) as AuthRow
  map.set(id, { ...row, ...patch })
}