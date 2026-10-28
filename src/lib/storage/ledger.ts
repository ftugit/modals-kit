// Контракт учёта места, атомарного резервирования и манифестов файлов (`defineStorageLedger`).
//
// 0 зависимостей от фреймворков, `node:fs`, `#lib/db` и `#lib/cache`: работает в любом JS-рантайме.

/** Одна физическая часть логического файла на конкретном сервере. */
export interface StoredPart {
  readonly index: number
  readonly server: string
  readonly path: string
  readonly plainBytes: number
  readonly storedBytes: number
  readonly encrypted: boolean
  readonly etag?: string
}

/** Запись логического файла в реестре хранилища. */
export interface StoredFileRecord {
  readonly path: string
  readonly name: string
  readonly size: number
  readonly storedBytes: number
  readonly type: string
  readonly lastModified: number
  readonly createdAt: number
  readonly parts: readonly StoredPart[]
}

/** Заявка на бронь места на одном сервере. */
export interface ServerAllocation {
  readonly server: string
  readonly bytes: number
  readonly maxStorageBytes: number
}

/** Активная бронь места на время потоковой загрузки/переноса. */
export interface LedgerReservation {
  readonly id: string
  readonly allocations: readonly ServerAllocation[]
  readonly expiresAt: number
}

/** Снимок занятого и зарезервированного места одного сервера. */
export interface ServerUsageSnapshot {
  readonly usedBytes: number
  readonly reservedBytes: number
  readonly filesCount: number
  readonly partsCount: number
}

/** Спецификация адаптера реестра учёта хранилища. */
export interface StorageLedgerSpec {
  reserve(input: {
    readonly id: string
    readonly allocations: readonly ServerAllocation[]
    readonly ttlMs: number
  }): LedgerReservation | null | Promise<LedgerReservation | null>

  commit(input: {
    readonly reservationId: string
    readonly file: StoredFileRecord
  }): { readonly replaced?: StoredFileRecord } | Promise<{ readonly replaced?: StoredFileRecord }>

  release(reservationId: string): void | Promise<void>

  sweepExpired?(now?: number): number | Promise<number>

  getFile(path: string): StoredFileRecord | null | Promise<StoredFileRecord | null>
  deleteFile(path: string): StoredFileRecord | null | Promise<StoredFileRecord | null>
  listFiles(options?: { prefix?: string; limit?: number; cursor?: string }):
    | { entries: readonly StoredFileRecord[]; cursor?: string }
    | Promise<{ entries: readonly StoredFileRecord[]; cursor?: string }>

  usage(
    servers: readonly string[],
  ): Record<string, ServerUsageSnapshot> | Promise<Record<string, ServerUsageSnapshot>>
}

/** Адаптированный экземпляр реестра учёта (всегда возвращает `Promise`-совместимые методы). */
export interface AdaptedStorageLedger {
  reserve(input: {
    readonly id: string
    readonly allocations: readonly ServerAllocation[]
    readonly ttlMs: number
  }): Promise<LedgerReservation | null>
  commit(input: {
    readonly reservationId: string
    readonly file: StoredFileRecord
  }): Promise<{ readonly replaced?: StoredFileRecord }>
  release(reservationId: string): Promise<void>
  sweepExpired(now?: number): Promise<number>
  getFile(path: string): Promise<StoredFileRecord | null>
  deleteFile(path: string): Promise<StoredFileRecord | null>
  listFiles(options?: {
    prefix?: string
    limit?: number
    cursor?: string
  }): Promise<{ entries: readonly StoredFileRecord[]; cursor?: string }>
  usage(servers: readonly string[]): Promise<Record<string, ServerUsageSnapshot>>
}

/** Обернуть пользовательскую спецификацию `StorageLedgerSpec` в единый контракт `AdaptedStorageLedger`. */
export function defineStorageLedger(spec: StorageLedgerSpec): AdaptedStorageLedger {
  return {
    reserve: async (input) => spec.reserve(input),
    commit: async (input) => spec.commit(input),
    release: async (id) => {
      await spec.release(id)
    },
    sweepExpired: async (now) => (spec.sweepExpired ? spec.sweepExpired(now) : 0),
    getFile: async (path) => spec.getFile(path),
    deleteFile: async (path) => spec.deleteFile(path),
    listFiles: async (opts) => spec.listFiles(opts),
    usage: async (servers) => spec.usage(servers),
  }
}

export interface LedgerStateData {
  files: Record<string, StoredFileRecord>
  reservations: Record<string, LedgerReservation>
}

