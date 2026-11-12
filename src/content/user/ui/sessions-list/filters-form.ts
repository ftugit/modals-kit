// Описание фильтров списка устройств. Одно на sidebar, модалку и
// `/user/sessions/filters`. Имена полей — ключи extra, не адресные: адрес
// пишет адаптер. Права в описание не входят: их проверяет `execute`.
//
// Страны — данные, не каталог: пункты приходят из среза (`listSessionsPage`
// считает их без фильтра страны). Фабрика принимает их списком; на сервере
// список не нужен — `decode` множественного выбора значения не сверяет с
// пунктами, поэтому POST проверяется правилом ниже, а не составом options.
import { labelsFromFields, textFromDescriptor } from '#components/listing/captions.js'
import { defineForm, field, v } from '#lib/form/index.js'
import { USER_MESSAGES } from '../../messages.js'
import { SESSIONS_COUNTRY_NONE, type SessionsState } from '../../types.js'
import { FILTER_ERROR, FILTER_MESSAGES } from '../filter-messages.js'
import {
  countryLabel,
  SESSIONS_EXTRA_DEFAULTS,
  SESSIONS_NAME,
  SESSIONS_PAGE_PARAM,
  SESSIONS_PAGE_SIZE,
  SESSIONS_STATES,
} from './source.js'

export const SESSIONS_FILTERS_FORM_ID = 'user-sessions-filters'

export const SESSIONS_FILTER_MESSAGES = FILTER_MESSAGES

export interface SessionsFilterValues {
  state: string
  net: boolean
  country: string[]
  cfrom: string
  cto: string
  sfrom: string
  sto: string
  size: number
}

export interface SessionsFilterCaps {
  /** Отозванные строки открывает только `session.readDeleted`. */
  canSeeDeleted: boolean
}

export type SessionsFilterApply =
  | { ok: true; patch: Record<string, string | undefined>; pageSize: number }
  | { ok: false; path: string; code: string; message: string }

const clean = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  return String(value).trim()
}

const COUNTRY_RE = /^([A-Za-z0-9_-]{1,8}|none)$/

/**
 * Форма фильтров. `countries` — пункты выбора: страница и модалка передают коды
 * среза, серверный разбор POST может передать пусто (пункты ему не нужны).
 * `canSeeDeleted` убирает пункт «отозванные» не у права: сервер тем же
 * правилом срезает значение, пришедшее из `from`.
 */
export function sessionsFiltersForm(countries: readonly string[] = [], canSeeDeleted = true) {
  return defineForm({
    id: SESSIONS_FILTERS_FORM_ID,
    revision: 1,
    messages: { ...USER_MESSAGES, ...SESSIONS_FILTER_MESSAGES },
    fields: {
      paginator: field.hidden({ defaultValue: SESSIONS_NAME }),
      page_param: field.hidden({ defaultValue: SESSIONS_PAGE_PARAM }),
      from: field.hidden({}),
      size: field.number({
        label: 'Элементов на страницу',
        defaultValue: SESSIONS_PAGE_SIZE,
        validate: [v.required(), v.integer(), v.minValue(30), v.maxValue(100)],
      }),
      state: field.select({
        label: 'Состояние',
        options: [
          { value: 'active', label: 'Только живые' },
          { value: 'expired', label: 'Истёкшие' },
          { value: 'all', label: 'Все не отозванные' },
          // Отозванные открываются только с правом `session.readDeleted`:
          // без права пункта нет, а не «выключен».
          ...(canSeeDeleted ? [{ value: 'revoked', label: 'Только отозванные' }] : []),
        ],
        defaultValue: SESSIONS_EXTRA_DEFAULTS.state,
      }),
      net: field.checkbox({ label: 'Только со сменой сети', defaultValue: false }),
      country: field.multiselect({
        label: 'Страна',
        options: countries.map((code) => ({ value: code, label: countryLabel(code) })),
      }),
      cfrom: field['datetime-local']({ label: 'Создан: с' }),
      cto: field['datetime-local']({ label: 'Создан: по' }),
      sfrom: field['datetime-local']({ label: 'Последняя активность: с' }),
      sto: field['datetime-local']({ label: 'Последняя активность: по' }),
    },
  })
}

/** Пункт «Отозванные» добавляется формой, когда право есть. */
export const SESSIONS_REVOKED_OPTION = { value: 'revoked', label: 'Только отозванные' } as const

export function sessionsFilterLabels(): Record<string, string> {
  return labelsFromFields(sessionsFiltersForm([]).fields)
}

export function sessionsFilterText(key: string, value: string): string {
  if (key === 'country') {
    return value
      .split(',')
      .filter(Boolean)
      .map(countryLabel)
      .join(', ')
  }
  return textFromDescriptor(sessionsFiltersForm([]).byName[key], value)
}

export function applySessionsFilters(
  values: Record<string, unknown>,
  caps: SessionsFilterCaps,
): SessionsFilterApply {
  const sizeRaw = values.size
  const pageSize = typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw)
  if (!Number.isInteger(pageSize) || pageSize < 30 || pageSize > 100) {
    return { ok: false, path: 'size', code: FILTER_ERROR.size, message: SESSIONS_FILTER_MESSAGES[FILTER_ERROR.size] }
  }
  const cfrom = clean(values.cfrom)
  const cto = clean(values.cto)
  const sfrom = clean(values.sfrom)
  const sto = clean(values.sto)
  if (cfrom && cto && cfrom > cto) {
    return { ok: false, path: 'cfrom', code: FILTER_ERROR.range, message: SESSIONS_FILTER_MESSAGES[FILTER_ERROR.range] }
  }
  if (sfrom && sto && sfrom > sto) {
    return { ok: false, path: 'sfrom', code: FILTER_ERROR.range, message: SESSIONS_FILTER_MESSAGES[FILTER_ERROR.range] }
  }
  let state = clean(values.state) || SESSIONS_EXTRA_DEFAULTS.state
  if (!SESSIONS_STATES.includes(state as SessionsState)) {
    return { ok: false, path: 'state', code: FILTER_ERROR.value, message: SESSIONS_FILTER_MESSAGES[FILTER_ERROR.value] }
  }
  // Отозванные без права: значение не выживает из `from` и не превращается в отказ.
  if (state === 'revoked' && !caps.canSeeDeleted) state = SESSIONS_EXTRA_DEFAULTS.state
  const rawCountry = Array.isArray(values.country) ? values.country : []
  const country: string[] = []
  for (const raw of rawCountry) {
    const code = clean(raw)
    if (!code) continue
    // «Неизвестно» приходит из формы как `none`; всё прочее — код из подсказки.
    if (!COUNTRY_RE.test(code)) {
      return { ok: false, path: 'country', code: FILTER_ERROR.value, message: SESSIONS_FILTER_MESSAGES[FILTER_ERROR.value] }
    }
    country.push(code === SESSIONS_COUNTRY_NONE ? SESSIONS_COUNTRY_NONE : code.toUpperCase())
  }
  const countryCsv = [...new Set(country)].slice(0, 20).join(',')
  return {
    ok: true,
    pageSize,
    patch: {
      state: state === SESSIONS_EXTRA_DEFAULTS.state ? undefined : state,
      net: values.net === true ? '1' : undefined,
      country: countryCsv || undefined,
      cfrom: cfrom || undefined,
      cto: cto || undefined,
      sfrom: sfrom || undefined,
      sto: sto || undefined,
    },
  }
}
