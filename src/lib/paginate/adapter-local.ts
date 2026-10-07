// Local-адаптер: source + storage без URL (SPEC §3.6). Дословный порт React-версии;
// источник — адаптированный (слой `source.ts`): возможности и паспорт записи
// приезжают пагинатору, а вызов данных идёт единственным путём (`fetchPage`).
import { createMemoryStorage } from './storage'
import { assertAdaptedSource, type AdaptedSource } from './source'
import type { PaginatorAdapter, PaginatorStorage } from './types'

export function createLocalAdapter<T>(opts: {
  name: string
  source: AdaptedSource<T>
  storage?: PaginatorStorage
  pageSize?: number
  append?: boolean
  /** Ключи extra, объявленные потребителем (для строгой проверки `setExtra`). */
  extraKeys?: readonly string[]
}): PaginatorAdapter<T> {
  const source = assertAdaptedSource<T>(opts.source, `createLocalAdapter("${opts.name}")`)
  const storage = opts.storage ?? createMemoryStorage()
  const pageSize = opts.pageSize ?? 20
  const append = opts.append ?? true
  return {
    async getInitial() {
      const restored = await storage.read(opts.name)
      return {
        page: restored?.page ?? 1,
        // Хранилище нативно помнит pageSize; иначе — конфиг адаптера.
        pageSize: restored?.pageSize ?? pageSize,
        totalItems: restored?.totalItems ?? null,
        totalPages: restored?.totalPages ?? null,
        extra: restored?.extra ?? {},
      }
    },
    loadPage: (req) =>
      source.fetchPage({ page: req.page, pageSize: req.pageSize, signal: req.signal }, req.extra),
    persist: (state) => storage.write(opts.name, state),
    capabilities: { append },
    capabilitiesFor: (extra) => source.capabilitiesFor(extra),
    // Поверхность потребителя известна только если он её объявил: иначе не судим.
    extraKeys: opts.extraKeys ? () => [...opts.extraKeys!, ...source.extraKeys()] : undefined,
  }
}
