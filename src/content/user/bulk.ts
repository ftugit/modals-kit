/**
 * Общий контракт набора (план сессий §5.2, §11.2).
 *
 * Действие принимает **одну** форму набора: `id`, `ids` или срез. Формы не
 * смешиваются: два источника в одном запросе — отказ разбора, а не тихий
 * выбор «первого». Набор `ids` ограничен пределом ресурса и превышение —
 * отказ с кодом, а не молчаливое усечение (тогда «просили 600, сделали 500»
 * выглядело бы успехом).
 *
 * Разбор живёт здесь, а не в каждом компоненте: число предела объявляется
 * один раз, и все двери (аккаунты, блокировки, сессии) читают его отсюда.
 */

/** Предел числа `ids` в одном наборе — консервативное значение контракта. */
export const BULK_IDS_LIMIT = 500

/** Какая форма набора пришла. */
export type BulkSetForm = 'id' | 'ids' | 'slice'

/** Числа исхода: адрес не меняет, частичный исход виден числом. */
export interface BulkCounts {
  /** Сколько строк просили обработать. */
  requested: number
  /** Сколько изменилось. */
  changed: number
  /** Сколько уже было в целевом состоянии (идемпотентность). */
  unchanged: number
  /** Сколько отклонено (право, цель, запрет). */
  rejected: number
}

/** Вход разбора: ровно одна форма набора. */
export interface BulkInput {
  id?: string | null
  ids?: readonly string[] | string | null
  /** Условия среза: ключи и значения фильтра списка. */
  slice?: Readonly<Record<string, string>> | null
}

export type BulkParse =
  | { ok: true; form: BulkSetForm; ids: string[]; slice: Readonly<Record<string, string>> | null }
  | { ok: false; code: 'auth.confirm' | 'auth.limit' }

/** Строки `ids` из CSV или массива: пустые выброшены, повторы схлопнуты. */
export function bulkIds(raw: string | readonly string[] | null | undefined): string[] {
  const parts = typeof raw === 'string' ? raw.split(',') : (raw ?? [])
  return [...new Set(parts.map((s) => String(s ?? '').trim()).filter(Boolean))]
}

/** Срез непуст: хотя бы одно значение не пустое. */
export function hasSlice(slice: Readonly<Record<string, string>> | null | undefined): boolean {
  if (!slice) return false
  return Object.values(slice).some((v) => String(v ?? '').trim() !== '')
}

/**
 * Разобрать набор. Смешивание форм — `auth.confirm`; пустой набор — тоже
 * отказ («ноль объектов обработано» успехом не считается); превышение
 * предела `ids` — `auth.limit`.
 */
export function parseBulkInput(input: BulkInput): BulkParse {
  const id = String(input.id ?? '').trim()
  const ids = bulkIds(input.ids)
  const slice = hasSlice(input.slice) ? input.slice! : null
  const forms = Number(id !== '') + Number(ids.length > 0) + Number(slice !== null)
  if (forms !== 1) return { ok: false, code: 'auth.confirm' }
  if (slice) return { ok: true, form: 'slice', ids: [], slice }
  if (id) return { ok: true, form: 'id', ids: [id], slice: null }
  if (ids.length > BULK_IDS_LIMIT) return { ok: false, code: 'auth.limit' }
  return { ok: true, form: 'ids', ids, slice: null }
}

/** Пустые числа исхода. */
export function emptyCounts(requested = 0): BulkCounts {
  return { requested, changed: 0, unchanged: 0, rejected: 0 }
}

/** Сложить числа: у двери считает она, у формы — сводка. */
export function addCounts(a: BulkCounts, b: BulkCounts): BulkCounts {
  return {
    requested: a.requested + b.requested,
    changed: a.changed + b.changed,
    unchanged: a.unchanged + b.unchanged,
    rejected: a.rejected + b.rejected,
  }
}
