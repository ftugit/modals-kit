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
  hasPaginator,
  type PageResponse,
  type PaginatorState,
} from '#lib/paginate/index.js'
import type { AuthErrorCode } from '../../error.js'
import { AUTH_MESSAGES } from '../../messages.js'
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

/**
 * Догрузка порции — через тот же `load` роута `/users`, что отдал первую
 * порцию (одна точка доступа к данным, REST-роута у списка нет).
 * `preloadData` не принимает `AbortSignal` и не репортит прогресс: устаревшие
 * ответы пагинатор отсекает сам по `reqId`, а порция невелика.
 */
async function fetchSeedUsersPage(page: number, pageSize: number): Promise<PageResponse<SeedUserView>> {
  const q = new URLSearchParams({
    [SEED_USERS_PAGE_PARAM]: String(page),
    [`${SEED_USERS_PAGE_PARAM}.size`]: String(pageSize),
  })
  const r = await preloadData(`/users?${q}`)
  if (r.type !== 'loaded') {
    // Редирект (например, гостя уводит на вход) или отказ загрузчика:
    // пагинатору — ошибка с кодом, а не пустой список («данных нет» — другое).
    const err = new Error('Не удалось загрузить список') as Error & { code: string }
    err.code = r.type === 'redirect' ? 'auth.expired' : 'load.error'
    throw err
  }
  const data = r.data as SeedUsersScreenData
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
  totals: true,
  data: (look) => fetchSeedUsersPage(look.page, look.pageSize),
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
