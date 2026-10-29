/**
 * Список seed-юзеров — чтение таблицы `user_auth` порциями для экрана списка.
 * Отдельно от `auth.ts` (вход/сессии) и `profile.ts` (профиль человека): это
 * служебный экран аккаунтов, а не часть потока входа.
 *
 * Право на список — `admin` или `account.read`. Проверка двойная, как у выдачи
 * прав (`admin.ts`): здесь — доменный отказ `auth.forbidden` (экран покажет
 * человеку «нет прав», а не пустой список), в модели — `policy.select`, которая
 * без права отдала бы вызывающему только его собственную строку. Чтение идёт от
 * `principalOfRow` вызывающего: «только данные после ACL» — свойство этого
 * вызова, а не надежда на адаптер.
 *
 * Поиск, фильтры и порядок — серверные: домен собирает `Filter`/`Order` слоя
 * БД из проверенных аргументов, порт применяет их к выборке и счётчику одним
 * срезом. Что доступно вызывающему, решает домен: удалённые строки и всё, что
 * с ними связано (состояние, даты удаления, сортировка по удалению), — только
 * с правом чтения удалённых (`admin`/`account.read`, как `readDeleted` схемы);
 * без него аргументы про удалённых молча отбрасываются, а состояние считается
 * «только действующие».
 */
