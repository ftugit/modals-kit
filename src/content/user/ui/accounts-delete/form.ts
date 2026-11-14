/**
 * Описание формы единицы удаления аккаунтов (`user.accounts.delete`).
 *
 * Набор приходит значениями скрытых полей, а не новым описанием: одна форма на
 * `id`, `ids` и срез (§5.2). Срез едет теми же ключами, что у списка seed-юзеров,
 * поэтому разбор один — здесь, и им пользуются и загрузчик страницы, и
 * серверный обработчик.
 *
 * Текст подтверждения говорит «удаление запрошено», а не «стёрто»: крон
 * зачистки вне объёма плана (§11.5).
 */
import { defineForm, field } from '#lib/form/index.js'
import { AUTH_MESSAGES } from '../../messages.js'
import { BULK_IDS_LIMIT } from '../../bulk.js'
import type { AccountsSlice } from '../../accounts-admin.js'
import type { SeedUsersOrder, SeedUsersState } from '../../types.js'
import { SEED_USERS_ORDERS, SEED_USERS_PAGE_PARAM, SEED_USERS_STATES } from '../seed-users/source.js'

export const ACCOUNTS_DELETE_FORM_ID = 'user-accounts-delete'

/** Предел набора — один, доменный: форма своё число не вводит. */
export const MAX_ACCOUNTS_DELETE_IDS = BULK_IDS_LIMIT

/** Ключи среза списка аккаунтов, которые форма принимает скрытыми полями. */
export const ACCOUNTS_SLICE_KEYS = [
  'q',
  'state',
  'ord',
  'cfrom',
  'cto',
  'dfrom',
  'dto',
  'nick',
] as const

export type AccountsSliceKey = (typeof ACCOUNTS_SLICE_KEYS)[number]

/** Поле среза в форме: префикс, чтобы не спорить с `ids`. */
export function sliceFieldName(key: string): string {
  return `filter_${key}`
}

const dateMs = (raw: string | null | undefined): number | null => {
  if (!raw) return null
  const v = Date.parse(raw)
  return Number.isFinite(v) ? v : null
}

/**
 * Чтение среза из адреса: ключи списка (`?users.state=…`) или голые — так
 * кнопка может передать адрес списка целиком, не разбирая его.
 */
export function accountsSliceReader(params: URLSearchParams): (key: string) => string | undefined {
  return (key) => params.get(`${SEED_USERS_PAGE_PARAM}.${key}`) ?? params.get(key) ?? undefined
}

/** Непустой срез: хотя бы одно значение заполнено. */
export function hasSliceFields(read: (key: string) => string | undefined): boolean {
  return ACCOUNTS_SLICE_KEYS.some((key) => String(read(key) ?? '').trim() !== '')
}

/**
 * Условия среза из полей формы (или адреса): домен получает те же имена, что
 * у списка. Незнакомый порядок/состояние отбрасываются — как в `load` списка.
 */
export function accountsSliceFrom(read: (key: string) => string | undefined): AccountsSlice {
  const q = read('q')?.trim()
  const stateRaw = read('state')
  const orderRaw = read('ord')
  return {
    ...(q ? { search: q } : {}),
    ...(SEED_USERS_STATES.includes(stateRaw as SeedUsersState)
      ? { state: stateRaw as SeedUsersState }
      : {}),
    ...(SEED_USERS_ORDERS.includes(orderRaw as SeedUsersOrder)
      ? { order: orderRaw as SeedUsersOrder }
      : {}),
    createdFrom: dateMs(read('cfrom')),
    createdTo: dateMs(read('cto')),
    deletedFrom: dateMs(read('dfrom')),
    deletedTo: dateMs(read('dto')),
    nickname: read('nick') === '1' || read('nick') === 'on',
  }
}

/** Числом и словами: набор показан человеку, а не спрятан в адресе (§6.3). */
export function accountsDeleteSummary(shape: { count: number; slice: boolean }): {
  title: string
  detail: string
  hold: boolean
  submit: string
} {
  const { count, slice } = shape
  const title = slice
    ? 'Удалить все аккаунты в этом срезе?'
    : count === 1
      ? 'Удалить этот аккаунт?'
      : `Удалить ${count} ${plural(count, 'аккаунт', 'аккаунта', 'аккаунтов')}?`
  return {
    title,
    detail:
      'Удаление будет запрошено: вход и устройства перестанут работать сразу. Строки данных останутся до зачистки планировщиком — физического стирания эта кнопка не обещает.',
    // Удержание — когда набор заведомо больше одного: у среза число строк
    // известно лишь серверу, поэтому срез требует удержания всегда.
    hold: slice || count > 1,
    submit: slice ? 'Удерживайте, чтобы удалить' : 'Удалить',
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/**
 * Описание формы — одно для клиента и сервера: ревизия и поля не зависят от
 * адреса и от того, кто носитель.
 */
export function accountsDeleteForm() {
  const fields: Record<string, ReturnType<typeof field.hidden>> = {
    ids: field.hidden({ defaultValue: '', validate: [] }),
  }
  for (const key of ACCOUNTS_SLICE_KEYS) {
    fields[sliceFieldName(key)] = field.hidden({ defaultValue: '', validate: [] })
  }
  return defineForm({
    id: ACCOUNTS_DELETE_FORM_ID,
    revision: 1,
    messages: { ...AUTH_MESSAGES },
    actions: [
      { id: 'delete', label: 'Удалить аккаунты', validate: 'none' },
    ],
    fields,
  })
}
