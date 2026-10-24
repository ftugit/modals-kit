/**
 * Типизированные маршруты и реестр адресов поверх `@standard-schema/spec`,
 * `localPath` (`./core.ts`) и алгебры ключей `claimQuery` / `nextSearch` (`./keys.ts`).
 *
 * Ни одного фреймворкового импорта: привязка к `RouteId` / `RouteParams` SvelteKit
 * живёт тонкой обёрткой `kitRoute` в `./sveltekit.ts`, а связка с модалками идёт
 * через штатный `registerModal({ route: myRoute.href })` без связности ядер.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { localPath } from './core.js'
import { claimQuery, nextSearch, type QueryClaim, type QueryPatchValue } from './keys.js'

/** Сырой разбор поиска: ключ → значение или список значений. */
export type RawQueryRecord = Record<string, string | readonly string[] | undefined>
/** Откуда читать поиск: URL, `URLSearchParams`, строка или уже разобранная запись. */
export type QueryInputSource = URL | URLSearchParams | string | RawQueryRecord | null | undefined

/** Схема безопасного локального пути (`next` / `returnTo`): отсекает `//evil.com`, `/\evil.com`, `javascript:`. */
export const localPathSchema: StandardSchemaV1<string | null | undefined, string | null> = {
  '~standard': {
    version: 1,
    vendor: 'modals-kit/address',
    validate: (value) => ({ value: typeof value === 'string' ? localPath(value) : null }),
  },
}

/**
 * Компактная обёртка синхронного нормализатора в `StandardSchemaV1` (0 лишних байт
 * в начальном бандле там, где тянуть весь рантайм Zod не нужно; с `z.object(...)`
 * полностью взаимозаменяема).
 */
export function querySchema<Input extends Record<string, unknown>, Output = Input>(
  normalize: (raw: RawQueryRecord) => Output,
): StandardSchemaV1<Input, Output> {
  return {
    '~standard': {
      version: 1,
      vendor: 'modals-kit/address',
      validate: (value) => ({ value: normalize((value ?? {}) as RawQueryRecord) }),
    },
  }
}

/** Форма схемы поиска: ключ → Standard Schema-валидатор значения. */
export type SchemaShape = Record<string, StandardSchemaV1<unknown, unknown>>

/**
 * Покомпонентная сборка `StandardSchemaV1`-схемы объекта из произвольной смеси
 * `StandardSchemaV1`-полей (`z.enum(...)`, `z.coerce.number()`, `localPathSchema`,
 * собственные валидаторы) с поключевым откатом битых URL-параметров к дефолту поля.
 */
export function objectSchema<Shape extends SchemaShape>(
  shape: Shape,
): StandardSchemaV1<
  { [K in keyof Shape]: StandardSchemaV1.InferInput<Shape[K]> },
  { [K in keyof Shape]: StandardSchemaV1.InferOutput<Shape[K]> }
> {
  return {
    '~standard': {
      version: 1,
      vendor: 'modals-kit/address',
      validate: (value) => {
        const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
        const out: Record<string, unknown> = {}
        const issues: StandardSchemaV1.Issue[] = []
        for (const [key, field] of Object.entries(shape)) {
          const primary = field['~standard'].validate(record[key])
          if (primary instanceof Promise) {
            throw new TypeError(`Async StandardSchemaV1 field "${key}" is not supported in synchronous route.parse()`)
          }
          if (!primary.issues) {
            out[key] = primary.value
            continue
          }
          const fallback = field['~standard'].validate(undefined)
          if (fallback instanceof Promise) {
            throw new TypeError(`Async StandardSchemaV1 field "${key}" is not supported in synchronous route.parse()`)
          }
          if (!fallback.issues) {
            out[key] = fallback.value
          } else {
            issues.push(...primary.issues)
          }
        }
        return issues.length > 0
          ? { issues }
          : { value: out as { [K in keyof Shape]: StandardSchemaV1.InferOutput<Shape[K]> } }
      },
    },
  }
}

/** Опции статического маршрута: путь, схема поиска и метаданные. */
export interface StaticRouteOptions<
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
> {
  /** Уникальный идентификатор в реестре (по умолчанию совпадает с `path`). */
  readonly id?: string
  /** Владелец query-ключей в `claimQuery` / `nextSearch` (по умолчанию `id ?? path`). */
  readonly owner?: string
  /** Бронируемые ключи строки запроса (`['stage', 'next']`). */
  readonly keys?: readonly QueryClaim[]
  /** Standard Schema v1 (`z.object(...)` или `querySchema(...)`) для разбора query. */
  readonly search?: StandardSchemaV1<SearchInput, SearchOutput>
  /** Значения по умолчанию: совпадающие с ними не сериализуются в `href` / `patch`. */
  readonly defaults?: Partial<Record<keyof SearchInput & string, unknown>>
}

/** Опции параметрического маршрута: шаблон пути и схема поиска. */
export interface ParamRouteOptions<
  Params extends Record<string, string>,
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
> extends StaticRouteOptions<SearchInput, SearchOutput> {
  readonly id: string
  readonly buildPath: (params: Params) => string
}

