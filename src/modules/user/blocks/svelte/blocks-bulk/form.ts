/**
 * Описание формы единицы наборных действий над блокировками (`user.blocks.bulk`).
 *
 * Одна форма на двери «снять» и «удалить»: набор приходит скрытыми полями
 * (`ids` + срез), а действие выбирается `intent`. Срез едет теми же ключами,
 * что у списка блокировок, поэтому разбор один — здесь.
 *
 * `uid` в срезе — цель персонального списка (`/user/[id]/blocks`): у него uid
 * в пути, а не в строке запроса, поэтому загрузчик кладёт его в поля сам.
 */
import { defineForm, field } from '#core/lib/form/index.js'
import { AUTH_MESSAGES, USER_MESSAGES } from '#modules/user/base/messages.js'
import { isBlockScope } from '#modules/user/base/model/spec-block.js'
import { BULK_IDS_LIMIT } from '#modules/user/base/service/bulk.js'
import type { BlocksSlice } from '#modules/user/blocks/service/blocks-admin.js'
import type { BlocksState } from '#modules/user/base/model/types.js'
import { BLOCKS_ORDERS, BLOCKS_PAGE_PARAM, BLOCKS_STATES } from '../blocks-list/source.js'

export const BLOCKS_BULK_FORM_ID = 'user-blocks-bulk'

/** Предел набора — один, доменный: форма своё число не вводит. */
export const MAX_BLOCKS_BULK_IDS = BULK_IDS_LIMIT

/** Действия единицы: снять блокировку или мягко удалить запись. */
export const BLOCKS_BULK_INTENTS = ['lift', 'delete'] as const
export type BlocksBulkIntent = (typeof BLOCKS_BULK_INTENTS)[number]

/** Ключи среза списка блокировок, которые форма принимает скрытыми полями. */
export const BLOCKS_SLICE_KEYS = ['ord', 'state', 'scopes', 'uids', 'uid'] as const

export type BlocksSliceKey = (typeof BLOCKS_SLICE_KEYS)[number]

/** Поле среза в форме: префикс, чтобы не спорить с `ids`. */
export function sliceFieldName(key: string): string {
  return `filter_${key}`
}

/**
 * Чтение среза из адреса: ключи списка (`?blocks.state=…`) или голые — так
 * кнопка может передать адрес списка целиком, не разбирая его.
 */
export function blocksSliceReader(params: URLSearchParams): (key: string) => string | undefined {
  return (key) => params.get(`${BLOCKS_PAGE_PARAM}.${key}`) ?? params.get(key) ?? undefined
}

/** Непустой срез: хотя бы одно значение заполнено. */
export function hasSliceFields(read: (key: string) => string | undefined): boolean {
  return BLOCKS_SLICE_KEYS.some((key) => String(read(key) ?? '').trim() !== '')
}

/**
 * Условия среза из полей формы (или адреса): домен получает те же имена, что
 * у списка. Незнакомые сферы/состояние/порядок отбрасываются — как в `load`.
 */
export function blocksSliceFrom(read: (key: string) => string | undefined): BlocksSlice {
  const stateRaw = read('state')
  const orderRaw = read('ord')
  const scopes = String(read('scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && isBlockScope(s))
  const uids = String(read('uids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const uid = String(read('uid') ?? '').trim()
  return {
    ...(stateRaw && BLOCKS_STATES.includes(stateRaw as BlocksState)
      ? { state: stateRaw as BlocksState }
      : {}),
    ...(orderRaw && BLOCKS_ORDERS.includes(orderRaw as (typeof BLOCKS_ORDERS)[number])
      ? { order: orderRaw as (typeof BLOCKS_ORDERS)[number] }
      : {}),
    ...(scopes.length > 0 ? { scopes } : {}),
    ...(uids.length > 0 ? { uids } : {}),
    ...(uid ? { uid } : {}),
  }
}

/** Числом и словами: набор показан человеку, а не спрятан в адресе (§6.3). */
export function blocksBulkSummary(
  shape: { count: number; slice: boolean },
  intent: BlocksBulkIntent,
): { title: string; detail: string; hold: boolean; submit: string } {
  const { count, slice } = shape
  const many = slice || count > 1
  if (intent === 'delete') {
    return {
      title: slice
        ? 'Удалить все записи в этом срезе?'
        : count === 1
          ? 'Удалить эту запись блокировки?'
          : `Удалить ${count} ${plural(count, 'запись', 'записи', 'записей')}?`,
      detail:
        'Записи будут помечены удалёнными и уйдут из живого списка. Строки истории остаются: окончательное стирание — отдельное действие строки.',
      hold: many,
      submit: slice ? 'Удерживайте, чтобы удалить' : 'Удалить',
    }
  }
  return {
    title: slice
      ? 'Снять все блокировки в этом срезе?'
      : count === 1
        ? 'Снять эту блокировку?'
        : `Снять ${count} ${plural(count, 'блокировку', 'блокировки', 'блокировок')}?`,
    detail:
      'Блокировка заканчивается сейчас, потому что срок становится текущим. Запись остаётся в истории — удаления здесь нет.',
    hold: many,
    submit: slice ? 'Удерживайте, чтобы снять' : 'Снять',
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Описание формы — одно для клиента и сервера: ревизия и поля не зависят от носителя. */
export function blocksBulkForm() {
  const fields: Record<string, ReturnType<typeof field.hidden>> = {
    ids: field.hidden({ defaultValue: '', validate: [] }),
  }
  for (const key of BLOCKS_SLICE_KEYS) {
    fields[sliceFieldName(key)] = field.hidden({ defaultValue: '', validate: [] })
  }
  return defineForm({
    id: BLOCKS_BULK_FORM_ID,
    revision: 1,
    messages: { ...AUTH_MESSAGES, ...USER_MESSAGES },
    actions: [
      { id: 'lift', label: 'Снять блокировки', validate: 'none' },
      { id: 'delete', label: 'Удалить записи', validate: 'none' },
    ],
    fields,
  })
}
