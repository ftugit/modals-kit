/**
 * Источник и регистрация пагинатора списка seed-юзеров.
 *
 * Один конвейер на все носители: первая порция приходит снапшотом из `load`
 * роута `/users` (тот же `load` исполняет модалка через `preloadData`),
 * следующие порции в браузере догружает этот источник — тоже через
 * `preloadData` на `/users?users=N`, то есть через тот же `load`. Отдельного
 * REST-роута у списка нет (решение владельца: одна точка доступа к данным);
 * на сервере все пути сходятся в одном доменном вызове
 * `auth(event).listSeedUsers(...)` — разной логики выдачи у страницы,
 * модалки и догрузки нет.
 *
 * Адрес пагинатора — свой базовый ключ `users` (`?users=2`, `?users.size=…`):
 * подлежащая страница может жить со своим `?page`, а модалка — со своими
 * `?modal.*`, и список не должен спорить с ними о ключах.
 */
import { preloadData } from '$app/navigation'
import {
  createUrlAdapter,
  definePaginator,
  defineSource,
  extraField,
  hasPaginator,
  type ExtraSearchSpec,
  type PageResponse,
  type PaginatorState,
} from '#lib/paginate/index.js'
import type { AuthErrorCode } from '../../error.js'
import { AUTH_MESSAGES } from '../../messages.js'
import type { SeedUserView, SeedUsersOrder, SeedUsersPage, SeedUsersState } from '../../types.js'

export const SEED_USERS_NAME = 'seed-users'
export const SEED_USERS_PAGE_SIZE = 30
/** Допустимые размеры порции из формы фильтров и адреса: целое 30..100. */
export const SEED_USERS_PAGE_SIZES: readonly number[] = Array.from({ length: 71 }, (_, i) => i + 30)
export const SEED_USERS_PAGE_PARAM = 'users'

/**
 * Ключи фильтров источника (этап 1): порядок, состояние удалённости и
 * диапазоны дат. Значения — строки адреса (`?users.ord=created-asc` и т.д.),
 * разбирает их один раз `load` роута; домен валидирует и собирает срез БД.
 * Даты — ISO-строки полей формы, в `load` превращаются в мс epoch.
 */
export const SEED_USERS_FILTER_KEYS = ['ord', 'state', 'cfrom', 'cto', 'dfrom', 'dto', 'nick'] as const

/**
 * Ключ ограничения по списку id (`users.ids=id,id`): не фильтр формы, а
 * срез источника — шаг подтверждения показывает тем же списком только
 * выбранных. Живёт в `extra` пагинатора (и в адресе), чтобы догрузка
 * порций видела тот же срез, что первая порция снапшота.
 */
export const SEED_USERS_IDS_KEY = 'ids'

/** Допустимые значения порядка и состояния: валидатор адреса и `load` роута смотрят в один список. */
export const SEED_USERS_ORDERS: readonly SeedUsersOrder[] = [
  'created-desc',
  'created-asc',
  'deleted-desc',
  'deleted-asc',
  'id-asc',
  'id-desc',
  'nickname-asc',
  'nickname-desc',
]
export const SEED_USERS_STATES: readonly SeedUsersState[] = ['active', 'all', 'deleted']

/**
 * Ключи `extra`, объявленные адресному слою (`extraSearch` URL-адаптера).
 *
 * Без этого объявления адаптер ключи в адрес НЕ пишет и из адреса НЕ
 * восстанавливает (он вправе держать только объявленное — адрес общий,
 * в нём живут чужие параметры): поиск и фильтры тогда работают из стора,
 * но URL-хранилищем не являются. Проверяется здесь только ФОРМА значений;
 * допустимость — за `load` и доменом (прецедент — `SHIKIMORI_FILTER_SEARCH`).
 */
export const SEED_USERS_EXTRA_SEARCH: ExtraSearchSpec = {
  q: extraField('text', (v) => typeof v === 'string' && v.length <= 120),
  ord: extraField('text', (v) => SEED_USERS_ORDERS.includes(v as SeedUsersOrder)),
  state: extraField('text', (v) => SEED_USERS_STATES.includes(v as SeedUsersState)),
  cfrom: extraField('text', (v) => typeof v === 'string' && v.length <= 40),
  cto: extraField('text', (v) => typeof v === 'string' && v.length <= 40),
  dfrom: extraField('text', (v) => typeof v === 'string' && v.length <= 40),
  dto: extraField('text', (v) => typeof v === 'string' && v.length <= 40),
  // Параметр никнейма (этап 2): только '1' — включён; всё прочее — выключен.
  nick: extraField('text', (v) => v === '1'),
  // Ограничение по id: список uuid через запятую, разумной длины.
  ids: extraField('text', (v) => typeof v === 'string' && /^[0-9a-f,-]{1,4000}$/i.test(v)),
}

/** Дефолты `extra`: значения по умолчанию в адрес не пишутся — чистый URL. */
export const SEED_USERS_EXTRA_DEFAULTS = { q: '', ord: 'created-desc', state: 'active', nick: '', ids: '' } as const

/**
 * Данные `load` роута `/users` — единственный источник показа списка.
 * `fact` — отказ домена данными (нет входа, нет права), а не брошенная ошибка:
 * иначе носителю нечего было бы показать экраном отказа (`Acl` рисует он).
 * `snapshot === null` при `fact === null` не бывает.
 */
export interface SeedUsersRouteData {
  snapshot: PaginatorState<SeedUserView> | null
  fact: AuthErrorCode | null
  /** Вход включён на сервере (иначе экран скрыт за `Acl`). */
  enabled: boolean
  /** Видны ли вызывающему удалённые строки: от этого зависят фильтр состояния и даты удаления. */
  canSeeDeleted: boolean
  /** Доступны ли вызывающему никнеймы: от этого зависит параметр никнейма в фильтрах. */
  canSeeNickname: boolean
}

