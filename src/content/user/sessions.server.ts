/**
 * Сессии как устройства — функции модели, не фаервола.
 *
 * Контекст — `principalOfRow(actor)`, не `SYSTEM`. `jti` и `version` в
 * человеческую проекцию не попадают. Зависимости `{ db, now }` те же, что у
 * хранилища: тест гоняет PGlite без кук. Фаервол по-прежнему читает строку
 * по `jti` куки через порт.
 */
import {
  checkGrants,
  grants,
  normalizeFailure,
  type Database,
  type DataContext,
  type Filter,
} from '#lib/db/index.js'
import { SERVER, fail, ok, principalOfRow, type UserResult } from './auth.js'
import { defineCaps, type PageCaps } from './caps.js'
import { auth as authResource, session as sessionResource } from './schema.js'
import { SESSIONS_BULK_IDS_LIMIT, SESSIONS_COUNTRY_NONE, type SessionsWhereArgs } from './types.js'
export type { SessionsWhereArgs } from './types.js'
export { SESSIONS_BULK_IDS_LIMIT } from './types.js'
import type {
  SessionBulkRevokeResult,
  SessionDetail,
  SessionDeviceView,
  SessionRevokeResult,
  SessionsPage,
  SessionsState,
  SubnetEntry,
} from './types.js'

const gSession = grants(sessionResource)

export const SESSIONS_MAX_PAGE_SIZE = 100

/** Кто вызывает функции. `sessionId` — строка текущей куки, не `jti`. */
export type SessionActor = {
  id: string
  permissions: readonly string[]
  sessionId?: string | null
}

/** Часы и база. `now` — миллисекунды или функция, как порт часов в тесте. */
export type SessionDeps = {
  db: Database
  now?: number | (() => number)
}

/** Сколько стран показывает форма фильтров. Срез шире — это уже не подсказка. */
export const SESSIONS_COUNTRY_LIMIT = 60

/** Идентификатор строки: 36 символов, как у всех uuid в проекте. */
const SESSION_ID_RE = /^[0-9a-f-]{36}$/i

/**
 * Годные идентификаторы из адреса: обрезка, строчные, повторы вон, мусор не
 * проходит. Мусор не роняет вызов — он просто не попадает в набор.
 */
function normalizeSessionIds(ids: readonly string[] | undefined): string[] {
  const out = new Set<string>()
  for (const raw of ids ?? []) {
    const id = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (SESSION_ID_RE.test(id)) out.add(id)
  }
  return [...out]
}

export type ListSessionsPageArgs = SessionsWhereArgs & {
  /** Один аккаунт. Пусто и без `journal` — свои устройства. */
  authId?: string | null
  /** Общий журнал. Чужой аккаунт сюда не подставляется. */
  journal?: boolean
  page?: number
  pageSize?: number
}

/**
 * Серверный набор отзыва: тот же срез, что показывает список (`where`), плюс
 * исключения и флаг текущей сессии. Клиентские `ids`/`pick`/`scope` удалены:
 * разметка не посылает состав набора, сервер считает его сам в момент POST.
 */
export type RevokeBulkArgs = {
  /** Пусто — свой аккаунт. */
  authId?: string | null
  /** Фильтр списка: те же поля, что у `listSessionsPage`. */
  where?: SessionsWhereArgs
  /** Единственные клиентские id — исключения («всё, кроме»). Мусор и повторы отбрасываются. */
  except?: readonly string[]
  /** Включать текущую сессию актора в набор. Снят — она исключается сервером. */
  includeCurrent?: boolean
  /**
   * Только текущая сессия актора (экран выхода, снятый чекбокс). Id сервер
   * знает сам из куки; клиентский идентификатор сюда не попадает.
   */
  onlyCurrent?: boolean
}

const ctxOf = (actor: SessionActor): DataContext =>
  principalOfRow({ id: actor.id, permissions: actor.permissions })

const nowOf = (deps: SessionDeps): number => {
  const clock = deps.now
  if (typeof clock === 'function') return clock()
  if (typeof clock === 'number') return clock
  return Date.now()
}

