/**
 * Применение фильтров каталога: канонические значения → параметры API Shikimori.
 *
 * Здесь живёт ЗНАНИЕ ОБ API, которого нет в схеме: какой параметр отвечает за
 * поле и в каком виде принимает значение (измерено живьём, `probes-shiki/`):
 *   • жанры — по версии API: `mix` — `genre_v2` (мир жанров v2, те же id, что
 *     отдаёт GraphQL `genres`), `rest` — `genre` (мир v1, REST `/genres`),
 *     `graphql` — аргумент `genre` GraphQL (id v2);
 *   • `studio` — id студий REST-справочника (`/studios`);
 *     у обоих: СПИСОК через запятую значит «и», префикс `!` у значения —
 *     «кроме», а повтор параметра API читает как «последний побеждает»
 *     (поэтому списки собираются одним значением — см. `buildUpstreamUrl`);
 *   • `kind`/`status`/`rating`/`duration` — по значению;
 *   • `score` — минимальная оценка (нижняя граница, верхней у API нет);
 *   • `season` — диапазон лет ОБЕИМИ границами (`2014_2016`); односторонний
 *     `2014_` API отбивает 422, поэтому недостающую границу подставляет край
 *     базы (поле схемы несёт его в `min`/`max`).
 *
 * Deny-safe на каждом шаге: значение, которого нет в опциях схемы, отсекает
 * `catalogFilterFormData`; значение, не прошедшее правила формы, отсекает
 * `validateCatalogFilterValues` тем же описанием, что рисует форму
 * (`shikimoriFilterForm`): связки, перевёрнутый диапазон, «все из» ∩ «кроме».
 * Неприменённое НЕ исчезает молча: возвращается списком `dropped` с причиной —
 * её показывают интерфейс и журнал.
 */
import {
  catalogFilterFieldNames,
  catalogFilterFormData,
  catalogFilterValueMap,
  catalogRuleState,
  parseCatalogFilterPath,
  validateCatalogFilterValues,
  type CatalogFilterSchema,
  type CatalogFilterValues,
} from '#lib/paginate/filters/index.js'
import { DEV } from 'esm-env'
import { SHIKIMORI_DEFAULT_API, type AnimesPage, type ShikimoriApi } from '../../content/shikimori'
import { shikimoriFilterForm } from '../../content/shikimori-filters'
import { fetchCatalogPage, type AnimesQuery, type TransportDeps } from './shikimori'
import { getShikimoriFilterSchema } from './shikimori-schema'
import { FILTER_KEY_PREFIX } from '#lib/paginate/index.js'

/** Что из запрошенного не применяется и почему (для UI, лога и отладки). */
export type DroppedFilter = { key: string; reason: string }

export type AnimesFilterQuery = {
  /** Параметры API, готовые к слиянию с `AnimesQuery`. */
  params: Partial<AnimesQuery>
  /** Ключи, отброшенные deny-safe. */
  dropped: DroppedFilter[]
  /** Применяется ли поиск (`q`): связка может его запретить. */
  search: boolean
  /** Причина запрета поиска — её показывает интерфейс. */
  searchReason?: string
}

/**
 * Значения `filters.*` (из extra пагинатора) → параметры API.
 * `values` — уже проверенные (см. `validateCatalogFilterValues`), поэтому
 * мэппинг читает их как типизированные данные, а не как строки из адреса.
 */
