/**
 * Связка модуля пользователя с SvelteKit: порты из хвостов проекта, куки,
 * фасад одного запроса. Только сервер (`#lib/server`, `$app/env/private`).
 *
 * ОБЩЕГО ВЫЗОВА НА ПРИЛОЖЕНИЕ НЕТ (решение владельца): никаких автопроверок в
 * hooks на каждый запрос. Каждый экшен/загрузка зовёт фасад `auth(event)` сам.
 *
 * Носитель токенов (модель владельца, ход 251): ОБА токена — HttpOnly-куки,
 * ставит только сервер по явному POST; временный дополнительно живёт в RAM
 * (vault), значение приходит из ответа api и из данных страницы.
 *
 * Хранилище адаптера — `#lib/server/cache` (память процесса с TTL): честные
 * сроки challenge/сессий в dev и e2e. Перенос на БД — замена ТРЁХ адаптеров
 * (`sessions`, `auths`, `profiles`) на ресурсы `schema.ts` (`user_*`), ядро
 * (`auth.ts`) не меняется — это и есть шов портов.
 */
import { AUTH_SEAL_ID, AUTH_SEAL_OLD_KEYS, AUTH_SEAL_SECRET } from '$app/env/private'
import * as Iron from 'iron-webcrypto'
import { localStore } from '#server/cache.server.js'
import { db } from '#server/db.server.js'
import type { Cookies } from '@sveltejs/kit'
import {
  createUserConfig,
  issueFreshAccess as coreIssueFreshAccess,
  listSessions as coreListSessions,
  login as coreLogin,
  logout as coreLogout,
  logoutAll as coreLogoutAll,
  renew as coreRenew,
  requestDelete as coreRequestDelete,
  revokeSession as coreRevokeSession,
  issueChallenge as coreIssueChallenge,
  restoreDeleted as coreRestoreDeleted,
  verifySeed as coreVerifySeed,
  type SessionView,
  type UserResult,
} from './index.js'
import { sign, verify } from './keys.js'
import { profile as coreProfile, updateProfile as coreUpdateProfile } from './profile.js'
import { auth as authRes, profile as profileRes, session as sessionRes } from './schema.js'
import type { AuthPorts, AuthRow } from './ports.js'
import { normalizeFailure, type DataContext } from '#lib/db/index.js'
import type { ProfileView, SessionRecord } from './types.js'
import type { Blocked, LoginOutcome } from './types.js'
import type { VaultSessionMeta } from './vault.js'

/** Кука токена продления (девайс-токен, `{jti, version}`). */
export const RENEWAL_COOKIE = 'auth_sid'
/** Кука временного токена (access). */
export const ACCESS_COOKIE = 'auth_tmp'

const COOKIE_BASE = { path: '/', httpOnly: true, sameSite: 'lax', secure: false } as const

/** Структурный срез SvelteKit-события: ядру нужны только куки. */
export interface AuthEvent {
  request: Request
  cookies: Cookies
}

/* ── ключи запечатывания (env, ротация как у курсорных) ── */

function sealKeysFromEnv(): { enabled: boolean; id: string; secret: string; old: Record<string, string> } {
  const secret = AUTH_SEAL_SECRET
  // Отсутствие секрета НЕ бросает (конвенция репо: без env функция выключается
  // с человеческим объяснением — как курсор lib/db без DB_CURSOR_SECRET), а
  // выключает вход: readVault даёт «не вошёл», страница входа — баннер, экшены
  // отвечают отказом auth.disabled. Короткий секрет ловит схема env.ts на старте.
  if (!secret || secret.length < 32) return { enabled: false, id: '', secret: '', old: {} }
  const id = AUTH_SEAL_ID || 'v1'
  const old: Record<string, string> = {}
  for (const pair of (AUTH_SEAL_OLD_KEYS ?? '').split(',')) {
    const [kid, value] = pair.split(':')
    if (kid && value && kid !== id) old[kid.trim()] = value.trim()
  }
  return { enabled: true, id, secret, old }
}

/** Вход включён? Секрет запечатывания задан и достаточной длины (константа процесса). */
export const AUTH_ENABLED = sealKeysFromEnv().enabled

/* ── адаптеры на ресурсы `lib/db` (таблицы schema.ts; RAM-версии отменены) ── */

