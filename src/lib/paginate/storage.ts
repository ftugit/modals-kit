// Хранилища (SPEC §3.5). Пагинатор отдаёт ПОЛНЫЙ snapshot — storage берёт нужное (R10).
// Порт storage.ts React-версии: read-валидация без zod, тот же deny-safe контракт
// (подделка в devtools → null → безопасные дефолты).
import type { Extra, ExtraValue, PaginatorState, PaginatorStorage, RestorableState } from './types'

function isInt(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min
}

function isExtraValue(v: unknown): v is ExtraValue {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/** extra: плоский объект скаляров; всё лишнее отбрасывается ПО КЛЮЧУ (не валит объект). */
export function sanitizeExtra(input: unknown): Extra {
  const out: Extra = {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (isExtraValue(v)) out[k] = v
  }
  return out
}

/**
 * Эквивалент restorableSchema.partial().safeParse: поле отсутствует — допустимо,
 * присутствует, но невалидно — ВЕСЬ объект отвергается (null, deny-safe).
 */
export function safeParseRestorable(input: unknown): Partial<RestorableState> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  const out: Partial<RestorableState> = {}
  if (o.page !== undefined) {
    if (!isInt(o.page, 1)) return null
    out.page = o.page
  }
  if (o.pageSize !== undefined) {
    if (!isInt(o.pageSize, 1)) return null
    out.pageSize = o.pageSize
  }
  if (o.totalItems !== undefined) {
    if (o.totalItems !== null && !isInt(o.totalItems, 0)) return null
    out.totalItems = o.totalItems as number | null
  }
  if (o.totalPages !== undefined) {
    if (o.totalPages !== null && !isInt(o.totalPages, 0)) return null
    out.totalPages = o.totalPages as number | null
  }
  if (o.extra !== undefined) out.extra = sanitizeExtra(o.extra)
  if (o.sourceState !== undefined) {
    if (typeof o.sourceState !== 'string' || o.sourceState.length > 8192) return null
    out.sourceState = o.sourceState
  }
  return out
}

export function createMemoryStorage(): PaginatorStorage {
  const map = new Map<string, PaginatorState<unknown>>()
  return {
    read: (name) => map.get(name) ?? null,
    write: (name, snapshot) => void map.set(name, snapshot),
  }
}

export type MinimalStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const defaultPick = (s: PaginatorState<unknown>): Partial<RestorableState> => ({
  page: s.page,
  pageSize: s.pageSize,
  totalItems: s.totalItems,
  extra: s.extra,
  sourceState: s.sourceState,
})

export function createLocalStorageStorage(
  opts: {
    /** Кастомный отбор полей из полного snapshot. Default: page + pageSize + totalItems + extra. */
    pick?: (s: PaginatorState<unknown>) => Partial<RestorableState>
    /** Инжекция для тестов/кастомных бэкендов. Default: globalThis.localStorage (SSR-guard). */
    storage?: MinimalStorage
  } = {},
): PaginatorStorage {
  const pick = opts.pick ?? defaultPick
  const resolve = (): MinimalStorage | undefined =>
    opts.storage ??
    (typeof globalThis.localStorage !== 'undefined'
      ? (globalThis.localStorage as MinimalStorage)
      : undefined)

  return {
    read(name) {
      const ls = resolve()
      if (!ls) return null
      const raw = ls.getItem(`pag:${name}`)
      if (raw == null) return null
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null // битый JSON → deny-safe
      }
      return safeParseRestorable(parsed)
    },
    write(name, snapshot) {
      const ls = resolve()
      if (!ls) return // SSR no-op
      // Ошибки (quota) пробрасываем — гасит ядро (persist не критичен для отображения).
      ls.setItem(`pag:${name}`, JSON.stringify(pick(snapshot)))
    },
  }
}