/**
 * Догрузка порции — через тот же `load` роута `/users`, что отдал первую
 * порцию (одна точка доступа к данным, REST-роута у списка нет).
 * `preloadData` не принимает `AbortSignal` и не репортит прогресс: устаревшие
 * ответы пагинатор отсекает сам по `reqId`, а порция невелика.
 */
async function fetchSeedUsersPage(
  page: number,
  pageSize: number,
  input?: { q?: string; filters?: Readonly<Record<string, string>> },
): Promise<PageResponse<SeedUserView>> {
  const q = new URLSearchParams({
    [SEED_USERS_PAGE_PARAM]: String(page),
    [`${SEED_USERS_PAGE_PARAM}.size`]: String(pageSize),
  })
  // Поиск и фильтры едут теми же ключами адреса, что держит адаптер
  // (`users.q`, `users.ord`, …): `load` разберёт их в тот же срез, что и SSR.
  if (input?.q) q.set(`${SEED_USERS_PAGE_PARAM}.q`, input.q)
  for (const [k, v] of Object.entries(input?.filters ?? {})) {
    if (v) q.set(`${SEED_USERS_PAGE_PARAM}.${k}`, v)
  }
  const r = await preloadData(`/users?${q}`)
  if (r.type !== 'loaded') {
    // Редирект (например, гостя уводит на вход) или отказ загрузчика:
    // пагинатору — ошибка с кодом, а не пустой список («данных нет» — другое).
    const err = new Error('Не удалось загрузить список') as Error & { code: string }
    err.code = r.type === 'redirect' ? 'auth.expired' : 'load.error'
    throw err
  }
  const data = r.data as SeedUsersRouteData
  // Отказ домена `load` отдаёт данными (`fact`): для пагинатора это ошибка
  // с кодом домена — пустой список он прочитал бы как «список пуст».
  if (data.fact) {
    const err = new Error(AUTH_MESSAGES[data.fact] ?? 'Не удалось загрузить список') as Error & { code: string }
    err.code = data.fact
    throw err
  }
  const snap = data.snapshot
  if (!snap) throw new Error('Не удалось загрузить список')
  return {
    items: snap.pages[page] ?? [],
    totalItems: snap.totalItems ?? undefined,
    totalPages: snap.totalPages ?? undefined,
    hasNext: snap.hasNext ?? false,
  }
}

export const seedUsersSource = defineSource<SeedUserView>({
  name: 'seed_users',
  record: {
    id: (r) => r.id,
    title: (r) => r.seed ?? r.id,
    texts: (r) => [r.seed ?? '', r.id],
  },
  // Родной поиск источника: пагинатор отдаёт запрос в `data` (`input.q`),
  // сужает выдачу сервер (подстрока seed/id, при включённом параметре — ещё
  // никнейма), а не клиент по загруженным порциям.
  search: { minLength: 2 },
  filters: [...SEED_USERS_FILTER_KEYS, SEED_USERS_IDS_KEY],
  totals: true,
  data: (look, input) => fetchSeedUsersPage(look.page, look.pageSize, input),
})

/**
 * Регистрация пагинатора — в том же бандле, где рендерится хост (иначе клиент
 * падает на гидрации с «Unknown paginator»). Идемпотентно.
 */
export function ensureSeedUsersPaginator(): string {
  if (!hasPaginator(SEED_USERS_NAME)) {
    definePaginator({
      name: SEED_USERS_NAME,
      // Поиск и любой фильтр — новая выдача с первой порции. Без `reloadKeys`
      // `setExtra` только правил бы состояние: ни перезапроса, ни смены адреса
      // (прецедент — `reloadKeys` демо-пагинатора и списка постов).
      reloadKeys: ['q', ...SEED_USERS_FILTER_KEYS, SEED_USERS_IDS_KEY],
      adapter: createUrlAdapter({
        name: SEED_USERS_NAME,
        source: seedUsersSource,
        pageSize: SEED_USERS_PAGE_SIZE,
        pageSizes: SEED_USERS_PAGE_SIZES,
        pageParam: SEED_USERS_PAGE_PARAM,
        // Поиск и фильтры — полноправные ключи адреса (утверждённое
        // URL-хранилище): адаптер пишет их при смене состояния и
        // восстанавливает из адреса после перезагрузки.
        extraSearch: SEED_USERS_EXTRA_SEARCH,
        extraDefaults: SEED_USERS_EXTRA_DEFAULTS,
      }),
    })
  }
  return SEED_USERS_NAME
}

/**
 * Снапшот первой порции для `PaginatorHost`: состояние, которое хост принял бы
 * после загрузки этой страницы, но без сетевого хода — данные уже принёс `load`.
 */
export function seedUsersSnapshot(p: SeedUsersPage, ids?: string): PaginatorState<SeedUserView> {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize))
  return {
    name: SEED_USERS_NAME,
    page: p.page,
    pageSize: p.pageSize,
    totalItems: p.total,
    totalPages,
    // Срез по id едет в `extra` снапшота: догрузка порций берёт фильтры
    // из состояния, и без этого следующие порции потеряли бы ограничение.
    extra: ids ? { [SEED_USERS_IDS_KEY]: ids } : {},
    loadedPages: [p.page],
    pages: { [p.page]: p.items },
    status: 'idle',
    error: null,
    errorCode: null,
    pending: null,
    hasNext: p.page < totalPages,
    hasPrev: p.page > 1,
    reqId: 0,
    capabilities: seedUsersSource.capabilitiesFor({}),
  }
}