export function animesFilterParams(
  schema: CatalogFilterSchema,
  values: CatalogFilterValues,
  api: ShikimoriApi = SHIKIMORI_DEFAULT_API,
): { params: Partial<AnimesQuery>; dropped: DroppedFilter[] } {
  const params: Partial<AnimesQuery> = {}
  const dropped: DroppedFilter[] = []
  const byKey = new Map(schema.fields.map((field) => [field.key, field]))

  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key)
    if (!field) {
      dropped.push({ key: `filters.${key}`, reason: 'поля нет в схеме источника' })
      continue
    }
    if (field.type === 'multiselect') {
      const group = value as Partial<Record<string, readonly string[]>>
      if (group.or?.length) dropped.push({ key: `filters.${key}.or`, reason: 'режим «или» API не поддерживает' })
      if (key === 'genres') {
        // «и» и «кроме» — одним списком: элементы складываются по «и», `!` —
        // исключение (проверено живьём, см. `buildUpstreamUrl`).
        const list = [...(group.and ?? []), ...(group.not ?? []).map((item) => `!${item}`)]
        // Параметр — по версии: id жанров у `rest` из мира v1, у остальных v2.
        if (list.length) {
          if (api === 'mix') params.genre_v2 = [...list]
          else params.genre = [...list]
        }
      } else if (key === 'studios') {
        // Отрицания — тот же список с префиксом `!` (проверено живьём: см.
        // объявление поля в `content/shikimori-filters`).
        const list = [...(group.and ?? []), ...(group.not ?? []).map((item) => `!${item}`)]
        if (list.length) params.studio = [...list]
      } else {
        // Поле-мультивыбор без правила мэппинга: молча «как-нибудь» не бывает.
        dropped.push({ key: `filters.${key}`, reason: 'для поля не объявлен параметр API' })
      }
      continue
    }
    if (field.type === 'number') {
      const range = value as { min?: number; max?: number }
      if (key === 'score') {
        if (range.min !== undefined) params.score = range.min
        if (range.max !== undefined)
          dropped.push({ key: 'filters.score.max', reason: 'у оценки в API только нижняя граница' })
        continue
      }
      if (key === 'year') {
        const min = range.min ?? field.min
        const max = range.max ?? field.max
        if (min === undefined || max === undefined) {
          dropped.push({ key: 'filters.year', reason: 'для диапазона лет нужны обе границы' })
          continue
        }
        if (min > max) {
          dropped.push({ key: 'filters.year', reason: 'нижняя граница больше верхней' })
          continue
        }
        params.season = `${min}_${max}`
        continue
      }
      dropped.push({ key: `filters.${key}`, reason: 'для поля не объявлен параметр API' })
      continue
    }
    // select/text: значение едет как есть.
    const single = String(value)
    if (!single) continue
    if (field.key === 'kind' || field.key === 'status' || field.key === 'rating' || field.key === 'duration') {
      params[field.key] = single
      continue
    }
    dropped.push({ key: `filters.${key}`, reason: 'для поля не объявлен параметр API' })
  }

  return { params, dropped }
}

/**
 * Полный разбор фильтров запроса: сырые `filters.*` (из адреса или extra) плюс
 * схема → параметры API, решение про поиск и список отброшенного.
 *
 * Порядок намеренно канонный: связки → deny-safe отбор известных ключей →
 * типы значений (`decode`) и правила формы (`validateForm`) → мэппинг.
 */
export function animesFilterQuery(
  schema: CatalogFilterSchema,
  raw: Record<string, unknown>,
  api: ShikimoriApi = SHIKIMORI_DEFAULT_API,
): AnimesFilterQuery {
  const map = catalogFilterValueMap(raw)
  // Один расчёт связок: поля, которые они гасят, и запрет поиска.
  const rules = catalogRuleState(schema, map)
  const searchRule = rules.search
  const declared = new Set(schema.fields.flatMap(catalogFilterFieldNames))
  const dropped: DroppedFilter[] = []

  const usable: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!declared.has(key) || !parseCatalogFilterPath(key)) {
      dropped.push({ key, reason: 'поля нет в схеме источника' })
      continue
    }
    // Поля, снятые связкой, сюда ДОЕЗЖАЮТ: без JS набор отклоняет валидатор
    // связей (модель §7: частичного применения не существует — источник не
    // получает ничего). Предрезка «по-тихому» оставила бы status работать.
    usable[key] = value
  }

  // Запрет поиска связкой виден и здесь: у поиска свой машинный канал
  // (`search`/`searchReason`), но и в `dropped` он попадает — потребитель,
  // который умеет показывать «что не применилось», не должен знать про два
  // разных способа об этом узнать.
  if (searchRule) dropped.push({ key: 'q', reason: searchRule.reason })

  const formData = catalogFilterFormData(schema, usable)
  const { values, errors, failed } = validateCatalogFilterValues(schema, formData, shikimoriFilterForm)
  const mapped = animesFilterParams(schema, values, api)

  // Что дошло до значений, а что нет: неприменённое не исчезает молча — иначе
  // «фильтр стоит в адресе, а выдача не сузилась» выглядело бы как баг API.
  const applied = new Set<string>()
  for (const [key, value] of Object.entries(values)) {
    const field = schema.fields.find((item) => item.key === key)
    if (!field) continue
    if (field.type === 'multiselect' || field.type === 'number') {
      for (const part of Object.keys(value)) applied.add(`filters.${key}.${part}`)
    } else {
      applied.add(`filters.${key}`)
    }
  }
  // Ошибка поля называет свою причину у своего ключа: значения могут быть
  // корректны поодиночке, но вместе не значат ничего.
  const explained = new Set<string>()
  for (const error of failed) {
    if (error.code === 'link.blocked') continue // причина — у связки, ниже
    const key = error.path ?? 'filters'
    explained.add(key)
    dropped.push({ key, reason: FAILED_REASON[error.code] ?? `значение не прошло проверку (${error.code})` })
  }
  // Связка, снявшая поле с ВЫБРАННЫМ значением, — отказ набора; объясняем
  // её причиной, а не «вне опций» (значение-то корректно, несовместим набор).
  const linkExplain = new Set<string>()
  for (const [key, rule] of rules.fields) {
    const field = schema.fields.find((item) => item.key === key)
    if (!field) continue
    // Пустое запрещённое поле ничего не нарушает (§7.5): сообщаем только о
    // связке, которая задела значение.
    if (!catalogFilterFieldNames(field).some((path) => (map[path]?.length ?? 0) > 0)) continue
    linkExplain.add(key)
    dropped.push({ key: `filters.${key}`, reason: rule.reason })
  }
  for (const key of Object.keys(usable)) {
    const owner = parseCatalogFilterPath(key)?.key
    if (applied.has(key) || explained.has(key) || (owner !== undefined && linkExplain.has(owner))) continue
    dropped.push({
      key,
      reason: !errors.length
        ? 'значение вне опций или границ схемы'
        : errors.every((code) => code === 'link.blocked')
          ? 'набор отклонён связкой: значения несовместимы'
          : 'набор отклонён: в нём есть ошибка',
    })
  }

  return {
    params: mapped.params,
    dropped: [...dropped, ...mapped.dropped],
    search: searchRule === undefined,
    ...(searchRule ? { searchReason: searchRule.reason } : {}),
  }
}

