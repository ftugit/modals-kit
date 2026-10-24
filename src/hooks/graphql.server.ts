/**
 * Универсальный GraphQL-источник: `{ url, doc, variables, map }`.
 *
 * Один и тот же транспорт обслуживает любой GraphQL-эндпоинт — Shikimori здесь
 * просто `url` (решение этапа 3: транспорт не знает про каталог, а каталог не
 * знает про транспорт). Что входит в контракт, кроме POST:
 *
 *   • кэш по `url + doc + variables` (повторный разбор схемы не дёргает API),
 *     с потолком записей;
 *   • сеть — `fetch` приложения (`#server/fetch.server.js`, `upstream`): User-Agent и лимит хоста, таймаут,
 *     повторы на 429/5xx, склейка одновременных одинаковых запросов («ровно
 *     один обновляющий запрос» — свойство сети, а не удача);
 *   • GraphQL-ответ с `errors` — ошибка, даже если HTTP 200: частичные данные
 *     не данные, и молча построить по ним схему нельзя.
 *
 * Ошибки наружу — `FetchError` (`#lib/fetch`) с кодом и статусом 502/504:
 * роут отдаёт их через `apiFailure`, а не как пустой список. `message` — НАШ
 * текст (его можно показать клиенту); исходный сбой и тексты `errors` сервера —
 * только в `cause`, для лога (B8).
 */
import { isServerSide } from '#lib/paginate/index.js'
import { FetchError, readJson, type AppFetch } from '#lib/fetch/index.js'
import type { Store } from '#lib/cache/index.js'
import { localStore } from '#server/cache.server.js'
import { upstream } from '#server/fetch.server.js'

/** Запрос к GraphQL: адрес, документ, переменные и проекция ответа. */
export type GraphqlSpec<T, V = Record<string, unknown>> = {
  url: string
  /** Документ запроса (строка GraphQL). */
  doc: string
  variables?: V
  /** Имя операции, если в документе их несколько. */
  operationName?: string
  /**
   * `data` ответа → значение домена. Проекция живёт рядом с запросом: транспорт
   * не знает ни одного поля конкретного API.
   */
  map: (data: unknown, raw: unknown) => T
}

/**
 * Зависимости транспорта: сеть — `fetch` приложения (`#server/fetch.server.js`: лимиты хоста,
 * User-Agent, таймаут, повторы, склейка одинаковых запросов), кэш — хранилище,
 * в котором транспорт берёт свою область (`localStore` по умолчанию).
 */
export type GraphqlDeps = {
  fetch?: AppFetch
  store?: Store
}

const CACHE_TTL_MS = 60_000
/**
 * Потолок кэша (F59): ключ — документ и переменные, а переменные бывают из ввода
 * пользователя (страница, фильтры) — без потолка кэш рос бы до конца процесса.
 */
export const GRAPHQL_CACHE_MAX = 256

const cacheOf = (deps: GraphqlDeps): Store =>
  (deps.store ?? localStore).scope('graphql', { max: GRAPHQL_CACHE_MAX })

/** Сброс кэша транспорта в `localStore` (тесты; в приложении не нужен). */
export async function resetGraphqlTransport(): Promise<void> {
  await cacheOf({}).clear()
}

/** Ключ кэша: одинаковый запрос — одна запись, разные — разные. */
export function graphqlCacheKey<T, V>(spec: GraphqlSpec<T, V>): string {
  const { url, doc, variables, operationName } = spec
  return JSON.stringify([url, doc, variables ?? null, operationName ?? null])
}

async function requestGraphql<T, V>(spec: GraphqlSpec<T, V>, fetch: AppFetch, signal?: AbortSignal): Promise<T> {
  const body = JSON.stringify({
    query: spec.doc,
    ...(spec.variables !== undefined ? { variables: spec.variables } : {}),
    ...(spec.operationName ? { operationName: spec.operationName } : {}),
  })
  // Запрос (не мутация) ничего не меняет: его можно повторить и склеить с
  // таким же одновременным — `idempotent` говорит это `fetch` приложения.
  const res = await fetch(spec.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body,
    idempotent: true,
    signal,
  })
  const raw = await readJson(res)
  const payload = (raw ?? {}) as { data?: unknown; errors?: readonly { message?: string }[] }
  if (payload.errors?.length) {
    // Тексты сервера (имена полей, типы) — подробности запроса, не для клиента.
    throw new FetchError('fetch.rejected', 'GraphQL вернул ошибку', {
      cause: payload.errors.map((e) => e.message ?? 'ошибка').join('; '),
    })
  }
  if (payload.data === undefined || payload.data === null) {
    throw new FetchError('fetch.rejected', 'GraphQL: ответ без data')
  }
  return spec.map(payload.data, raw)
}

/**
 * Выполнить GraphQL-запрос. Повторные вызовы того же запроса в пределах TTL
 * берут кэш; одновременные — один запрос (склейка в `fetch`). `signal`
 * прерывает только ЭТО ожидание: общий запрос дойдёт до конца для остальных.
 */
export async function fetchGraphql<T, V = Record<string, unknown>>(
  spec: GraphqlSpec<T, V>,
  { signal, ...deps }: GraphqlDeps & { signal?: AbortSignal } = {},
): Promise<T> {
  if (isServerSide() === false) {
    throw new Error('[graphql] транспорт схемы работает только на сервере')
  }
  const cache = cacheOf(deps)
  const key = graphqlCacheKey(spec)
  const hit = await cache.get<{ value: T }>(key)
  if (hit) return hit.value
  const value = await requestGraphql(spec, deps.fetch ?? upstream, signal)
  await cache.set(key, { value }, CACHE_TTL_MS)
  return value
}
