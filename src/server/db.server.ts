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
 * DATABASE_DIR. Таблицы описаны моделями (`posts`) и разворачиваются сами при
 * открытии БД (`schema.gate`): на любом движке один путь — в проде достаточно
 * DATABASE_URL. Что само применить нельзя, ждёт решения, а запросы к БД до тех пор
 * отвечают `schema_pending` (503).
 */
import { createDb } from '#lib/db/index.js'
import { posts } from '#content/demo-catalog/posts/posts.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { hyperdriveAdapter } from '#lib/db/adapters/hyperdrive.js'
import { lazyDriver } from '#lib/db/adapters/lazy.js'
import { openNodeDatabase, openPgPool } from '#lib/db/sveltekit/node.js'
import { cursorCodecFromEnv } from '#lib/db/sveltekit/index.js'
import { defineSchema, type SyncStep } from '#lib/db/sync/index.js'
import { DbFailure } from '#lib/db/index.js'
import type { Database, Driver, Limits } from '#lib/db/index.js'
import { createSchemaAdmin } from '#lib/db/sync/index.js'
import { sharedTask } from '#hooks/task-stream.server.js'
import type { TaskState } from '#lib/task/index.js'
import {
  DATABASE_DIR, DATABASE_URL, DB_ADMIN_TOKEN, DB_CONNECT_TIMEOUT_MS, DB_CURSOR_KID, DB_CURSOR_MAX_AGE_SECONDS,
  DB_CURSOR_OLD_KEYS, DB_CURSOR_SECRET, DB_CURSOR_TTL_SECONDS, DB_POOL_MAX, HYPERDRIVE_CONNECTION_STRING, VERCEL,
} from '$app/env/private'

// Настройки — из `$app/env/private` (перечень и проверки — `src/env.ts`): одна форма
// для любого адаптера (Node — `process.env`, Workers — `platform.env`), в dev — ещё
// и `.env`. Пустое значение там уже сведено к `undefined`, числа уже проверены.

// Модель записей — общий модуль (`src/content/posts.ts`): по ней строится и форма.
import { auth, profile, session } from '#content/user/schema.js'
import { cacheKv } from '#hooks/cache-db.js'
import { announceSeedAdmin, ensureSeedAdmin } from './admin-bootstrap.server.js'

export { posts, auth, profile, session, cacheKv }

/**
 * Схема БД демо: таблица из `posts` (типы, NOT NULL, CHECK длины из правил полей модели, индекс
 * под сортировку) и начальные записи — ручной SQL, выполняется один раз.
 */
