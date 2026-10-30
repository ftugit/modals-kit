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
  /** Метка времени (мс), когда драйвер сервера вернул `null` (`404`) при чтении этой части. */
  readonly missingAt?: number
}

/** Клонированная серверная реплика логического файла (одиночная либо нарезанная на части). */
export interface StoredReplica {
  readonly server: string
  readonly path: string
  readonly storedBytes: number
  readonly encrypted: boolean
  readonly etag?: string
  readonly createdAt?: number
  readonly parts?: readonly StoredPart[]
  /** Метка времени (мс), когда реплика на этом сервере оказалась отсутствующей (`404`). */
  readonly missingAt?: number
}

export type StoredFileStatus = 'ok' | 'degraded' | 'missing' | 'deleted'

/** Запись логического файла в реестре хранилища. */
export interface StoredFileRecord {
  readonly path: string
  readonly name: string
  readonly size: number
  readonly storedBytes: number
  readonly type: string
  readonly lastModified: number
  readonly createdAt: number
  /** Опциональный `SHA-256` открытых байтов (считается и сравнивается только при включённом `hash: true`). */
  readonly hash?: string
  /** Серверные клоны этого файла (позволяют читать без `N+1` запросов к `@replica:…`). */
  readonly replicas?: readonly StoredReplica[]
  /** Статус доступности файла (`'ok'` по умолчанию; `'missing'` при потере всех копий). */
  readonly status?: StoredFileStatus
  /** Метка времени (мс) последней фоновой проверки целостности `reconcile`. */
  readonly checkedAt?: number
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

  /** Найти живую запись с включённым `hash`, совпадающую по `hash` (и `size`, если передан). */
  findByHash?(
    hash: string,
    size?: number,
  ): StoredFileRecord | null | Promise<StoredFileRecord | null>

  /** Вернуть только те физические части `parts`, на которые в реестре не ссылается ни одна оставшаяся запись. */
  filterUnreferencedParts?(
    parts: readonly StoredPart[],
    excludePath?: string,
  ): readonly StoredPart[] | Promise<readonly StoredPart[]>

  /** Атомарно обновить метаданные существующей записи файла (реплики, `missingAt`, `status`, `checkedAt`). */
  patchFile?(
    path: string,
    updater: (current: StoredFileRecord) => StoredFileRecord | null,
  ): StoredFileRecord | null | Promise<StoredFileRecord | null>

  /** Выбрать записи с пропавшими частями/репликами (`missingAt != null` или `status === 'missing'`). */
  listMissingFiles?(options?: {
    readonly limit?: number
    readonly servers?: readonly string[]
  }): readonly StoredFileRecord[] | Promise<readonly StoredFileRecord[]>
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
  findByHash(hash: string, size?: number): Promise<StoredFileRecord | null>
  filterUnreferencedParts(
    parts: readonly StoredPart[],
    excludePath?: string,
  ): Promise<readonly StoredPart[]>
  patchFile(
    path: string,
    updater: (current: StoredFileRecord) => StoredFileRecord | null,
  ): Promise<StoredFileRecord | null>
  listMissingFiles(options?: {
    readonly limit?: number
    readonly servers?: readonly string[]
  }): Promise<readonly StoredFileRecord[]>
}

export interface PhysicalPartRef {
  readonly server: string
  readonly path: string
  readonly storedBytes: number
}

/** Все физические объекты (основные `parts` + `replicas`), принадлежащие одной записи реестра. */
export function collectRecordPhysicalParts(file: StoredFileRecord): readonly PhysicalPartRef[] {
  const out: PhysicalPartRef[] = []
  for (const part of file.parts) {
    out.push({ server: part.server, path: part.path, storedBytes: part.storedBytes })
  }
  if (file.replicas) {
    for (const rep of file.replicas) {
      if (rep.parts && rep.parts.length > 0) {
        for (const rp of rep.parts) {
          out.push({ server: rp.server, path: rp.path, storedBytes: rp.storedBytes })
        }
      } else {
        out.push({ server: rep.server, path: rep.path, storedBytes: rep.storedBytes })
      }
    }
  }
  return out
}

