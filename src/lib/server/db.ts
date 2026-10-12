/**
 * Composition root: единственный владелец соединения и ресурсов.
 * Паттерн — SvelteKit FAQ «How do I set up a database?»: синглтон процесса,
 * импорт из серверных модулей, никаких `db` в `.svelte`.
 *
 * `db` создаётся при загрузке модуля и ничего не стоит: соединение открывает
 * `lazyDriver` при первом запросе к БД. Страницы без БД её не поднимают — какой бы
 * движок ни был задан окружением (Hyperdrive, pg, PGlite): путь один.
 *
 * Движок: PGlite в памяти для dev/демо (иначе `npm run dev` и `vite build`
 * спорят из-за file-lock одного каталога) либо файловый каталог, если задан
 * DATABASE_DIR. Миграции — явные, НЕ при старте: здесь демо-корпус создаётся
 * тем же `applyMigrationText`, что и в проде (один путь, не «в тесте одно,
 * в проде другое»).
 */
import { createDb, defineResource, f, field, policy, s } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { hyperdriveAdapter } from '#lib/db/adapters/hyperdrive.js'
import { lazyDriver } from '#lib/db/adapters/lazy.js'
import { openNodeDatabase, openPgPool } from '#lib/db/sveltekit/node.js'
import { applyMigrationText, cursorCodecFromEnv } from '#lib/db/sveltekit/index.js'
import type { Database, Driver, Limits } from '#lib/db/index.js'
import {
  DATABASE_DIR, DATABASE_URL, DB_CONNECT_TIMEOUT_MS, DB_CURSOR_OLD_KEYS, DB_CURSOR_SECRET,
  DB_CURSOR_TTL_SECONDS, DB_POOL_MAX, HYPERDRIVE_CONNECTION_STRING, VERCEL,
} from '$app/env/private'

// Настройки — из `$app/env/private` (перечень и проверки — `src/env.ts`): одна форма
// для любого адаптера (Node — `process.env`, Workers — `platform.env`), в dev — ещё
// и `.env`. Пустое значение там уже сведено к `undefined`, числа уже проверены.

export const posts = defineResource({
  key: 'demo.post.v1',
  table: 'public.demo_post',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq', 'in'] }),
    title: field(s.text({ min: 3, max: 120 }), {
      read: () => true,
      create: () => true,
      update: () => true,
      required: true,
      normalize: (v) => (typeof v === 'string' ? v.trim() : v),
      filters: ['eq', 'contains', 'startsWith'],
      orderable: true,
    }),
    created_at: f.timestamp({ read: () => true, generated: true, orderable: true, filters: ['gt', 'gte', 'lt', 'lte'] }),
  },
  policy: {
    select: policy.publicRows(),
    insert: policy.roles(['author']),
    update: policy.ownerOrRoles('id', ['editor']),
    // deny() для delete дал бы не 403, а not_found: строка, скрытая политикой,
    // неотличима от отсутствующей — так не протекает факт существования.
    delete: policy.roles(['author']),
  },
  order: [['created_at', 'desc']],
})

const MIGRATION = `
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE IF NOT EXISTS public.demo_post (
  -- DEFAULT есть и у колонки, и у поля createValue: ресурс подставляет uuid,
  -- а прямой SQL/seed остаётся валидным — как в миграции источника.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS demo_post_page ON public.demo_post (created_at DESC NULLS LAST, id ASC NULLS LAST);
INSERT INTO public.demo_post (title) SELECT 'Запись ' || n FROM generate_series(1, 7) n
  WHERE NOT EXISTS (SELECT 1 FROM public.demo_post);
`

/**
 * Принцип демо-«автора»: один на хук, на SSR-снапшот пагинатора и на
 * `/api/db-posts`. Разносить его копией по трём местам нельзя — расхождение
 * проявилось бы как «страница показывает другое, чем догрузка».
 */
export const DEMO_PRINCIPAL = Object.freeze({ roles: ['author'] })

const LIMITS: Limits = { pageSize: 20, maxPageSize: 100, maxPage: 10000, filterDepth: 8, filterNodes: 100, inValues: 100, inputKeys: 64 }

