/**
 * API модуля пользователя — голые функции над портами. Ни Request/Response,
 * ни валидаторов: на входе голые данные, на выходе данные или голый факт
 * (код+путь); перевод в HTTP делает gateway, в ошибки формы — инструкции
 * `error.ts`.
 *
 * ФАЕРВОЛ живёт здесь: функции, которым он нужен, вызывают `guard()` сами
 * (профиль и мутации — да, генерация связки — нет). Общего вызова на
 * приложение НЕТ: каждый компонент обращается к api сам.
 *
 * Модель (решения владельца, ход 251):
 *  - вход единый: seed не найден → аккаунт создаётся; подпись nonce —
 *    доказательство владения seed (`keys.ts`, Ed25519);
 *  - access — запечатанная строка, сервер её не хранит; продление — по куке
 *    с токеном продления `{jti, version}`: версия совпала — ротация (вкладка
 *    владелец), версия меньше — «усыновление» (кто-то продлил раньше: свежий
 *    access без создания нового продления — куча токенов не плодится);
 *  - отзыв = софт-удаление строки сессии; статусы фаервола:
 *    ok / revoked / expired / unknown (`statusOf`);
 *  - заявка на удаление НЕ закрывает вход: `login` с пенингом возвращает
 *    токены и `deletePending: true` — виджет ведёт на шаг восстановления;
 *    `cancelDelete` снимает метку под уже выданными правами;
 *  - сроки и поведение — из конфига модуля (`config.ts`), не константы.
 */
import type { AuthFact } from './error.js'
import type { AuthPorts } from './ports.js'
import type { Blocked, Challenge, LoginOutcome, Principal, ProfileView, SessionRecord, SessionStatus, SubnetEntry, TokenPair } from './types.js'

/** Результат функции API: данные или голый факт (код+путь). */
export type UserResult<T> =
  | { ok: true; value: T }
  | { ok: false; fact: AuthFact }

/** Голые результаты api: значение или доменный факт — пользуются и profile.ts. */
export const ok = <T>(value: T): UserResult<T> => ({ ok: true, value })
export const fail = (fact: AuthFact): UserResult<never> => ({ ok: false, fact })

/* ── служебные: случайные строки, хэш подсети, активные сферы ── */

