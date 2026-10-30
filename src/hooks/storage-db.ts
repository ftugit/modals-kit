// Переходник между `#lib/storage`, базой `#lib/db` и кэшем `#lib/cache`.
//
// Как и `src/hooks/cache-db.ts`, живёт в `src/hooks`, а не внутри одной из
// библиотек: `#lib/storage` остаётся полностью независимым пакетом (`0`
// импортов `#lib/db` и `#lib/cache`), а приложение при необходимости
// подключает к `createStorage` реестр учёта и квот в PostgreSQL
// (`pgStorageLedger`) и общий кэш метаданных / конкурентных слотов
// (`cacheStorageStore` поверх `localStore` или `sharedStore = pgStore(db)`).
//
// Таблицы описаны моделями `#lib/db` (`storageFile`, `storageReservation`):
// `src/server/db.server.ts` регистрирует их в схеме БД, и `sync` разворачивает
// их при открытии соединения на любом движке (PGlite, `pg`, Hyperdrive).
// Срок жизни броней (`expires_at`) считается часами базы (`clock_timestamp()`).

import { isAtomic, type Store } from '#lib/cache/index.js'
import { defineResource, f, policy, type Database } from '#lib/db/index.js'
import { STORAGE_ACL, storageServer } from './storage-schema.js'
import {
  defineStorageLedger,
  defineStorageStore,
  type AdaptedStorageLedger,
  type AdaptedStorageStore,
  type LedgerReservation,
  type ServerAllocation,
  type ServerUsageSnapshot,
  type StoredFileRecord,
} from '#lib/storage/index.js'

/**
 * Таблица логических файлов реестра `storage`.
 * Естественный ключ — пара `(scope, path)`; `record` хранит канонический
 * `StoredFileRecord` со списком физических частей `parts` в `jsonb`.
 */
export const storageFile = defineResource({
  key: 'storage.file.v1',
  table: 'public.storage_file',
  primaryKey: 'id',
  fields: {
    id: f.uuid({
      read: () => true,
      immutable: true,
      orderable: true,
      filters: ['eq'],
      db: { default: 'gen_random_uuid()' },
    }),
    scope: f.text({ read: () => true, create: () => true, required: true, filters: ['eq'] }),
    path: f.text({
      read: () => true,
      create: () => true,
      required: true,
      orderable: true,
      filters: ['eq', 'gt', 'startsWith'],
    }),
    hash: f.text({
      read: () => true,
      create: () => true,
      update: () => true,
      nullable: true,
      filters: ['eq'],
    }),
    record: f.json({ read: () => true, create: () => true, update: () => true, required: true }),
  },
  policy: {
    select: policy.roles(['server']),
    insert: policy.roles(['server']),
    update: policy.roles(['server']),
    delete: policy.roles(['server']),
  },
  order: [['id', 'asc']],
  db: {
    unique: [['scope', 'path']],
    indexes: [
      ['scope', 'path'],
      ['scope', 'hash'],
    ],
  },
})

/**
 * Таблица активных броней места на время потоковой загрузки или переноса.
 * Естественный ключ — `(scope, reservation_id)`; `expires_at` сравнивается
 * с часами базы (`clock_timestamp()`).
 */
export const storageReservation = defineResource({
  key: 'storage.reservation.v1',
  table: 'public.storage_reservation',
  primaryKey: 'id',
  fields: {
    id: f.uuid({
      read: () => true,
      immutable: true,
      orderable: true,
      filters: ['eq'],
      db: { default: 'gen_random_uuid()' },
    }),
    scope: f.text({ read: () => true, create: () => true, required: true, filters: ['eq'] }),
    reservation_id: f.text({
      read: () => true,
      create: () => true,
      required: true,
      filters: ['eq'],
    }),
    allocations: f.json({
      read: () => true,
      create: () => true,
      update: () => true,
      required: true,
    }),
    expires_at: f.timestamp({
      read: () => true,
      create: () => true,
      update: () => true,
      required: true,
    }),
  },
  policy: {
    select: policy.roles(['server']),
    insert: policy.roles(['server']),
    update: policy.roles(['server']),
    delete: policy.roles(['server']),
  },
  order: [['id', 'asc']],
  db: { unique: [['scope', 'reservation_id']], indexes: [['expires_at'], ['scope']] },
})