/** Описание статического маршрута: разбор адреса и построение ссылки. */
export interface StaticRouteDescriptor<
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
> {
  readonly id: string
  readonly owner: string
  readonly path: string
  /** Собрать ссылку маршрута (совместимо напрямую с `ModalDefinition.route`). */
  readonly href: (search?: Partial<SearchInput>) => string
  /** Разобрать и провалидировать query-параметры из `URL`, `URLSearchParams` или строки. */
  readonly parse: (from?: QueryInputSource) => SearchOutput
  /** Точечно обновить свои query-ключи, сохранив все чужие параметры нетронутыми. */
  readonly patch: (
    from: URL | URLSearchParams | string,
    patch: Partial<Record<keyof SearchInput & string, QueryPatchValue>>,
    opts?: { drop?: readonly string[] },
  ) => string
}

/** Описание параметрического маршрута: параметры пути и схема поиска. */
export interface ParamRouteDescriptor<
  Params extends Record<string, string>,
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
> {
  readonly id: string
  readonly owner: string
  /** Собрать путь маршрута по параметрам сегментов. */
  readonly path: (params: Params) => string
  /** Собрать полную ссылку маршрута по параметрам пути и query-параметрам. */
  readonly href: (params: Params, search?: Partial<SearchInput>) => string
  /** Разобрать и провалидировать query-параметры из `URL`, `URLSearchParams` или строки. */
  readonly parse: (from?: QueryInputSource) => SearchOutput
  /** Точечно обновить свои query-ключи на конкретном пути, сохранив чужие параметры. */
  readonly patch: (
    from: URL | URLSearchParams | string,
    params: Params,
    patch: Partial<Record<keyof SearchInput & string, QueryPatchValue>>,
    opts?: { drop?: readonly string[] },
  ) => string
}

/** Описание маршрута: общий вид для статических и параметрических. */
export type RouteDescriptor<
  Params extends Record<string, string> | void = void,
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
> = [Params] extends [void]
  ? StaticRouteDescriptor<SearchInput, SearchOutput>
  : ParamRouteDescriptor<Extract<Params, Record<string, string>>, SearchInput, SearchOutput>

const routes = new Map<string, StaticRouteDescriptor<never, unknown> | ParamRouteDescriptor<never, never, unknown>>()

/** Сброс реестра маршрутов (для изолированных unit-тестов). */
export function resetRegisteredRoutes(): void {
  routes.clear()
}

function extractSearchString(from: URL | URLSearchParams | string): string {
  if (from instanceof URL) return from.search
  if (from instanceof URLSearchParams) {
    const qs = from.toString()
    return qs ? `?${qs}` : ''
  }
  const qIndex = from.indexOf('?')
  if (qIndex >= 0) {
    const raw = from.slice(qIndex)
    const hashIndex = raw.indexOf('#')
    return hashIndex >= 0 ? raw.slice(0, hashIndex) : raw
  }
  return from.startsWith('/') || from.includes('://') ? '' : from
}

function toRawRecord(from: QueryInputSource): RawQueryRecord {
  if (!from) return {}
  if (!(from instanceof URL) && !(from instanceof URLSearchParams) && typeof from !== 'string') {
    return from
  }
  const params = new URLSearchParams(extractSearchString(from))
  const out: RawQueryRecord = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    out[key] = all.length <= 1 ? all[0] : all
  }
  return out
}

function validateSync<Input, Output>(schema: StandardSchemaV1<Input, Output>, raw: RawQueryRecord): Output {
  const run = (candidate: RawQueryRecord) => {
    const res = schema['~standard'].validate(candidate)
    if (res instanceof Promise) {
      throw new TypeError('Async StandardSchemaV1 is not supported in synchronous route.parse()')
    }
    return res
  }

  const first = run(raw)
  if (!first.issues) return first.value

  // Битые query-параметры в адресной строке не должны ронять SSR 500-й ошибкой:
  // вычищаем проблемные верхнеуровневые ключи, чтобы сработали `.default(...)` схемы.
  const cleaned: RawQueryRecord = { ...raw }
  for (const issue of first.issues) {
    const head = issue.path?.[0]
    const key = typeof head === 'object' && head !== null && 'key' in head ? head.key : head
    if (typeof key === 'string') delete cleaned[key]
  }
  const fallback = run(cleaned)
  if (!fallback.issues) return fallback.value

  const empty = run({})
  if (!empty.issues) return empty.value

  throw new Error(`Invalid route search parameters: ${first.issues.map((i) => i.message).join('; ')}`)
}

function normalizePatch(
  patch: Record<string, unknown> | undefined,
  defaults: Partial<Record<string, unknown>> | undefined,
): Record<string, QueryPatchValue> {
  if (!patch) return {}
  const normalized: Record<string, QueryPatchValue> = {}
  for (const [key, value] of Object.entries(patch)) {
    normalized[key] = (defaults && key in defaults && defaults[key] === value
      ? undefined
      : value) as QueryPatchValue
  }
  return normalized
}

