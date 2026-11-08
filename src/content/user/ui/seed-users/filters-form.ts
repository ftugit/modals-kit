// Описание фильтров списка seed-юзеров. Одно на sidebar, модалку и
// `/users/filters`. Имена полей — ключи extra, не адресные: адрес пишет
// адаптер. Права в описание не входят: их проверяет `execute`.
import { defineForm, field, v } from '#lib/form/index.js'
import type { SeedUsersOrder, SeedUsersState } from '../../types.js'
import { USER_MESSAGES } from '../../messages.js'
import {
  SEED_USERS_NAME,
  SEED_USERS_ORDERS,
  SEED_USERS_PAGE_PARAM,
  SEED_USERS_PAGE_SIZE,
  SEED_USERS_STATES,
} from './source.js'

export const SEED_USERS_FILTERS_FORM_ID = 'seed-users-filters'

export const SEED_FILTER_MESSAGES = {
  'filters.range': 'Дата «с» позже даты «по» — поправьте диапазон',
  'filters.size': 'Элементов на страницу — целое число от 30 до 100',
  'filters.value': 'Такое значение фильтр не принимает',
  'filters.no-address': 'У этого списка нет адреса для применения без JS.',
} as const

export interface SeedUsersFilterValues {
  ord: string
  state: string
  cfrom: string
  cto: string
  dfrom: string
  dto: string
  nick: boolean
  size: number
}

export interface SeedUsersFilterCaps {
  canSeeDeleted: boolean
  canSeeNickname: boolean
}

export type SeedFilterApply =
  | { ok: true; patch: Record<string, string | undefined>; pageSize: number }
  | { ok: false; path: string; code: string; message: string }

const clean = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  return String(value).trim()
}

export const seedUsersFiltersForm = defineForm({
  id: SEED_USERS_FILTERS_FORM_ID,
  revision: 1,
  messages: { ...USER_MESSAGES, ...SEED_FILTER_MESSAGES },
  fields: {
    paginator: field.hidden({ defaultValue: SEED_USERS_NAME }),
    page_param: field.hidden({ defaultValue: SEED_USERS_PAGE_PARAM }),
    from: field.hidden({}),
    // Только показ: сервер право не читает из этого поля.
    show_deleted: field.checkbox({ label: 'Удалённые', defaultValue: false }),
    nick: field.checkbox({ label: 'Показывать никнейм', defaultValue: false }),
    size: field.number({
      label: 'Элементов на страницу',
      defaultValue: SEED_USERS_PAGE_SIZE,
      validate: [v.required(), v.integer(), v.minValue(30), v.maxValue(100)],
    }),
    ord: field.select({
      label: 'Порядок',
      options: [
        { value: 'created-desc', label: 'Сначала новые (по созданию)' },
        { value: 'created-asc', label: 'Сначала старые (по созданию)' },
        { value: 'nickname-asc', label: 'По никнейму (А→Я)', when: { field: 'nick', equals: true } },
        { value: 'nickname-desc', label: 'По никнейму (Я→А)', when: { field: 'nick', equals: true } },
        {
          value: 'deleted-desc',
          label: 'Недавно удалённые (по удалению)',
          when: { field: 'show_deleted', equals: true },
        },
        {
          value: 'deleted-asc',
          label: 'Давно удалённые (по удалению)',
          when: { field: 'show_deleted', equals: true },
        },
        { value: 'id-asc', label: 'По id: по возрастанию' },
        { value: 'id-desc', label: 'По id: по убыванию' },
      ],
      defaultValue: 'created-desc',
    }),
    state: field.select({
      label: 'Состояние',
      options: [
        { value: 'active', label: 'Только действующие' },
        { value: 'all', label: 'Включая удалённые', when: { field: 'show_deleted', equals: true } },
        { value: 'deleted', label: 'Только удалённые', when: { field: 'show_deleted', equals: true } },
      ],
      defaultValue: 'active',
    }),
    cfrom: field['datetime-local']({ label: 'Создан: с' }),
    cto: field['datetime-local']({ label: 'Создан: по' }),
    dfrom: field['datetime-local']({ label: 'Удалён: с' }),
    dto: field['datetime-local']({ label: 'Удалён: по' }),
  },
})

export function applySeedFilters(
  values: Record<string, unknown>,
  caps: SeedUsersFilterCaps,
): SeedFilterApply {
  const sizeRaw = values.size
  const pageSize = typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw)
  if (!Number.isInteger(pageSize) || pageSize < 30 || pageSize > 100) {
    return { ok: false, path: 'size', code: 'filters.size', message: SEED_FILTER_MESSAGES['filters.size'] }
  }
  const cfrom = clean(values.cfrom)
  const cto = clean(values.cto)
  const dfrom = clean(values.dfrom)
  const dto = clean(values.dto)
  if (cfrom && cto && cfrom > cto) {
    return { ok: false, path: 'cfrom', code: 'filters.range', message: SEED_FILTER_MESSAGES['filters.range'] }
  }
  if (caps.canSeeDeleted && dfrom && dto && dfrom > dto) {
    return { ok: false, path: 'dfrom', code: 'filters.range', message: SEED_FILTER_MESSAGES['filters.range'] }
  }
  let ord = clean(values.ord) || 'created-desc'
  if (!SEED_USERS_ORDERS.includes(ord as SeedUsersOrder)) {
    return { ok: false, path: 'ord', code: 'filters.value', message: SEED_FILTER_MESSAGES['filters.value'] }
  }
  const nickOn = caps.canSeeNickname && values.nick === true
  if ((!caps.canSeeDeleted && ord.startsWith('deleted')) || (!nickOn && ord.startsWith('nickname'))) {
    ord = 'created-desc'
  }
  let state = clean(values.state) || 'active'
  if (!SEED_USERS_STATES.includes(state as SeedUsersState)) {
    return { ok: false, path: 'state', code: 'filters.value', message: SEED_FILTER_MESSAGES['filters.value'] }
  }
  if (!caps.canSeeDeleted) state = 'active'
  return {
    ok: true,
    pageSize,
    patch: {
      ord: ord === 'created-desc' ? undefined : ord,
      state: state === 'active' ? undefined : state,
      cfrom: cfrom || undefined,
      cto: cto || undefined,
      dfrom: caps.canSeeDeleted ? dfrom || undefined : undefined,
      dto: caps.canSeeDeleted ? dto || undefined : undefined,
      nick: nickOn ? '1' : undefined,
    },
  }
}