export { STORAGE_ACL, storageServer }

/** Удобный кортеж ресурсов для регистрации в `defineSchema({ resources: [...storageResources] })`. */
export const storageResources = [storageFile, storageReservation, storageServer] as const

export interface PgStorageLedgerOptions {
  /** Пространство имён в таблицах `storage_file` / `storage_reservation` (по умолчанию `''`). */
  readonly scope?: string
  /** Интервал оппортунистической уборки протухших броней, мс (по умолчанию `60_000`). */
  readonly sweepIntervalMs?: number
}

export interface CacheStorageStoreOptions {
  /** Подобласть ключей в `#lib/cache` (по умолчанию `'storage'`). */
  readonly scope?: string
}

const DEFAULT_SWEEP_MS = 60_000

const ident = (p: string) => `"${p.replaceAll('"', '""')}"`

const FILE_TABLE = storageFile.table.split('.').map(ident).join('.')
const fileCol = (name: string) =>
  ident((storageFile.fields as Record<string, { column?: string }>)[name]?.column ?? name)
const F_SCOPE = fileCol('scope')
const F_PATH = fileCol('path')
const F_HASH = fileCol('hash')
const F_REC = fileCol('record')

const RESV_TABLE = storageReservation.table.split('.').map(ident).join('.')
const resvCol = (name: string) =>
  ident((storageReservation.fields as Record<string, { column?: string }>)[name]?.column ?? name)
const R_ID = resvCol('id')
const R_SCOPE = resvCol('scope')
const R_RES_ID = resvCol('reservation_id')
const R_ALLOCS = resvCol('allocations')
const R_EXP = resvCol('expires_at')

const RESV_LIVE = `${R_EXP} > clock_timestamp()`
const RESV_DEAD = `${R_EXP} <= clock_timestamp()`

function toEpochMs(pgTimestamp: string | Date | number): number {
  if (typeof pgTimestamp === 'number') return pgTimestamp
  if (pgTimestamp instanceof Date) return pgTimestamp.getTime()
  return new Date(pgTimestamp).getTime()
}

/**
 * Реестр учёта места и манифестов `#lib/storage` поверх PostgreSQL (`#lib/db`).
 *
 * Все операции сериализуются на уровне инстанса и опираются на часы БД
 * (`clock_timestamp()`), не требуя интерактивных мультиоператорных транзакций
 * (совместимо с PGlite, пулом `pg` и transaction-pooling Hyperdrive).
 */
