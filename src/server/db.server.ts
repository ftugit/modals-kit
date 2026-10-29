/**
 * Composition root: единственный владелец соединения и ресурсов.
 * Паттерн — SvelteKit FAQ «How do I set up a database?»: синглтон процесса,
 * импорт из серверных модулей, никаких `db` в `.svelte`.
 *
 * `db` создаётся при загрузке модуля и ничего не стоит: соединение открывает
 * `lazyDriver` при первом запросе к БД. Страницы без БД её не поднимают — какой бы
 * движок ни был задан окружением (Hyperdrive, pg, PGlite): путь один.
 *
 * Движок: внешний Postgres по `DATABASE_URL` (очистка `DATABASE_RESET=1`, сверка
 * всех моделей, сиды и первый администратор выполняются уже на этапе сборки в
 * `tooling/db-reset.mjs`, так что база готова и логи видны сразу при деплое;
 * в рантайме `schema.gate` делает только быструю сверку отпечатков), иначе PGlite:
 * в памяти для dev/демо (иначе `npm run dev` и `vite build` спорят из-за
 * file-lock одного каталога) либо файловый каталог, если задан DATABASE_DIR.
 * Что само применить нельзя, ждёт решения, а запросы к БД до тех пор отвечают
 * `schema_pending` (503).
 */
import { createDb, DbFailure, type Database, type Driver } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { hyperdriveAdapter } from '#lib/db/adapters/hyperdrive.js'
import { lazyDriver } from '#lib/db/adapters/lazy.js'
import { openNodeDatabase, openPgPool } from '#lib/db/sveltekit/node.js'
import { cursorCodecFromEnv } from '#lib/db/sveltekit/index.js'
import { createSchemaAdmin, type SyncStep } from '#lib/db/sync/index.js'
import { sharedTask } from '#hooks/task-stream.server.js'
import type { TaskState } from '#lib/task/index.js'
import {
  DATABASE_DIR, DATABASE_URL, DB_ADMIN_TOKEN, DB_CONNECT_TIMEOUT_MS, DB_CURSOR_KID, DB_CURSOR_MAX_AGE_SECONDS,
  DB_CURSOR_OLD_KEYS, DB_CURSOR_SECRET, DB_CURSOR_TTL_SECONDS, DB_POOL_MAX, HYPERDRIVE_CONNECTION_STRING, VERCEL,
} from '$app/env/private'
import {
  auth,
  bootstrapDatabase,
  cacheKv,
  DB_LIMITS,
  posts,
  profile,
  schema,
  schemaSpec,
  session,
  storageFile,
  storageReservation,
  storageServer,
} from './db-spec.server.js'

export { posts, auth, profile, session, cacheKv, storageFile, storageReservation, storageServer, schema }

/** Этап сверки схемы — словами для человека (`taskLabel`: «шаг N из M: …»). */
export function schemaStepName(step: SyncStep): string | undefined {
  if (step.step === 'check') return 'Проверка схемы'
  if (step.step === 'table') return `Таблица ${step.name?.replace(/^public\./, '')}`
  if (step.step === 'sql') return `Скрипт ${step.name}`
  return undefined
}

/** Ход сверки → состояние задачи с подписью `label`. */
export function schemaStepTask(label: string, step: SyncStep, offset = 0): TaskState {
  const name = schemaStepName(step)
  return {
    status: 'pending',
    scope: 'global',
    label,
    progress: { kind: 'steps', done: offset + step.done, total: offset + step.total, ...(name ? { step: name } : {}) },
  }
}

/**
 * Запуск базы — общая операция процесса: подключение и сверка схемы (`openDriver`).
 * Её ход получают все запросы, которые её ждут: `taskResponse(request, run, { watch: [watchDb] })`.
 */
const dbStart = sharedTask()
export const watchDb = dbStart.watch
const DB_START_LABEL = 'Запуск базы'

