// URL-адаптер: GET (?page) — хранилище указателя страницы (R5, R11).
// Порт adapter-tanstack.ts React-версии на роутер FastEdge (TanStack-семантика validateSearch).
// D6: НЕ импортирует server-only модули — url запроса передаёт loader через ctx.
// Enforcement пути 3: ОДИН парсер ?page для validateSearch роута и чтения в адаптере (deny-safe).
// Без zod: тот же контракт, что и z.coerce.number().int().min(1).catch(1).
//
// Формат — как у модалок (`?modal=card&modal.1.id=7`): базовый ключ + точечные подключи:
//   ?page=3            — указатель страницы (нативно)
//   ?page.size=5       — размер страницы (нативно)
//   ?page.<key>=<v>    — ключи потребителя (RestorableState.extra), объявленные в extraSearch
// Один пагинатор = один базовый ключ (pageParam), несколько пагинаторов — разные ключи.
import { assertAdaptedSource, type AdaptedSource } from './source'
import type {
  Extra,
  ExtraValue,
  HrefContext,
  PaginatorAdapter,
  PaginatorState,
} from './types'

/** Строгий целочисленный парсер: любой мусор («2.7», «abc», «../../etc») → 1 (deny-safe). */
export function parsePageValue(raw: unknown): number {
  if (raw == null || raw === '') return 1
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

/** Разбор скаляра из URL: true/false/null/число/строка (как decodeScalar у модалок). */
export function decodeExtraValue(raw: string): ExtraValue {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (raw !== '' && /^-?\d*\.?\d+$/.test(raw) && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

export function encodeExtraValue(v: ExtraValue): string {
  return v === null ? 'null' : String(v)
}

/**
 * Объявленный тип extra-ключа. Адресный слой декодирует скаляр жадно
 * («9» → 9, «true» → true): смысл значения знает только ПОТРЕБИТЕЛЬ, поэтому
 * нормализация к объявленному типу живёт здесь, в одном хелпере, а не
 * россыпью `typeof raw === 'string' ? … : ''` в каждом валидаторе (именно на
 * этом ключ молча исчезал — см. диагноз b1 § 3.1 плана).
 */
export type ExtraFieldType = 'text' | 'number' | 'boolean' | 'list'

/**
 * Нормализация ExtraValue к объявленному типу (undefined = мусор/отсутствие).
 * `text`: число 9 → обратно строка '9'; `number`: конечное число;
 * `boolean`: только настоящий boolean; `list`: строка «a, b,,c» → каноничная
 * «a,b,c» (ExtraValue массивов не содержит — список ездит одной строкой).
 */
export function coerceExtraValue(raw: ExtraValue, type: ExtraFieldType): ExtraValue | undefined {
  switch (type) {
    case 'text':
      return raw == null ? undefined : String(raw)
    case 'number': {
      if (raw == null || raw === '' || typeof raw === 'boolean') return undefined
      const n = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(n) ? n : undefined
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined
    case 'list': {
      if (raw == null) return undefined
      const items = String(raw)
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      return items.length ? items.join(',') : undefined
    }
  }
}

/**
 * Валидатор ключа с объявленным типом: сначала `coerceExtraValue`, затем
 * опциональный предикат-домен. Эмитит `undefined` = ключ отброшен (в dev
 * адресный слой предупреждает с именем ключа и причиной — молчание запрещено).
 */
export function extraField(
  type: ExtraFieldType,
  validate?: (value: ExtraValue) => boolean,
): ExtraSearchValidator {
  return (raw) => {
    const value = coerceExtraValue(raw, type)
    if (value === undefined) return undefined
    return validate && !validate(value) ? undefined : value
  }
}

/** Отметка для повторяющихся GET-значений нативного `<select multiple>`. */
export type ExtraSearchValidator = ((raw: ExtraValue) => ExtraValue | undefined) & {
  readonly repeatedValues?: 'comma'
}

/**
 * Свернуть повторяющиеся параметры нативной формы в CSV-скаляр. В хранилище
 * список остаётся `ExtraValue`-скаляром; объединение выполняет URL-адаптер.
 */
export function commaListSearch(
  validate: (raw: ExtraValue) => ExtraValue | undefined,
): ExtraSearchValidator {
  return Object.assign(validate, { repeatedValues: 'comma' as const })
}

/**
 * Спецификация ключей потребителя в URL: имя → валидатор (raw → значение | undefined).
 * undefined = ключ отсутствует/мусор → в extra не попадает (дефолт роута остаётся).
 * Рекомендуемый строитель — `extraField` с объявленным типом (§ 3.1 плана).
 */
export type ExtraSearchSpec = Record<string, ExtraSearchValidator>

/**
 * Dev-режим адресного слоя: нет process (браузер) — считаем dev; предупреждения
 * глушит только явный production. Изоморфно с остальными гвардами библиотеки.
 */
export function isDevAddressLayer(): boolean {
  return (
    typeof process === 'undefined' ||
    !process.env ||
    process.env.NODE_ENV !== 'production'
  )
}

/** Единая точка dev-предупреждений адресного слоя (§ 3.1: молчаливый отброс запрещён). */
export function warnExtraDropped(base: string, key: string, raw: string, reason: string): void {
  if (!isDevAddressLayer()) return
  console.warn(
    `[paginate] extra-ключ "${base}.${key}" отброшен: ${reason}; сырое значение: ${JSON.stringify(raw)}`,
  )
}

export type PaginatorSearchOptions = {
  /** Базовый ключ (default 'page'). */
  pageParam?: string
  /** Допустимые размеры страницы; иное значение → undefined (адаптер возьмёт свой default). */
  pageSizes?: readonly number[]
  extra?: ExtraSearchSpec
}

/** Восстанавливаемая из URL часть: page, pageSize (если задан), extra (только валидные). */
export type UrlRestorable = {
  page: number | undefined
  pageSize: number | undefined
  extra: Extra
}

/** Разбор всех ключей пагинатора из URLSearchParams (единый парсер роута и адаптера). */
export function readPaginatorSearch(
  params: URLSearchParams,
  opts: PaginatorSearchOptions = {},
): UrlRestorable {
  const base = opts.pageParam ?? 'page'
  const rawPage = params.get(base)
  const page = rawPage == null || rawPage === '' ? undefined : parsePageValue(rawPage)
  let pageSize: number | undefined
  const rawSize = params.get(`${base}.size`)
  if (rawSize != null && rawSize !== '') {
    const n = Number(rawSize)
    if (Number.isInteger(n) && n >= 1 && (!opts.pageSizes || opts.pageSizes.includes(n)))
      pageSize = n
  }
  const extra: Extra = {}
  const spec = opts.extra ?? {}
  for (const [key, validate] of Object.entries(spec)) {
    // Обычные поля используют последнее значение (hidden=false + checkbox=true);
    // явно объявленные списки собирают повторяющиеся значения native GET.
    const all = params.getAll(`${base}.${key}`)
    const validator = validate
    const raw = all.length
      ? validator.repeatedValues === 'comma'
        ? all.join(',')
        : all[all.length - 1]
      : null
    if (raw == null) continue
    const v = validator(decodeExtraValue(raw))
    if (v !== undefined) extra[key] = v
    else warnExtraDropped(base, key, raw, 'значение не прошло валидатор')
  }
  // Молчаливый отброс запрещён (§ 3.1): неизвестный ключ нашего префикса в dev виден.
  if (isDevAddressLayer()) {
    for (const key of new Set(params.keys())) {
      if (!key.startsWith(`${base}.`)) continue
      const suffix = key.slice(base.length + 1)
      if (suffix === 'size' || suffix in spec) continue
      warnExtraDropped(base, suffix, params.get(key) ?? '', 'неизвестный ключ (нет в extraSearch)')
    }
  }
  return { page, pageSize, extra }
}

/**
 * validateSearch роута — ЕДИНСТВЕННАЯ дефиниция ?page / ?page.size / ?page.<key> (роут + адаптер).
 * Возвращает плоские ключи search в том же виде, что и в адресе (`page`, `page.size`, …):
 * так `app.search` роутера остаётся симметричен URL, а stringifySearch собирает его обратно.
 * Раунд-8: отсутствующий ключ остаётся отсутствующим (URL принадлежит url-адаптеру, персистом).
 */
/**
 * Канонический адрес пагинатора: пустые значения ОБЪЯВЛЕННЫХ ключей убираются.
 *
 * Зачем: нативная форма отправляет ВСЕ свои контролы, включая незаполненные, —
 * после «Применить» без JavaScript адрес превращался в список полей
 * (`?page.filters.kind=tv&page.filters.status=&page.filters.rating=&…`). Для
 * слоя пустое значение тождественно отсутствию ключа (§ 3.5: чистый канонический
 * адрес), поэтому такие ключи — шум, а не выбор пользователя. Править при этом
 * САМИ поля нельзя: без JavaScript «подкручивать» форму нечем (выключенный или
 * безымянный контрол браузер не отправит, и ввод пропал бы молча), — значит
 * адрес приводит в порядок тот, кто его принимает.
 *
 * Что НЕ трогается: ключи со значениями (в том числе визуально пустые, но
 * значащие — `false`, `0`), чужие ключи второго пагинатора и вовсе не наши
 * (`utm_source`): отбрасывать чужое — не наше дело. `null` — адрес уже
 * канонический, лишней переадресации не будет.
 */
export function canonicalPaginatorSearch(
  parts: PaginatorSearchOptions | readonly PaginatorSearchOptions[],
  params: URLSearchParams | string,
): URLSearchParams | null {
  const specs = Array.isArray(parts)
    ? (parts as readonly PaginatorSearchOptions[])
    : [parts as PaginatorSearchOptions]
  const source = typeof params === 'string' ? new URLSearchParams(params) : params
  const out = new URLSearchParams(source)
  let changed = false
  const dropEmpty = (key: string): void => {
    const values = out.getAll(key)
    if (!values.length || values.some((value) => value !== '')) return
    out.delete(key)
    changed = true
  }
  for (const spec of specs) {
    const base = spec.pageParam ?? 'page'
    dropEmpty(base)
    dropEmpty(`${base}.size`)
    for (const key of Object.keys(spec.extra ?? {})) dropEmpty(`${base}.${key}`)
  }
  return changed ? out : null
}

/**
 * Тот же канонический вид, но для среза search роутера (запись `{ключ: значение}`,
 * как её отдаёт `currentSearch`). Нужен на записи адреса и на привязке роутера:
 * сама `canonicalPaginatorSearch` работает с `URLSearchParams`, а роутер принимает
 * объект. `null` — править нечего.
 */
export function canonicalSearchRecord(
  parts: PaginatorSearchOptions | readonly PaginatorSearchOptions[],
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!record) return null
  const canonical = canonicalPaginatorSearch(parts, searchToParams(record))
  if (!canonical) return null
  const out: Record<string, unknown> = {}
  for (const key of new Set(canonical.keys())) {
    const values = canonical.getAll(key)
    out[key] = values.length > 1 ? values : values[0]
  }
  return out
}

export function paginatorSearch(
  opts: PaginatorSearchOptions | readonly PaginatorSearchOptions[] = {},
): (params: URLSearchParams) => Record<string, unknown> {
  // Несколько пагинаторов на странице — массив спецификаций: каждая разбирает СВОЙ префикс,
  // чужие ключи проходят как есть только если не принадлежат ни одной из спецификаций
  // (иначе строка из URL затёрла бы уже распарсенное число соседа).
  const specs = Array.isArray(opts)
    ? (opts as readonly PaginatorSearchOptions[])
    : [opts as PaginatorSearchOptions]
  const bases = specs.map((o) => o.pageParam ?? 'page')
  const owned = (key: string) => bases.some((b) => key === b || key.startsWith(`${b}.`))
  return (params: URLSearchParams) => {
    const out: Record<string, unknown> = {}
    specs.forEach((o, i) => {
      const base = bases[i]
      const r = readPaginatorSearch(params, o)
      if (r.page !== undefined) out[base] = r.page
      if (r.pageSize !== undefined) out[`${base}.size`] = r.pageSize
      for (const [k, v] of Object.entries(r.extra)) out[`${base}.${k}`] = v
    })
    // Прочие (чужие) ключи — как есть, чтобы не терять их при navigate/hrefFor.
    for (const key of new Set(params.keys())) {
      if (owned(key)) continue
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      const all = params.getAll(key)
      out[key] = all.length > 1 ? all : all[0]
    }
    return out
  }
}

/** Совместимость: только ?page (без size/extra). */
export function pageSearch(
  pageParam = 'page',
): (params: URLSearchParams) => Record<string, unknown> {
  return paginatorSearch({ pageParam })
}

/** URL → номер страницы; любой мусор/отсутствие → 1 (deny-safe). */
export function parsePageFromUrl(url: string, pageParam = 'page'): number {
  try {
    const raw = new URL(url, 'http://localhost').searchParams.get(pageParam)
    return parsePageValue(raw ?? undefined)
  } catch {
    return 1
  }
}

/** Минимальный срез роутера, нужный адаптеру (привязку делает PaginatorHost, D2). */
export type MinimalRouter = {
  navigate(opts: {
    search: (prev: Record<string, unknown>) => Record<string, unknown>
    replace?: boolean
  }): void | Promise<unknown>
  /**
   * Привести адрес к виду без перехода (замена текущей записи истории) — там, где
   * адрес надо поправить, а не «пойти»: навигация перезапустила бы загрузку данных.
   * Необязателен: роутер без такой возможности просто оставляет адрес как есть,
   * а на сервере адрес править нечем и не нужно (пустое значение = отсутствие ключа).
   */
  syncAddress?(opts: { search: (prev: Record<string, unknown>) => Record<string, unknown> }): void
  currentSearch?: () => Record<string, unknown>
}

function searchToParams(search: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value == null) continue
    if (Array.isArray(value)) for (const v of value) params.append(key, String(v))
    else params.set(key, String(value))
  }
  return params
}

export function createUrlAdapter<T>(opts: {
  name: string
  source: AdaptedSource<T>
  pageSize?: number
  append?: boolean
  pageParam?: string
  pageSizes?: readonly number[]
  extraSearch?: ExtraSearchSpec
  /** Дефолты extra: ключи со значением === default НЕ пишутся в URL (чистый адрес). */
  extraDefaults?: Extra
  /** Получить url запроса на SSR (альтернатива ctx.url в getInitial). */
  getUrl?: () => string | undefined
}): PaginatorAdapter<T> & {
  setRouter(router: MinimalRouter | null): void
  /** Спецификация ключей адреса — хост читает её вместо дублирующих пропсов. */
  searchSpec: { pageParam: string; extra?: ExtraSearchSpec; pageSizes?: readonly number[] }
} {
  const source = assertAdaptedSource<T>(opts.source, `createUrlAdapter("${opts.name}")`)
  const pageSize = opts.pageSize ?? 20
  const pageParam = opts.pageParam ?? 'page'
  const append = opts.append ?? true
  const searchOpts: PaginatorSearchOptions = {
    pageParam,
    pageSizes: opts.pageSizes,
    extra: opts.extraSearch,
  }
  const extraKeys = Object.keys(opts.extraSearch ?? {})
  let router: MinimalRouter | null = null
  // Раунд-6: поиск последнего getInitial(ctx.url) — href-ы на SSR, где роутера нет.
  let lastInitSearch: Record<string, unknown> | null = null
  // Полётный navigate (URL ещё НЕ применился). Echo-guard обязан видеть его иначе класс:
  // reportAnchor(A)→navigate(A); reportAnchor(B≈URL)→echo-skip; navigate(A) садится ПОЗЖЕ
  // → URL отстаёт от пагинатора → внешняя страница (не-эхо) → лишний REPLACE/прыжок скролла
  // (всплывает при смене раскладки: IO-шторм reportAnchor как раз такой реверанс делает).
  // Сравнивается сериализованный «отпечаток» {page,size,extra}.
  let inflight: string | null = null

  function currentSearch(): Record<string, unknown> | null {
    return (
      router?.currentSearch?.() ??
      lastInitSearch ??
      (typeof window !== 'undefined'
        ? Object.fromEntries(new URLSearchParams(window.location.search))
        : null)
    )
  }

  /**
   * Ключи пагинатора для записи в search роутера: size/extra — только отличные
   * от дефолта. Значения — типизированные (как их отдаёт validateSearch), а не строки.
   * Указатель первой страницы — тоже дефолт: `?page=1`/`?search=1` в адрес не
   * пишутся (§ 3.5 плана: чистый канонический адрес; отсутствие ключа == 1).
   */
  function ownKeys(
    state: Pick<PaginatorState<T>, 'page' | 'pageSize' | 'extra'>,
  ): Record<string, ExtraValue> {
    const out: Record<string, ExtraValue> = {}
    if (state.page !== 1) out[pageParam] = state.page
    if (state.pageSize !== pageSize) out[`${pageParam}.size`] = state.pageSize
    for (const key of extraKeys) {
      const v = state.extra[key]
      if (v === undefined) continue
      if (opts.extraDefaults && key in opts.extraDefaults && opts.extraDefaults[key] === v) continue
      out[`${pageParam}.${key}`] = v
    }
    return out
  }

  /** Отпечаток собственных ключей в произвольном search (для echo-guard). */
/**
   * Строка запроса, по которой судится «адрес уже такой». Берётся ЖИВОЙ адрес, а не
   * срез фреймворка: `$app/state.page.url` после `replaceState` обновляется
   * асинхронно, и на устаревшем срезе echo-guard либо пишет адрес лишний раз, либо —
   * когда устаревший срез совпадает с новым состоянием — не пишет вовсе. Второе и
   * выглядит как «источник и параметры не переключаются»: стор поменялся, адрес
   * остался прежним. На сервере `location` нет, и править там нечего — остаётся
   * прежний источник (срез роутера).
   */
  function liveSearch(): Record<string, unknown> | null {
    const loc = globalThis.location
    if (!loc) return router?.currentSearch?.() ?? null
    return Object.fromEntries(new URLSearchParams(loc.search))
  }

  function fingerprintOf(search: Record<string, unknown> | null): string {
    if (!search) return ''
    const r = readPaginatorSearch(searchToParams(search), searchOpts)
    return JSON.stringify(
      ownKeys({ page: r.page ?? 1, pageSize: r.pageSize ?? pageSize, extra: r.extra }),
    )
  }

  function mergeSearch(
    prev: Record<string, unknown>,
    own: Record<string, ExtraValue>,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(prev)) {
      if (k === pageParam || k.startsWith(`${pageParam}.`)) continue
      next[k] = v
    }
    return { ...next, ...own }
  }

  return {
    pageParam,
    /**
     * Спецификация ключей адреса — чтобы хосту не передавали её вторым экземпляром.
     * Транспорт объявляет себя сам: хост читает отсюда `pageParam`/`extra`/`pageSizes`
     * для разбора back/forward и не может разойтись с адаптером.
     */
    searchSpec: { pageParam, extra: opts.extraSearch, pageSizes: opts.pageSizes },
    /**
     * Разбор внешнего состояния живёт ЗДЕСЬ: адрес — хранилище этого адаптера.
     * Все объявленные ключи присутствуют в `extra` явно; ключ, исчезнувший из
     * адреса, отдаётся как `undefined` (= снять), иначе дифф хоста слеп к снятию
     * фильтра и список остаётся суженным.
     */
    observeExternal(search) {
      const params = searchToParams(search ?? {})
      const r = readPaginatorSearch(params, searchOpts)
      // Как раньше в хосте: restorable считаем, только если транспорт вообще
      // чем-то управляет извне (объявлены extra-ключи или размеры страницы).
      let restorable: { pageSize?: number; extra: Extra } | null = null
      if (extraKeys.length > 0 || opts.pageSizes != null) {
        const extra: Extra = { ...(opts.extraDefaults ?? {}) }
        const w = extra as Record<string, ExtraValue | undefined>
        for (const key of extraKeys) w[key] = key in r.extra ? r.extra[key] : w[key]
        for (const [k, v] of Object.entries(r.extra)) if (!(k in extra)) w[k] = v
        restorable = { pageSize: r.pageSize ?? pageSize, extra }
      }
      return { page: r.page ?? null, restorable }
    },

    getInitial(ctx) {
      const url =
        ctx?.url ?? opts.getUrl?.() ?? (typeof window !== 'undefined' ? window.location.search : '')
      const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : url
      const params = new URLSearchParams(query)
      lastInitSearch = Object.fromEntries(params)
      const r = readPaginatorSearch(params, searchOpts)
      return { page: r.page ?? 1, pageSize: r.pageSize ?? pageSize, extra: r.extra }
    },
    hrefFor(page, ctx?: HrefContext) {
      const search = ctx?.search ?? currentSearch()
      if (!search) return null
      const params = new URLSearchParams()
      let seen = false
      for (const [key, value] of Object.entries(search)) {
        if (key === pageParam) {
          // Канонический адрес: указатель первой страницы не пишется (§ 3.5).
          if (page !== 1) params.set(pageParam, String(page))
          seen = true
        } else if (value != null) {
          params.set(key, String(value))
        }
      }
      if (!seen && page !== 1) params.set(pageParam, String(page))
      /**
       * Дописка указателя, который источник вернул вместе со страницей (курсор
       * следующего шага): он живёт в extra СОСТОЯНИЯ, а на сервере адрес править
       * нечем — без этой дописки ссылка вела бы в один адрес, а клик с JavaScript
       * шёл бы в другой. Адрес сильнее: ключи, которые в срезе уже есть, не
       * перезаписываются, и берутся только объявленные (deny-safe как в persist).
       */
      const extra = ctx?.extra
      if (extra) {
        for (const key of extraKeys) {
          const v = extra[key]
          if (v === undefined || v === null || v === '') continue
          if (`${pageParam}.${key}` in search) continue
          if (opts.extraDefaults && key in opts.extraDefaults && opts.extraDefaults[key] === v) continue
          params.set(`${pageParam}.${key}`, String(v))
        }
      }
      return `?${params.toString()}`
    },
    loadPage: (req) =>
      source.fetchPage({ page: req.page, pageSize: req.pageSize, signal: req.signal }, req.extra),
    capabilitiesFor: (extra) => source.capabilitiesFor(extra),
    // Объявленные ключи: спецификация адреса + дефолты (поверхность потребителя)
    // плюс ключи источника (q и фильтры) — по ним `setExtra` проверяет запись.
    extraKeys: () => [
      ...extraKeys,
      ...Object.keys(opts.extraDefaults ?? {}),
      ...source.extraKeys(),
    ],
    persist(state: PaginatorState<T>) {
      if (!router) return // сервер / роутер не привязан — URL уже источник истины
      const own = ownKeys(state)
      const want = JSON.stringify(own)
      const current = fingerprintOf(liveSearch())
      // Эхо: URL уже показывает то же самое И полётный navigate (если был) нёс то же.
      if (current === want && (inflight == null || inflight === want)) return
      // Уже объявлено такое же значение и оно в полёте — дождаться применения.
      if (inflight === want && current !== want) return
      // Остальное — ПОСЛЕДНИЙ persist побеждает: перезаписываем и полётный navigate.
      // `mergeSearch` выбрасывает прежние ключи своего префикса, поэтому запись
      // и без чистки не переносит «грязный» хвост адреса дальше.
      // Основой слияния остаётся срез, который даёт РОУТЕР (он читается в момент
      // записи, а не захватывается здесь): так чужие ключи строки запроса — например
      // цепочка `?modal=` модалок — переносятся по договору роутера, а не по нашему
      // догадыванию о свежести адреса.
      const search = (prev: Record<string, unknown>) => mergeSearch(prev, own)
      /**
       * Адрес пагинатора — ЗАПИСЬ текущей строки истории, а не переход, и делать
       * его надо тем же: `syncAddress` (replaceState) меняет адрес, не перечитывая
       * данные. `goto` с новым `?page` — это навигация SvelteKit, то есть повторный
       * run `+page.server.ts`: второй запрос к источнику на каждое нажатие, результат
       * которого списку не нужен (снапшот читается один раз). Замены семантики тут
       * нет: `persist` и раньше писал с `replace: true`, новая запись истории не
       * создавалась. Роутер без `syncAddress` (не SvelteKit) идёт прежним путём.
       */
      if (router.syncAddress) {
        inflight = want
        router.syncAddress({ search })
        // Флаг держится до микротаски: пока фреймворк не применил новый адрес в
        // реактивном срезе, повторная запись того же `want` не нужна.
        void Promise.resolve().then(() => {
          if (inflight === want) inflight = null
        })
        return
      }
      inflight = want
      void Promise.resolve(router.navigate({ search, replace: true })).finally(() => {
        if (inflight === want) inflight = null
      })
    },
    capabilities: { append },
    setRouter(next) {
      router = next
      if (!next?.syncAddress) return
      /**
       * Адрес мог прийти «грязным»: нативная GET-форма отправляет ВСЕ свои
       * контролы, поэтому в адресе после «Применить» остаются пустые значения
       * незаполненных полей. Для слоя пустое значение тождественно отсутствию
       * ключа, значит адрес правится до канонического вида — ЗАМЕНОЙ записи
       * истории (`syncAddress`), без перехода и без редиректа: разметка та же,
       * данные те же, лишней навигации нет. Без JavaScript шага нет вовсе —
       * править нечем, и это не потеря: пустые ключи инертны (см. §4.6 чек-листа).
       */
      const cleaned = canonicalSearchRecord(searchOpts, next.currentSearch?.() ?? lastInitSearch)
      if (cleaned) next.syncAddress({ search: () => cleaned })
    },
  }
}