/**
 * Системный контекст: модуль и есть арбитр (фаервол внутри api), таблицы ему
 * обслуживают серверные роли из политик схемы. Сигнала запроса здесь нет —
 * операции короткие и точечные.
 */
/**
 * Контекст серверного кода адаптеров (`auth`, `session`): только `server`.
 * `admin` здесь больше нет — сервер не берёт себе прав человека; действия,
 * которые должны идти от владельца, получают `principalOfRow` (профиль).
 */
const SYSTEM: DataContext = { principal: { roles: ['server'] } }

const ms = (v: unknown): number | null => (v ? new Date(String(v)).getTime() : null)
const iso = (v: number): string => new Date(v).toISOString()

function authRowOf(r: Record<string, unknown>): AuthRow {
  return {
    id: String(r.id),
    seed: (r.seed as string | null) ?? null,
    deletedAt: ms(r.deleted_at),
    blocked: (Array.isArray(r.blocked) ? r.blocked : []) as Blocked[],
    permissions: (Array.isArray(r.permissions) ? r.permissions : []).map(String),
    subnetSalt: String(r.subnet_salt ?? ''),
  }
}

function sessionRowOf(r: Record<string, unknown>): SessionRecord {
  return {
    jti: String(r.jti),
    authId: String(r.auth_id),
    deviceName: (r.device_name as string | null) ?? null,
    subnetHash: (r.subnet_hash as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    history: (Array.isArray(r.subnet_history) ? r.subnet_history : []) as SessionRecord['history'],
    createdAt: ms(r.created_at) ?? Date.now(),
    expiresAt: ms(r.expires_at) ?? 0,
    version: Number(r.version ?? 0),
    deletedAt: ms(r.deleted_at),
    lastSeenAt: ms(r.last_seen_at),
  }
}

function sessionsAdapter() {
  const api = () => db.resource(sessionRes)
  const byJti = async (jti: string): Promise<Record<string, unknown> | undefined> => {
    const rows = await api().select(SYSTEM, { filter: { field: 'jti', op: 'eq', value: jti }, includeDeleted: true })
    return rows[0] as unknown as Record<string, unknown> | undefined
  }
  return {
    async create(r: SessionRecord): Promise<void> {
      await api().insert(SYSTEM, {
        auth_id: r.authId,
        jti: r.jti,
        device_name: r.deviceName,
        subnet_hash: r.subnetHash,
        country: r.country,
        subnet_history: r.history,
        version: r.version,
        expires_at: iso(r.expiresAt),
        ...(r.lastSeenAt ? { last_seen_at: iso(r.lastSeenAt) } : {}),
      })
    },
    async get(jti: string): Promise<SessionRecord | undefined> {
      const row = await byJti(jti)
      return row ? sessionRowOf(row) : undefined
    },
    async listByAuth(authId: string): Promise<SessionRecord[]> {
      const rows = await api().select(SYSTEM, { filter: { field: 'auth_id', op: 'eq', value: authId }, includeDeleted: true })
      return (rows as unknown as Record<string, unknown>[]).map(sessionRowOf)
    },
    async save(r: SessionRecord): Promise<void> {
      const row = await byJti(r.jti)
      if (!row) return
      await api().update(SYSTEM, row.id, {
        device_name: r.deviceName,
        subnet_hash: r.subnetHash,
        country: r.country,
        subnet_history: r.history,
        version: r.version,
        expires_at: iso(r.expiresAt),
        ...(r.lastSeenAt ? { last_seen_at: iso(r.lastSeenAt) } : {}),
      })
    },
    async softDelete(jti: string, _at: number): Promise<void> {
      const row = await byJti(jti)
      if (row) await api().delete(SYSTEM, row.id)
    },
    async softDeleteAllByAuth(authId: string, at: number): Promise<void> {
      for (const r of await this.listByAuth(authId)) {
        if (r.deletedAt === null) await this.softDelete(r.jti, at)
      }
    },
  }
}

function authsAdapter() {
  const api = () => db.resource(authRes)
  return {
    async findBySeed(seed: string): Promise<AuthRow | undefined> {
      // без includeDeleted: модель сама добавляет deleted_at IS NULL —
      // аккаунт с заявкой на удаление обычному поиску не виден
      const rows = await api().select(SYSTEM, { filter: { field: 'seed', op: 'eq', value: seed } })
      const row = rows[0] as unknown as Record<string, unknown> | undefined
      return row ? authRowOf(row) : undefined
    },
    async findDeletedBySeed(seed: string): Promise<AuthRow | undefined> {
      // единственный includeDeleted по seed: зовётся ТОЛЬКО после
      // доказательства владения (restoreDeleted в ядре)
      const rows = await api().select(SYSTEM, { filter: { field: 'seed', op: 'eq', value: seed }, includeDeleted: true })
      const row = rows[0] as unknown as Record<string, unknown> | undefined
      const found = row ? authRowOf(row) : undefined
      return found && found.deletedAt !== null ? found : undefined
    },
    async create(seed: string): Promise<AuthRow | null> {
      try {
        const row = (await api().insert(SYSTEM, { seed })) as unknown as Record<string, unknown>
        return authRowOf(row)
      } catch (e) {
        // unique по seed покрывает и удалённые строки: конфликт = «занят»
        if (normalizeFailure(e).kind === 'conflict') return null
        throw e
      }
    },
    async get(id: string): Promise<AuthRow | undefined> {
      try {
        const row = await api().get(SYSTEM, id, { includeDeleted: true })
        return authRowOf(row as unknown as Record<string, unknown>)
      } catch {
        return undefined
      }
    },
    async markDeleted(id: string, _at: number): Promise<void> {
      await api().delete(SYSTEM, id)
    },
    async clearDeleted(id: string): Promise<void> {
      await api().restore(SYSTEM, id)
    },
    async wipeCredentials(id: string): Promise<void> {
      await api().update(SYSTEM, id, { seed: null })
    },
    async setPermissions(ctx: DataContext, id: string, permissions: readonly string[]): Promise<void> {
      await api().update(ctx, id, { permissions: [...permissions] })
    },
    async listDeletedBefore(cutoffMs: number): Promise<AuthRow[]> {
      // таблица аккаунтов мала; выбранных удалённых фильтруем в JS — слоя
      // фильтров по метке времени удаления нет
      const rows = (await api().select(SYSTEM, { includeDeleted: true })) as unknown as Record<string, unknown>[]
      return rows.map(authRowOf).filter((r) => r.deletedAt !== null && r.deletedAt <= cutoffMs)
    },
  }
}

function profilesAdapter() {
  const api = () => db.resource(profileRes)
  // Контекст приходит от ядра: чтение и правка — владелец, создание и смерть
  // аккаунта — сервер. Адаптер не выбирает права сам.
  const byAuth = async (ctx: DataContext, authId: string): Promise<Record<string, unknown> | undefined> => {
    const rows = await api().select(ctx, { filter: { field: 'auth_id', op: 'eq', value: authId } })
    return rows[0] as unknown as Record<string, unknown> | undefined
  }
  const viewOf = (r: Record<string, unknown>): ProfileView => ({
    id: String(r.id),
    authId: String(r.auth_id),
    nickname: (r.nickname as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    createdAt: ms(r.created_at) ?? Date.now(),
    updatedAt: ms(r.updated_at) ?? Date.now(),
  })
  return {
    async create(ctx: DataContext, authId: string, patch: { nickname?: string; avatarUrl?: string }): Promise<void> {
      await api().insert(ctx, {
        auth_id: authId,
        ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
        ...(patch.avatarUrl !== undefined ? { avatar_url: patch.avatarUrl } : {}),
      })
    },
    async get(ctx: DataContext, authId: string): Promise<ProfileView | undefined> {
      const row = await byAuth(ctx, authId)
      return row ? viewOf(row) : undefined
    },
    async update(ctx: DataContext, authId: string, patch: { nickname?: string; avatarUrl?: string | null }): Promise<void> {
      const row = await byAuth(ctx, authId)
      if (!row) return
      await api().update(ctx, row.id, {
        ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
        ...(patch.avatarUrl !== undefined ? { avatar_url: patch.avatarUrl } : {}),
      })
    },
    async remove(ctx: DataContext, authId: string): Promise<void> {
      const row = await byAuth(ctx, authId)
      if (row) await api().delete(ctx, row.id, { hard: true })
    },
  }
}

/** Порты из хвостов проекта; куки передаёт тот, кто знает запрос (фасад). */
export function authPorts(cookies?: AuthPorts['cookies']): AuthPorts {
  const keys = sealKeysFromEnv()
  return {
    challenge: (() => {
      const store = localStore.scope('user-auth-challenge', { max: 10_000 })
      return {
        issue: async (nonce, ttl) => {
          await store.set(`nonce:${nonce}`, true, ttl * 1000)
        },
        async consume(nonce) {
          const k = `nonce:${nonce}`
          const had = await store.get<boolean>(k)
          await store.delete(k)
          return had === true
        },
      }
    })(),
    sessions: sessionsAdapter(),
    auths: authsAdapter(),
    profiles: profilesAdapter(),
    sealKeys: {
      current: () => ({ id: keys.id, secret: keys.secret }),
      secretOf: (id) => (id === keys.id ? keys.secret : keys.old[id]),
      retire: async () => {},
    },
    seal: {
      async seal(payload, ttlSeconds) {
        if (!keys.enabled) throw new Error('AUTH_SEAL_SECRET не задан — запечатывать токены нечем (вход выключен)')
        return Iron.seal(payload, { id: keys.id, secret: keys.secret }, { ...Iron.defaults, ttl: ttlSeconds * 1000 })
      },
      async unseal(token) {
        // при выключенном входе распечатывать нечем: «не вошёл», без исключений
        if (!keys.enabled) return undefined
        try {
          const map: Record<string, string> = { default: keys.secret, ...keys.old, [keys.id]: keys.secret }
          // верхняя граница iron — год (токен продления); access короче и свою exp несёт сам
          return (await Iron.unseal(token, map, { ...Iron.defaults, ttl: 365 * 24 * 3600 * 1000 })) as never
        } catch {
          return undefined
        }
      },
    },
    crypto: { sign: (payload, secret) => sign(payload, secret), verify: (payload, signature, seed) => verify(payload, signature, seed) },
    cookies:
      cookies ?? {
        get: () => undefined,
        set: () => {},
        delete: () => {},
      },
    clock: { now: () => Date.now() },
    config: createUserConfig(localStore.scope('user-config')),
  }
}

/** Подсеть из запроса: /24 у IPv4, /48 у IPv6 — полного адреса не знает даже ядро. */
export function subnetOf(request: Request): string | undefined {
  const raw = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (!raw) return undefined
  if (raw.includes('.')) {
    const parts = raw.split('.')
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`
  }
  const parts = raw.split(':')
  return `${parts.slice(0, 4).join(':')}::`
}

const countryOf = (request: Request): string | undefined =>
  request.headers.get('cf-ipcountry')?.slice(0, 64) ?? undefined

/**
 * Очередь сериализации ротации по `jti` в пределах процесса: параллельные
 * запросы с одной и той же сессией выполняются строго по очереди, но каждый
 * со своими собственными `ports`, `subnet` и `country` (без шаринга чужого
 * `LoginOutcome` и без двойной перезаписи одной версии в БД).
 */
const renewLocks = new Map<string, Promise<void>>()

async function withRenewLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = renewLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((r) => {
    release = r
  })
  const tail = prev.then(() => current)
  renewLocks.set(key, tail)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (renewLocks.get(key) === tail) renewLocks.delete(key)
  }
}

export function auth(event: AuthEvent): {
  /** Вход включён (секрет запечатывания задан)? Иначе форма скрыта, экшены отказывают. */
  readonly enabled: boolean
  issueChallenge(): Promise<UserResult<{ nonce: string; expiresAt: number }>>
  login(args: { seed: string; nonce: string; signature?: string; deviceName?: string }): Promise<UserResult<LoginOutcome>>
  restoreDeleted(args: { seed: string; nonce: string; signature?: string; deviceName?: string }): Promise<UserResult<LoginOutcome>>
  verifySeed(args: { seed: string; nonce: string; signature?: string }): Promise<UserResult<{ sub: string }>>
  renew(): Promise<UserResult<LoginOutcome>>
  refreshAccess(): Promise<UserResult<string>>
  logout(): Promise<UserResult<null>>
  logoutAll(): Promise<UserResult<null>>
  listSessions(): Promise<UserResult<SessionView[]>>
  revokeSession(jti: string): Promise<UserResult<null>>
  /** Свой профиль; `subject` — чужой (нужны права `profile.read`/`admin`). */
  profile(subject?: string): Promise<UserResult<ProfileView | null>>
  /** Сохранить свой профиль; `subject` — чужой (нужно право `profile.edit`/`admin`). */
  updateProfile(
    args: { nickname?: string; avatarUrl?: string | null },
    subject?: string,
  ): Promise<UserResult<ProfileView>>
  requestDelete(): Promise<UserResult<null>>
} {
  const ports = authPorts({
    get: (name) => event.cookies.get(name),
    set: (name, value, ttlSeconds) => event.cookies.set(name, value, { ...COOKIE_BASE, maxAge: ttlSeconds }),
    // secure:false явно: без него Kit возьмёт дефолт (Secure вне localhost),
    // и браузер по http не вернёт куку
    delete: (name) => event.cookies.delete(name, { ...COOKIE_BASE }),
  })
  const access = () => event.cookies.get(ACCESS_COOKIE)
  const renewal = () => event.cookies.get(RENEWAL_COOKIE)
  const setTokens = (value: LoginOutcome, deviceTtlSec: number, accessTtlSec: number) => {
    event.cookies.set(ACCESS_COOKIE, value.access, { ...COOKIE_BASE, maxAge: accessTtlSec })
    if (value.renewal) event.cookies.set(RENEWAL_COOKIE, value.renewal, { ...COOKIE_BASE, maxAge: deviceTtlSec })
  }
  const clearCookies = () => {
    event.cookies.delete(ACCESS_COOKIE, { ...COOKIE_BASE })
    event.cookies.delete(RENEWAL_COOKIE, { ...COOKIE_BASE })
  }

  const runRenew = async (): Promise<UserResult<LoginOutcome>> => {
    const rawRenewal = renewal()
    const unsealed = rawRenewal ? await ports.seal.unseal(rawRenewal) : null
    const jti = unsealed && unsealed.k === 'renewal' ? unsealed.jti : null

    const exec = () =>
      coreRenew(ports, {
        renewal: rawRenewal,
        subnet: subnetOf(event.request),
        country: countryOf(event.request),
      })

    const r = jti ? await withRenewLock(jti, exec) : await exec()
    if (r.ok) {
      setTokens(r.value, await ports.config.get('deviceTtlSec'), await ports.config.get('accessTtlSec'))
    }
    return r
  }

  const freshAccessOrCurrent = async (): Promise<string | undefined> => {
    const current = access()
    if (current) {
      const payload = await ports.seal.unseal(current)
      if (payload && payload.k === 'access' && payload.exp > Date.now()) {
        return current
      }
    }
    if (!renewal()) return current
    const renewed = await runRenew()
    return renewed.ok ? renewed.value.access : current
  }

  return {
    enabled: AUTH_ENABLED,
    issueChallenge: () => coreIssueChallenge(ports),
    login: async (args) => {
      const r = await coreLogin(ports, { ...args, subnet: subnetOf(event.request), country: countryOf(event.request) })
      if (r.ok) setTokens(r.value, await ports.config.get('deviceTtlSec'), await ports.config.get('accessTtlSec'))
      return r
    },
    restoreDeleted: async (args) => {
      const r = await coreRestoreDeleted(ports, { ...args, subnet: subnetOf(event.request), country: countryOf(event.request) })
      if (r.ok) setTokens(r.value, await ports.config.get('deviceTtlSec'), await ports.config.get('accessTtlSec'))
      return r
    },
    verifySeed: (args) => coreVerifySeed(ports, args),
    renew: runRenew,
    refreshAccess: async () => {
      const r = await coreIssueFreshAccess(ports, await freshAccessOrCurrent())
      if (r.ok) {
        event.cookies.set(ACCESS_COOKIE, r.value, {
          ...COOKIE_BASE,
          maxAge: await ports.config.get('accessTtlSec'),
        })
      }
      return r
    },
    logout: async () => {
      const r = await coreLogout(ports, access(), renewal())
      clearCookies()
      return r
    },
    logoutAll: async () => {
      const r = await coreLogoutAll(ports, access(), renewal())
      clearCookies()
      return r
    },
    listSessions: async () => coreListSessions(ports, await freshAccessOrCurrent()),
    revokeSession: async (jti) => coreRevokeSession(ports, await freshAccessOrCurrent(), jti),
    profile: async (subject?: string) => coreProfile(ports, await freshAccessOrCurrent(), subject),
    updateProfile: async (args, subject?: string) =>
      coreUpdateProfile(ports, await freshAccessOrCurrent(), args, subject),
    requestDelete: async () => {
      const r = await coreRequestDelete(ports, await freshAccessOrCurrent(), renewal())
      if (r.ok) clearCookies()
      return r
    },
  }
}

/**
 * Публичные метаданные для `vault` из живой куки `auth_tmp` (stateless-путь, `0` запросов в БД).
 * Зашифрованная строка куки наружу НЕ возвращается.
 */
export async function readVault(
  cookies: { get(name: string): string | undefined },
  nowMs = Date.now(),
): Promise<VaultSessionMeta | null> {
  const access = cookies.get(ACCESS_COOKIE)
  if (!access) return null
  const payload = await authPorts().seal.unseal(access)
  if (!payload || payload.k !== 'access' || payload.exp <= nowMs) return null
  return {
    sub: payload.sub,
    iat: payload.iat,
    expiresAt: payload.exp,
    ttlMs: Math.max(1000, payload.exp - payload.iat),
    prof: payload.prof,
  }
}

/**
 * SSR-разрешение сессии для корневого layout новой вкладки:
 * - если короткий `auth_tmp` жив — возвращает метаданные мгновенно (`0` запросов в БД);
 * - если `auth_tmp` отсутствует или истёк, но присутствует `auth_sid` — бесшовно
 *   выполняет `renew()` прямо во время SSR `load`, выставляя свежие `Set-Cookie`;
 * - если `auth_sid` мёртв/отозван — удаляет мёртвые куки и возвращает `null`.
 */
export async function resolveVault(event: AuthEvent): Promise<VaultSessionMeta | null> {
  const live = await readVault(event.cookies)
  if (live) return live
  if (!event.cookies.get(RENEWAL_COOKIE)) return null

  const u = auth(event)
  if (!u.enabled) return null
  const renewed = await u.renew()
  if (renewed.ok) return vaultPayloadOf(renewed.value)

  event.cookies.delete(ACCESS_COOKIE, { ...COOKIE_BASE })
  event.cookies.delete(RENEWAL_COOKIE, { ...COOKIE_BASE })
  return null
}

/** Публичные метаданные для `vault` из свежевыпущенного `access` (без передачи самого токена). */
export async function vaultPayloadOf(input: LoginOutcome | string): Promise<VaultSessionMeta> {
  const rawAccess = typeof input === 'string' ? input : input.access
  const payload = await authPorts().seal.unseal(rawAccess)
  if (!payload || payload.k !== 'access') throw new Error('свежий access не распечатался')
  return {
    sub: payload.sub,
    iat: payload.iat,
    expiresAt: payload.exp,
    ttlMs: Math.max(1000, payload.exp - payload.iat),
    prof: payload.prof,
  }
}

/** Перевод голого факта в статус HTTP (REST-вызовы и журнал экшенов). */
export function toHttpStatus(result: UserResult<unknown>): number {
  if (result.ok) return 200
  switch (result.fact.code) {
    case 'auth.nonce-unknown':
    case 'auth.signature':
    case 'auth.token':
    case 'auth.kid-unknown':
    case 'auth.expired':
    case 'auth.revoked':
    case 'auth.session-unknown':
      return 401
    case 'auth.blocked':
    case 'auth.forbidden':
    case 'permissions.unknown':
    case 'permissions.self':
      return 403
    case 'auth.disabled':
      return 503
    case 'auth.identity-unknown':
      return 404
    case 'auth.delete-pending':
      return 409
    case 'auth.deleted':
      return 410
    case 'auth.confirm':
    case 'profile.nickname-forbidden':
    case 'profile.photo-format':
    case 'profile.photo-size':
    case 'profile.photo-spec':
      return 422
  }
}