/**
 * Кто пишет в демо: входа нет, гость. Роль `author` — право создавать записи
 * (`policy.roles(['author'])`), роль `editor` — право править чужие
 * (`policy.ownerOrRoles('author_id', ['editor'])`): без неё у гостя нет id и
 * правка недоступна никому, а опрос изменённых (`docs/design/live-update.md`
 * §5.2) нечем показать вживую. Это настройка ДЕМО, не модель прав: появится
 * вход или фэйк-юзер из панели (`author_id`) — `editor` снимается первым.
 */
export const DEMO_PRINCIPAL = Object.freeze({ roles: ['author', 'editor'] })

/** Конфигурация секрета — ошибка запуска, и она обязана называть переменную. */
function explainCursorConfig(build: () => ReturnType<typeof cursorCodecFromEnv>) {
  try {
    return build()
  } catch (e) {
    throw new Error(
      `Настройка курсора (DB_CURSOR_*) непригодна: ${(e as Error)?.message ?? e} ` +
        `(секреты — не короче 32 байт; без DB_CURSOR_SECRET курсор выключать честнее, чем ронять приложение)`,
      { cause: e },
    )
  }
}

let cursorConfigError: unknown
const cursorCodec = (() => {
  try {
    return explainCursorConfig(() =>
      cursorCodecFromEnv((key) => ({ DB_CURSOR_SECRET, DB_CURSOR_KID, DB_CURSOR_OLD_KEYS })[key], {
        ttlSeconds: DB_CURSOR_TTL_SECONDS,
        maxAgeSeconds: DB_CURSOR_MAX_AGE_SECONDS,
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
const lazy = lazyDriver(openDriver)
export const db: Database = createDb({ driver: lazy, limits: DB_LIMITS, cursorCodec })

/** Открытый драйвер мимо `gate` — только для переноса схемы (`schemaAdmin`). */
let raw: Driver | undefined

/**
 * Перенос схемы по кнопке: отчёт и решения под `DB_ADMIN_TOKEN`. БД открывается тем
 * же `lazyDriver`, что и у запросов (одно соединение на процесс); при конфликте
 * открытие проходит, а первый запрос отвечает `schema_pending` — это и ожидается.
 */
export const schemaAdmin = createSchemaAdmin({
  schema,
  token: DB_ADMIN_TOKEN,
  async driver() {
    if (!raw)
      await lazy.query({ text: 'SELECT 1' }).catch((e) => {
        if (!(e instanceof DbFailure && e.kind === 'schema_pending')) throw e
      })
    if (!raw) throw new DbFailure('unavailable')
    return raw
  },
})

async function openDriver(): Promise<Driver> {
  let driver: Driver
  let close: (() => Promise<void>) | undefined
  const syncTotal = 1 + schemaSpec.resources.length + schemaSpec.sql.length
  dbStart.report({
    status: 'pending',
    scope: 'global',
    label: DB_START_LABEL,
    progress: { kind: 'steps', done: 0, total: 1 + syncTotal, step: 'Подключение' },
  })
  try {
    if (cursorConfigError) throw cursorConfigError
    if (HYPERDRIVE_CONNECTION_STRING) {
      driver = hyperdriveAdapter({ connectionString: HYPERDRIVE_CONNECTION_STRING, maxInFlight: 5 })
    } else if (DATABASE_URL) {
      const pool = openPgPool({
        connectionString: DATABASE_URL,
        max: DB_POOL_MAX ?? (VERCEL ? 1 : 4),
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
    raw = close ? { ...driver, close } : driver
    const { driver: gated } = await bootstrapDatabase(raw, {
      onStep: (step) => dbStart.report(schemaStepTask(DB_START_LABEL, step, 1)),
    })
    return gated
  } catch (e) {
    const err = e as { kind?: string; message?: string; details?: unknown; cause?: { message?: string } | unknown; constructor?: { name?: string } }
    console.error(
      '[db] открыть БД не удалось:', err?.kind ?? err?.constructor?.name, String(err?.message ?? e).slice(0, 300),
      '\n  details:', JSON.stringify(err?.details ?? null).slice(0, 400),
      '\n  cause:', String((err?.cause as { message?: string })?.message ?? err?.cause ?? 'нет').slice(0, 300),
    )
    raw = undefined
    await close?.()
    throw e
  } finally {
    dbStart.end()
  }
}
