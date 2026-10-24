// Хранилище в Postgres: общее между инстансами. Это переходник между
// контрактом `#lib/cache` и базой `#lib/db`, поэтому живёт здесь, в
// `src/hooks`, а не в одной из библиотек: ядро cache базу не импортирует,
// ядро db про кэш не знает — соединяет их приложение в этой папке.
//
// Таблица описана моделью lib/db (`cacheKv`): `src/server/db.server.ts`
// регистрирует её в схеме БД, sync создаёт таблицу при подключении на любом
// движке. Операции — каждая одним оператором через `db.query` по таблице
// модели: `ResourceApi` атомарные `add`/`incr`/upsert одним оператором не
// выражает, а транзакций и session-состояния транспорты проекта не обещают
// (transaction-pooling, Hyperdrive). Часы — базы (`clock_timestamp()`): один
// источник времени на все инстансы; срок считается в SQL из ttl. Проект —
// `docs/design/cache-pg-store.md`.
import { defineResource, f, policy } from '#lib/db/index.js'
import type { Database } from '#lib/db/index.js'
import type { AtomicStore, ScopeOptions } from '#lib/cache/index.js'

/**
 * Модель KV-таблицы общего хранилища. Естественный ключ — пара
 * (scope, key): уникальность даёт `db.unique`, а PK модели один, поэтому
 * `id` — суррогатный uuid со значением базы. `expires_at` NULL — без срока
 * (`Infinity` контракта). Политика: только серверный слой, как у сессий.
 */
export const cacheKv = defineResource({
  key: 'cache.kv.v1',
  table: 'public.cache_kv',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, immutable: true, orderable: true, filters: ['eq'], db: { default: 'gen_random_uuid()' } }),
    scope: f.text({ read: () => true, create: () => true, required: true, filters: ['eq'] }),
    key: f.text({ read: () => true, create: () => true, required: true, filters: ['eq'] }),
    value: f.json({ read: () => true, create: () => true, update: () => true, required: true }),
    expires_at: f.timestamp({ read: () => true, create: () => true, update: () => true, nullable: true }),
  },
  policy: {
    select: policy.roles(['server']),
    insert: policy.roles(['server']),
    update: policy.roles(['server']),
    delete: policy.roles(['server']),
  },
  order: [['id', 'asc']],
  db: { unique: [['scope', 'key']], indexes: [['expires_at']] },
})

/** Postgres отвечает позже: те же методы контракта, но все — обещания. */
export interface PgStore extends AtomicStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  add<T>(key: string, value: T, ttlMs: number): Promise<boolean>
  incr(key: string, ttlMs: number): Promise<number>
  scope(name: string, options?: ScopeOptions): PgStore
}

/** Настройка `pgStore`: как часто запись попутно вычищает просроченные ключи. */
export interface PgStoreOptions {
  /**
   * Как часто запись заодно вычищает просроченное (DELETE по индексу срока).
   * По умолчанию раз в минуту на инстанс, как обход у памяти процесса.
   */
  sweepIntervalMs?: number
}

const DEFAULT_SWEEP_MS = 60_000

const ident = (p: string) => `"${p.replaceAll('"', '""')}"`
/** Таблица и колонки — из дескриптора модели, а не строками отдельно. */
const TABLE = cacheKv.table.split('.').map(ident).join('.')
const colOf = (name: string) =>
  ident((cacheKv.fields as Record<string, { column?: string }>)[name]?.column ?? name)
const SC = colOf('scope')
const KEY = colOf('key')
const VAL = colOf('value')
const EXP = colOf('expires_at')
/** Запись жива: срока нет или он в будущем по часам базы. */
const LIVE = `(${EXP} IS NULL OR ${EXP} > clock_timestamp())`
/** Запись просрочена (NULL здесь — не истина: вечная запись не просрочена). */
const DEAD = `${EXP} <= clock_timestamp()`

function checkTtl(ttlMs: number): number {
  if (!(ttlMs > 0))
    throw new RangeError(`[cache] ttlMs — положительное число мс или Infinity, получено ${String(ttlMs)}`)
  return ttlMs
}

/** Выражение срока в SQL: конечный ttl — от часов базы, Infinity — NULL. */
const expiryOf = (ttlMs: number, param: number) =>
  Number.isFinite(ttlMs) ? `clock_timestamp() + ($${param}::double precision * interval '1 millisecond')` : 'NULL'

/**
 * Общее хранилище поверх Postgres. Таблица должна быть развёрнута sync-ом
 * из модели `cacheKv` (приложение регистрирует её в схеме БД); драйвер
 * таблицу сам не создаёт — это дело подключения, а не хранилища.
 *
 * Потолок `max` областей игнорируется: контракт разрешает сетевым
 * хранилищам жить по своим правилам вытеснения, а здесь вытеснение — срок.
 * @param db База приложения (`Database` из lib/db).
 * @param options Период оппортунистической вычистки просроченного.
 * @returns Хранилище; `scope` создаёт области префиксом пути в колонке scope.
 */
