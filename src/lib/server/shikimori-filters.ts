/**
 * Применение фильтров каталога: канонические значения → параметры API Shikimori.
 *
 * Здесь живёт ЗНАНИЕ ОБ API, которого нет в схеме: какой параметр отвечает за
 * поле и в каком виде принимает значение (измерено живьём, `probes-shiki/`):
 *   • `genre_v2` — мир жанров v2 (те же id, что отдаёт GraphQL `genres`);
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
 * `validateCatalogFilterValues`; связки (`drop`) отсекает `$lib/filters/rules`.
 * Неприменённое НЕ исчезает молча: возвращается списком `dropped` с причиной —
 * её показывают интерфейс и журнал.
 */
import {
  catalogFilterFieldNames,
  catalogFilterFormData,
  catalogFilterSearchRule,
  catalogFilterSuppressedFields,
  catalogFilterValueMap,
  parseCatalogFilterPath,
  validateCatalogFilterValues,
  type CatalogFilterSchema,
  type CatalogFilterValues,
} from '$lib/filters'
import type { AnimesPage } from '../../content/shikimori'
import { fetchAnimes, type AnimesQuery, type TransportDeps } from './shikimori'
import { getShikimoriFilterSchema } from './shikimori-schema'

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
        if (list.length) params.genre_v2 = [...list]
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
): AnimesFilterQuery {
  const map = catalogFilterValueMap(raw)
  const suppressed = catalogFilterSuppressedFields(schema, map)
  const searchRule = catalogFilterSearchRule(schema, map)
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
  const { values, errors } = validateCatalogFilterValues(schema, formData)
  const mapped = animesFilterParams(schema, values)

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
  // Перевёрнутый диапазон объясняется отдельно: значения внутри границ поля, но
  // вместе не значат ничего — причину называет связка смысла, а не «мусор».
  const explained = new Set<string>()
  for (const field of schema.fields) {
    if (field.type !== 'number') continue
    const min = Number(usable[`filters.${field.key}.min`])
    const max = Number(usable[`filters.${field.key}.max`])
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= max) continue
    dropped.push({ key: `filters.${field.key}`, reason: 'нижняя граница больше верхней' })
    explained.add(`filters.${field.key}.min`)
    explained.add(`filters.${field.key}.max`)
  }
  // Связка, снявшая поле с ВЫБРАННЫМ значением, — отказ набора; объясняем
  // её причиной, а не «вне опций» (значение-то корректно, несовместим набор).
  const rejected = errors.includes('link.blocked')
  const linkExplain = new Set<string>()
  for (const key of suppressed) {
    const field = schema.fields.find((item) => item.key === key)
    if (!field) continue
    // Пустое запрещённое поле ничего не нарушает (§7.5): сообщаем только о
    // связке, которая задела значение.
    if (!catalogFilterFieldNames(field).some((path) => (map[path]?.length ?? 0) > 0)) continue
    linkExplain.add(key)
    const rule = (schema.rules ?? []).find((item) => item.drop !== 'q' && item.drop.field === key)
    dropped.push({
      key: `filters.${key}`,
      reason: rule?.reason ?? 'несовместимо с другими фильтрами',
    })
  }
  for (const key of Object.keys(usable)) {
    const owner = parseCatalogFilterPath(key)?.key
    if (applied.has(key) || explained.has(key) || (owner !== undefined && linkExplain.has(owner))) continue
    dropped.push({
      key,
      reason: rejected
        ? 'набор отклонён связкой: значения несовместимы'
        : 'значение вне опций или границ схемы',
    })
  }
  for (const error of errors) {
    if (error === 'link.blocked') continue // его причина уже названа по ключам
    dropped.push({ key: 'filters', reason: `значение не прошло проверку (${error})` })
  }

  return {
    params: mapped.params,
    dropped: [...dropped, ...mapped.dropped],
    search: searchRule === undefined,
    ...(searchRule ? { searchReason: searchRule.reason } : {}),
  }
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
  parsed: { query: AnimesQuery; filters: Readonly<Record<string, unknown>> },
  deps: TransportDeps & { signal?: AbortSignal } = {},
): Promise<AnimesPage> {
  const requested = Object.keys(parsed.filters).length > 0
  const { signal, ...transport } = deps
  const applied: AnimesFilterQuery = requested
    ? animesFilterQuery(await getShikimoriFilterSchema(transport), parsed.filters)
    : { params: {}, dropped: [], search: true }

  const query: AnimesQuery = { ...parsed.query, ...applied.params }
  if (!applied.search) delete query.search
  for (const item of applied.dropped) {
    if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
      console.warn(`[shikimori] фильтр «${item.key}» не применён: ${item.reason}`)
    }
  }

  const page = await fetchAnimes(query, { ...transport, ...(signal ? { signal } : {}) })
  return applied.dropped.length ? { ...page, dropped: applied.dropped } : page
}

/** Значения фильтров из extra пагинатора — как их видит транспорт. */
export function filtersOfExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (key.startsWith('filters.')) out[key] = value
  }
  return out
}