import { checkGrants, grants, type Filter, type Order } from '#lib/db/index.js'
import { blocksOfMany, fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { auth as authResource, profile as profileResource } from './schema.js'
import type { AuthPorts, SeedAccountRow } from './ports.js'
import type { SeedUserView, SeedUsersOrder, SeedUsersPage, SeedUsersState } from './types.js'

const gAuth = grants(authResource)
const gProfile = grants(profileResource)

/** Потолок порции: экран догружает понемногу, выгрузка таблицы целиком не нужна. */
export const SEED_USERS_MAX_PAGE_SIZE = 100

const viewOf = (r: SeedAccountRow, blocked: readonly import('./types.js').Blocked[]): SeedUserView => ({
  id: r.id,
  seed: r.seed,
  permissions: [...r.permissions],
  blocked: [...blocked],
  createdAt: r.createdAt,
  deletedAt: r.deletedAt,
})

export interface ListSeedUsersArgs {
  page?: number
  pageSize?: number
  /**
   * Подстрока поиска (без учёта регистра): совпадение по seed или по id,
   * а при включённом параметре никнейма — ещё и по никнейму. Пустая — без поиска.
   */
  search?: string
  /** Порядок; `deleted-*` — только с правом на удалённые. */
  order?: SeedUsersOrder
  /** Состояние удалённости; без права на удалённые всегда `active`. */
  state?: SeedUsersState
  /** Диапазон создания, мс epoch; `null`/`undefined` — граница не задана. */
  createdFrom?: number | null
  createdTo?: number | null
  /** Диапазон удаления, мс epoch; только с правом на удалённые. */
  deletedFrom?: number | null
  deletedTo?: number | null
  /**
   * Параметр никнейма из фильтров: столбец, поиск и сортировка по
   * никнейму. Действует только с правом читать профили (`canSeeNickname`);
   * без права или при выключенном параметре домен его игнорирует.
   */
  nickname?: boolean
  /**
   * Состояние профиля: только с созданным профилем (`created`) или только
   * без строки профиля (`missing`). На уровне модели — узел `exists` по
   * модели профиля (docs/plan-exists-filter.md), не include и не срез в
   * памяти. Действует только с правом читать профили (`canSeeNickname`):
   * политика цели внутри `exists` — политика профиля, и без права на её
   * строки существование чужих профилей не подсматривается.
   */
  profile?: 'created' | 'missing'
  /**
   * Ограничение выдачи списком id (шаг подтверждения выбора и подобные):
   * только эти юзеры. Пустой/отсутствующий — без ограничения.
   */
  ids?: string[]
}

const ORDER_OF: Record<SeedUsersOrder, Order> = {
  'created-desc': [['created_at', 'desc']],
  'created-asc': [['created_at', 'asc']],
  'deleted-desc': [['deleted_at', 'desc']],
  'deleted-asc': [['deleted_at', 'asc']],
  'id-asc': [['id', 'asc']],
  'id-desc': [['id', 'desc']],
  // Путь по связи модели: слой сам подтянет join профиля и отсортирует по
  // payload (NULL — последним, конвенция слоя).
  'nickname-asc': [['profile.nickname', 'asc']],
  'nickname-desc': [['profile.nickname', 'desc']],
}

const ms = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null

/** Значение timestamp-фильтра для слоя БД — ISO-строка (схема поля числа не принимает). */
const iso = (v: number): string => new Date(v).toISOString()

/**
 * Порция списка аккаунтов: страница (с 1), размер и полное число строк
 * на том же срезе (поиск и фильтры учтены и в строках, и в счётчике).
 * Порядок по умолчанию — порядок модели (`created_at desc`).
 */
export async function listSeedUsers(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: ListSeedUsersArgs = {},
): Promise<UserResult<SeedUsersPage>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  const actor = principalOfRow({ id: g.sub, permissions: g.perms }).principal
  const caps = checkGrants(actor, {
    canReadAccounts: gAuth.select,
    canSeeDeleted: gAuth.selectDeleted,
    canSeeNickname: gProfile.select,
  })
  if (!caps.canReadAccounts) return fail({ code: 'auth.forbidden' })

  const { canSeeDeleted, canSeeNickname } = caps
  const withNickname = canSeeNickname && args.nickname === true
  // Состояние профиля — тем же правом, что никнейм: внутри exists действует
  // политика профиля, без права строки цели вызывающему не видны.
  const profileState = canSeeNickname ? args.profile : undefined

  const page = Math.max(1, Math.trunc(args.page ?? 1) || 1)
  const pageSize = Math.min(
    SEED_USERS_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(args.pageSize ?? 10) || 10),
  )

  const state: SeedUsersState = canSeeDeleted ? (args.state ?? 'active') : 'active'
  const orderName: SeedUsersOrder =
    args.order &&
    (canSeeDeleted || !args.order.startsWith('deleted')) &&
    (withNickname || !args.order.startsWith('nickname'))
      ? args.order
      : 'created-desc'

  const nodes: Filter[] = []
  if (profileState) {
    const hasProfile: Filter = { exists: { from: profileResource, on: [['id', 'auth_id']] } }
    nodes.push(profileState === 'created' ? hasProfile : { not: hasProfile })
  }
  const q = (args.search ?? '').trim()
  // Поиск — DB-фильтр: подстроковые операторы слоя валидируют фрагмент, а
  // не значение поля (FIX-1 аудита 2026-10-29), поэтому подстрока по seed
  // (схема 43–44 знака) и по id (uuid приводится к text) законна. Никнейм —
  // exists по профилю, только при включённом параметре: внутри exists
  // действует политика профиля.
  if (q) {
    const branches: Filter[] = [
      { field: 'seed', op: 'icontains', value: q },
      { field: 'id', op: 'icontains', value: q },
    ]
    if (withNickname) {
      branches.push({
        exists: {
          from: profileResource,
          on: [['id', 'auth_id']],
          where: { field: 'nickname', op: 'icontains', value: q },
        },
      })
    }
    nodes.push({ or: branches })
  }
  // Срез по id — DB-фильтр `in` по первичному ключу (объявлен в фильтрах поля).
  if (args.ids?.length) nodes.push({ field: 'id', op: 'in', value: [...args.ids] })

  const createdFrom = ms(args.createdFrom)
  const createdTo = ms(args.createdTo)
  if (createdFrom !== null) nodes.push({ field: 'created_at', op: 'gte', value: iso(createdFrom) })
  if (createdTo !== null) nodes.push({ field: 'created_at', op: 'lte', value: iso(createdTo) })

  if (canSeeDeleted && state === 'deleted') {
    const deletedFrom = ms(args.deletedFrom)
    const deletedTo = ms(args.deletedTo)
    // «Только удалённые» — та же объявленная операция `gte` от эпохи:
    // отдельной ветки в адаптере под состояние нет.
    nodes.push({ field: 'deleted_at', op: 'gte', value: iso(deletedFrom ?? 0) })
    if (deletedTo !== null) nodes.push({ field: 'deleted_at', op: 'lte', value: iso(deletedTo) })
  }
  // Диапазон удаления действует только в состоянии «только удалённые»:
  // в «включая удалённые» условие по `deleted_at` выкинуло бы действующие
  // строки (NULL сравнению не удовлетворяет), а это не то, что выбрал человек.

  const filter: Filter | undefined =
    nodes.length === 0 ? undefined : nodes.length === 1 ? nodes[0] : { and: nodes }

  const { rows, total } = await ports.auths.listPage(
    principalOfRow({ id: g.sub, permissions: g.perms }),
    {
      page,
      pageSize,
      ...(filter ? { filter } : {}),
      order: ORDER_OF[orderName],
      includeDeleted: state !== 'active',
      ...(withNickname ? { withNickname: true } : {}),
    },
  )
  // Блокировки страницы — одним батчом модели (этап 9), не полем строки auth.
  const blocksMap = await blocksOfMany(ports, rows.map((r) => r.id))
  return ok({
    items: rows.map((r) =>
      withNickname
        ? { ...viewOf(r, blocksMap.get(r.id) ?? []), nickname: r.nickname ?? null }
        : viewOf(r, blocksMap.get(r.id) ?? []),
    ),
    total,
    page,
    pageSize,
    canSeeDeleted,
    canSeeNickname,
  })
}
