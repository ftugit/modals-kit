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
 *  - заявка на удаление закрывает вход полностью: обычный поиск удалённую
 *    строку не видит (политика модели), создать дубль мешает unique — по
 *    конфликту `login` возвращает факт `auth.deleted` БЕЗ сессии; вернуть
 *    аккаунт — `restoreDeleted`: то же доказательство владения, затем
 *    привилегированный поиск удалённой строки и снятие метки;
 *  - сроки и поведение — из конфига модуля (`config.ts`), не константы.
 */
import type { AuthFact } from './error.js'
import type { AuthPorts } from './ports.js'
import type { Blocked, Challenge, LoginOutcome, ProfileView, SessionRecord, SessionStatus, SubnetEntry, TokenPair } from './types.js'

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

/** Аргументы входа и восстановления — одно и то же доказательство владения. */
export type EnterArgs = {
  seed: string
  nonce: string
  /** Подпись nonce; нет — режим без JS: доказательство = само знание секрета. */
  signature?: string
  deviceName?: string
  /** Подсеть в представлении адаптера (хэш считается здесь); нет — не пишем. */
  subnet?: string
  country?: string
}

/**
 * Доказательство владения seed: одноразовый nonce + подпись. Чистая
 * криптография — строк аккаунтов НЕ касается, поэтому стоит ДО любого
 * поиска (в т.ч. привилегированного поиска удалённой строки).
 * Возвращает нормализованный seed или факт отказа.
 */
async function proveSeed(ports: AuthPorts, args: EnterArgs): Promise<{ seed: string } | AuthFact> {
  const seed = args.seed.trim()
  if (seed.length < 43 || seed.length > 44) return { code: 'auth.signature', path: 'signature' }
  if (!(await ports.challenge.consume(args.nonce))) return { code: 'auth.nonce-unknown', path: 'signature' }
  if (args.signature !== undefined && !(await ports.crypto.verify(args.nonce, args.signature, seed)))
    return { code: 'auth.signature', path: 'signature' }
  return { seed }
}

/**
 * Хвост входа после доказательства: найти живую строку или создать.
 * Создать не вышло (seed занят, а живой строки нет) — аккаунт удалён:
 * факт `auth.deleted`, сессии нет. Блокировка сферой `auth` →
 * `auth.blocked`. Подсеть/страна — от адаптера: полный адрес не
 * принимается никогда.
 */
async function completeLogin(ports: AuthPorts, seed: string, args: EnterArgs): Promise<UserResult<LoginOutcome>> {
  const now = ports.clock.now()
  let row = await ports.auths.findBySeed(seed)
  if (!row) row = await ports.auths.create(seed) ?? undefined
  if (!row) return fail({ code: 'auth.deleted' })

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
    restrictions: blocked.filter((b) => b.scope !== 'auth'),
  })
}

/** Единый вход: подпись nonce по seed; аккаунта нет — создаём. */
export async function login(ports: AuthPorts, args: EnterArgs): Promise<UserResult<LoginOutcome>> {
  const proof = await proveSeed(ports, args)
  if ('code' in proof) return fail(proof)
  return completeLogin(ports, proof.seed, args)
}

/**
 * Восстановление удалённого аккаунта (подтверждение на шаге восстановления):
 * то же доказательство владения, что у входа, — и только после него
 * привилегированный поиск удалённой строки и снятие метки; дальше — обычный
 * хвост входа. Удалённой строки нет (исполнитель уже стёр seed, или аккаунт
 * жив) — хвост входа сам разберётся: свободный seed создаст новый аккаунт.
 */
export async function restoreDeleted(ports: AuthPorts, args: EnterArgs): Promise<UserResult<LoginOutcome>> {
  const proof = await proveSeed(ports, args)
  if ('code' in proof) return fail(proof)
  const deleted = await ports.auths.findDeletedBySeed(proof.seed)
  if (deleted) await ports.auths.clearDeleted(deleted.id)
  return completeLogin(ports, proof.seed, args)
}

/**
 * Проверка владения seed без открытия сессии (`authorize = false`):
 * проверяет одноразовый `nonce`, подпись и наличие активного аккаунта по `seed`.
 *
 * Строки сессий в `user_session` НЕ создаются (`0` записей), куки/токены НЕ
 * выдаются и НЕ меняются: гость остаётся без токена (последующие шаги под
 * `Acl allow="user"` и `guard()` требуют вход), а авторизованный пользователь
 * сохраняет свой текущий токен и действует строго под своим логином.
 */
export async function verifySeed(
  ports: AuthPorts,
  args: EnterArgs,
): Promise<UserResult<{ sub: string }>> {
  const proof = await proveSeed(ports, args)
  if ('code' in proof) return fail(proof)
  const row = await ports.auths.findBySeed(proof.seed)
  if (!row) return fail({ code: 'auth.identity-unknown', path: 'seed' })
  return ok({ sub: row.id })
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
  if (auth.deletedAt !== null) return { code: 'auth.delete-pending' }
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
    restrictions: activeBlocks(auth.blocked, now).filter((b) => b.scope !== 'auth'),
  })
}

/* ── выходы, устройства ── */

/**
 * Выход: софт-удаление своей сессии.
 * Работает и тогда, когда короткий `access` уже истёк, а живой `renewal`
 * (`auth_sid`) ещё лежит в куке браузера — иначе старая сессия осталась бы
 * активной в БД после клика «Выйти».
 */
export async function logout(
  ports: AuthPorts,
  accessToken: string | undefined,
  renewalToken?: string | undefined,
): Promise<UserResult<null>> {
  const now = ports.clock.now()
  const g = await guard(ports, accessToken)
  if (!('code' in g)) {
    await ports.sessions.softDelete(g.jti, now)
    return ok(null)
  }
  if (renewalToken) {
    const t = await ports.seal.unseal(renewalToken)
    if (t && t.k === 'renewal') {
      await ports.sessions.softDelete(t.jti, now)
      return ok(null)
    }
  }
  if (g.code === 'auth.expired' && accessToken) {
    const expired = await ports.seal.unseal(accessToken)
    if (expired && expired.k === 'access') {
      await ports.sessions.softDelete(expired.dt, now)
      return ok(null)
    }
  }
  return fail(g)
}

/** Выйти со всех устройств: софт-удаление всех строк сессий аккаунта (с fallback на `renewal`). */
export async function logoutAll(
  ports: AuthPorts,
  accessToken: string | undefined,
  renewalToken?: string | undefined,
): Promise<UserResult<null>> {
  const now = ports.clock.now()
  const g = await guard(ports, accessToken)
  if (!('code' in g)) {
    await ports.sessions.softDeleteAllByAuth(g.sub, now)
    return ok(null)
  }
  if (renewalToken && (g.code === 'auth.expired' || g.code === 'auth.token')) {
    const t = await ports.seal.unseal(renewalToken)
    if (t && t.k === 'renewal') {
      const record = await ports.sessions.get(t.jti)
      if (record && statusOf(record, now) === 'ok') {
        const auth = await ports.auths.get(record.authId)
        if (auth && !fullBlock(auth.blocked, now) && auth.deletedAt === null) {
          await ports.sessions.softDeleteAllByAuth(record.authId, now)
          return ok(null)
        }
      }
    }
  }
  return fail(g)
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

/** Заявка на удаление: софт-метка; вход теперь получает факт `auth.deleted`. */
export async function requestDelete(ports: AuthPorts, accessToken: string | undefined): Promise<UserResult<null>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  await ports.auths.markDeleted(g.sub, ports.clock.now())
  return ok(null)
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
