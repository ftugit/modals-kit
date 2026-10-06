// Local-адаптер: source + storage без URL (SPEC §3.6). Дословный порт React-версии.
import { createMemoryStorage } from './storage'
import type { PaginatorAdapter, PaginatorStorage, Source } from './types'

export function createLocalAdapter<T>(opts: {
  name: string
  source: Source<T>
  storage?: PaginatorStorage
  pageSize?: number
  append?: boolean
}): PaginatorAdapter<T> {
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
    loadPage: (req) => opts.source(req),
    persist: (state) => storage.write(opts.name, state),
    capabilities: { append },
  }
}