/** Причины отказа по кодам ошибок формы — для `dropped` и журнала. */
const FAILED_REASON: Readonly<Record<string, string>> = {
  notAbove: 'нижняя граница больше верхней',
  noOverlap: 'значение выбрано и в «все из», и в «кроме»',
  oneOf: 'значение вне опций или границ схемы',
  minValue: 'значение вне опций или границ схемы',
  maxValue: 'значение вне опций или границ схемы',
  maxCount: 'выбрано больше значений, чем позволяет схема',
}

/**
 * Страница каталога с фильтрами — ОДИН путь для HTTP-роута и для SSR-моста.
 *
 * Роут и лоадер обязаны применять фильтры одинаково: две копии этого конвейера
 * разошлись бы (SSR-снапшот строился бы по другим правилам, чем клиентская
 * догрузка, — и «перезагрузка меняет выдачу» вернулось бы). Поэтому разбор,
 * чтение живой схемы, применение связок и вызов транспорта живут здесь, а
 * потребители лишь разбирают адрес (роут) и отдают JSON/снапшот.
 *
 * Схема читается только когда фильтры есть: обычная страница каталога её не
 * ждёт. `signal` относится к запросу страницы, а не к сборке схемы: ушедший
 * клиент не должен оставлять после себя «схема недоступна» на весь TTL.
 */
export async function fetchAnimesPage(
  parsed: { api?: ShikimoriApi; query: AnimesQuery; filters: Readonly<Record<string, unknown>> },
  deps: TransportDeps & { signal?: AbortSignal } = {},
): Promise<AnimesPage> {
  const api = parsed.api ?? SHIKIMORI_DEFAULT_API
  const requested = Object.keys(parsed.filters).length > 0
  const { signal, ...transport } = deps
  const applied: AnimesFilterQuery = requested
    ? animesFilterQuery(await getShikimoriFilterSchema({ ...transport, api }), parsed.filters, api)
    : { params: {}, dropped: [], search: true }

  const query: AnimesQuery = { ...parsed.query, ...applied.params }
  if (!applied.search) delete query.search
  for (const item of applied.dropped) {
    if (DEV) {
      console.warn(`[shikimori] фильтр «${item.key}» не применён: ${item.reason}`)
    }
  }

  const page = await fetchCatalogPage(api, query, { ...transport, ...(signal ? { signal } : {}) })
  return applied.dropped.length ? { ...page, dropped: applied.dropped } : page
}

/** Значения фильтров из extra пагинатора — как их видит транспорт. */
export function filtersOfExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (key.startsWith(FILTER_KEY_PREFIX)) out[key] = value
  }
  return out
}
