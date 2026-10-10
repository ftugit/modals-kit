# `$lib/db` — серверный слой данных

Обычный `lib` этого приложения, такой же, как `$lib/form` или `$lib/modals`: TS-исходники
в `src/lib/db`, импорт через `$lib/db`, тесты рядом (`src/lib/db/test/*.test.ts`), проверки
границ — в `tooling/`. Отдельного пакета, `dist`-сборки и tarball-установки больше нет.

Слой **перенесён** из `server/lib/db` репозитория SolidHono (эталон: `f8079b1`) и
адаптирован под SvelteKit (эталон приложения: `modals-kit@f82734f`, сверено с `5d08da7`
на `b1`). Карта переноса, снятые проверки и правила ре-синхронизации — [`PORTING.md`](./PORTING.md).

Ядро (`$lib/db`) про HTTP не знает вообще: это компилятор SQL + политики +
валидация + транзакции. SvelteKit-слой (`$lib/db/sveltekit`) добавляет ровно то,
чего ядру не хватало: `event.locals`, разбор query из `load`, ошибки в формате
`error()`/`fail()`, курсорный секрет из env, прогон миграций.

```
Драйверы          pg (пул) · PGlite (dev/тесты) · Hyperdrive (Workers, клиент на запрос)
Ресурс            defineResource: поля × Grant (read/create/update) × policy × relations
Валидация         Standard Schema (~standard): своя zero-dep схема ИЛИ zod — на выбор
Безопасность      идентификаторы через ident(), значения через параметры, deny-safe query
Пейджинация       offset (page/limit) и keyset-курсор (HMAC + kid + TTL + scope)
Транзакции        savepoint'ы, откат по сигналу, afterCommit-очередь, «отравленный» parent
Миграции          splitSqlStatements + applyMigrationText (один BEGIN/COMMIT)
```