const iso = (ms: number): string => new Date(ms).toISOString()

function ms(value: unknown): number | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function historyOf(value: unknown): SubnetEntry[] {
  if (!Array.isArray(value)) return []
  const out: SubnetEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.hash !== 'string' || !row.hash) continue
    out.push({
      hash: row.hash,
      country: typeof row.country === 'string' ? row.country : null,
      at: ms(row.at) ?? 0,
    })
  }
  return out
}

/** Явный набор полей: служебные ключи строки, даже если модель их отдала, не проходят. */
function project(row: Record<string, unknown>, actor: SessionActor): SessionDeviceView {
  const id = String(row.id)
  return {
    id,
    authId: String(row.auth_id),
    deviceName: (row.device_name as string | null) ?? null,
    subnetHash: (row.subnet_hash as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    history: historyOf(row.subnet_history),
    createdAt: ms(row.created_at) ?? 0,
    expiresAt: ms(row.expires_at) ?? 0,
    lastSeenAt: ms(row.last_seen_at),
    deletedAt: ms(row.deleted_at),
    current: actor.sessionId != null && actor.sessionId === id,
  }
}

function unknownSession(): UserResult<never> {
  return fail({ code: 'auth.session-unknown' })
}

function isMissing(error: unknown): boolean {
  const kind = normalizeFailure(error).kind
  return kind === 'not_found' || kind === 'forbidden' || kind === 'validation'
}

/**
 * Существование аккаунта — отдельный зонд, не чтение сессии. Его делает `server`,
 * потому что `session.read` не входит в круг `auth`, а пустой список и
 * «аккаунта нет» должны различаться. Наружу строка auth не отдаётся.
 */
async function accountExists(deps: SessionDeps, authId: string): Promise<boolean> {
  try {
    await deps.db.resource(authResource).get(SERVER, authId, { includeDeleted: true })
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/**
 * Права круга журнала: без владельца строки. У `checkGrants` `ownerId` —
 * необязательная опция (`options?.ownerId ?? null`), а атом владельца требует
 * `ownerId !== null`, то есть чтение без владельца — штатный режим модели, а не
 * обход. Голый `checkGrants` без обёртки здесь не пишут: `capsOf` — местное
 * соглашение модуля (то же в `blocks.ts`).
 */
const journalCapsOf = (actor: SessionActor) => capsOf(actor, null)

const capsOf = (actor: SessionActor, ownerId: string | null): PageCaps<'sessions'> => {
  const principal = ctxOf(actor).principal
  // Состав флагов закреплён картой `PageCaps<'sessions'>` (P2-3): переименовать
  // или убрать флаг здесь, не поправ route data, — ошибка компиляции.
  return defineCaps<'sessions'>(
    checkGrants(
      principal,
      {
        canRead: gSession.select,
        canSeeDeleted: gSession.selectDeleted,
        canRename: gSession.update,
        canRevoke: gSession.delete,
        canHardDelete: gSession.hardDelete,
      },
      { ownerId },
    ),
  )
}

function clampState(state: SessionsState, canSeeDeleted: boolean): SessionsState {
  if (state === 'revoked' && !canSeeDeleted) return 'all'
  return state
}

async function loadRow(
  deps: SessionDeps,
  actor: SessionActor,
  id: string,
  includeDeleted: boolean,
): Promise<Record<string, unknown> | null> {
  if (!id.trim()) return null
  try {
    const row = await deps.db.resource(sessionResource).get(
      ctxOf(actor),
      id,
      includeDeleted ? { includeDeleted: true } : undefined,
    )
    return row as unknown as Record<string, unknown>
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

/**
 * Построитель среза списка: один источник истины для «что показывает список»
 * и «что закрывает серверный набор». Чистая функция: права не проверяет,
 * только собирает фильтр из цели, состояния, стран, сети и дат.
 */
export function sessionsWhere(
  actor: SessionActor,
  args: ListSessionsPageArgs,
  now: number,
): { and: Filter[]; filter: Filter | undefined; state: SessionsState; includeDeleted: boolean; countryFilter: Filter | null } {
  const journal = args.journal === true
  const requested = args.authId?.trim() || null
  const own = !journal && (requested === null || requested === actor.id)
  const target = own ? actor.id : requested
  const ownerId = journal ? null : target
  const caps = capsOf(actor, ownerId)
  const state = clampState(args.state ?? 'active', caps.canSeeDeleted)
  const and: Filter[] = []
  if (!journal && target) and.push({ field: 'auth_id', op: 'eq', value: target })
  if (state === 'active') and.push({ field: 'expires_at', op: 'gt', value: iso(now) })
  else if (state === 'expired') and.push({ field: 'expires_at', op: 'lte', value: iso(now) })
  else if (state === 'revoked') and.push({ field: 'deleted_at', op: 'gte', value: iso(0) })
  const wanted = [...new Set((args.country ?? []).map((c) => c.trim()).filter(Boolean))].slice(0, 20)
  const countryParts: Filter[] = []
  for (const code of wanted) {
    if (code === SESSIONS_COUNTRY_NONE) countryParts.push({ field: 'country', op: 'isNull' })
    else countryParts.push({ field: 'country', op: 'eq', value: code })
  }
  const countryFilter: Filter | null =
    countryParts.length === 0 ? null : countryParts.length === 1 ? countryParts[0]! : { or: countryParts }
  if (countryFilter) and.push(countryFilter)
  if (args.subnetChanged === true) and.push({ field: 'subnet_history', op: 'ne', value: [] })
  const range = (field: string, from?: number | null, to?: number | null): void => {
    if (from != null && Number.isFinite(from)) and.push({ field, op: 'gte', value: iso(from) })
    if (to != null && Number.isFinite(to)) and.push({ field, op: 'lte', value: iso(to) })
  }
  range('created_at', args.createdFrom, args.createdTo)
  range('last_seen_at', args.seenFrom, args.seenTo)
  const filter: Filter | undefined = and.length === 0 ? undefined : and.length === 1 ? and[0] : { and }
  return { and, filter, state, includeDeleted: state === 'revoked', countryFilter }
}

export async function listSessionsPage(
  actor: SessionActor,
  args: ListSessionsPageArgs = {},
  deps: SessionDeps,
): Promise<UserResult<SessionsPage>> {
  const journal = args.journal === true
  const requested = args.authId?.trim() || null
  const own = !journal && (requested === null || requested === actor.id)
  const target = own ? actor.id : requested
  const ownerId = journal ? null : target
  const caps = capsOf(actor, ownerId)

  if (journal || !own) {
    if (!caps.canRead) return fail({ code: 'auth.forbidden' })
  }
  if (!own && !journal) {
    if (!target || !(await accountExists(deps, target))) return fail({ code: 'auth.identity-unknown' })
  }

  const page = Math.max(1, Math.trunc(args.page ?? 1) || 1)
  const pageSize = Math.min(SESSIONS_MAX_PAGE_SIZE, Math.max(1, Math.trunc(args.pageSize ?? 30) || 30))
  const now = nowOf(deps)
  const { and, filter, state, includeDeleted, countryFilter } = sessionsWhere(actor, args, now)
  const api = deps.db.resource(sessionResource)
  const ctx = ctxOf(actor)
  const [rows, total] = await Promise.all([
    api.select(ctx, {
      page,
      limit: pageSize,
      order: [['created_at', 'desc']],
      ...(filter ? { filter } : {}),
      includeDeleted,
    }),
    api.count(ctx, { ...(filter ? { filter } : {}), includeDeleted }),
  ])

  // Страны для формы — по срезу БЕЗ самого фильтра страны: иначе выбор одной
  // страны стёр бы остальные пункты. Срез ограничен: это подсказка выбора, а
  // не отчёт по всей базе.
  const withoutCountry = countryFilter ? and.filter((f) => f !== countryFilter) : and
  const countrySlice: Filter | undefined =
    withoutCountry.length === 0 ? undefined : withoutCountry.length === 1 ? withoutCountry[0] : { and: withoutCountry }
  let countryRows: unknown[] = []
  try {
    countryRows = await api.select(ctx, {
      ...(countrySlice ? { filter: countrySlice } : {}),
      includeDeleted,
      limit: SESSIONS_COUNTRY_LIMIT,
      fields: ['country'],
    })
  } catch {
    // Подсказка стран не должна валить список: без неё фильтр остаётся,
    // просто кодов в форме меньше.
    countryRows = []
  }
  const seen = new Set<string>()
  for (const row of countryRows as Record<string, unknown>[]) {
    const code = typeof row.country === 'string' && row.country.trim() ? row.country.trim() : SESSIONS_COUNTRY_NONE
    seen.add(code)
  }

  return ok({
    items: (rows as unknown as Record<string, unknown>[]).map((row) => project(row, actor)),
    // Чтение БЕЗ владельца — это тот же круг, что у журнала: по нему экран
    // показывает вход в «Все сессии». Своих читает каждый владелец, поэтому
    // `canRead` среза здесь не годится.
    canReadOthers: journalCapsOf(actor).canRead,
    total,
    page,
    pageSize,
    authId: journal ? null : target,
    journal,
    state,
    countries: [...seen].sort((a, b) => (a === SESSIONS_COUNTRY_NONE ? 1 : b === SESSIONS_COUNTRY_NONE ? -1 : a.localeCompare(b))),
    canSeeDeleted: caps.canSeeDeleted,
    canRename: caps.canRename,
    canRevoke: caps.canRevoke,
    canHardDelete: caps.canHardDelete,
  })
}

export async function readSessionDetail(
  actor: SessionActor,
  id: string,
  deps: SessionDeps,
): Promise<UserResult<SessionDetail>> {
  const canSeeDeleted = journalCapsOf(actor).canSeeDeleted
  const loaded = await loadRow(deps, actor, id, canSeeDeleted)
  if (!loaded) return unknownSession()
  const session = project(loaded, actor)
  const caps = capsOf(actor, session.authId)
  return ok({
    session,
    canRename: caps.canRename && session.deletedAt === null,
    canRevoke: caps.canRevoke && session.deletedAt === null,
    canHardDelete: caps.canHardDelete,
  })
}

export async function renameSessionDevice(
  actor: SessionActor,
  id: string,
  deviceName: string | null,
  deps: SessionDeps,
): Promise<UserResult<SessionDeviceView>> {
  const loaded = await loadRow(deps, actor, id, false)
  if (!loaded) return unknownSession()
  const session = project(loaded, actor)
  if (!capsOf(actor, session.authId).canRename) return fail({ code: 'auth.forbidden', path: 'device_name' })
  const name = typeof deviceName === 'string' ? deviceName.trim() : ''
  try {
    const row = await deps.db.resource(sessionResource).update(ctxOf(actor), id, {
      device_name: name || null,
    })
    return ok(project(row as unknown as Record<string, unknown>, actor))
  } catch (error) {
    const kind = normalizeFailure(error).kind
    if (kind === 'not_found' || kind === 'validation') return unknownSession()
    if (kind === 'forbidden') return fail({ code: 'auth.forbidden', path: 'device_name' })
    throw error
  }
}

export async function revokeSessionById(
  actor: SessionActor,
  id: string,
  deps: SessionDeps,
  opts?: { hard?: boolean },
): Promise<UserResult<SessionRevokeResult>> {
  const hard = opts?.hard === true
  const canSeeDeleted = journalCapsOf(actor).canSeeDeleted
  const loaded = await loadRow(deps, actor, id, hard && canSeeDeleted)
  if (!loaded) return unknownSession()
  const session = project(loaded, actor)
  const caps = capsOf(actor, session.authId)
  if (hard && !caps.canHardDelete) return fail({ code: 'auth.forbidden' })
  if (!hard && !caps.canRevoke) return fail({ code: 'auth.forbidden' })
  try {
    await deps.db.resource(sessionResource).delete(ctxOf(actor), id, hard ? { hard: true } : undefined)
  } catch (error) {
    const kind = normalizeFailure(error).kind
    if (kind === 'not_found' || kind === 'validation') return unknownSession()
    if (kind === 'forbidden') return fail({ code: 'auth.forbidden' })
    throw error
  }
  return ok({ id: session.id, current: session.current, hard })
}

export async function revokeBulkSessions(
  actor: SessionActor,
  args: RevokeBulkArgs,
  deps: SessionDeps,
): Promise<UserResult<SessionBulkRevokeResult>> {
  const requestedTarget = args.authId?.trim() || null
  const own = requestedTarget === null || requestedTarget === actor.id
  const target = own ? actor.id : requestedTarget
  if (!target) return fail({ code: 'auth.forbidden' })
  const caps = capsOf(actor, target)
  if (!caps.canRevoke) return fail({ code: 'auth.forbidden' })
  if (!own && !(await accountExists(deps, target))) return fail({ code: 'auth.identity-unknown' })

  // Единственные клиентские id — исключения. Усечение молча менять намерение
  // не должно: обрезанный список исключений закрыл бы строки, которые просили
  // оставить, поэтому предел — отказ, а не `.slice`.
  const except = normalizeSessionIds(args.except)
  if (except.length > SESSIONS_BULK_IDS_LIMIT) return fail({ code: 'auth.limit' })

  // Тот же срез, что показывает список: один построитель на чтение и отзыв.
  const where = sessionsWhere(actor, { ...args.where, authId: target }, nowOf(deps))
  const and: Filter[] = [...where.and]
  if (args.onlyCurrent) {
    // Экран выхода: снятый чекбокс закрывает одну текущую сессию. Id сервер
    // знает сам из куки; клиентский идентификатор в набор не попадает.
    const currentId = actor.sessionId?.trim()
    if (!currentId) return fail({ code: 'session.nothing-to-close' })
    and.push({ field: 'id', op: 'eq', value: currentId })
  } else if (!args.includeCurrent && actor.sessionId?.trim()) {
    and.push({ field: 'id', op: 'ne', value: actor.sessionId.trim() })
  }
  // Исключения — объявленный `notIn` порциями по техническому лимиту значений
  // (`db.limits.inValues`), а не сотни отдельных `ne`: 500 `ne` превышают
  // `filterNodes` боевого драйвера и падают validation ещё до SQL (P1-8).
  // Порция ≤ inValues даёт один узел фильтра на кусок; 500 id → 5 узлов.
  const chunk = deps.db.limits.inValues
  for (let i = 0; i < except.length; i += chunk) {
    and.push({ field: 'id', op: 'notIn', value: except.slice(i, i + chunk) })
  }
  const filter: Filter = and.length === 1 ? and[0]! : { and }
  const ctx = ctxOf(actor)

  let requested = 0
  let revoked = 0
  let current = false
  await deps.db.transaction(async (tx) => {
    const api = tx.resource(sessionResource)
    // `requested` — счёт по тому же срезу до удаления: расхождение с `revoked`
    // означает, что часть строк закрыли между счётом и отзывом.
    requested = await api.count(ctx, { filter, includeDeleted: where.includeDeleted })
    if (requested === 0) return
    for (;;) {
      const rows = (await api.select(ctx, {
        filter,
        limit: SESSIONS_MAX_PAGE_SIZE,
        includeDeleted: where.includeDeleted,
      })) as unknown as Record<string, unknown>[]
      if (rows.length === 0) break
      for (const row of rows) {
        const id = String(row.id)
        await api.delete(ctx, id)
        revoked += 1
        if (actor.sessionId != null && actor.sessionId === id) current = true
      }
    }
  })
  if (requested === 0) return fail({ code: 'session.nothing-to-close' })
  return ok({ revoked, current, requested })
}
