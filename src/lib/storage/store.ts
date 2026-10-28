// Опциональный кэш-стор (`defineStorageStore`) и технические метаданные запроса (`tech` / `meta`)
// с мягкой деградацией через `console.error` (§1.1 п.3 спецификации).

export interface StorageStoreSpec {
  get<T = unknown>(key: string): T | undefined | Promise<T | undefined>
  set<T = unknown>(key: string, value: T, options?: { ttlMs?: number }): void | Promise<void>
  delete(key: string): void | Promise<void>
  add?<T = unknown>(key: string, value: T, options: { ttlMs: number }): boolean | Promise<boolean>
  incr?(key: string, options: { ttlMs: number; by?: number }): number | Promise<number>
}

export interface AdaptedStorageStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set<T = unknown>(key: string, value: T, options?: { ttlMs?: number }): Promise<void>
  delete(key: string): Promise<void>
  add<T = unknown>(key: string, value: T, options: { ttlMs: number }): Promise<boolean>
  incr(key: string, options: { ttlMs: number; by?: number }): Promise<number>
}

export interface StorageRequestMeta {
  readonly ip?: string
  readonly clientId?: string
  readonly requestId?: string
  readonly [extra: string]: unknown
}

export interface StorageTechConfig {
  readonly publicOrigin?: string
  readonly resolveMeta?: (
    request: Request,
  ) => StorageRequestMeta | Promise<StorageRequestMeta>
}

export function defineStorageStore(spec: StorageStoreSpec): AdaptedStorageStore {
  return {
    get: async <T = unknown>(key: string) => spec.get<T>(key),
    set: async <T = unknown>(key: string, value: T, options?: { ttlMs?: number }) => {
      await spec.set(key, value, options)
    },
    delete: async (key: string) => {
      await spec.delete(key)
    },
    add: async <T = unknown>(key: string, value: T, options: { ttlMs: number }) => {
      if (spec.add) return spec.add(key, value, options)
      const existing = await spec.get(key)
      if (existing !== undefined) return false
      await spec.set(key, value, { ttlMs: options.ttlMs })
      return true
    },
    incr: async (key: string, options: { ttlMs: number; by?: number }) => {
      if (spec.incr) return spec.incr(key, options)
      const step = options.by ?? 1
      const current = Number((await spec.get<number>(key)) ?? 0)
      const next = (Number.isFinite(current) ? current : 0) + step
      await spec.set(key, next, { ttlMs: options.ttlMs })
      return next
    },
  }
}

/**
 * Лёгкий in-memory стор с TTL (для тестов и однопроцессного рантайма без `#lib/cache`).
 */
export function memoryStore(): AdaptedStorageStore {
  const entries = new Map<string, { value: unknown; expiresAt: number | null }>()

  function readLive(key: string): { value: unknown; expiresAt: number | null } | undefined {
    const rec = entries.get(key)
    if (!rec) return undefined
    if (rec.expiresAt !== null && rec.expiresAt <= Date.now()) {
      entries.delete(key)
      return undefined
    }
    return rec
  }

  return defineStorageStore({
    get<T = unknown>(key: string): T | undefined {
      return readLive(key)?.value as T | undefined
    },
    set<T = unknown>(key: string, value: T, options?: { ttlMs?: number }): void {
      const expiresAt =
        options?.ttlMs !== undefined && options.ttlMs > 0
          ? Date.now() + options.ttlMs
          : null
      entries.set(key, { value, expiresAt })
    },
    delete(key: string): void {
      entries.delete(key)
    },
    add<T = unknown>(key: string, value: T, options: { ttlMs: number }): boolean {
      if (readLive(key) !== undefined) return false
      entries.set(key, { value, expiresAt: Date.now() + options.ttlMs })
      return true
    },
    incr(key: string, options: { ttlMs: number; by?: number }): number {
      const step = options.by ?? 1
      const live = readLive(key)
      const next = (typeof live?.value === 'number' ? live.value : 0) + step
      const expiresAt = live?.expiresAt ?? Date.now() + options.ttlMs
      entries.set(key, { value: next, expiresAt })
      return next
    },
  })
}

/** Единообразная мягкая деградация при включённой опции без нужной зависимости. */
export function reportDegradedOption(optionName: string, missingRequirement: string): void {
  console.error(
    `[storage] опция «${optionName}» проигнорирована: не передан ${missingRequirement}`,
  )
}
