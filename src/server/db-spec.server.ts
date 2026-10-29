/**
 * Единое описание схемы БД приложения, начальных SQL-шагов и запуска первого
 * администратора — без зависимостей от `$app/env/private`.
 *
 * Используется в двух местах без дублирования:
 * 1. `tooling/db-reset.mjs` на этапе сборки (`npm run build`): если задан
 *    `DATABASE_URL`, сразу после сборки (и опционального `DATABASE_RESET=1`)
 *    разворачивает все таблицы, сиды и первого администратора прямо в Build Logs.
 * 2. `src/server/db.server.ts` в рантайме (`lazyDriver`): для `npm run dev`
 *    на PGlite в памяти и как страховочный контур на случай запуска без этапа сборки.
 */
import { createDb, type Driver, type Limits } from '#lib/db/index.js'
import { defineSchema, type SchemaReport, type SyncStep } from '#lib/db/sync/index.js'
import { posts } from '#content/demo-catalog/posts/posts.js'
import { auth, block as userBlock, config as userConfig, profile, session } from '#content/user/schema.js'
import { cacheKv } from '#hooks/cache-db.js'
import { storageFile, storageReservation } from '#hooks/storage-db.js'
import { announceSeedAdmin, ensureSeedAdmin, type SeedAdmin } from './admin-bootstrap.server.js'

export { posts, auth, profile, session, userConfig, userBlock, cacheKv, storageFile, storageReservation }

export const DB_LIMITS: Limits = {
  pageSize: 20,
  maxPageSize: 100,
  maxPage: 10000,
  filterDepth: 8,
  filterNodes: 100,
  inValues: 100,
  inputKeys: 64,
}

export const schemaSpec = {
  // user-ресурсы (модуль user): таблицы и миграции — здесь, потребление — `db.resource`;
  // cache_kv — таблица общего хранилища lib/cache (`sharedStore` в server/cache.ts);
  // storage_file / storage_reservation — реестр и брони lib/storage (`pgStorageLedger` в hooks/storage-db.ts)
  resources: [posts, auth, session, profile, userConfig, userBlock, cacheKv, storageFile, storageReservation],
  sql: [
    // Конфиг-модель (этап 10): уникальность пары (auth_id, key) обычный
    // unique не даёт — NULL глобальных строк в Postgres не равен NULL,
    // и вторая строка умолчания с тем же ключом прошла бы. Два частичных
    // индекса: глобальный ключ один, юзерский — один на юзера.
    {
      id: 'user-config-uq-global',
      text: 'CREATE UNIQUE INDEX IF NOT EXISTS user_config_uq_global ON public.user_config (key) WHERE auth_id IS NULL',
    },
    {
      id: 'user-config-uq-user',
      text: 'CREATE UNIQUE INDEX IF NOT EXISTS user_config_uq_user ON public.user_config (auth_id, key) WHERE auth_id IS NOT NULL',
    },
    // Ключ приватности профиля (этап 8): строка умолчания несёт схему
    // прав — владелец сам ставит себе уровень (assign/editUser/deleteUser:
    // owner), умолчание меняет админ. Значение — nobody: текущее поведение
    // до явного выбора. Идемпотентно (WHERE NOT EXISTS по глобальному ключу).
    {
      id: 'user-config-seed-visibility',
      text: `INSERT INTO public.user_config (auth_id, key, value, schema)
             SELECT NULL, 'profile.visibility', '"nobody"'::jsonb,
                    '{"editDefault":["admin"],"assign":["admin","owner"],"editUser":["admin","owner"],"deleteUser":["admin","owner"]}'::jsonb
             WHERE NOT EXISTS (SELECT 1 FROM public.user_config WHERE auth_id IS NULL AND key = 'profile.visibility')`,
    },
    // Ключ автовыхода при смене IP (пример прав этапа 10): закрепляет и
    // меняет только админ, владелец — только чтение (чтение схемой не
    // закрывается: его даёт getUserKey владельцу и config.read).
    {
      id: 'user-config-seed-iplock',
      text: `INSERT INTO public.user_config (auth_id, key, value, schema)
             SELECT NULL, 'session.ipLock', 'false'::jsonb,
                    '{"editDefault":["admin"],"assign":["admin"],"editUser":["admin"],"deleteUser":["admin"]}'::jsonb
             WHERE NOT EXISTS (SELECT 1 FROM public.user_config WHERE auth_id IS NULL AND key = 'session.ipLock')`,
    },
    // Блокировки (этап 9): индекс чтения цели и перенос истории из
    // json-массива user_auth.blocked в строки модели.
    {
      id: 'user-block-ix-target',
      text: 'CREATE INDEX IF NOT EXISTS user_block_ix_target ON public.user_block (auth_id, created_at DESC)',
    },
    {
      id: 'user-block-backfill-v2',
      text: `INSERT INTO public.user_block (auth_id, scope, reason, until, "by", created_at, updated_at)
             SELECT a.id, e->>'scope', e->>'reason',
                    CASE WHEN e ? 'until' THEN to_timestamp((e->>'until')::double precision / 1000.0) END,
                    CASE WHEN e->>'by' ~ '^[0-9a-fA-F-]{36}$' THEN (e->>'by')::uuid END,
                    to_timestamp((e->>'at')::double precision / 1000.0),
                    to_timestamp((e->>'at')::double precision / 1000.0)
             FROM public.user_auth a,
                  jsonb_array_elements(
                    CASE WHEN jsonb_typeof(to_jsonb(a)->'blocked') = 'array' THEN to_jsonb(a)->'blocked' ELSE '[]'::jsonb END
                  ) AS e
             WHERE NOT EXISTS (SELECT 1 FROM public.kit_schema WHERE kind = 'sql' AND name = 'user-block-backfill')`,
    },
    {
      id: 'demo-post-seed-500',
      text: `INSERT INTO public.demo_post (title, created_at)
               SELECT 'Запись ' || n, clock_timestamp() - (501 - n) * interval '1 minute'
               FROM generate_series(1, 500) n
               WHERE NOT EXISTS (SELECT 1 FROM public.demo_post)`,
    },
    {
      id: 'demo-user-seed-100',
      text: `INSERT INTO public.user_auth (seed, permissions, subnet_salt, created_at, updated_at, deleted_at)
               SELECT 'demo-' || substr(md5('seed-' || n), 1, 19) || substr(md5('salt-' || n), 1, 19),
                      '{}',
                      substr(md5('sub-' || n), 1, 32),
                      clock_timestamp() - (n * interval '1.3 days'),
                      clock_timestamp() - (n * interval '1.3 days'),
                      CASE WHEN n <= 20 THEN clock_timestamp() - (n * interval '1.3 days') + interval '20 days' END
                 FROM generate_series(1, 100) n
                WHERE NOT EXISTS (SELECT 1 FROM public.user_auth WHERE seed LIKE 'demo-%')`,
    },
    {
      id: 'demo-profile-seed-100',
      text: `INSERT INTO public.user_profile (auth_id, nickname, created_at, updated_at)
               SELECT a.id, 'demo-user-' || lpad(a.rn::text, 3, '0'), a.created_at, a.created_at
                 FROM (SELECT id, created_at, row_number() OVER (ORDER BY created_at) AS rn
                         FROM public.user_auth WHERE seed LIKE 'demo-%') a
                WHERE NOT EXISTS (SELECT 1 FROM public.user_profile p WHERE p.auth_id = a.id)`,
    },
  ],
}

