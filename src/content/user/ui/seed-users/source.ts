/**
 * Источник и регистрация пагинатора списка seed-юзеров.
 *
 * Один конвейер на все носители (прецедент — список постов `#content/demo-catalog/posts`):
 * первая порция приходит снапшотом из `load` роута `/users` (тот же `load`
 * исполняет модалка через `preloadData`), следующие порции в браузере догружает
 * этот источник через `GET /api/seed-users`. Оба пути на сервере сходятся в
 * одном доменном вызове `auth(event).listSeedUsers(...)` — разной логики выдачи
 * у страницы, модалки и догрузки нет.
 *
 * Адрес пагинатора — свой базовый ключ `users` (`?users=2`, `?users.size=…`):
 * подлежащая страница может жить со своим `?page`, а модалка — со своими
 * `?modal.*`, и список не должен спорить с ними о ключах.
 */
import { responseError } from '#hooks/api-error.js'
import { fetchWithTask } from '#lib/fetch/index.js'
import {
  createUrlAdapter,
  definePaginator,
  defineSource,
  hasPaginator,
  type PageResponse,
  type PaginatorState,
} from '#lib/paginate/index.js'
import type { AuthErrorCode } from '../../error.js'
import type { SeedUserView, SeedUsersPage } from '../../types.js'

export const SEED_USERS_NAME = 'seed-users'
export const SEED_USERS_PAGE_SIZE = 10
export const SEED_USERS_PAGE_PARAM = 'users'

/**
 * Данные экрана списка: ровно то, что отдаёт `load` роута `/users`.
 * `fact` — отказ домена данными (нет входа, нет права), а не брошенная ошибка:
 * иначе компонент модалки не смонтировался бы и экран отказа показать некому.
 * `snapshot === null` при `fact === null` не бывает.
 */
export interface SeedUsersScreenData {
  snapshot: PaginatorState<SeedUserView> | null
  fact: AuthErrorCode | null
  /** Вход включён на сервере (иначе экран скрыт за `Acl`). */
  enabled: boolean
}

async function fetchSeedUsersPage(page: number, pageSize: number, signal?: AbortSignal, report?: (p: unknown) => void): Promise<PageResponse<SeedUserView>> {
  const q = new URLSearchParams({ page: String(page), size: String(pageSize) })
  const res = await fetchWithTask(`/api/seed-users?${q}`, { signal, onTask: report })
  // Отказ сервера обязан дойти до пагинатора как ошибка: пустой список он
  // читает как «данных нет», а это другое состояние (см. ErrorRow).
  if (!res.ok) throw await responseError(res, 'seed-users')
  const p = (await res.json()) as SeedUsersPage
  return pageResponseOf(p)
}

function pageResponseOf(p: SeedUsersPage): PageResponse<SeedUserView> {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize))
  return {
    items: p.items,
    totalItems: p.total,
    totalPages,
    hasNext: p.page < totalPages,
  }
}

export const seedUsersSource = defineSource<SeedUserView>({
  name: 'seed_users',
  record: {
    id: (r) => r.id,
    title: (r) => r.seed ?? r.id,
    texts: (r) => [r.seed ?? '', r.id],
  },
  totals: true,
  data: (look) => fetchSeedUsersPage(look.page, look.pageSize, look.signal, look.report),
})

/**
 * Регистрация пагинатора — в том же бандле, где рендерится хост (иначе клиент
 * падает на гидрации с «Unknown paginator»). Идемпотентно.
 */
export function ensureSeedUsersPaginator(): string {
  if (!hasPaginator(SEED_USERS_NAME)) {
    definePaginator({
      name: SEED_USERS_NAME,
      adapter: createUrlAdapter({
        name: SEED_USERS_NAME,
        source: seedUsersSource,
        pageSize: SEED_USERS_PAGE_SIZE,
        pageParam: SEED_USERS_PAGE_PARAM,
      }),
    })
  }
  return SEED_USERS_NAME
}

/**
 * Снапшот первой порции для `PaginatorHost`: состояние, которое хост принял бы
 * после загрузки этой страницы, но без сетевого хода — данные уже принёс `load`.
 */
export function seedUsersSnapshot(p: SeedUsersPage): PaginatorState<SeedUserView> {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize))
  return {
    name: SEED_USERS_NAME,
    page: p.page,
    pageSize: p.pageSize,
    totalItems: p.total,
    totalPages,
    extra: {},
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