/** Проверить, есть ли в записи хотя бы одна пропавшая физическая часть или реплика. */
export function recordHasMissingLocations(
  file: StoredFileRecord,
  serverFilter?: ReadonlySet<string>,
): boolean {
  if (!serverFilter && file.status === 'missing') return true
  for (const p of file.parts) {
    if (p.missingAt !== undefined && (!serverFilter || serverFilter.has(p.server))) {
      return true
    }
  }
  if (file.replicas) {
    for (const r of file.replicas) {
      if (r.missingAt !== undefined && (!serverFilter || serverFilter.has(r.server))) {
        return true
      }
      if (r.parts) {
        for (const rp of r.parts) {
          if (rp.missingAt !== undefined && (!serverFilter || serverFilter.has(rp.server))) {
            return true
          }
        }
      }
    }
  }
  return false
}

/** Вычислить статус логического файла по здоровью его основных частей и реплик. */
export function computeRecordHealthStatus(file: StoredFileRecord): StoredFileStatus {
  if (file.status === 'deleted') return 'deleted'
  const primaryOk =
    file.parts.length > 0 && file.parts.every((p) => p.missingAt === undefined)
  const allReplicasOk =
    !file.replicas ||
    file.replicas.every(
      (r) =>
        r.missingAt === undefined &&
        (!r.parts || r.parts.every((rp) => rp.missingAt === undefined)),
    )
  if (primaryOk && allReplicasOk) return 'ok'
  const anyReplicaOk = Boolean(
    file.replicas?.some(
      (r) =>
        r.missingAt === undefined &&
        (!r.parts || r.parts.every((rp) => rp.missingAt === undefined)),
    ),
  )
  return primaryOk || anyReplicaOk ? 'degraded' : 'missing'
}

async function scanAllEntries(
  spec: StorageLedgerSpec,
): Promise<readonly StoredFileRecord[]> {
  const all: StoredFileRecord[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await spec.listFiles({
      limit: 500,
      ...(cursor !== undefined ? { cursor } : {}),
    })
    all.push(...page.entries)
    if (!page.cursor || page.entries.length === 0) break
    cursor = page.cursor
  }
  return all
}

/** Обернуть пользовательскую спецификацию `StorageLedgerSpec` в единый контракт `AdaptedStorageLedger`. */
export function defineStorageLedger(spec: StorageLedgerSpec): AdaptedStorageLedger {
  let fallbackPatchSeq = 0

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

    findByHash: async (hash, size) => {
      if (spec.findByHash) return spec.findByHash(hash, size)
      const all = await scanAllEntries(spec)
      for (const rec of all) {
        if (
          rec.hash === hash &&
          (size === undefined || rec.size === size) &&
          rec.status !== 'missing' &&
          rec.status !== 'deleted' &&
          rec.parts.length > 0 &&
          rec.parts.every((p) => p.missingAt === undefined)
        ) {
          return rec
        }
      }
      return null
    },

    filterUnreferencedParts: async (parts, excludePath) => {
      if (parts.length === 0) return []
      if (spec.filterUnreferencedParts) {
        return spec.filterUnreferencedParts(parts, excludePath)
      }
      const all = await scanAllEntries(spec)
      const referenced = new Set<string>()
      for (const rec of all) {
        if (excludePath !== undefined && rec.path === excludePath) continue
        for (const obj of collectRecordPhysicalParts(rec)) {
          referenced.add(`${obj.server}\0${obj.path}`)
        }
      }
      return parts.filter((p) => !referenced.has(`${p.server}\0${p.path}`))
    },

    patchFile: async (path, updater) => {
      if (spec.patchFile) return spec.patchFile(path, updater)
      const cur = await spec.getFile(path)
      if (!cur) return null
      const next = updater(cur)
      if (!next) return null
      fallbackPatchSeq = (fallbackPatchSeq + 1) % 1_000_000_000
      const resvId = `patch-${Date.now().toString(36)}-${fallbackPatchSeq.toString(36)}`
      await spec.reserve({ id: resvId, allocations: [], ttlMs: 30_000 })
      await spec.commit({ reservationId: resvId, file: next })
      return next
    },

    listMissingFiles: async (options) => {
      if (spec.listMissingFiles) return spec.listMissingFiles(options)
      const serverFilter =
        options?.servers && options.servers.length > 0
          ? new Set(options.servers)
          : undefined
      const all = await scanAllEntries(spec)
      const matched = all
        .filter((rec) => recordHasMissingLocations(rec, serverFilter))
        .sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0))
      const limit =
        options?.limit !== undefined && options.limit > 0
          ? Math.floor(options.limit)
          : matched.length
      return matched.slice(0, limit)
    },
  }
}

export interface LedgerStateData {
  files: Record<string, StoredFileRecord>
  reservations: Record<string, LedgerReservation>
}