export function pgStore(db: Database, options: PgStoreOptions = {}): PgStore {
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_MS
  let sweptAt = 0

  /** Вычистка просроченного на записях, не чаще периода на инстанс. */
  async function sweep() {
    const t = Date.now()
    if (t - sweptAt < sweepIntervalMs) return
    sweptAt = t
    try {
      await db.query({ text: `DELETE FROM ${TABLE} WHERE ${DEAD}` })
    } catch (e) {
      // Запись уже состоялась: сбой уборки — не повод её отказывать, но и
      // молчать нельзя (просроченное будет копиться).
      console.error('[cache] pgStore: вычистка просроченного не удалась', e)
    }
  }

  function view(scopePath: string): PgStore {
    return {
      async get<T>(key: string) {
        const r = await db.query<{ value: unknown }>({
          text: `SELECT ${VAL} AS value FROM ${TABLE} WHERE ${SC} = $1 AND ${KEY} = $2 AND ${LIVE}`,
          values: [scopePath, key],
        })
        return r.rows[0]?.value as T | undefined
      },
      async set(key, value, ttlMs) {
        checkTtl(ttlMs)
        const finite = Number.isFinite(ttlMs)
        await db.query({
          text: `INSERT INTO ${TABLE} (${SC}, ${KEY}, ${VAL}, ${EXP})
                 VALUES ($1, $2, $3::jsonb, ${expiryOf(ttlMs, 4)})
                 ON CONFLICT (${SC}, ${KEY}) DO UPDATE
                   SET ${VAL} = EXCLUDED.${VAL}, ${EXP} = EXCLUDED.${EXP}`,
          values: finite ? [scopePath, key, JSON.stringify(value) ?? 'null', ttlMs] : [scopePath, key, JSON.stringify(value) ?? 'null'],
        })
        await sweep()
      },
      async delete(key) {
        await db.query({
          text: `DELETE FROM ${TABLE} WHERE ${SC} = $1 AND ${KEY} = $2`,
          values: [scopePath, key],
        })
      },
      async clear() {
        // Своя область и вложенные: путь вложенной — свой путь + ':…'.
        await db.query(scopePath === ''
          ? { text: `DELETE FROM ${TABLE}` }
          : {
              text: `DELETE FROM ${TABLE} WHERE ${SC} = $1 OR starts_with(${SC}, $1 || ':')`,
              values: [scopePath],
            })
      },
      async add(key, value, ttlMs) {
        checkTtl(ttlMs)
        const finite = Number.isFinite(ttlMs)
        // DO UPDATE … WHERE просрочено: живая запись не трогается и строки
        // не возвращает, просроченная — заменяется. Атомарно одним оператором.
        const r = await db.query({
          text: `INSERT INTO ${TABLE} AS kv (${SC}, ${KEY}, ${VAL}, ${EXP})
                 VALUES ($1, $2, $3::jsonb, ${expiryOf(ttlMs, 4)})
                 ON CONFLICT (${SC}, ${KEY}) DO UPDATE
                   SET ${VAL} = EXCLUDED.${VAL}, ${EXP} = EXCLUDED.${EXP}
                   WHERE kv.${EXP} <= clock_timestamp()
                 RETURNING ${KEY}`,
          values: finite ? [scopePath, key, JSON.stringify(value) ?? 'null', ttlMs] : [scopePath, key, JSON.stringify(value) ?? 'null'],
        })
        const added = r.rows.length > 0
        if (added) await sweep()
        return added
      },
      async incr(key, ttlMs) {
        checkTtl(ttlMs)
        const finite = Number.isFinite(ttlMs)
        // Окно фиксировано с первого вызова: живая запись срок не меняет.
        // WHERE отсекает живую нечисловую запись без записи: 0 строк тогда
        // означает либо её, либо гонку с удалением — различаем чтением.
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await db.query<{ value: unknown }>({
            text: `INSERT INTO ${TABLE} AS kv (${SC}, ${KEY}, ${VAL}, ${EXP})
                   VALUES ($1, $2, '1'::jsonb, ${expiryOf(ttlMs, 3)})
                   ON CONFLICT (${SC}, ${KEY}) DO UPDATE
                     SET ${VAL} = CASE WHEN kv.${EXP} <= clock_timestamp()
                                        THEN '1'::jsonb
                                        ELSE to_jsonb((kv.${VAL}::text::numeric) + 1) END,
                         ${EXP} = CASE WHEN kv.${EXP} <= clock_timestamp()
                                        THEN EXCLUDED.${EXP} ELSE kv.${EXP} END
                     WHERE kv.${EXP} <= clock_timestamp() OR jsonb_typeof(kv.${VAL}) = 'number'
                   RETURNING ${VAL} AS value`,
            values: finite ? [scopePath, key, ttlMs] : [scopePath, key],
          })
          if (r.rows.length) {
            await sweep()
            return Number(r.rows[0]!.value)
          }
          const live = await view(scopePath).get(key)
          if (live !== undefined)
            throw new TypeError(`[cache] incr «${key}»: под ключом не число`)
        }
        throw new TypeError(`[cache] incr «${key}»: под ключом не число`)
      },
      scope(name, _options?: ScopeOptions) {
        if (name === '') throw new TypeError('[cache] scope: имя области не может быть пустым')
        // `scope('a:b')` — то же, что `scope('a').scope('b')`: путь просто
        // растёт через ':', как префикс ключей у сетевых хранилищ.
        return view(scopePath === '' ? name : `${scopePath}:${name}`)
      },
    }
  }

  return view('')
}
