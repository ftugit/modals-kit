// Описание фильтров списка блокировок. Одно на sidebar, модалку и
// `/blocks/filters`. Сферы — фиксированный каталог, не имена из тела POST.
import { labelsFromFields, textFromDescriptor } from '#components/listing/captions.js'
import { defineForm, field, v } from '#lib/form/index.js'
import { BLOCK_SCOPES, isBlockScope } from '../../spec-block.js'
import type { BlocksOrder, BlocksState } from '../../types.js'
import { USER_MESSAGES } from '../../messages.js'
import {
  BLOCKS_EXTRA_DEFAULTS,
  BLOCKS_NAME,
  BLOCKS_ORDERS,
  BLOCKS_PAGE_PARAM,
  BLOCKS_PAGE_SIZE,
  BLOCKS_STATES,
} from './source.js'

export const BLOCKS_FILTERS_FORM_ID = 'user-blocks-filters'

export const BLOCKS_FILTER_MESSAGES = {
  'filters.range': 'Дата «с» позже даты «по» — поправьте диапазон',
  'filters.size': 'Элементов на страницу — целое число от 30 до 100',
  'filters.value': 'Такое значение фильтр не принимает',
  'filters.no-address': 'У этого списка нет адреса для применения без JS.',
} as const

export interface BlocksFilterValues {
  ord: string
  state: string
  scopes: string[]
  uids: string[]
  size: number
}

export interface BlocksFilterCaps {
  canSeeDeleted: boolean
  canSeeLive: boolean
  canPickUsers: boolean
  /** Список конкретного пользователя: выбор uid в фильтре закрыт. */
  uid: string | null
}

export type BlocksFilterApply =
  | { ok: true; patch: Record<string, string | undefined>; pageSize: number }
  | { ok: false; path: string; code: string; message: string }

export const scopeFieldName = (key: string) => `sc.${key}`

/** Заголовок колонки сфер. Отдельного поля `scopes` в форме нет: сферы пакуются в один ключ extra. */
export const BLOCKS_SCOPES_LABEL = 'Сферы блокировок'

/** Заголовок выбора пользователей. Поле `uids` скрытое, подпись живёт в описании. */
export const BLOCKS_UIDS_LABEL = 'Пользователи'

const clean = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  return String(value).trim()
}

const scopeFields = Object.fromEntries(
  Object.entries(BLOCK_SCOPES).map(([key, info]) => [
    scopeFieldName(key),
    field.checkbox({ label: `${info.title} (${key})`, defaultValue: false }),
  ]),
)

export const blocksFiltersForm = defineForm({
  id: BLOCKS_FILTERS_FORM_ID,
  revision: 1,
  messages: { ...USER_MESSAGES, ...BLOCKS_FILTER_MESSAGES },
  fields: {
    paginator: field.hidden({ defaultValue: BLOCKS_NAME }),
    page_param: field.hidden({ defaultValue: BLOCKS_PAGE_PARAM }),
    from: field.hidden({}),
    show_deleted: field.checkbox({ label: 'Удалённые', defaultValue: false }),
    show_live: field.checkbox({ label: 'Живые', defaultValue: true }),
    size: field.number({
      label: 'Элементов на страницу',
      defaultValue: BLOCKS_PAGE_SIZE,
      validate: [v.required(), v.integer(), v.minValue(30), v.maxValue(100)],
    }),
    ord: field.select({
      label: 'Порядок',
      options: [
        { value: 'created-desc', label: 'Сначала новые (по созданию)' },
        { value: 'created-asc', label: 'Сначала старые (по созданию)' },
        { value: 'until-asc', label: 'По сроку окончания (по возрастанию)' },
        { value: 'until-desc', label: 'По сроку окончания (по убыванию)' },
        { value: 'scope-asc', label: 'По сфере (А→Я)' },
        { value: 'scope-desc', label: 'По сфере (Я→А)' },
        { value: 'deleted-desc', label: 'Недавно удалённые', when: { field: 'show_deleted', equals: true } },
        { value: 'deleted-asc', label: 'Давно удалённые', when: { field: 'show_deleted', equals: true } },
      ],
      defaultValue: BLOCKS_EXTRA_DEFAULTS.ord,
    }),
    state: field.select({
      label: 'Состояние',
      options: [
        { value: 'all', label: 'Все живые (активные и снятые)', when: { field: 'show_live', equals: true } },
        { value: 'active', label: 'Только активные', when: { field: 'show_live', equals: true } },
        { value: 'expired', label: 'Только снятые / истёкшие', when: { field: 'show_live', equals: true } },
        { value: 'deleted', label: 'Только мягко удалённые', when: { field: 'show_deleted', equals: true } },
      ],
      defaultValue: BLOCKS_EXTRA_DEFAULTS.state,
    }),
    uids: field.hidden({ label: BLOCKS_UIDS_LABEL, defaultValue: '' }),
    ...scopeFields,
  },
})