/** Конфигурация секрета — ошибка запуска, и она обязана называть переменную. */
function explainCursorConfig(build: () => ReturnType<typeof cursorCodecFromEnv>) {
  try {
    return build()
  } catch (e) {
    throw new Error(
      `DB_CURSOR_SECRET непригоден: ${(e as Error)?.message ?? e} ` +
        `(нужна строка не короче 32 байт; без неё курсор выключать честнее, чем ронять приложение)`,
      { cause: e },
    )
  }
}

// Секрет курсора обязан быть не короче 32 байт, иначе слой отказывает — и без
// `explainCursorConfig` демо падало бы в 500 с текстом «Invalid cursor key/TTL
// configuration», где не понять, о какой переменной речь. Проверка дешёвая и
// синхронная, но её отказ НЕ роняет загрузку модуля (иначе неверный секрет ломал бы и
// страницы без БД): он запоминается и становится отказом первого обращения к БД.
let cursorConfigError: unknown
const cursorCodec = (() => {
  try {
    return explainCursorConfig(() =>
      cursorCodecFromEnv((key) => ({ DB_CURSOR_SECRET, DB_CURSOR_OLD_KEYS })[key], {
        ttlSeconds: DB_CURSOR_TTL_SECONDS,
      }),
    )
  } catch (e) {
    cursorConfigError = e
    return undefined
  }
})()

/**
 * Один `Database` на процесс. Соединение — при первом запросе (`lazyDriver`):
 * неудачное открытие не запоминается, следующий запрос пробует снова — один медленный
 * первый запрос (холодный контейнер, таймаут коннекта) не становится 500 до перезапуска.
 */
export const db: Database = createDb({ driver: lazyDriver(openDriver), limits: LIMITS, cursorCodec })

async function openDriver(): Promise<Driver> {
  let driver: Driver
  let close: (() => Promise<void>) | undefined
  try {
    if (cursorConfigError) throw cursorConfigError
    if (HYPERDRIVE_CONNECTION_STRING) {
      // Cloudflare Workers/Vercel Edge: клиент на запрос, пул держит Hyperdrive.
      driver = hyperdriveAdapter({ connectionString: HYPERDRIVE_CONNECTION_STRING, maxInFlight: 5 })
    } else if (DATABASE_URL) {
      const pool = openPgPool({
        connectionString: DATABASE_URL,
        max: DB_POOL_MAX ?? (VERCEL ? 1 : 4),
        // Холодный старт у хостера = долгие первые рукопожатия; дефолтных 10 с на
        // это мало.
        connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS ?? 30_000,
      })
      driver = pool.driver
      close = pool.close
    } else {
      const node = await openNodeDatabase(process.cwd(), DATABASE_DIR ?? 'data/postgres', {
        memory: !DATABASE_DIR,
      })
      driver = pgliteAdapter(node.db)
      close = node.close
    }
    // Демо-корпус создаётся тем же `applyMigrationText`, что и в проде.
    await applyMigrationText(createDb({ driver, limits: LIMITS }), MIGRATION)
    return close ? { ...driver, close } : driver
  } catch (e) {
    // Причина 500 в production не видна (SvelteKit её не печатает), а без этой строки
    // её ещё и нельзя найти: отказ открытия молча повторялся бы на каждый запрос.
    const err = e as { kind?: string; message?: string; details?: unknown; cause?: { message?: string } | unknown; constructor?: { name?: string } }
    console.error(
      '[db] открыть БД не удалось:', err?.kind ?? err?.constructor?.name, String(err?.message ?? e).slice(0, 300),
      '\n  details:', JSON.stringify(err?.details ?? null).slice(0, 400),
      '\n  cause:', String((err?.cause as { message?: string })?.message ?? err?.cause ?? 'нет').slice(0, 300),
    )
    // Захваченный ресурс обязан быть отпущен и при отказе ПОСЛЕ захвата: каталог
    // PGlite остаётся с `.kit-db.lock`, и следующая попытка отвечала бы «stop its
    // owner» вместо настоящей причины.
    await close?.()
    throw e
  }
}