export const schema = defineSchema(schemaSpec)

/** Печать результата сверки схемы в лог сборки или сервера. */
export function logSchemaReport(r: SchemaReport): void {
  const summary = `[db] схема: применено ${r.applied.length}, конфликтов ${r.conflicts.length}, ждут решения ${r.notices.length}`
  const conflicts = r.conflicts.map((c) => `${c.kind} ${c.table} ${c.column ?? ''}`.trim()).join('; ')
  if (r.status === 'ok') console.log(conflicts ? `${summary} ${conflicts}` : summary)
  else console.warn(summary, conflicts)
}

export interface BootstrapDbOptions {
  readonly onStep?: (step: SyncStep) => void
  /** Печатать явную строку, если администратор уже существовал (удобно в Build Logs). */
  readonly logExistingAdmin?: boolean
}

/**
 * Развернуть схему всех моделей, сиды и первого администратора поверх открытого `Driver`.
 * Возвращает защищённый `gated`-драйвер и (если был создан сейчас) запись администратора.
 */
export async function bootstrapDatabase(
  rawDriver: Driver,
  options?: BootstrapDbOptions,
): Promise<{ driver: Driver; createdAdmin: SeedAdmin | null }> {
  let reportStatus: SchemaReport['status'] = 'ok'
  const gated = await schema.gate(rawDriver, {
    ...(options?.onStep ? { onStep: options.onStep } : {}),
    onReport: (r) => {
      reportStatus = r.status
      logSchemaReport(r)
    },
  })

  let createdAdmin: SeedAdmin | null = null
  if (reportStatus === 'ok') {
    try {
      const boot = createDb({ driver: gated, limits: DB_LIMITS })
      createdAdmin = await ensureSeedAdmin(boot)
      if (createdAdmin) announceSeedAdmin(createdAdmin)
      else if (options?.logExistingAdmin) {
        console.log('[user] администратор в базе уже есть — новый ключ не создавался')
      }
    } catch (e) {
      console.warn(
        '[user] администратора завести не удалось:',
        String((e as Error)?.message ?? e).slice(0, 300),
      )
    }
  }
  return { driver: gated, createdAdmin }
}
