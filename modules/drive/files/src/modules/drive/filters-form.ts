// Описание фильтров списка «Диска» (`plan-drive-repair.md` §6.3). Одно на
// sidebar, модалку и `/drive/filters`. Имена полей — ключи extra, не адресные:
// адрес списка пишет адаптер пагинатора, а не GET-форма.
import { labelsFromFields, textFromDescriptor } from '#core/ui/listing/captions.js'
import { defineForm, field, v } from '#core/lib/form/index.js'
import { FILTER_ERROR, FILTER_MESSAGES } from '#modules/user/base/svelte/filter-messages.js'
import { DRIVE_MESSAGES } from './messages.js'
import { driveRootRoute } from './routes.js'
import {
  DRIVE_EXTRA_DEFAULTS,
  DRIVE_NAME,
  DRIVE_PAGE_DEFAULT,
  DRIVE_PAGE_PARAM,
  DRIVE_PAGE_SIZES,
} from './source.js'

export const DRIVE_FILTERS_FORM_ID = 'drive-filters'

export const DRIVE_FILTER_MESSAGES = FILTER_MESSAGES

export interface DriveFilterValues {
  ord: string
  type: string
  scope: 'folder' | 'global'
  size: number
  from_date: string
  to_date: string
}

export type DriveFilterApply =
  | { ok: true; patch: Record<string, string | undefined>; pageSize: number }
  | { ok: false; path: string; code: string; message: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ORDERS = ['name', 'updated', 'size'] as const
const TYPES = ['all', 'file', 'folder'] as const
const SCOPES = ['folder', 'global'] as const

const clean = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  return String(value).trim()
}

function validDate(value: string): boolean {
  return value === '' || (DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)))
}

export const driveFiltersForm = defineForm({
  id: DRIVE_FILTERS_FORM_ID,
  revision: 1,
  messages: { ...DRIVE_MESSAGES, ...DRIVE_FILTER_MESSAGES },
  fields: {
    paginator: field.hidden({ defaultValue: DRIVE_NAME }),
    page_param: field.hidden({ defaultValue: DRIVE_PAGE_PARAM }),
    from: field.hidden({ defaultValue: driveRootRoute.href() }),
    ord: field.select({
      label: 'Сортировка',
      options: [
        { value: 'name', label: 'По имени' },
        { value: 'updated', label: 'По изменению' },
        { value: 'size', label: 'По размеру' },
      ],
      defaultValue: DRIVE_EXTRA_DEFAULTS.ord,
    }),
    type: field.select({
      label: 'Тип',
      options: [
        { value: 'all', label: 'Всё' },
        { value: 'folder', label: 'Папки' },
        { value: 'file', label: 'Файлы' },
      ],
      defaultValue: DRIVE_EXTRA_DEFAULTS.type,
    }),
    scope: field.select({
      label: 'Область',
      options: [
        { value: 'folder', label: 'Текущая папка' },
        { value: 'global', label: 'Весь диск' },
      ],
      defaultValue: DRIVE_EXTRA_DEFAULTS.scope,
    }),
    size: field.select({
      label: 'На страницу',
      options: DRIVE_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) })),
      defaultValue: String(DRIVE_PAGE_DEFAULT),
      validate: [v.required()],
    }),
    from_date: field.date({ label: 'Изменён с' }),
    to_date: field.date({ label: 'Изменён по' }),
  },
})

export function driveFilterLabels(): Record<string, string> {
  return labelsFromFields(driveFiltersForm.fields, {
    from: 'Изменён с',
    to: 'Изменён по',
    size: 'На страницу',
  })
}

export function driveFilterText(key: string, value: string): string {
  const name = key === 'from' ? 'from_date' : key === 'to' ? 'to_date' : key
  return textFromDescriptor(driveFiltersForm.byName[name], value)
}

/** Значения формы из живого `extra` пагинатора (снапшот или модалка). */
export function driveFilterValues(
  extra: Record<string, unknown>,
  pageSize: number,
): DriveFilterValues {
  const text = (key: string) => (typeof extra[key] === 'string' ? String(extra[key]) : '')
  const ord = text('ord')
  const type = text('type')
  const scope = text('scope')
  const size = (DRIVE_PAGE_SIZES as readonly number[]).includes(pageSize)
    ? pageSize
    : DRIVE_PAGE_DEFAULT
  return {
    ord: (ORDERS as readonly string[]).includes(ord) ? ord : DRIVE_EXTRA_DEFAULTS.ord,
    type: (TYPES as readonly string[]).includes(type) ? type : DRIVE_EXTRA_DEFAULTS.type,
    scope: (SCOPES as readonly string[]).includes(scope) ? (scope as 'folder' | 'global') : 'folder',
    size,
    from_date: text('from'),
    to_date: text('to'),
  }
}

/** Проверка и патч `extra`: умолчания снимаются, чтобы не мусорить в адресе. */
export function applyDriveFilters(values: Record<string, unknown>): DriveFilterApply {
  const sizeRaw = values.size
  const pageSize = typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw)
  if (!(DRIVE_PAGE_SIZES as readonly number[]).includes(pageSize)) {
    return {
      ok: false,
      path: 'size',
      code: FILTER_ERROR.size,
      message: DRIVE_FILTER_MESSAGES[FILTER_ERROR.size],
    }
  }

  const ord = clean(values.ord) || DRIVE_EXTRA_DEFAULTS.ord
  if (!(ORDERS as readonly string[]).includes(ord)) {
    return {
      ok: false,
      path: 'ord',
      code: FILTER_ERROR.value,
      message: DRIVE_FILTER_MESSAGES[FILTER_ERROR.value],
    }
  }

  const type = clean(values.type) || DRIVE_EXTRA_DEFAULTS.type
  if (!(TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      path: 'type',
      code: FILTER_ERROR.value,
      message: DRIVE_FILTER_MESSAGES[FILTER_ERROR.value],
    }
  }

  const scope = clean(values.scope) || DRIVE_EXTRA_DEFAULTS.scope
  if (!(SCOPES as readonly string[]).includes(scope)) {
    return {
      ok: false,
      path: 'scope',
      code: FILTER_ERROR.value,
      message: DRIVE_FILTER_MESSAGES[FILTER_ERROR.value],
    }
  }

  const from = clean(values.from_date)
  const to = clean(values.to_date)
  if (!validDate(from) || !validDate(to) || (from && to && from > to)) {
    return {
      ok: false,
      path: from && to && from > to ? 'from_date' : !validDate(from) ? 'from_date' : 'to_date',
      code: FILTER_ERROR.range,
      message: DRIVE_FILTER_MESSAGES[FILTER_ERROR.range],
    }
  }

  return {
    ok: true,
    pageSize,
    patch: {
      ord: ord === DRIVE_EXTRA_DEFAULTS.ord ? undefined : ord,
      type: type === DRIVE_EXTRA_DEFAULTS.type ? undefined : type,
      scope: scope === DRIVE_EXTRA_DEFAULTS.scope ? undefined : scope,
      from: from || undefined,
      to: to || undefined,
    },
  }
}