/** Вычислить точный снимок занятого и зарезервированного места по серверам из состояния реестра. */
export function computeLedgerUsage(
  state: LedgerStateData,
  servers: readonly string[],
  now = Date.now(),
): Record<string, ServerUsageSnapshot> {
  const out: Record<
    string,
    { usedBytes: number; reservedBytes: number; files: Set<string>; partsCount: number }
  > = {}
  const ensure = (srv: string) => {
    let slot = out[srv]
    if (!slot) {
      slot = { usedBytes: 0, reservedBytes: 0, files: new Set(), partsCount: 0 }
      out[srv] = slot
    }
    return slot
  }
  for (const srv of servers) ensure(srv)

  for (const file of Object.values(state.files)) {
    for (const part of file.parts) {
      const slot = ensure(part.server)
      slot.usedBytes += part.storedBytes
      slot.partsCount += 1
      slot.files.add(file.path)
    }
  }

  for (const resv of Object.values(state.reservations)) {
    if (resv.expiresAt <= now) continue
    for (const alloc of resv.allocations) {
      ensure(alloc.server).reservedBytes += alloc.bytes
    }
  }

  const result: Record<string, ServerUsageSnapshot> = {}
  for (const [srv, slot] of Object.entries(out)) {
    result[srv] = {
      usedBytes: slot.usedBytes,
      reservedBytes: slot.reservedBytes,
      filesCount: slot.files.size,
      partsCount: slot.partsCount,
    }
  }
  return result
}

/** Применить шаг `sweepExpired` к мутируемому состоянию реестра. */
export function sweepExpiredInState(state: LedgerStateData, now = Date.now()): number {
  let removed = 0
  for (const [id, resv] of Object.entries(state.reservations)) {
    if (resv.expiresAt <= now) {
      delete state.reservations[id]
      removed += 1
    }
  }
  return removed
}

/**
 * Реестр учёта в памяти процесса (для юнит-тестов, dev-стендов и однопроцессных скриптов).
 * Все проверки `used + reserved + bytes <= maxStorageBytes` выполняются синхронно и атомарно.
 */
export function memoryLedger(nowFn: () => number = Date.now): AdaptedStorageLedger {
  const state: LedgerStateData = {
    files: {},
    reservations: {},
  }

  return defineStorageLedger({
    reserve({ id, allocations, ttlMs }) {
      const now = nowFn()
      sweepExpiredInState(state, now)
      if (state.reservations[id]) {
        return state.reservations[id]!
      }

      const snap = computeLedgerUsage(
        state,
        allocations.map((a) => a.server),
        now,
      )
      for (const alloc of allocations) {
        const cur = snap[alloc.server] ?? {
          usedBytes: 0,
          reservedBytes: 0,
          filesCount: 0,
          partsCount: 0,
        }
        if (cur.usedBytes + cur.reservedBytes + alloc.bytes > alloc.maxStorageBytes) {
          return null
        }
      }

      const created: LedgerReservation = {
        id,
        allocations: [...allocations],
        expiresAt: now + Math.max(1, ttlMs),
      }
      state.reservations[id] = created
      return created
    },

    commit({ reservationId, file }) {
      delete state.reservations[reservationId]
      const replaced = state.files[file.path]
      state.files[file.path] = file
      return replaced ? { replaced } : {}
    },

    release(reservationId) {
      delete state.reservations[reservationId]
    },

    sweepExpired(now = nowFn()) {
      return sweepExpiredInState(state, now)
    },

    getFile(path) {
      return state.files[path] ?? null
    },

    deleteFile(path) {
      const prev = state.files[path] ?? null
      if (prev) delete state.files[path]
      return prev
    },

    listFiles(options) {
      const prefix = options?.prefix ?? ''
      const sorted = Object.keys(state.files)
        .filter((k) => !k.startsWith('@replica:') && k.startsWith(prefix))
        .sort()
      const startIdx = options?.cursor ? Math.max(0, sorted.indexOf(options.cursor) + 1) : 0
      const limit = options?.limit ?? sorted.length
      const sliceKeys = sorted.slice(startIdx, startIdx + limit)
      const entries = sliceKeys.map((k) => state.files[k]!)
      const nextCursor =
        startIdx + limit < sorted.length ? sliceKeys[sliceKeys.length - 1] : undefined
      return { entries, ...(nextCursor ? { cursor: nextCursor } : {}) }
    },

    usage(servers) {
      const now = nowFn()
      sweepExpiredInState(state, now)
      return computeLedgerUsage(state, servers, now)
    },
  })
}