function createRouteCodec<SearchInput extends Record<string, unknown>, SearchOutput>(
  id: string,
  opts: StaticRouteOptions<SearchInput, SearchOutput> | undefined,
) {
  const owner = opts?.owner ?? id
  const declaredKeys = opts?.keys ?? []
  const claimAll = () => {
    if (declaredKeys.length > 0) claimQuery(owner, ...declaredKeys)
  }
  claimAll()

  const parse = (from?: QueryInputSource): SearchOutput => {
    const raw = toRawRecord(from)
    return opts?.search ? validateSync(opts.search, raw) : (raw as unknown as SearchOutput)
  }

  const formatSearch = (
    from: URL | URLSearchParams | string,
    changes: Record<string, unknown> | undefined,
    patchOpts?: { drop?: readonly string[] },
  ): string => {
    if (!from && (!changes || Object.keys(changes).length === 0) && !patchOpts?.drop?.length) {
      return ''
    }
    claimAll()
    return nextSearch(owner, extractSearchString(from), normalizePatch(changes, opts?.defaults), patchOpts)
  }

  return { id, owner, parse, formatSearch }
}

/** Объявляет типизированный маршрут: путь, схема поиска и построитель ссылки. */
export function defineRoute<
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
>(
  path: string,
  options?: StaticRouteOptions<SearchInput, SearchOutput>,
): StaticRouteDescriptor<SearchInput, SearchOutput>
/** Перегрузка: параметрический маршрут — путь собирает `buildPath`, поиск тот же. */
export function defineRoute<
  Params extends Record<string, string>,
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
>(
  options: ParamRouteOptions<Params, SearchInput, SearchOutput>,
): ParamRouteDescriptor<Params, SearchInput, SearchOutput>
/** Реализация: принимает готовый путь (`string`) либо опции параметрического маршрута. */
export function defineRoute<
  Params extends Record<string, string>,
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
>(
  pathOrOptions: string | ParamRouteOptions<Params, SearchInput, SearchOutput>,
  maybeOptions?: StaticRouteOptions<SearchInput, SearchOutput>,
): StaticRouteDescriptor<SearchInput, SearchOutput> | ParamRouteDescriptor<Params, SearchInput, SearchOutput> {
  if (typeof pathOrOptions === 'string') {
    const pathname = pathOrOptions
    const core = createRouteCodec(maybeOptions?.id ?? pathname, maybeOptions)
    const staticDescriptor: StaticRouteDescriptor<SearchInput, SearchOutput> = {
      id: core.id,
      owner: core.owner,
      path: pathname,
      parse: core.parse,
      href: (search) => `${pathname}${core.formatSearch('', search as Record<string, unknown> | undefined)}`,
      patch: (from, changes, opts) =>
        `${pathname}${core.formatSearch(from, changes as Record<string, unknown>, opts)}`,
    }
    return staticDescriptor
  }

  const { buildPath } = pathOrOptions
  const core = createRouteCodec(pathOrOptions.id, pathOrOptions)
  const paramDescriptor: ParamRouteDescriptor<Params, SearchInput, SearchOutput> = {
    id: core.id,
    owner: core.owner,
    path: buildPath,
    parse: core.parse,
    href: (params, search) =>
      `${buildPath(params)}${core.formatSearch('', search as Record<string, unknown> | undefined)}`,
    patch: (from, params, changes, opts) =>
      `${buildPath(params)}${core.formatSearch(from, changes as Record<string, unknown>, opts)}`,
  }
  return paramDescriptor
}

/** Регистрирует описание в реестре маршрутов (по имени или пути). */
export function registerRoute<
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
>(
  path: string,
  options?: StaticRouteOptions<SearchInput, SearchOutput>,
): StaticRouteDescriptor<SearchInput, SearchOutput>
/** Перегрузка: параметрический маршрут по опциям (`buildPath` и `id`). */
export function registerRoute<
  Params extends Record<string, string>,
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
>(
  options: ParamRouteOptions<Params, SearchInput, SearchOutput>,
): ParamRouteDescriptor<Params, SearchInput, SearchOutput>
/** Реализация: принимает готовый путь (`string`) либо опции параметрического маршрута. */
export function registerRoute<
  Params extends Record<string, string>,
  SearchInput extends Record<string, unknown> = Record<string, never>,
  SearchOutput = SearchInput,
>(
  pathOrOptions: string | ParamRouteOptions<Params, SearchInput, SearchOutput>,
  maybeOptions?: StaticRouteOptions<SearchInput, SearchOutput>,
): StaticRouteDescriptor<SearchInput, SearchOutput> | ParamRouteDescriptor<Params, SearchInput, SearchOutput> {
  const id = typeof pathOrOptions === 'string' ? (maybeOptions?.id ?? pathOrOptions) : pathOrOptions.id
  if (routes.has(id)) {
    throw new Error(`Маршрут «${id}» уже зарегистрирован в реестре адресов`)
  }
  const descriptor =
    typeof pathOrOptions === 'string'
      ? defineRoute(pathOrOptions, maybeOptions)
      : defineRoute(pathOrOptions)
  routes.set(id, descriptor as never)
  return descriptor
}