Содержание:
· [Установка](#установка)
· [Composition root](#1-composition-root)
· [Доверенный контекст: `hooks.server.ts`](#2-доверенный-контекст-hooksserverts)
· [Чтение в `load`](#3-чтение-в-load)
· [Запись в actions](#4-запись-в-actions)
· [Драйверы](#5-драйверы)
· [Миграции](#6-миграции)
· [Публичный API](#7-публичный-api)
· [Свой код в TypeScript](#8-свой-код-в-typescript)
· [Разработка слоя](#9-разработка-слоя) · перенос и расхождения — [PORTING.md](./PORTING.md) · транспорты/serverless — [docs/TRANSPORTS.md](./docs/TRANSPORTS.md)

## Установка

Никакой: слой лежит в этом же дереве, `import { createDb } from '$lib/db'` работает сразу.
Зависимости, которые слой реально тянет, уже в `package.json` приложения:

| Зависимость | Зачем | Где |
|---|---|---|
| `@standard-schema/spec` | только типы (`StandardSchemaV1`) | `src/lib/db/types.ts`, `src/lib/db/schema.ts` |
| `pg` | пул PostgreSQL в Node | `src/lib/db/adapters/pg.ts` |
| `@electric-sql/pglite` | dev/тесты без Docker и прав | `src/lib/db/adapters/pglite.ts` |
| `zod` (devDep) | опциональный совместимый вход | `src/lib/db/zod.ts` |

`pg` и `PGlite` намеренно **не** реэкспортируются из барреля: клиентская/edge сборка не
должна их тянуть. Импорт движков — только из под-путей `$lib/db/adapters/*` и
`$lib/db/sveltekit/node`.

`@sveltejs/kit` слой в рантайме не импортирует (нужен только типам), поэтому
`$lib/db/sveltekit` работает и в Cloudflare Workers.

## 1. Composition root

Единственный владелец соединения и ресурсов — серверный модуль (`$lib/server`), как в
официальном SvelteKit FAQ «How do I set up a database?»: синглтон процесса, а не на
запрос. Лень важна: `vite dev` и `vite build` спорят из-за file-lock каталога PGlite.

```ts
// src/lib/server/db.ts
import { createDb, conservativeLimits, defineResource, f, field, policy, s } from '$lib/db'
import { pgliteAdapter } from '$lib/db/adapters/pglite'
import { openNodeDatabase, openPgPool, envReader } from '$lib/db/sveltekit/node'
import { applyMigrationText, cursorCodecFromEnv } from '$lib/db/sveltekit'

export const posts = defineResource({
  key: 'demo.post.v1',                    // участвует в scope курсора: переименование = сброс курсоров
  table: 'public.demo_post',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true,
                 orderable: true, filters: ['eq', 'in'] }),
    title: field(s.text({ min: 3, max: 120 }), {
      read: () => true, create: () => true, update: () => true, required: true,
      normalize: (v) => (typeof v === 'string' ? v.trim() : v),
      filters: ['eq', 'contains', 'startsWith'], orderable: true,
    }),
    created_at: f.timestamp({ read: () => true, generated: true,
                              orderable: true, filters: ['gt', 'gte', 'lt', 'lte'] }),
  },
  policy: {
    select: policy.publicRows(),
    insert: policy.roles(['author']),
    update: policy.ownerOrRoles('id', ['editor']),
    delete: policy.roles(['author']),
  },
  order: [['created_at', 'desc']],
})

const env = envReader(process.env, import.meta.env as Record<string, string | undefined>)

let runtime: Promise<{ db: Database; close(): Promise<void> }> | undefined
export const getRuntime = () =>
  (runtime ??= (async () => {
    const cursorCodec = cursorCodecFromEnv(env)      // без DB_CURSOR_SECRET → undefined (только page)
    if (env('DATABASE_URL')) {
      const pg = openPgPool({ connectionString: env('DATABASE_URL')!,
                              max: Number(env('DB_POOL_MAX') ?? (env('VERCEL') ? 1 : 4)) })
      return { db: createDb({ driver: pg.driver, limits: conservativeLimits, cursorCodec }),
               close: pg.close }
    }
    const node = await openNodeDatabase(process.cwd(), env('DATABASE_DIR') ?? 'data/postgres',
                                       { memory: !env('DATABASE_DIR') })
    const db = createDb({ driver: pgliteAdapter(node.db), limits: conservativeLimits, cursorCodec })
    await applyMigrationText(db, MIGRATION)           // demo: схема создаётся тем же путём, что и в проде
    return { db, close: node.close }
  })())
```

Именованные экспорты ресурсов, а не «один глобальный `db`»: маршрут получает
`db.resource(posts)`, и компилятор видит только те поля, которые ресурс разрешил.

`defineResource` проверяет форму конфигурации и падает **на определении**, а не на первом
запросе: `softDelete` без `value`/`readDeleted`, `generated` + write-маска, неизвестный
оператор в `filters`, несуществующие `localField`/`foreignField` у связи, `validateFinal`
не-схема, сортировка по `!orderable`. Причины попадают в `DbFailure.details.issues`
(в dev их видно в `toKitError`, наружу — нет).

## 2. Доверенный контекст: `hooks.server.ts`

`DataContext` — единственный носитель principal/signal/requestId. Собирает его **пакет**
в хуке, поэтому роль невозможно «доложить» телом запроса или query-параметром.

```ts
// src/hooks.server.ts
import { dbHandle } from '$lib/db/sveltekit'
import type { Handle } from '@sveltejs/kit'
import { getRuntime } from '$lib/server/db'

export const handle: Handle = async ({ event, resolve }) => {
  // /db-demo и догрузка страниц его пагинатора (/api/db-posts) — модалки и статика
  // за сессию не платят.
  if (event.url.pathname !== '/db-demo' && !event.url.pathname.startsWith('/api/db-posts'))
    return resolve(event)
  const { db } = await getRuntime()
  const inject = dbHandle({ db, principal: () => DEMO_PRINCIPAL })   // принцип один на все пути демо
  return inject({ event, resolve } as never)
}
```

Что даёт хук:

| Ключ | Значение |
|---|---|
| `event.locals.db` | синглтон `Database` (или результат фабрики `db: (event) => …`) |
| `event.locals.dbCtx` | `DataContext`: `principal` (заморожен), `signal` из `event.request.signal`, `requestId` |
| `paths: [...]` | контекст только для этих префиксов; вне их `dbCtx` = гость (`roles: []`) |
| не-массив `roles` | `forbidden` (403) — а не «тихо пустые права» |

`signal` означает: клиент ушёл со страницы → `pg`-запрос отменяется (`cancel`), а
транзакция откатывается; у Hyperdrive отменённый **до** запроса сигнал не отправляет SQL
вообще.

Типы приложения (важно: `import type` — **на верхнем уровне файла**, внутри
`declare global` слияние не происходит):

```ts
// src/app.d.ts
import type { KitErrorBody, LocalsDb } from '$lib/db/sveltekit'

declare global {
  namespace App {
    interface Error extends KitErrorBody {}
    interface Locals extends LocalsDb {}
  }
}
export {}
```

## 3. Чтение в `load`

```ts
export const load: PageServerLoad = async (event) => {
  const { db } = await getRuntime()
  const api = db.resource(posts)
  try {
    const input = parseListInput(event.url.searchParams)   // ВНУТРИ try: отказ = 422, а не 500
    const [items, totalItems] = await Promise.all([api.select(event.locals.dbCtx, input),
                                                   api.count(event.locals.dbCtx, {})])
    return { items, totalItems }
  } catch (e) {
    const kit = toKitError(e, import.meta.env.DEV)
    throw error(kit.status, kit.body)
  }
}
```

`parseListInput` — deny-safe, а не «игнорируем неизвестное». Разрешённые ключи:
`fields`, `filter`, `order`, `page`, `limit`, `includeDeleted`, `include` (+ `after` для
курсорной пейджинации, и тогда `page` запрещён).

| Запрос | Результат |
|---|---|
| `?limit=2&fields=id,title` | срез + проекция (поля вне grant → `forbidden`) |
| `?filter={"field":"title","op":"contains","value":"из"}` | оператор берётся из `filters` поля; иной оператор → `forbidden` |
| `?order=[["title","asc"]]` | сортировка только по `orderable` |
| `?limit=1&limit=2`, `?page=0`, `?limit=1e9`, `?filter=notjson` | `validation` → 422 |
| `?sort=title` (неизвестный ключ) | 422, а не «молча проигнорировано» |
| `?/create` (маркер form action) | игнорируется: это не данные клиента |

Операторы `filters`: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `notIn`, `isNull`,
`isNotNull`, `contains`, `startsWith` и регистронезависимые пары `icontains`,
`istartsWith`. Последние два — `ILIKE` с тем же экранированием, что и `LIKE`: `\`, `%`, `_` в
значении получают обратный слэш, а escape-символ задан явно (`ESCAPE E'\'`) — значение
`50%` уходит параметром `%50\%%`, поэтому поиск по «50%» не превращается в поиск по чему
угодно. Поле обязано перечислить оператор в `filters`: «оператор есть в языке» ≠ «он
разрешён этому полю» → иначе `forbidden` (403). Индекс под `contains`/`icontains`
(`pg_trgm` GIN) — забота миграций; `002` показывает форму на примере keyset-индекса.

Регистронезависимость зависит ещё и от **энкодинга БД**: в кластере с
`server_encoding = SQL_ASCII` (это дефолт `initdb` при `LANG=C`/`POSIX`) `lower()` и `ILIKE`
складывают только ASCII, и поиск по «СТаль» против «Сталь» вернёт пустоту без ошибки.
Замерено на реальном PostgreSQL 17: UTF8 → 1 строка, SQL_ASCII → 0 строк при живом
`contains` (LIKE байтовый) — `src/lib/db/probes/testdb-encoding.probe.mjs`. Поэтому `withTestDb`
проверяет `lower('А') = 'а'` и отказывает (`unsupported`) на базе без кейс-фолдинга;
в приложении лечится `initdb --encoding=UTF8 --locale=C.UTF-8` либо
`createdb -T template0 --encoding=UTF8`.

Для пагинатора точный `count` не обязателен: `api.estimate(ctx, filter)` →
`{ rows, exact, method }` — `pg_class.reltuples` без фильтра (дешевле на порядки), план
`EXPLAIN (FORMAT JSON)` с фильтром, точный `count(*)` как откат. `exact: false` обязан
отражаться в UI («~12 000»), цифры с `estimate` нельзя показывать как подтверждённые.

Составная коллекция (например «аниме за юзером» = VIEW над 4 таблицами с `jsonb_agg`
тегов) работает так же, как табличная: та же политика, `count`, сортировка и пагинация.
Кейс разобран и проверен на реальном PostgreSQL 17 — `src/lib/db/probes/shikimori-view.probe.mjs`,
выводы — `docs/ACL-DESIGN.md` §13.

Курсорная страница: `api.cursor(ctx, input)` → `{ items, nextCursor }`; `nextCursor` —
подписанный (`DB_CURSOR_SECRET`), версия+`kid`+TTL+scope из `principal` и `resource.key`,
поэтому курсор не переносим между пользователями и не переживает смену политики.
Без секрета `cursorCodecFromEnv` возвращает `undefined`, а `api.cursor` — `unsupported`
(501): пагинатор обязан остаться на `page`.

## 4. Запись в actions

Валидация схемы — часть `insert`/`update`/`delete`, отдельного `safeParse` в маршруте не
нужно. Ошибку превращает в поля `toFormFailure`.

```ts
export const actions: Actions = {
  create: async (event) => {
    const { db } = await getRuntime()
    try {
      const input = await readJson(event.request)                  // или formData → объект
      const row = await db.resource(posts).insert(event.locals.dbCtx, { title: input.title })
      return { ok: true, message: `создано: ${row.title}` }
    } catch (e) {
      const { status, data } = toFormFailure(e, import.meta.env.DEV)
      return fail(status, data)                                    // data.fieldErrors / data.formErrors
    }
  },
}
```

```svelte
<form method="POST" action="?/create" use:enhance>
  {#if form?.fieldErrors?.title}<p role="alert" id="title-error">{form.fieldErrors.title.join(', ')}</p>{/if}
  <input id="title" name="title" aria-invalid={!!form?.fieldErrors?.title} />
</form>
```

Поведение, которое стоит знать заранее (проверено в реальном приложении):

- `title: "ab"` → `fieldErrors.title = ["Too small: expected string to have >=3 characters"]`,
  `aria-invalid`, строка **не** вставлена;
- клиент не может прислать `id`: у поля `immutable` + `createValue` → `forbidden` (403);
- `delete` строки, скрытой политикой → `not_found` (404), а не 403: факт существования
  не протекает;
- `toFormFailure`/`toKitError` никогда не отдают `cause`, текст SQL и параметры — в dev
  добавляется только `diagnostic` (`sqlstate`, `condition`, `field`);
- отказ прав на стороне БД (`RLS`, `GRANT`, `RAISE EXCEPTION … ERRCODE 42501/42502` из
  триггера) идёт в `forbidden` → **403**, а не в 500: «нельзя» и «сервер упал» различимы.

Пакетная вставка — `insertMany`: один `INSERT … VALUES (…),(…) RETURNING` на чанк, валидация
каждой строки — тем же `draftInput`-путём, что и у `insert`.

```ts
const created = await db.resource(posts).insertMany(ctx, rows, { chunkSize: 200 })
// rows.length > 1 чанка → внутри db.transaction; на транспорте без транзакций
// пачка дописывается последовательно, а { atomic: true } = unsupported до первого запроса
```

Отличия от цикла из `insert` — все три проверены тестом: разный набор полей у строк =
`validation` (иначе часть строк получила бы `DEFAULT`, а `RETURNING` ввёл бы в заблуждение);
`hooks`/`validateFinal` с пакетным путём несовместимы = `unsupported`; короткий `RETURNING`
без `onConflictIgnore` = `database`, а не тихий недобор. Лимиты: 1…5000 строк, чанк =
`min(chunkSize, 500, 30000/(колонок+1))` — чтобы не упереться в 65535 параметров протокола.

Сериализационный конфликт — единственная ошибка, при которой повтор всего блока безопасен:

```ts
import { withRetry } from '$lib/db'
await withRetry(db, (tx) => tx.transaction(async (t) => move(t, from, to)), {
  attempts: 5, isolation: 'serializable', onRetry: (e, n) => metrics.inc('db.retry', n),
})
```

Ретраится только то, что помечено `e.details.retryable === true` (`40001`, `40P01`);
пауза — экспоненциальная с джиттером, `wait` инъектируется (в тестах — noop, в runtime
можно дать `scheduler.wait`). Повтор = повтор **всего** callback'а, поэтому изнутри него
нельзя слать письма/дёргать платёж. Детекция сериализационного конфликта требует
`capabilities.sqlstate`, на транспорте без кодов ошибок `withRetry` не удваивает усилия.

`kind → HTTP status` (таблица `FAILURE_STATUS`, каждое значение обязано быть маппингом —
проверяется тестом):

| kind | 422 | 403 | 404 | 409 | 400 | 501 | 503 | 500 |
|---|---|---|---|---|---|---|---|---|
| `validation` | • | | | | | | | |
| `forbidden` | | • | | | | | | |
| `not_found` | | | • | | | | | |
| `conflict`, `transaction` | | | | • | | | | |
| `cursor` | | | | | • | | | |
| `unsupported` | | | | | | • | | |
| `unavailable` | | | | | | | • | |
| `database`, `post_commit` | | | | | | | | • |

## 5. Драйверы

| Адаптер | Ввод | Транзакции | Когда |
|---|---|---|---|
| `$lib/db/adapters/pg` | `pgAdapter(pool, maxInFlight = 32, transactionTimeoutMs = 30000)` | да (savepoint'ы) | Node-сервер, long-lived |
| `$lib/db/adapters/pglite` | `pgliteAdapter(db)` | да | dev/тесты; один пользователь, WASM, не для Workers |
| `$lib/db/adapters/hyperdrive` | `hyperdriveAdapter({ connectionString, timeoutMs = 15000, maxInFlight = 5 })` | да, на одном `Client` | Cloudflare Workers + Hyperdrive |
| `$lib/db/adapters/proxy` | `proxyHttpAdapter(config)` / `proxyWsAdapter(config)` / `proxyAdapter(mode, config)` | HTTP — **нет**, WS — да (один сокет = один backend) | Postgres за HTTP/WS-прокси (`@juit/pgproxy`-протокол): хостинг без TCP, free-контейнеры, домен за Cloudflare |
| транспорт без сессий и без прокси (`neon()` HTTP) | свой `Driver` ≈ 35 строк, `capabilities.transactions = false` | **нет** | [`docs/TRANSPORTS.md`](./docs/TRANSPORTS.md) §5 |

`adapters/proxy` — это протокол `@juit/pgproxy`: `{id, query, params}` → `{id, statusCode,
rows, rowCount, command, fields}`. Три вещи из него следуют, и все три обработаны в адаптере,
а не в приложении: (1) строки приходят **кортежами текста**, имена и типы — в `fields`
`[[name, oid]]`, поэтому адаптер собирает объекты и разбирает значения по OID (bool/int/float/
json/массивы; `int8` и `numeric` остаются строками — как в `pg`); (2) `?auth=`-токен
**одноразовый** и подписывается локальным временем, так что расхождение часов с прокси больше
10 с даёт 403, и адаптер говорит об этом прямо вместо «бэкенд недоступен»; (3) SQLSTATE в
ошибке нет → `sqlstate: false`, и конфликт уникальности честно становится 500, а не 409.

```ts
import { createDb, conservativeLimits } from '$lib/db'
import { proxyWsAdapter } from '$lib/db/adapters/proxy'

const db = createDb({
  limits: conservativeLimits,
  driver: proxyWsAdapter({ url: 'https://proxy.example/', secret: process.env.PGPROXYSECRET! }),
})
```

На Node < 21 нет `WebSocket` — передайте конструктор (`new WebSocket` из `ws`) в `config.WebSocket`.
`proxyHttpAdapter` отличается ровно тем, что `transaction()` возвращает `unsupported` до отправки SQL.

Hyperdrive-адаптер построен по инструкции Cloudflare: **новый `pg.Client` на запрос**
(пул принадлежит Hyperdrive), дедлайн на операцию, `client.end()` в `finally`,
`maxInFlight` — fail-fast без очереди (лимит внешних соединений воркера маленький),
`signal` проверяется до отправки SQL. Требует `nodejs_compat` и `pg >= 8.16.3`.
Транспорт подменяется через `openClient` — на этом держатся тесты адаптера без БД.

Прогоны перенесённых наборов умеют идти против **нативного PostgreSQL** (не PGlite):
`DB_LIB_TEST_PG_URL` и `DB_HARDENING_PG_URL` — и в этом репозитории зелёные в обоих
режимах (см. `PORTING.md` §5). `openPgPool` (в `sveltekit/node`) ставит serverless-дефолты:
`connectionTimeoutMillis 10000`, `idleTimeoutMillis 30000`, `statement_timeout 15000`,
`application_name` (иначе в
`pg_stat_activity` инстансы неразличимы). `max` на Vercel держат равным 1 на инстанс —
число соединений умножается на число холодных стартов. Последние два значения уходят в
**startup-пакет** соединения, и за pooler'ом это либо ломает подключение
(`FATAL: unsupported startup parameter in options: statement_timeout`), либо молча
обнуляется (замер на PgBouncer 1.24.1 с `ignore_startup_parameters`: `SHOW statement_timeout`
→ `0`). Для соединения через pooler передайте `startupParameters: 'skip'`, а
`statement_timeout`/`application_name` поставьте на роли или в настройках пулера. Пустой `connectionString` →
`Missing DATABASE_URL` (проверено), сам пул строится и закрывается без сервера; запросный
путь `pg` покрыт перенесёнными тестами источника на стаб-клиентах (admission cap, дедлайн
транзакции), а сверх этого оба перенесённых набора прогоняются против **нативного
PostgreSQL 17.11** (`DB_LIB_TEST_PG_URL`, `DB_HARDENING_PG_URL`) — 5/5 и там, и там.

Пулу, который живёт между запросами, нужны две вещи, и обе включены по умолчанию:
`keepAlive` (первый пробник через 10 с; `keepAliveInitialDelayMillis`) — иначе NAT убивает
молчащее соединение, и `idleTimeoutMillis` 30 с. Отменяемый запрос (`signal`) всегда возвращает
соединение в пул: успех — `release()`, сбой — `release(err)`; без этого приложение на SvelteKit
вычерпывало пул за `max` запросов и отвечало 500 через `connectionTimeoutMillis` (подробно —
`docs/TRANSPORTS.md` §7.2).

`createDb` требует `limits`. `conservativeLimits`: `pageSize 20`, `maxPageSize 100`,
`maxPage 10000`, `filterDepth 8`, `filterNodes 100`, `inValues 100`, `inputKeys 64`.
Бюджет `inValues` и `inputKeys` — причина, по которой «мелкий» мусор в query не
превращается в большой план; превышение = `validation`.

Пулы pgBouncer/Supavisor (transaction mode) совместимы по построению: сессионного состояния
(`LISTEN`, именованные `PREPARE`, поисковый путь) порт не использует, `SET` — только
`SET LOCAL` внутри транзакции. Замеры против живого PgBouncer 1.24.1 в transaction mode —
`src/lib/db/probes/pooler.probe.mjs` (там же параллельный прогон прямым соединением):

| Что | pooler, transaction mode | прямое соединение |
|---|---|---|
| `BEGIN` … несколько запросов … `COMMIT`, откат, авто-откат при обрыве | ✅ работает (соединение занято до COMMIT) | ✅ |
| `SET LOCAL` внутри транзакции | ✅ | ✅ |
| session-level `set_config(..., false)` | **просачивается**: чужой клиент читает `client1` | своя сессия |
| TEMP-таблица | **видна чужим клиентам** (все сидели на одном серверном соединении) | своя |
| `options=-c search_path=…` / `-c statement_timeout=…` | отбрасываются: `FATAL unsupported startup parameter` или `SHOW statement_timeout = 0` | применяются |
| `LISTEN`, advisory locks, SQL `PREPARE` | приняты, но живут ровно до возврата соединения в пул | живут в сессии |

Отсюда четыре правила: (1) транзакции через transaction-mode пулер **не** нужно отключать —
`pgAdapter` остаётся транзакционным (в отличие от HTTP-транспортов, `docs/TRANSPORTS.md` §3);
(2) «локально работало» на пулере ничего не доказывает — состояние не теряется, а
перетекает между клиентами; (3) `withTestDb` из-за этого проверяет применившийся
`search_path` и на пулере отказывает (`unsupported`), а не пишет в `public`; (4) транзакция
держит серверное соединение пула всё время между запросами — блоки `insertMany`/`withRetry`
держите короткими и без внешних вызовов внутри.

Row-Level Security остаётся ответственностью схемы и миграций: фильтрация в `policy` —
первична, RLS — второй эшелон, пакет её не включает.

## 6. Миграции

```ts
import { applyMigrationText, splitSqlStatements } from '$lib/db/sveltekit'
const statements = splitSqlStatements(await readFile(file, 'utf8'))
await applyMigrationText(db, sql)            // один BEGIN/COMMIT на файл; -> { applied: n }
```

`splitSqlStatements` — не `split(';')`: `;` внутри строк, `--`/`/* */`-комментариев и
`$tag$…$tag$`-блоков оператор не режет (на корпусе SolidHono наивный split давал
осколки вместо 5 операторов). `applyMigrationText` отказывает (`unsupported`), если у
драйвера нет транзакций, — «частично применённая миграция» невозможна по контракту.
В слое лежат `src/lib/db/migrations/001-db-probe.sql` (5 операторов) и
`src/lib/db/migrations/002-db-probe-page-index.sql` (2 оператора) — не для автоприменения, а как образец схемы/индексов под этот слой (`002` показывает `NULLS LAST`
keyset-индекс, который обязана порождать `order`).

Автопрогона на импорте нет сознательно: `vite build` и `vite dev` не должны менять схему.
Прогон — явный скрипт/роут/флаг (в демо — `getRuntime()` при первом обращении к dev-БД).

## 7. Публичный API

| Экспорт | Что |
|---|---|
| `$lib/db` | `createDb`, `DbFailure`, `normalizeFailure`, `fail`, `defineResource`, `field`, `f`, `s`, `make`, `policy`, `createCursorCodec`, `conservativeLimits`, `withRetry` + тип `RetryOptions`, типы (`Database`, `Driver`, `DataContext`, `Capabilities`, `Limits`, `Row`, …) |
| `$lib/db/schema` | zero-dep Standard Schema: `s.text/uuid/integer/bigint/decimal/boolean/date/timestamp/json/array/enum/custom`, `make` |
| `$lib/db/adapters/pg` | `pgAdapter` |
| `$lib/db/adapters/pglite` | `pgliteAdapter` |
| `$lib/db/adapters/hyperdrive` | `hyperdriveAdapter` |
| `$lib/db/adapters/proxy` | `proxyAdapter`, `proxyHttpAdapter`, `proxyWsAdapter` (+ типы `ProxyConfig`, `ProxyMode`) |
| `$lib/db/sveltekit` | `dbHandle`, `createRequestContext`, `toKitError`, `toFormFailure`, `FAILURE_STATUS`, `parseListInput`, `readJson`, `readBoundedBody`, `BodyTooLarge`, `cursorCodecFromEnv`, `splitSqlStatements`, `applyMigrationText`, типы `LocalsDb`/`MinimalEvent`/`Principal` |
| `$lib/db/sveltekit/node` | `openNodeDatabase`, `pgliteDriver`, `openPgPool` (в т.ч. `startupParameters: 'skip'` для pooler), `resolveDatabaseDir`, `envReader` (тут же `node:`/PGlite — в Workers этот entry не импортируют) |
| `$lib/db/testing` | `withTestDb`, типы `TestDb`, `TestDbOptions`, `TestDbEncoding` |
| `$lib/db/zod` | `z` (zod) + `field`/`f`/`defineResource`: позволяет переносить схемы вида `field(z.string().min(1), {...})` без правок; пакет zod не тянет, импорт опциональный |

`withTestDb(fn, options)` — тестовая БД одним вызовом, чтобы приложению не пришлось тащить
Docker. С `url` (или env `KIT_TEST_PG_URL`) это настоящий PostgreSQL в уникальной схеме
`kit_test_<hex>`: изоляция держится опцией пула `-c search_path`, а не `SET` — `SET` при
transaction-пулинге теряется, а startup-параметр живёт на всё подключение. Но и он не
всесерилен: pooler его отбрасывает, поэтому хелпер проверяет `current_schema()` на двух
отдельных подключениях и при несовпадении отказывает (`unsupported`), а не пишет в `public`. Без URL — PGlite в памяти (`memory: true`
выбирает его явно, даже когда URL задан). В callback отдаётся `{ db, schema, sql, tables,
withRetry }`: `sql` — сырой запрос для сидов и проверок «что реально в БД», `tables` —
страховка «миграция применилась», `encoding` — `{ encoding, caseFolds }` (страховка
регистронезависимых операторов, см. §3; `encoding: 'any'` в опциях отключает проверку).
Миграции принимают SQL-тексты (`migrations`) и применяются
одним транзакционным прогоном; таблицы в них обязаны быть **без** схемы в имени (`demo_post`),
иначе уедут в `public`. `DROP SCHEMA … CASCADE` — в `finally`, поэтому параллельные прогоны не
мешают друг другу. `pg`/PGlite подгружаются динамически и в production-сборку не попадают.

`Field`-флаги: `column`, `schema`, `kind`, `read`/`create`/`update` (Grant),
`generated`, `immutable`, `required`, `nullable`, `normalize`, `createValue`, `filters`,
`orderable`. `Resource`: `key`, `table`, `primaryKey`, `ownerField`, `mandatoryRead`,
`policy`, `order`, `hooks`, `relations`, `constraints`, `validateFinal`, `softDelete`.
Строки `select` типизированы как `Partial<…>` — проекция вправе вернуть не все поля, а
relations добавляются через `include`.

Условия окружения: `DB_CURSOR_SECRET` (не короче 32 байт — более короткий ключ
отказывается сам кодек, `createCursorCodec`, а не молча подписывает слабым HMAC),
`DB_CURSOR_OLD_KEYS` (кольцо старых ключей для мягкой смены секрета,
`kid:secret,...`), `DB_CURSOR_TTL_SECONDS` (по умолчанию 1800). Остальные имена
(`DATABASE_URL`, `DATABASE_DIR`, `DB_POOL_MAX`, `HYPERDRIVE_CONNECTION_STRING`, `VERCEL`)
читает приложение — пакет принимает значения, а не env.

## 8. Как слой связан с деревом приложения

Слой — часть приложения, поэтому никаких `exports`/`files`/`tsconfig.build.json` у него
нет: Vite резолвит `$lib/db` в `src/lib/db`, a `svelte-check` видит `.ts` как есть. Единствен-
ное ограничение, которое теперь держит контракт потребителя, проверяется аудитом: приложение
импортирует слой **только** через `$lib/db…` (никаких `../../lib/db`), а карта entry-поинтов
ниже — единственное, что считается публичным API.

## 9. Разработка слоя

Слой проверяется теми же командами, что и всё приложение:

```sh
npm run test:db       # vitest по src/lib/db (структура, порт-специфика, перенесённые проверки, аудит доков)
npm run test          # всё: vitest по src + node --test tooling/
npm run check         # svelte-check по всему дереву (тесты слоя из него исключены, как и остальные *.test.ts)
npm run build         # здесь важен и layer-guard: обход $lib/form роняет сборку
npm run test:db:probes # пробы на живых движках (см. ниже) — нужен поднятый PG/прокси
```

Тесты слоя — 65 групп в четырёх файлах (на PGlite выполняются 64: одна группа требует
настоящего PostgreSQL):

| Файл | Группы | О чём |
|---|---|---|
| `src/lib/db/test/db-structure.test.ts` | 6 | границы слоя: у `./sveltekit` нет импортов `node:`/`pg`/PGlite, каждый `FailureKind` замаплен, баррель не тянет адаптеры, `src/lib/db/migrations/*.sql` парсятся |
| `src/lib/db/test/db-port-specific.test.ts` | 30 | поведение, которого в источнике не было (курсоры, `parseListInput`, отмена и пул, прокси-транспорты, Hyperdrive, замок каталога) |
| `src/lib/db/test/ported/db-lib.script.ts` | 16 | перенесённые проверки источника (один `it` на скрипт из `test/db-ported.test.ts`: PGlite/PG поднимаются раз на файл) |
| `src/lib/db/test/ported/db-hardening.script.ts` | 5 | устойчивость отказов: отмена, дедлайны, отравленный parent |
| `src/lib/db/test/ported/db-followup.script.ts` | 9 | дополнения переноса (из 12 групп источника снято 3, причины — `src/lib/db/PORTING.md`) |
| `src/lib/db/test/db-docs.test.ts` | — | боевой прогон `tooling/db-docs.mjs`: README/PORTING против кода |

Аудит документации живёт как остальные стражи приложения: правила и разбор — в
`tooling/db-docs.mjs` с юнит-тестами `tooling/db-docs.test.mjs` (`node --test tooling/`),
а сверка с настоящим кодом — тестом внутри слоя, потому что `.ts` читается только там, где
есть TS-транспиляция. `dist`-сборки, `fix-esm` и `npm pack` из прошлого жизненного цикла пакета
больше нет: приложение компилирует исходники само.

Есть и прогон на живых движках: `src/lib/db/probes/` — PGlite (`pglite.probe.mjs`),
нативный PostgreSQL 17 и четыре транспорта сразу (`transport-matrix.probe.mjs`, требуется
поднятое окружение; матрица и выводы — [`docs/TRANSPORTS.md`](./docs/TRANSPORTS.md)); там же
`testdb-encoding.probe.mjs` — ловушка `SQL_ASCII` для `icontains`, `pooler.probe.mjs` —
поведение под PgBouncer'ом, `proxy-live.probe.mjs` — живое включение `adapters/proxy`,
`src/lib/db/probes/pg-live.probe.mjs` — прямой TCP к PostgreSQL: предполёт-хендшейк (не грузить
недоступный порт таймаутами пула) + границы, которых у прокси нет (`sqlstate` → `conflict`, savepoints).
Пробы — `.mjs`/`.mts` со `import`-ами TS-исходников, поэтому запускаются через tsx:
`node --import tsx src/lib/db/probes/<имя>.probe.mjs`.