/**
 * Вычислить точный снимок занятого и зарезервированного места по серверам из состояния реестра.
 * Физические объекты дедуплицируются по ключу `(server, path)` (общие дедуплицированные части не
 * списывают квоту дважды), а реплики `replicas` учитываются на своих целевых серверах.
 */
export function computeLedgerUsage(
  state: LedgerStateData,
  servers: readonly string[],
  now = Date.now(),
): Record<string, ServerUsageSnapshot> {
  const out: Record<
    string,
    {
      usedBytes: number
      reservedBytes: number
      files: Set<string>
      seenPhysical: Set<string>
      partsCount: number
    }
  > = {}
  const ensure = (srv: string) => {
    let slot = out[srv]
    if (!slot) {
      slot = {
        usedBytes: 0,
        reservedBytes: 0,
        files: new Set(),
        seenPhysical: new Set(),
        partsCount: 0,
      }
      out[srv] = slot
    }
    return slot
  }
  for (const srv of servers) ensure(srv)

  for (const file of Object.values(state.files)) {
    const logicalKey = file.path.startsWith('@replica:')
      ? file.path.replace(/^@replica:[^:]+:/, '')
      : file.path
    for (const obj of collectRecordPhysicalParts(file)) {
      const slot = ensure(obj.server)
      slot.files.add(logicalKey)
      if (!slot.seenPhysical.has(obj.path)) {
        slot.seenPhysical.add(obj.path)
        slot.usedBytes += obj.storedBytes
        slot.partsCount += 1
      }
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

/** Найти в `LedgerStateData` живую запись по `hash` (и `size`, если передан). */
export function findByHashInState(
  state: LedgerStateData,
  hash: string,
  size?: number,
): StoredFileRecord | null {
  for (const [key, rec] of Object.entries(state.files)) {
    if (key.startsWith('@replica:')) continue
    if (
      rec.hash === hash &&
      (size === undefined || rec.size === size) &&
      rec.status !== 'missing' &&
      rec.status !== 'deleted' &&
      rec.parts.length > 0 &&
      rec.parts.every((p) => p.missingAt === undefined)
    ) {
      return rec
    }
  }
  return null
}

/** Отфильтровать только осиротевшие физические части, на которые больше никто не ссылается в `state`. */
export function filterUnreferencedPartsInState(
  state: LedgerStateData,
  parts: readonly StoredPart[],
  excludePath?: string,
): readonly StoredPart[] {
  if (parts.length === 0) return []
  const referenced = new Set<string>()
  for (const [key, rec] of Object.entries(state.files)) {
    if (excludePath !== undefined && (key === excludePath || rec.path === excludePath)) continue
    for (const obj of collectRecordPhysicalParts(rec)) {
      referenced.add(`${obj.server}\0${obj.path}`)
    }
  }
  // Также дедуплицируем сам выходной список по `(server, path)`
  const seenOut = new Set<string>()
  const out: StoredPart[] = []
  for (const p of parts) {
    const id = `${p.server}\0${p.path}`
    if (!referenced.has(id) && !seenOut.has(id)) {
      seenOut.add(id)
      out.push(p)
    }
  }
  return out
}

/** Выбрать записи с пропавшими частями/репликами из `LedgerStateData` (по давности `checkedAt`). */
export function listMissingFilesInState(
  state: LedgerStateData,
  options?: { readonly limit?: number; readonly servers?: readonly string[] },
): readonly StoredFileRecord[] {
  const serverFilter =
    options?.servers && options.servers.length > 0 ? new Set(options.servers) : undefined
  const matched: StoredFileRecord[] = []
  for (const [key, rec] of Object.entries(state.files)) {
    if (key.startsWith('@replica:')) continue
    if (recordHasMissingLocations(rec, serverFilter)) {
      matched.push(rec)
    }
  }
  matched.sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0))
  const limit =
    options?.limit !== undefined && options.limit > 0
      ? Math.floor(options.limit)
      : matched.length
  return matched.slice(0, limit)
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

    findByHash(hash, size) {
      return findByHashInState(state, hash, size)
    },

    filterUnreferencedParts(parts, excludePath) {
      return filterUnreferencedPartsInState(state, parts, excludePath)
    },

    patchFile(path, updater) {
      const cur = state.files[path]
      if (!cur) return null
      const next = updater(cur)
      if (!next) return null
      state.files[path] = next
      return next
    },

    listMissingFiles(options) {
      return listMissingFilesInState(state, options)
    },
  })
}