const schemaSpec = {
  // user-ресурсы (модуль user): таблицы и миграции — здесь, потребление — `db.resource`;
  // cache_kv — таблица общего хранилища lib/cache (`sharedStore` в server/cache.ts)
  resources: [posts, auth, session, profile, cacheKv],
  sql: [
    // created_at задан явно: DEFAULT clock_timestamp() в одном INSERT даёт строкам одно и то же
    // время (видно в демо), и сортировка по нему становится произвольной. Шаг — минута,
    // «Запись 1» — самая старая. Новый id, а не правка старого: изменённый текст под прежним
    // id на уже развёрнутой БД — конфликт `sql_changed` и 503 до решения.
    {
      id: 'demo-post-seed-500',
      text: `INSERT INTO public.demo_post (title, created_at)
               SELECT 'Запись ' || n, clock_timestamp() - (501 - n) * interval '1 minute'
               FROM generate_series(1, 500) n
               WHERE NOT EXISTS (SELECT 1 FROM public.demo_post)`,
    },
    // Демо-юзера списка seed-юзеров (этап 0 плана seed-list-stages): 100
    // аккаунтов, первые 20 — с заявкой на удаление. Как и сид постов выше:
    // один раз, идемпотентно (маркер — префикс seed `demo-`), даты размазаны
    // назад, чтобы поиск/фильтры/сортировки этапа 1 было на чём проверять.
    // Набор временный: удаляется отдельной правкой (скрипт + строки `demo-%`).
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
 * Принцип демо-«автора»: один на хук, на SSR-снапшот пагинатора и на
 * `/api/db-posts`. Разносить его копией по трём местам нельзя — расхождение
 * проявилось бы как «страница показывает другое, чем догрузка».
 */
/**
 * Кто пишет в демо: входа нет, гость. Роль `author` — право создавать записи
 * (`policy.roles(['author'])`), роль `editor` — право править чужие
 * (`policy.ownerOrRoles('author_id', ['editor'])`): без неё у гостя нет id и
 * правка недоступна никому, а опрос изменённых (`docs/design/live-update.md`
 * §5.2) нечем показать вживую. Это настройка ДЕМО, не модель прав: появится
 * вход или фэйк-юзер из панели (`author_id`) — `editor` снимается первым.
 */
export const DEMO_PRINCIPAL = Object.freeze({ roles: ['author', 'editor'] })

const LIMITS: Limits = { pageSize: 20, maxPageSize: 100, maxPage: 10000, filterDepth: 8, filterNodes: 100, inValues: 100, inputKeys: 64 }

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

// Секрет курсора обязан быть не короче 32 байт, иначе слой отказывает — и без
// `explainCursorConfig` демо падало бы в 500 с текстом «Invalid cursor key/TTL
// configuration», где не понять, о какой переменной речь. Проверка дешёвая и
// синхронная, но её отказ НЕ роняет загрузку модуля (иначе неверный секрет ломал бы и
// страницы без БД): он запоминается и становится отказом первого обращения к БД.
let cursorConfigError: unknown
const cursorCodec = (() => {
  try {
    return explainCursorConfig(() =>
      cursorCodecFromEnv((key) => ({ DB_CURSOR_SECRET, DB_CURSOR_KID, DB_CURSOR_OLD_KEYS })[key], {
        ttlSeconds: DB_CURSOR_TTL_SECONDS,
        // Потолок возраста указателя (live-update §7 «б»). Имя читается здесь, а
        // не из переданной функции `env`: список известных имён — `src/env.ts`,
        // и переменная, не попавшая сюда, молча стала бы «по умолчанию».
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
export const db: Database = createDb({ driver: lazy, limits: LIMITS, cursorCodec })

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
  // Подключение — этап до сверки: всего 1 + (проверка + таблицы + скрипты).
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
    // Схема из моделей: недостающее создаётся само; конфликт не роняет открытие —
    // запросы отвечают `schema_pending`, пока его не снимут.
    raw = close ? { ...driver, close } : driver
    const gated = await schema.gate(raw, {
      onStep: (step) => dbStart.report(schemaStepTask(DB_START_LABEL, step, 1)),
      onReport: (r) =>
        console[r.status === 'ok' ? 'info' : 'warn'](
          `[db] схема: применено ${r.applied.length}, конфликтов ${r.conflicts.length}, ждут решения ${r.notices.length}`,
          r.conflicts.map((c) => `${c.kind} ${c.table} ${c.column ?? ''}`.trim()).join('; '),
        ),
    })
    // Первый администратор: без него некому выдавать права (`admin.ts`).
    // Отдельный `Database` поверх уже сверенного драйвера — `db` ещё открывается,
    // и обращение к нему отсюда замкнуло бы `lazyDriver` сам на себя.
    // Отказ не отменяет запуск базы: приложение живёт и без администратора.
    try {
      const boot = createDb({ driver: gated, limits: LIMITS })
      const created = await ensureSeedAdmin(boot)
      if (created) announceSeedAdmin(created)
    } catch (e) {
      console.warn('[user] администратора завести не удалось:', String((e as Error)?.message ?? e).slice(0, 300))
    }
    return gated
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
    raw = undefined
    await close?.()
    throw e
  } finally {
    dbStart.end()
  }
}