export function pgStorageLedger(
  db: Database,
  options: PgStorageLedgerOptions = {},
): AdaptedStorageLedger {
  const scope = options.scope ?? ''
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_MS
  let sweptAt = 0

  // Последовательная очередь в рамках процесса + транзакционная advisory-блокировка PostgreSQL
  // (`pg_advisory_xact_lock`, когда драйвер поддерживает транзакции) исключают гонки квот как
  // внутри одного процесса, так и между несколькими инстансами приложения в `READ COMMITTED`.
  let queue: Promise<unknown> = Promise.resolve()
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  function withScopeLock<T>(
    fn: (runner: Pick<Database, 'query'>) => Promise<T>,
  ): Promise<T> {
    return serialize(async () => {
      if (db.driver.capabilities.transactions) {
        return db.transaction(async (tx) => {
          await tx.query({
            text: `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
            values: ['modals_kit_storage_ledger', scope],
          })
          return fn(tx)
        })
      }
      return fn(db)
    })
  }

  async function sweepOpportunistic(runner: Pick<Database, 'query'> = db): Promise<void> {
    const now = Date.now()
    if (now - sweptAt < sweepIntervalMs) return
    sweptAt = now
    try {
      await runner.query({
        text: `DELETE FROM ${RESV_TABLE} WHERE ${R_SCOPE} = $1 AND ${RESV_DEAD}`,
        values: [scope],
      })
    } catch (err) {
      console.error('[storage] pgStorageLedger: вычистка просроченных броней не удалась', err)
    }
  }

  async function computeUsageRaw(
    servers: readonly string[],
  ): Promise<Record<string, ServerUsageSnapshot>> {
    const out: Record<string, ServerUsageSnapshot> = {}
    for (const s of servers) {
      out[s] = {
        usedBytes: 0,
        reservedBytes: 0,
        filesCount: 0,
        partsCount: 0,
      }
    }

    const fileStats = await db.query<{
      server: string
      used_bytes: string | number
      files_count: number
      parts_count: number
    }>({
      text: `WITH raw_locs AS (
               SELECT
                 f.${F_PATH} AS logical_path,
                 p->>'server' AS server,
                 p->>'path' AS phys_path,
                 COALESCE((p->>'storedBytes')::bigint, 0) AS stored_bytes
               FROM ${FILE_TABLE} f,
                    jsonb_array_elements(f.${F_REC}->'parts') AS p
               WHERE f.${F_SCOPE} = $1
               UNION ALL
               SELECT
                 f.${F_PATH} AS logical_path,
                 r->>'server' AS server,
                 r->>'path' AS phys_path,
                 COALESCE((r->>'storedBytes')::bigint, 0) AS stored_bytes
               FROM ${FILE_TABLE} f,
                    jsonb_array_elements(COALESCE(f.${F_REC}->'replicas', '[]'::jsonb)) AS r
               WHERE f.${F_SCOPE} = $1
             ),
             dedup_phys AS (
               SELECT server, phys_path, MAX(stored_bytes) AS stored_bytes
               FROM raw_locs
               GROUP BY server, phys_path
             ),
             file_counts AS (
               SELECT server, COUNT(DISTINCT logical_path)::int AS files_count
               FROM raw_locs
               WHERE NOT starts_with(logical_path, '@replica:')
               GROUP BY server
             )
             SELECT
               dp.server AS server,
               COALESCE(SUM(dp.stored_bytes), 0)::text AS used_bytes,
               COALESCE(fc.files_count, 0)::int AS files_count,
               COUNT(*)::int AS parts_count
             FROM dedup_phys dp
             LEFT JOIN file_counts fc ON fc.server = dp.server
             GROUP BY dp.server, fc.files_count`,
      values: [scope],
    })

    for (const row of fileStats.rows) {
      const prev = out[row.server]
      out[row.server] = {
        usedBytes: Number(row.used_bytes),
        reservedBytes: prev?.reservedBytes ?? 0,
        filesCount: Number(row.files_count),
        partsCount: Number(row.parts_count),
      }
    }

    const resvStats = await db.query<{
      server: string
      reserved_bytes: string | number
    }>({
      text: `SELECT
               a->>'server' AS server,
               COALESCE(SUM((a->>'bytes')::bigint), 0)::text AS reserved_bytes
             FROM ${RESV_TABLE} r,
                  jsonb_array_elements(r.${R_ALLOCS}) AS a
             WHERE r.${R_SCOPE} = $1 AND r.${RESV_LIVE}
             GROUP BY a->>'server'`,
      values: [scope],
    })

    for (const row of resvStats.rows) {
      const prev = out[row.server]
      out[row.server] = {
        usedBytes: prev?.usedBytes ?? 0,
        reservedBytes: Number(row.reserved_bytes),
        filesCount: prev?.filesCount ?? 0,
        partsCount: prev?.partsCount ?? 0,
      }
    }

    return out
  }

  return defineStorageLedger({
    reserve({ id, allocations, ttlMs }) {
      return withScopeLock(async (runner): Promise<LedgerReservation | null> => {
        if (!(ttlMs > 0) && ttlMs !== Infinity) {
          throw new RangeError(
            `[storage] ttlMs брони должен быть положительным числом мс, получено ${String(ttlMs)}`,
          )
        }
        const safeTtlMs = Number.isFinite(ttlMs) ? Math.max(1, ttlMs) : 365 * 24 * 60 * 60 * 1000

        // Идемпотентный возврат уже активной брони с тем же id
        const existing = await runner.query<{
          allocations: readonly ServerAllocation[]
          expires_at: string | Date
        }>({
          text: `SELECT ${R_ALLOCS} AS allocations, ${R_EXP} AS expires_at
                 FROM ${RESV_TABLE}
                 WHERE ${R_SCOPE} = $1 AND ${R_RES_ID} = $2 AND ${RESV_LIVE}`,
          values: [scope, id],
        })
        if (existing.rows[0]) {
          return {
            id,
            allocations: existing.rows[0].allocations,
            expiresAt: toEpochMs(existing.rows[0].expires_at),
          }
        }

        // Удаляем истёкшую запись с тем же id (если была) и просроченные брони перед проверкой остатка
        await runner.query({
          text: `DELETE FROM ${RESV_TABLE} WHERE ${R_SCOPE} = $1 AND (${RESV_DEAD} OR ${R_RES_ID} = $2)`,
          values: [scope, id],
        })
        sweptAt = Date.now()

        // Агрегируем суммарный запрос по каждому серверу (на случай нескольких частей на одном сервере)
        const perServer = new Map<string, { bytes: number; maxStorageBytes: number }>()
        for (const alloc of allocations) {
          const prev = perServer.get(alloc.server)
          if (prev) {
            prev.bytes += alloc.bytes
            prev.maxStorageBytes = Math.min(prev.maxStorageBytes, alloc.maxStorageBytes)
          } else {
            perServer.set(alloc.server, {
              bytes: alloc.bytes,
              maxStorageBytes: alloc.maxStorageBytes,
            })
          }
        }

        const allocJson = JSON.stringify(allocations)

        // Одиночный атомарный оператор: проверяет (used + live_reserved + req <= maxStorageBytes)
        // по ВСЕМ запрошенным серверам сразу на часах базы `clock_timestamp()` и вставляет бронь
        // только при `bool_and(...) = true`.
        const inserted = await runner.query<{ expires_at: string | Date }>({
          text: `WITH req AS (
                   SELECT
                     a->>'server' AS server,
                     SUM((a->>'bytes')::bigint) AS req_bytes,
                     MIN((a->>'maxStorageBytes')::bigint) AS max_bytes
                   FROM jsonb_array_elements($3::jsonb) AS a
                   GROUP BY a->>'server'
                 ),
                 raw_locs AS (
                   SELECT
                     p->>'server' AS server,
                     p->>'path' AS phys_path,
                     COALESCE((p->>'storedBytes')::bigint, 0) AS stored_bytes
                   FROM ${FILE_TABLE} f,
                        jsonb_array_elements(f.${F_REC}->'parts') AS p
                   WHERE f.${F_SCOPE} = $1
                   UNION ALL
                   SELECT
                     rp->>'server' AS server,
                     rp->>'path' AS phys_path,
                     COALESCE((rp->>'storedBytes')::bigint, 0) AS stored_bytes
                   FROM ${FILE_TABLE} f,
                        jsonb_array_elements(COALESCE(f.${F_REC}->'replicas', '[]'::jsonb)) AS rp
                   WHERE f.${F_SCOPE} = $1
                 ),
                 dedup_phys AS (
                   SELECT server, phys_path, MAX(stored_bytes) AS stored_bytes
                   FROM raw_locs
                   GROUP BY server, phys_path
                 ),
                 used AS (
                   SELECT
                     server,
                     COALESCE(SUM(stored_bytes), 0) AS used_bytes
                   FROM dedup_phys
                   GROUP BY server
                 ),
                 resv AS (
                   SELECT
                     ra->>'server' AS server,
                     COALESCE(SUM((ra->>'bytes')::bigint), 0) AS reserved_bytes
                   FROM ${RESV_TABLE} r,
                        jsonb_array_elements(r.${R_ALLOCS}) AS ra
                   WHERE r.${R_SCOPE} = $1 AND r.${RESV_LIVE}
                   GROUP BY ra->>'server'
                 ),
                 verdict AS (
                   SELECT COALESCE(
                     bool_and(
                       COALESCE(u.used_bytes, 0) + COALESCE(rv.reserved_bytes, 0) + req.req_bytes <= req.max_bytes
                     ),
                     true
                   ) AS ok
                   FROM req
                   LEFT JOIN used u ON u.server = req.server
                   LEFT JOIN resv rv ON rv.server = req.server
                 )
                 INSERT INTO ${RESV_TABLE} (${R_SCOPE}, ${R_RES_ID}, ${R_ALLOCS}, ${R_EXP})
                 SELECT
                   $1,
                   $2,
                   $3::jsonb,
                   clock_timestamp() + ($4::double precision * interval '1 millisecond')
                 FROM verdict
                 WHERE verdict.ok = true
                 ON CONFLICT (${R_SCOPE}, ${R_RES_ID}) DO NOTHING
                 RETURNING ${R_EXP} AS expires_at`,
          values: [scope, id, allocJson, safeTtlMs],
        })

        const row = inserted.rows[0]
        if (!row) return null

        // Подстраховочная сверка для случая 0-элементного allocations
        if (perServer.size === 0) {
          return {
            id,
            allocations: [],
            expiresAt: toEpochMs(row.expires_at),
          }
        }

        return {
          id,
          allocations: [...allocations],
          expiresAt: toEpochMs(row.expires_at),
        }
      })
    },

    commit({ reservationId, file }) {
      return withScopeLock(async (runner): Promise<{ readonly replaced?: StoredFileRecord }> => {
        const result = await runner.query<{ prev_record: StoredFileRecord | null }>({
          text: `WITH del_resv AS (
                   DELETE FROM ${RESV_TABLE}
                   WHERE ${R_SCOPE} = $1 AND ${R_RES_ID} = $2
                 ),
                 prev AS (
                   SELECT ${F_REC} AS record
                   FROM ${FILE_TABLE}
                   WHERE ${F_SCOPE} = $1 AND ${F_PATH} = $3
                 ),
                 upserted AS (
                   INSERT INTO ${FILE_TABLE} (${F_SCOPE}, ${F_PATH}, ${F_HASH}, ${F_REC})
                   VALUES ($1, $3, $5, $4::jsonb)
                   ON CONFLICT (${F_SCOPE}, ${F_PATH}) DO UPDATE
                     SET ${F_HASH} = EXCLUDED.${F_HASH},
                         ${F_REC} = EXCLUDED.${F_REC}
                   RETURNING 1
                 )
                 SELECT (SELECT record FROM prev) AS prev_record FROM upserted`,
          values: [scope, reservationId, file.path, JSON.stringify(file), file.hash ?? null],
        })

        await sweepOpportunistic(runner)
        const replaced = result.rows[0]?.prev_record ?? undefined
        return replaced ? { replaced } : {}
      })
    },

    release(reservationId) {
      return withScopeLock(async (runner): Promise<void> => {
        await runner.query({
          text: `DELETE FROM ${RESV_TABLE} WHERE ${R_SCOPE} = $1 AND ${R_RES_ID} = $2`,
          values: [scope, reservationId],
        })
      })
    },

    sweepExpired(now) {
      return withScopeLock(async (runner): Promise<number> => {
        const res =
          now === undefined
            ? await runner.query<{ id: string }>({
                text: `DELETE FROM ${RESV_TABLE}
                       WHERE ${R_SCOPE} = $1 AND ${RESV_DEAD}
                       RETURNING ${R_ID} AS id`,
                values: [scope],
              })
            : await runner.query<{ id: string }>({
                text: `DELETE FROM ${RESV_TABLE}
                       WHERE ${R_SCOPE} = $1
                         AND ${R_EXP} <= to_timestamp($2::double precision / 1000.0)
                       RETURNING ${R_ID} AS id`,
                values: [scope, now],
              })
        sweptAt = Date.now()
        return res.rows.length
      })
    },

    async getFile(path) {
      const res = await db.query<{ record: StoredFileRecord }>({
        text: `SELECT ${F_REC} AS record
               FROM ${FILE_TABLE}
               WHERE ${F_SCOPE} = $1 AND ${F_PATH} = $2`,
        values: [scope, path],
      })
      return res.rows[0]?.record ?? null
    },

    deleteFile(path) {
      return withScopeLock(async (runner): Promise<StoredFileRecord | null> => {
        const res = await runner.query<{ record: StoredFileRecord }>({
          text: `DELETE FROM ${FILE_TABLE}
                 WHERE ${F_SCOPE} = $1 AND ${F_PATH} = $2
                 RETURNING ${F_REC} AS record`,
          values: [scope, path],
        })
        return res.rows[0]?.record ?? null
      })
    },

    async listFiles(listOptions) {
      const prefix = listOptions?.prefix ?? ''
      const cursor = listOptions?.cursor ?? null
      const limit =
        listOptions?.limit !== undefined && listOptions.limit > 0
          ? Math.floor(listOptions.limit)
          : null

      if (limit !== null) {
        const res = await db.query<{ path: string; record: StoredFileRecord }>({
          text: `SELECT ${F_PATH} AS path, ${F_REC} AS record
                 FROM ${FILE_TABLE}
                 WHERE ${F_SCOPE} = $1
                   AND NOT starts_with(${F_PATH}, '@replica:')
                   AND ($2::text = '' OR starts_with(${F_PATH}, $2))
                   AND ($3::text IS NULL OR ${F_PATH} > $3)
                 ORDER BY ${F_PATH} ASC
                 LIMIT $4`,
          values: [scope, prefix, cursor, limit + 1],
        })
        const hasMore = res.rows.length > limit
        const slice = hasMore ? res.rows.slice(0, limit) : res.rows
        const entries = slice.map((r) => r.record)
        const nextCursor = hasMore ? slice[slice.length - 1]?.path : undefined
        return {
          entries,
          ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
        }
      }

      const res = await db.query<{ record: StoredFileRecord }>({
        text: `SELECT ${F_REC} AS record
               FROM ${FILE_TABLE}
               WHERE ${F_SCOPE} = $1
                 AND NOT starts_with(${F_PATH}, '@replica:')
                 AND ($2::text = '' OR starts_with(${F_PATH}, $2))
                 AND ($3::text IS NULL OR ${F_PATH} > $3)
               ORDER BY ${F_PATH} ASC`,
        values: [scope, prefix, cursor],
      })
      return { entries: res.rows.map((r) => r.record) }
    },

    usage(servers) {
      return serialize(async () => {
        await db.query({
          text: `DELETE FROM ${RESV_TABLE} WHERE ${R_SCOPE} = $1 AND ${RESV_DEAD}`,
          values: [scope],
        })
        sweptAt = Date.now()
        return computeUsageRaw(servers)
      })
    },

    async findByHash(hash, size) {
      const normalized = hash.trim().toLowerCase()
      if (!normalized) return null
      const res = await db.query<{ record: StoredFileRecord }>({
        text: `SELECT ${F_REC} AS record
               FROM ${FILE_TABLE}
               WHERE ${F_SCOPE} = $1
                 AND ${F_HASH} = $2
                 AND NOT starts_with(${F_PATH}, '@replica:')
                 AND ($3::bigint IS NULL OR (${F_REC}->>'size')::bigint = $3)
               ORDER BY ${F_PATH} ASC`,
        values: [scope, normalized, size ?? null],
      })
      for (const row of res.rows) {
        const rec = row.record
        if (rec.status === 'missing') continue
        if (rec.parts.some((p) => p.missingAt !== undefined)) continue
        return rec
      }
      return null
    },

    async filterUnreferencedParts(parts, excludePath) {
      if (parts.length === 0) return []
      const res = await db.query<{ server: string; phys_path: string }>({
        text: `WITH candidates AS (
                 SELECT DISTINCT (c->>'server') AS server, (c->>'path') AS phys_path
                 FROM jsonb_array_elements($3::jsonb) AS c
               ),
               live_locs AS (
                 SELECT p->>'server' AS server, p->>'path' AS phys_path
                 FROM ${FILE_TABLE} f,
                      jsonb_array_elements(f.${F_REC}->'parts') AS p
                 WHERE f.${F_SCOPE} = $1 AND ($2::text IS NULL OR f.${F_PATH} <> $2)
                 UNION
                 SELECT r->>'server' AS server, r->>'path' AS phys_path
                 FROM ${FILE_TABLE} f,
                      jsonb_array_elements(COALESCE(f.${F_REC}->'replicas', '[]'::jsonb)) AS r
                 WHERE f.${F_SCOPE} = $1 AND ($2::text IS NULL OR f.${F_PATH} <> $2)
               )
               SELECT c.server, c.phys_path
               FROM candidates c
               LEFT JOIN live_locs l ON l.server = c.server AND l.phys_path = c.phys_path
               WHERE l.server IS NULL`,
        values: [
          scope,
          excludePath ?? null,
          JSON.stringify(parts.map((p) => ({ server: p.server, path: p.path }))),
        ],
      })
      const unrefKeys = new Set(res.rows.map((r) => `${r.server}\0${r.phys_path}`))
      const seen = new Set<string>()
      return parts.filter((p) => {
        const k = `${p.server}\0${p.path}`
        if (!unrefKeys.has(k) || seen.has(k)) return false
        seen.add(k)
        return true
      })
    },

    patchFile(path, updater) {
      return withScopeLock(async (runner): Promise<StoredFileRecord | null> => {
        const curRes = await runner.query<{ record: StoredFileRecord }>({
          text: `SELECT ${F_REC} AS record
                 FROM ${FILE_TABLE}
                 WHERE ${F_SCOPE} = $1 AND ${F_PATH} = $2`,
          values: [scope, path],
        })
        const cur = curRes.rows[0]?.record
        if (!cur) return null
        const next = updater(cur)
        if (!next) return null
        await runner.query({
          text: `UPDATE ${FILE_TABLE}
                 SET ${F_HASH} = $3,
                     ${F_REC} = $4::jsonb
                 WHERE ${F_SCOPE} = $1 AND ${F_PATH} = $2`,
          values: [scope, path, next.hash ?? null, JSON.stringify(next)],
        })
        return next
      })
    },

    async listMissingFiles(missingOptions) {
      const limit =
        missingOptions?.limit !== undefined && missingOptions.limit > 0
          ? Math.floor(missingOptions.limit)
          : 100
      const filterSet =
        missingOptions?.servers && missingOptions.servers.length > 0
          ? new Set(missingOptions.servers)
          : null

      const res = await db.query<{ record: StoredFileRecord }>({
        text: `SELECT ${F_REC} AS record
               FROM ${FILE_TABLE} f
               WHERE f.${F_SCOPE} = $1
                 AND NOT starts_with(f.${F_PATH}, '@replica:')
                 AND (
                   f.${F_REC}->>'status' IN ('degraded', 'missing')
                   OR EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(f.${F_REC}->'parts') AS p
                     WHERE p ? 'missingAt'
                   )
                   OR EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(COALESCE(f.${F_REC}->'replicas', '[]'::jsonb)) AS r
                     WHERE r ? 'missingAt'
                   )
                 )
               ORDER BY f.${F_PATH} ASC`,
        values: [scope],
      })

      const out: StoredFileRecord[] = []
      for (const row of res.rows) {
        const rec = row.record
        if (filterSet !== null) {
          const matchesServer =
            rec.parts.some((p) => p.missingAt !== undefined && filterSet.has(p.server)) ||
            Boolean(
              rec.replicas?.some(
                (r) =>
                  (r.missingAt !== undefined ||
                    Boolean(r.parts?.some((rp) => rp.missingAt !== undefined))) &&
                  filterSet.has(r.server),
              ),
            )
          if (!matchesServer) continue
        }
        out.push(rec)
        if (out.length >= limit) break
      }
      return out
    },
  })
}

/**
 * Адаптер любого хранилища `#lib/cache` (`localStore` или `sharedStore = pgStore(db)`)
 * к контракту `AdaptedStorageStore` пакета `#lib/storage` (`statTtlMs` и конкурентные слоты).
 */
export function cacheStorageStore(
  store: Store,
  options: CacheStorageStoreOptions = {},
): AdaptedStorageStore {
  const scopeName = options.scope ?? 'storage'
  const scoped = store.scope(scopeName)
  const atomic = isAtomic(scoped) ? scoped : null

  return defineStorageStore({
    get<T = unknown>(key: string) {
      return scoped.get<T>(key)
    },
    set<T = unknown>(key: string, value: T, setOptions?: { ttlMs?: number }) {
      const ttlMs =
        setOptions?.ttlMs !== undefined && setOptions.ttlMs > 0
          ? setOptions.ttlMs
          : Infinity
      return scoped.set(key, value, ttlMs)
    },
    delete(key: string) {
      return scoped.delete(key)
    },
    ...(atomic
      ? {
          add<T = unknown>(key: string, value: T, addOptions: { ttlMs: number }) {
            return atomic.add(key, value, addOptions.ttlMs)
          },
          async incr(key: string, incrOptions: { ttlMs: number; by?: number }) {
            const step = Math.max(1, Math.floor(incrOptions.by ?? 1))
            let current = 0
            for (let i = 0; i < step; i++) {
              current = await atomic.incr(key, incrOptions.ttlMs)
            }
            return current
          },
        }
      : {}),
  })
}
