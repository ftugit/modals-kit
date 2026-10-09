/**
 * Composition root: единственный владелец соединения и ресурсов.
 * Паттерн — SvelteKit FAQ «How do I set up a database?»: синглтон процесса,
 * импорт из серверных модулей, никаких `db` в `.svelte`.
 *
 * Движок: PGlite в памяти для dev/демо (иначе `npm run dev` и `vite build`
 * спорят из-за file-lock одного каталога) либо файловый каталог, если задан
 * DATABASE_DIR. Миграции — явные, НЕ при старте: здесь демо-корпус создаётся
 * тем же `applyMigrationText`, что и в проде (один путь, не «в тесте одно,
 * в проде другое»).
 */
import { createDb, defineResource, f, field, policy, s } from '$lib/db'
import { pgliteAdapter } from '$lib/db/adapters/pglite'
import { hyperdriveAdapter } from '$lib/db/adapters/hyperdrive'
import { openNodeDatabase, openPgPool } from '$lib/db/sveltekit/node'
import { applyMigrationText, cursorCodecFromEnv } from '$lib/db/sveltekit'
import { envReader } from '$lib/db/sveltekit/node'
import type { Database, Driver } from '$lib/db'

const env = envReader(process.env, import.meta.env as Record<string, string | undefined>)

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

type Runtime = { db: Database; driver: Driver; close?: () => Promise<void> }
let opening: Promise<Runtime> | undefined

/**
 * Один индекс на процесс; `await` внутри load/action.
 *
 * Кэшируем только УСПЕШНУЮ инициализацию. Наивное `opening ??= промис` запоминает и
 * отказ: один медленный первый запрос (холодный контейнер на free-хостинге, таймаут
 * коннекта, БД ещё не поднята) превращал бы 500 в состояние процесса до перезапуска.
 */
export function getRuntime(): Promise<Runtime> {
  if (!opening)
    opening = open().catch((e) => {
      // Причина 500 в production не видна (SvelteKit её не печатает), а без этой строки
      // её ещё и нельзя найти: отказ инициализации молча повторялся бы на каждый запрос.
      console.error('[db] инициализация не удалась:', e?.kind ?? e?.constructor?.name, String(e?.message ?? e).slice(0, 300), '\n  details:', JSON.stringify((e as { details?: unknown })?.details ?? null).slice(0, 400), '\n  cause:', String((e as { cause?: Error })?.cause?.message ?? (e as { cause?: unknown })?.cause ?? 'нет').slice(0, 300))
      opening = undefined
      throw e
    })
  return opening
}

async function open(): Promise<Runtime> {
    let driver: Driver
    let close: (() => Promise<void>) | undefined
    if (env('HYPERDRIVE_CONNECTION_STRING')) {
      // Cloudflare Workers/Vercel Edge: клиент на запрос, пул держит Hyperdrive.
      driver = hyperdriveAdapter({ connectionString: env('HYPERDRIVE_CONNECTION_STRING')!, maxInFlight: 5 })
    } else if (env('DATABASE_URL')) {
      const pool = openPgPool({
        connectionString: env('DATABASE_URL')!,
        max: Number(env('DB_POOL_MAX') ?? (env('VERCEL') ? 1 : 4)),
        // Холодный старт у хостера = долгие первые рукопожатия; дефолтных 10 с на
        // это мало, а лишний пул-таймаут ещё и отравляет синглтон (см. выше).
        connectionTimeoutMillis: Number(env('DB_CONNECT_TIMEOUT_MS') ?? 30_000),
      })
      driver = pool.driver
      close = pool.close
    } else {
      const node = await openNodeDatabase(process.cwd(), env('DATABASE_DIR') ?? 'data/postgres', {
        memory: !env('DATABASE_DIR'),
      })
      driver = pgliteAdapter(node.db)
      close = node.close
    }
    const db = createDb({
      driver,
      limits: { pageSize: 20, maxPageSize: 100, maxPage: 10000, filterDepth: 8, filterNodes: 100, inValues: 100, inputKeys: 64 },
      cursorCodec: cursorCodecFromEnv(env),
    })
    await applyMigrationText(db, MIGRATION)
    return { db, driver, close }
}