const UIDS_RE = /^[0-9a-f,-]{1,4000}$/i

export function blocksFilterLabels(): Record<string, string> {
  return labelsFromFields(blocksFiltersForm.fields, { scopes: BLOCKS_SCOPES_LABEL })
}

export function blocksFilterText(key: string, value: string): string {
  if (key === 'scopes') {
    return value
      .split(',')
      .filter(Boolean)
      .map((part) => (isBlockScope(part) ? BLOCK_SCOPES[part].title : part))
      .join(', ')
  }
  if (key === 'uids') {
    const count = value.split(',').filter(Boolean).length
    return count ? String(count) : value
  }
  return textFromDescriptor(blocksFiltersForm.byName[key], value)
}

export function applyBlocksFilters(
  values: Record<string, unknown>,
  caps: BlocksFilterCaps,
): BlocksFilterApply {
  const sizeRaw = values.size
  const pageSize = typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw)
  if (!Number.isInteger(pageSize) || pageSize < 30 || pageSize > 100) {
    return { ok: false, path: 'size', code: 'filters.size', message: BLOCKS_FILTER_MESSAGES['filters.size'] }
  }
  let ord = clean(values.ord) || BLOCKS_EXTRA_DEFAULTS.ord
  if (!BLOCKS_ORDERS.includes(ord as BlocksOrder)) {
    return { ok: false, path: 'ord', code: 'filters.value', message: BLOCKS_FILTER_MESSAGES['filters.value'] }
  }
  if (!caps.canSeeDeleted && ord.startsWith('deleted')) ord = BLOCKS_EXTRA_DEFAULTS.ord
  let state = clean(values.state) || BLOCKS_EXTRA_DEFAULTS.state
  if (!BLOCKS_STATES.includes(state as BlocksState)) {
    return { ok: false, path: 'state', code: 'filters.value', message: BLOCKS_FILTER_MESSAGES['filters.value'] }
  }
  const allowed = new Set<BlocksState>(
    caps.canSeeLive
      ? caps.canSeeDeleted
        ? ['all', 'active', 'expired', 'deleted']
        : ['all', 'active', 'expired']
      : caps.canSeeDeleted
        ? ['deleted']
        : [],
  )
  // Запрещённое право снимает, чтобы значение не выжило из `from`. Чужое — отказ.
  if (!allowed.has(state as BlocksState)) {
    state = caps.canSeeLive ? BLOCKS_EXTRA_DEFAULTS.state : caps.canSeeDeleted ? 'deleted' : ''
    if (!allowed.has(state as BlocksState)) {
      return { ok: false, path: 'state', code: 'filters.value', message: BLOCKS_FILTER_MESSAGES['filters.value'] }
    }
  }
  const scopes: string[] = []
  for (const key of Object.keys(BLOCK_SCOPES)) {
    if (values[scopeFieldName(key)] === true && isBlockScope(key)) scopes.push(key)
  }
  const scopesCsv = scopes.join(',')
  if (scopesCsv.length > 400) {
    return { ok: false, path: 'uids', code: 'filters.value', message: BLOCKS_FILTER_MESSAGES['filters.value'] }
  }
  let uids = ''
  if (!caps.uid && caps.canPickUsers) {
    uids = clean(values.uids)
    if (uids && !UIDS_RE.test(uids)) {
      return { ok: false, path: 'uids', code: 'filters.value', message: BLOCKS_FILTER_MESSAGES['filters.value'] }
    }
  }
  return {
    ok: true,
    pageSize,
    patch: {
      ord: ord === BLOCKS_EXTRA_DEFAULTS.ord ? undefined : ord,
      state: state === BLOCKS_EXTRA_DEFAULTS.state ? undefined : state,
      scopes: scopesCsv || undefined,
      uids: uids || undefined,
    },
  }
}