/**
 * S4 (§6.4, Q2 v2 «url на подхвате»): адрес — ОДИН из адаптеров хранилища того
 * же пагинатора, а не отдельный пагинатор-двойник. Фабрика-композиция: поверх
 * local-адаптера (source + storage) ставится url-канал (тот же `createUrlAdapter`,
 * ядро не знает о гибриде).
 *
 * Правила выбора канала — фиксация НА ЗАГРУЗКЕ (`getInitial`):
 *  • адрес несёт хоть один НАШ объявленный ключ (page / page.size / page.<key>
 *    из `extraSearch`; пустое значение = отсутствие) → адрес и есть хранилище
 *    сессии: чтение из него, `persist` пишет адрес, fallback-стор НЕ пишется;
 *  • адрес пуст → restores прошлый заход из storage, стор и есть хранилище
 *    сессии: `persist` пишет его, адрес не трогаем.
 * «Наши ключи» считаем ТОЛЬКО по объявленной спецификации (deny-safe): мусор
 * `?page.junk=1` сессию не перехватывает. Переключение канала посреди сессии
 * не предусмотрено — адрес меняется навигацией документа (загрузка), а на ней
 * `getInitial` пересматривает решение.
 */
export function withUrlTakeover<T>(
  base: PaginatorAdapter<T>,
  url: {
    /** Имя url-канала — для dev-сообщений адаптера; дефолт 'url-channel'. */
    name?: string
    /** Тот же адаптированный источник, что у base: данные читаются базовым адаптером. */
    source: AdaptedSource<T>
    pageSize?: number
    pageParam?: string
    pageSizes?: readonly number[]
    extraSearch?: ExtraSearchSpec
    extraDefaults?: Extra
    append?: boolean
  },
): PaginatorAdapter<T> & {
  setRouter(router: MinimalRouter | null): void
  searchSpec: { pageParam: string; extra?: ExtraSearchSpec; pageSizes?: readonly number[] }
} {
  const channel = createUrlAdapter<T>({
    name: url.name ?? 'url-channel',
    source: url.source,
    pageSize: url.pageSize,
    pageParam: url.pageParam,
    pageSizes: url.pageSizes,
    extraSearch: url.extraSearch,
    extraDefaults: url.extraDefaults,
    append: url.append,
  })
  const baseParam = url.pageParam ?? 'page'
  // Канал сессии: true — адрес несёт, false — несёт storage. Решает getInitial.
  let takes = false
  const urlCarries = (params: URLSearchParams): boolean => {
    const has = (k: string) => {
      const v = params.get(k)
      return v != null && v !== ''
    }
    if (has(baseParam) || has(`${baseParam}.size`)) return true
    for (const key of Object.keys(url.extraSearch ?? {})) if (has(`${baseParam}.${key}`)) return true
    return false
  }

  return {
    getInitial(ctx?: { url?: string }) {
      const raw = ctx?.url ?? (typeof window !== 'undefined' ? window.location.search : '')
      const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw
      takes = urlCarries(new URLSearchParams(query))
      return takes ? channel.getInitial(ctx) : base.getInitial(ctx)
    },
    // Данные читает базовый адаптер: источник один, двойного пути нет.
    loadPage: (req) => base.loadPage(req),
    persist(state) {
      return takes ? channel.persist(state) : base.persist(state)
    },
    // Внешний поиск наблюдаем только когда адрес — наше хранилище: локальная
    // сессия слепа к чужим правкам адреса (гибрид «страница из стора, фильтры
    // из адреса» запрещён контрактом observeExternal).
    observeExternal(search) {
      return takes ? channel.observeExternal!(search) : null
    },
    hrefFor(page, ctx) {
      return takes ? channel.hrefFor!(page, ctx) : (base.hrefFor?.(page, ctx) ?? null)
    },
    capabilities: base.capabilities,
    capabilitiesFor: (extra) => base.capabilitiesFor(extra),
    // Объявленная поверхность — максимум двух каналов: запись `setExtra`
    // судится по ней, а судить чужими ключами нельзя (deny-safe).
    extraKeys: () => {
      const union = new Set([...(base.extraKeys?.() ?? []), ...(channel.extraKeys?.() ?? [])])
      return union.size ? [...union] : undefined
    },
    // Форма без JS GET-ит в адрес при любом канале: ключ объявления остаётся.
    pageParam: baseParam,
    searchSpec: channel.searchSpec,
    setRouter(router) {
      channel.setRouter(router)
    },
  }
}