/** Случайная строка base64url без набивки: 43 символа из 32 байт. */
export function randomToken(bytes = 32): string {
  const raw = new Uint8Array(bytes)
  crypto.getRandomValues(raw)
  return btoa(String.fromCharCode(...raw)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Хэш подсети с солью аккаунта — полный адрес и маска не хранятся. */
export async function subnetHash(salt: string, subnet: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${subnet}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Активные сферы блокировки: срок не вышел. Полная блокировка — сфера `auth`. */
export function activeBlocks(list: Blocked[] | undefined, now: number): Blocked[] {
  return (list ?? []).filter((b) => b.until === undefined || b.until > now)
}

/** Полная блокировка (вход закрыт) — если есть среди активных. */
export function fullBlock(list: Blocked[] | undefined, now: number): Blocked | undefined {
  return activeBlocks(list, now).find((b) => b.scope === 'auth')
}

/* ── вход ── */

/** Шаг 1 входа: одноразовый nonce на подпись (срок — из конфига). */
export async function issueChallenge(ports: AuthPorts): Promise<UserResult<Challenge>> {
  const nonce = randomToken()
  const ttl = await ports.config.get('challengeTtlSec')
  const expiresAt = ports.clock.now() + ttl * 1000
  await ports.challenge.issue(nonce, ttl)
  return ok({ nonce, expiresAt })
}

/**
 * Единый вход: подпись nonce по seed; аккаунта нет — создаём. Блокировка
 * сферой `auth` → `auth.blocked`; заявка на удаление → токены выдаются,
 * `deletePending: true` (шаг восстановления; отмена — `cancelDelete`).
 * Подсеть/страна — от адаптера: полный адрес не принимается никогда.
 */
export async function login(
  ports: AuthPorts,
  args: {
    seed: string
    nonce: string
    /** Подпись nonce; нет — режим без JS: доказательство = само знание секрета. */
    signature?: string
    deviceName?: string
    /** Подсеть в представлении адаптера (хэш считается здесь); нет — не пишем. */
    subnet?: string
    country?: string
  },
): Promise<UserResult<LoginOutcome>> {
  const seed = args.seed.trim()
  if (seed.length < 43 || seed.length > 44) return fail({ code: 'auth.signature', path: 'signature' })
  if (!(await ports.challenge.consume(args.nonce))) return fail({ code: 'auth.nonce-unknown', path: 'signature' })
  if (args.signature !== undefined && !(await ports.crypto.verify(args.nonce, args.signature, seed)))
    return fail({ code: 'auth.signature', path: 'signature' })

  const now = ports.clock.now()
  let row = await ports.auths.findBySeed(seed)
  if (!row) row = await ports.auths.create(seed)

  const blocked = activeBlocks(row.blocked, now)
  if (fullBlock(row.blocked, now)) {
    const b = blocked.find((x) => x.scope === 'auth') as Blocked
    return fail({ code: 'auth.blocked', args: { reason: b.reason, until: b.until ?? 0 } })
  }

  const deviceTtlSec = await ports.config.get('deviceTtlSec')
  const record = await openSession(ports, row, now, deviceTtlSec, args)
  const tokens = await issueTokens(ports, row, record, now, deviceTtlSec)
  return ok({
    ...tokens,
    deletePending: row.deletedAt !== null,
    restrictions: blocked.filter((b) => b.scope !== 'auth'),
  })
}

/** Новая строка сессии: jti, версия 0, срок из конфига, хэш подсети. */
async function openSession(
  ports: AuthPorts,
  row: { id: string; subnetSalt: string },
  now: number,
  deviceTtlSec: number,
  args: { deviceName?: string; subnet?: string; country?: string },
): Promise<SessionRecord> {
  const record: SessionRecord = {
    jti: randomToken(32),
    authId: row.id,
    deviceName: args.deviceName?.slice(0, 64) || null,
    subnetHash: args.subnet ? await subnetHash(row.subnetSalt, args.subnet) : null,
    country: args.country?.slice(0, 64) || null,
    history: [],
    createdAt: now,
    expiresAt: now + deviceTtlSec * 1000,
    version: 0,
    deletedAt: null,
    lastSeenAt: now,
  }
  await ports.sessions.create(record)
  return record
}

/** Свежие токены: access с витриной профиля + токен продления с версией строки. */
async function issueTokens(
  ports: AuthPorts,
  row: { id: string },
  record: SessionRecord,
  now: number,
  deviceTtlSec: number,
): Promise<TokenPair> {
  const accessTtlSec = await ports.config.get('accessTtlSec')
  const profile = await ports.profiles.get(row.id)
  const access = await ports.seal.seal(
    {
      k: 'access',
      sub: row.id,
      dt: record.jti,
      prof: { nickname: profile?.nickname ?? null, avatarUrl: profile?.avatarUrl ?? null },
      iat: now,
      exp: now + accessTtlSec * 1000,
    },
    accessTtlSec,
  )
  const renewal = await ports.seal.seal({ k: 'renewal', jti: record.jti, version: record.version }, deviceTtlSec)
  return { access, renewal }
}

/* ── фаервол ── */

/**
 * Guard доступа: распечатать access, проверить срок и статус сессии.
 * Возвращает то, что нужно функциям: contents access-токена и строку сессии.
 * Статусы: revoked/expired/unknown — факты; блокировка `auth` — `auth.blocked`;
 * заявка на удаление — `auth.delete-pending` (работа под правами остановлена).
 */
/**
 * Права по access-токену; пользуется и профильный api (`profile.ts`) —
 * у auth и профиля один источник прав (сессия).
 */
export async function guard(
  ports: AuthPorts,
  accessToken: string | undefined,
  opts?: { allowPending?: boolean },
): Promise<{ sub: string; jti: string; prof: { nickname: string | null; avatarUrl: string | null } } | AuthFact> {
  if (!accessToken) return { code: 'auth.expired' }
  const payload = await ports.seal.unseal(accessToken)
  if (!payload || payload.k !== 'access') return { code: 'auth.token' }
  if (payload.exp <= ports.clock.now()) return { code: 'auth.expired' }
  const record = await ports.sessions.get(payload.dt)
  const status = statusOf(record, ports.clock.now())
  if (status === 'unknown') return { code: 'auth.session-unknown' }
  if (status === 'revoked') return { code: 'auth.revoked' }
  if (status === 'expired') return { code: 'auth.expired' }
  const auth = await ports.auths.get(payload.sub)
  if (!auth || auth.seed === null) return { code: 'auth.identity-unknown' }
  const now = ports.clock.now()
  if (fullBlock(auth.blocked, now)) return { code: 'auth.blocked' }
  if (auth.deletedAt !== null && !opts?.allowPending) return { code: 'auth.delete-pending' }
  return { sub: payload.sub, jti: payload.dt, prof: payload.prof }
}

/** Свежий access под текущей сессией (витрина профиля — из БД, не из старого токена). */
async function freshAccess(ports: AuthPorts, sub: string, jti: string): Promise<string> {
  const accessTtlSec = await ports.config.get('accessTtlSec')
  const profile = await ports.profiles.get(sub)
  const now = ports.clock.now()
  return ports.seal.seal(
    {
      k: 'access',
      sub,
      dt: jti,
      prof: { nickname: profile?.nickname ?? null, avatarUrl: profile?.avatarUrl ?? null },
      iat: now,
      exp: now + accessTtlSec * 1000,
    },
    accessTtlSec,
  )
}

/**
 * Продление (фаервол): по токену продления из куки. Версия совпала — ротация
 * (новая версия строки, новый срок, свежий токен продления в ответе); версия
 * меньше — «усыновление»: только свежий access, продление не трогается.
 * Режим `sessionRecreate` ('update' | 'strict'): при 'strict' смена подсети
 * запрещена — факт `auth.blocked` с причиной `subnet-changed`, сведения не
 * меняются; при 'update' прежняя подсеть уходит в историю (до 8 записей).
 */
export async function renew(
  ports: AuthPorts,
  args: { renewal?: string; subnet?: string; country?: string },
): Promise<UserResult<LoginOutcome>> {
  if (!args.renewal) return fail({ code: 'auth.session-unknown' })
  const token = await ports.seal.unseal(args.renewal)
  if (!token || token.k !== 'renewal') return fail({ code: 'auth.token' })
  const record = await ports.sessions.get(token.jti)
  const status = statusOf(record, ports.clock.now())
  if (status === 'unknown') return fail({ code: 'auth.session-unknown' })
  if (status === 'revoked') return fail({ code: 'auth.revoked' })
  if (status === 'expired') return fail({ code: 'auth.expired' })
  const session = record as SessionRecord

  const auth = await ports.auths.get(session.authId)
  if (!auth || auth.seed === null) return fail({ code: 'auth.identity-unknown' })
  const now = ports.clock.now()
  if (fullBlock(auth.blocked, now)) return fail({ code: 'auth.blocked' })
  if (auth.deletedAt !== null) return fail({ code: 'auth.delete-pending' })

  const deviceTtlSec = await ports.config.get('deviceTtlSec')
  let renewal: string | undefined
  if (token.version === session.version) {
    // владелец продления: ротация сведений по режиму конфига
    const mode = await ports.config.get('sessionRecreate')
    const nextHash = args.subnet ? await subnetHash(auth.subnetSalt, args.subnet) : session.subnetHash
    const changedSubnet = args.subnet !== undefined && nextHash !== session.subnetHash
    if (mode === 'strict' && changedSubnet && session.subnetHash !== null) {
      return fail({ code: 'auth.blocked', args: { reason: 'subnet-changed', until: 0 } })
    }
    const history: SubnetEntry[] = [...session.history]
    if (mode === 'update' && changedSubnet && session.subnetHash !== null) {
      history.push({ hash: session.subnetHash, country: session.country, at: now })
      if (history.length > 8) history.splice(0, history.length - 8)
    }
    const rotated: SessionRecord = {
      ...session,
      version: session.version + 1,
      subnetHash: nextHash,
      country: args.country?.slice(0, 64) || session.country,
      history,
      expiresAt: now + deviceTtlSec * 1000,
      lastSeenAt: now,
    }
    await ports.sessions.save(rotated)
    renewal = await ports.seal.seal({ k: 'renewal', jti: rotated.jti, version: rotated.version }, deviceTtlSec)
  }
  // версия меньше — «усыновление»: кука продления уже свежая, берём только доступ
  const access = await freshAccess(ports, session.authId, session.jti)
  return ok({
    access,
    ...(renewal ? { renewal } : {}),
    deletePending: false,
    restrictions: activeBlocks(auth.blocked, now).filter((b) => b.scope !== 'auth'),
  })
}

/* ── выходы, устройства ── */

/** Выход: софт-удаление своей сессии. Куки снимает адаптер по явному вызову. */
export async function logout(ports: AuthPorts, accessToken: string | undefined): Promise<UserResult<null>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  await ports.sessions.softDelete(g.jti, ports.clock.now())
  return ok(null)
}

/** Выйти со всех устройств: софт-удаление всех строк сессий аккаунта. */
export async function logoutAll(ports: AuthPorts, accessToken: string | undefined): Promise<UserResult<null>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  await ports.sessions.softDeleteAllByAuth(g.sub, ports.clock.now())
  return ok(null)
}

/** Список устройств: имя, времена, текущая подсеть (хэш) и история. */
export async function listSessions(
  ports: AuthPorts,
  accessToken: string | undefined,
): Promise<UserResult<SessionView[]>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  const rows = await ports.sessions.listByAuth(g.sub)
  const items: SessionView[] = rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      jti: r.jti,
      deviceName: r.deviceName,
      subnetHash: r.subnetHash,
      country: r.country,
      history: r.history,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      lastSeenAt: r.lastSeenAt,
    }))
  return ok(items)
}

/** Отозвать устройство по jti (чужой jti неотличим от неизвестного). */
export async function revokeSession(
  ports: AuthPorts,
  accessToken: string | undefined,
  jti: string,
): Promise<UserResult<null>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  const row = await ports.sessions.get(jti)
  if (!row || row.authId !== g.sub) return fail({ code: 'auth.session-unknown' })
  await ports.sessions.softDelete(jti, ports.clock.now())
  return ok(null)
}

/** Вид сессии для списка устройств (хэш подсети, не адрес). */
export type SessionView = {
  jti: string
  deviceName: string | null
  subnetHash: string | null
  country: string | null
  history: SubnetEntry[]
  createdAt: number
  expiresAt: number
  lastSeenAt: number | null
}

/* ── удаление аккаунта ── */

/** Заявка на удаление: софт-метка; вход теперь ведёт на шаг восстановления. */
export async function requestDelete(ports: AuthPorts, accessToken: string | undefined): Promise<UserResult<null>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  await ports.auths.markDeleted(g.sub, ports.clock.now())
  return ok(null)
}

/**
 * Отмена заявки (шаг восстановления): права уже выданы входом, метка снимается
 * под ними — знать id недостаточно, доказательство владения сделал `login`.
 */
export async function cancelDelete(ports: AuthPorts, accessToken: string | undefined): Promise<UserResult<Principal>> {
  // allowPending: снятие заявки — ЕДИНСТВЕННАЯ функция, работающая под pending.
  const g = await guard(ports, accessToken, { allowPending: true })
  if ('code' in g) return fail(g)
  await ports.auths.clearDeleted(g.sub)
  return ok({ id: g.sub })
}

/**
 * Исполнитель удаления (зовёт планировщик приложения): грейс из конфига;
 * профиль уходит, seed/security стираются — надгробие остаётся.
 * Возвращает число зачищенных аккаунтов.
 */
export async function sweepDeletions(ports: AuthPorts): Promise<UserResult<number>> {
  const days = await ports.config.get('deleteGraceDays')
  const cutoff = ports.clock.now() - days * 24 * 60 * 60 * 1000
  const rows = await ports.auths.listDeletedBefore(cutoff)
  for (const row of rows) {
    await ports.profiles.remove(row.id)
    await ports.auths.wipeCredentials(row.id)
  }
  return ok(rows.length)
}

/** Статус сессии — вычисляет фаервол из записи (эмуляция session-status). */
export function statusOf(record: SessionRecord | undefined, now: number): SessionStatus {
  if (!record) return 'unknown'
  if (record.deletedAt !== null) return 'revoked'
  if (record.expiresAt <= now) return 'expired'
  return 'ok'
}
