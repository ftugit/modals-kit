# Транспорты: Vercel, Cloudflare, пулеры, PGlite

Вопрос, на который отвечает документ (CHECKLIST-2 §T3): работает ли PostgreSQL, который
дают Vercel/Cloudflare, **через текущий `lib/db` как есть**, что при этом отваливается и
корректно ли ведёт себя ядро с недостающими частями. Отдельный «HTTP-пакет» — нет.

> **Короткий ответ на «можно ли держать БД у Cloudflare/Vercel»**: как *хранилище*
> PostgreSQL — нигде: своего Postgres нет ни там, ни там (Cloudflare — D1, это SQLite;
> Vercel — маркетплейс-интеграции). Как *вычисление рядом с такой БД* — да, и `lib/db` к ней
> подключается без правок: Vercel → `pgAdapter` + `DATABASE_URL` от Neon/Supabase,
> Cloudflare → `hyperdriveAdapter` поверх внешнего PostgreSQL. Что теряется при
> бессессионном доступе — §2–§3 (ровно 7 операций, и все отказывают явно).

Всё, что ниже, измерено в этом репозитории (`src/lib/db/probes/transport-matrix.probe.mjs`, по
пулерам — `src/lib/db/probes/pooler.probe.mjs` на живом PgBouncer), а не выведено из документации
провайдеров.
Колонки `pgproxy HTTP`/`pgproxy WS` изначально снимались эталонной копией клиентского кода
(`src/lib/db/probes/lib/proxy-driver.mjs`); с 09.10.2026 те же границы проверяются портированным
`./adapters/proxy` — `src/lib/db/probes/proxy-live.probe.mjs`. Ссылки на документацию — только для
того, что в песочнице недоступно (сами инстансы Vercel/Cloudflare).

## 1. Разницу транспортов описывают 4 бита

`Capabilities` (`src/lib/db/types.ts`) читается ядром ровно в трёх местах:

| Бит | Кто спрашивает | Что решает |
|---|---|---|
| `transactions` | `src/lib/db/database.ts:116` (`db.transaction`), `src/lib/db/resource.ts:356` (хуки/`validateFinal`), `src/lib/db/sveltekit/migrate.ts:81` (`applyMigrationText`) | есть ли интерактивная транзакция |
| `savepoints` | `src/lib/db/database.ts` (`scope()` при вложенном `transaction()`) | можно ли катать часть работы |
| `sqlstate` | маппинг ошибок (`errors.ts` → `normalizeFailure`) | `23505` становится 409 `conflict` или нет |
| `isolationLevels` | `beginSQL` | разрешён ли `isolation` из вызова |

Больше нигде. Поэтому «транспорт без сессий» — это не отдельная ветка кода, а четыре
значения в одном объекте, и все три отказывающие места стоят **до** генерации SQL:
`unsupported` приходит, ни один запрос не отправлен. Проверено: ресурс с
`hooks`/`validateFinal` на HTTP-транспорте не делает ни `INSERT`, ни `SELECT`.

Отсюда — главный вывод T3: ядру всё равно, откуда пришли строки. Оно не знает TCP, HTTP,
пулов и провайдеров; оно знает `Driver = { capabilities, query, transaction, close? }`.

## 2. Матрица: один и тот же набор операций через 4 транспорта

Транспорты: `pg` (нативный пул к PostgreSQL 17.11), PGlite (WASM, в памяти), и два
транспорта через Juit pgproxy — HTTP (без сессий) и WebSocket (сессия есть). Колонки —
результат операции: `ok`, имя `DbFailure.kind`, или явный `unsupported`.

| Операция | `pg` · пул (нативный) | PGlite (memory, WASM) | pgproxy HTTP (без сессий) | pgproxy WS (сессия есть) |
|---|---|---|---|---|
| DDL (DROP + CREATE последовательно) | ✅ ok | ✅ ok | ✅ ok | ✅ ok |
| select + count + order + limit | ✅ ok | ✅ ok | ✅ ok | ✅ ok |
| фильтр ILIKE (icontains) | ✅ ok | ✅ ok | ✅ ok | ✅ ok |
| keyset-страница (cursor) | ✅ ok | ✅ ok | ✅ ok | ✅ ok |
| estimate (reltuples/EXPLAIN/count) | ✅ ok | ✅ ok | ✅ ok | ✅ ok |
| insert + update + delete | ✅ ok | ✅ ok | ✅ ok | ✅ ok |
| insertMany (1 чанк) | ✅ ok | ✅ ok | ✅ ok | ✅ ok |
| insertMany (3 чанка: на HTTP просто 3 INSERT подряд) | ✅ ok | ✅ ok | ✅ ok | ✅ ok |
| insertMany (3 чанка) + atomic: true | ✅ ok | ✅ ok | 🛑 unsupported | ✅ ok |
| транзакция: rollback не оставляет следов | ✅ ok | ✅ ok | 🛑 unsupported | ✅ ok |
| savepoint (вложенная откатка) | ✅ ok | ✅ ok | 🛑 unsupported | ✅ ok |
| write с hooks/validateFinal (хочет tx) | ✅ ok | ✅ ok | 🛑 unsupported | ✅ ok |
| applyMigrationText (хочет tx) | ✅ ok | ✅ ok | 🛑 unsupported | ✅ ok |
| конфликт UNIQUE → 409 conflict | ✅ ok | ✅ ok | kind=database | kind=database |
| set_config(...,true) внутри транзакции | ✅ ok | ✅ ok | 🛑 unsupported | ✅ ok |
| set_config вне транзакции (пул = лотерея) | потерян | потерян | потерян | потерян |
| TEMP TABLE в следующем запросе (лотерея пула, не гарантия) | видна | видна | видна | видна |
| withRetry обёртка (x3 на 40001) | ✅ ok | ✅ ok | 🛑 unsupported | ✅ ok |

`🛑 unsupported` = явный отказ **до** генерации SQL: ни одного запроса не отправлено. «kind=…» = какой `DbFailure.kind` получился вместо `ok`. `потерян`/`видна` — про сессионное состояние, см. §3.
Рядом с матрицей — цена round-trip, потому что на HTTP-транспорте она и есть главный
аргумент против «просто везде делать HTTP»: **pg (пул) 0.34 мс · PGlite 0.70 мс ·
pgproxy HTTP 5.40 мс · pgproxy WS 5.04 мс** на один и тот же `select … limit 1`
(40 повторов, localhost). Каждый `include` — это отдельный `LATERAL`-запрос, то есть
N+1 умножается на эти милисекунды: на `pg` 20 связей ≈ 7 мс, поверх HTTP-прокси ≈ 108 мс.

Повторить:

```sh
node src/lib/db/probes/transport-matrix.probe.mjs
# PostgreSQL 17 и pgproxy — рецепты в CHECKLIST-2 §0
# PG_MATRIX_URL · PGPROXY_URL · PGPROXY_SECRET · PGPROXY_MODULES · DEBUG_MATRIX=1
# живое включение портированного ./adapters/proxy: PROXY_URL · PROXY_SECRET · PROXY_INSECURE=1 · PROXY_GAP_MS
```

Строка «фильтр ILIKE» прогнана на ASCII-значении: песочный кластер поднят с
`server_encoding = SQL_ASCII`, где `ILIKE` складывает только ASCII (подробности и способ
ловить это — README §3 и `src/lib/db/probes/testdb-encoding.probe.mjs`). На транспортах это не сказывается:
дело в энкодинге базы, а не в способе достучаться до неё.

`src/lib/db/probes/lib/proxy-driver.mjs` — **не** часть пакета: это 130-строчная копия переносимых
адаптеров источника (`server/lib/db/adapters/proxy-{client,http,ws}.ts` @ `f8079b1`),
нужная только чтобы измерить поведение ядра над настоящим прокси. `@juit/*` она берёт из
лаборатории (`PGPROXY_MODULES`), поэтому `dependencies` пакета остаются пустыми.

## 3. Что отваливается и как именно

**Транспорт без интерактивных транзакций** — это HTTP-транспорты (`neon()` в HTTP-режиме,
pgproxy, любой «fetch-to-SQL») и statement-mode пулеры. Пулер в **transaction** mode
(PgBouncer/Supavisor/Hyperdrive) в этот список **не** входит: `BEGIN` … запросы … `COMMIT`
через него работает — серверное соединение держится занятым до `COMMIT`, поэтому
транзакции делают короткими, а не убирают (замер: `src/lib/db/probes/pooler.probe.mjs`, D1–D3 и H1).
Ровно 7 возможностей теряют HTTP-транспорты:

| Операция | Поведение | Почему так, а не иначе |
|---|---|---|
| `db.transaction(fn)` | `unsupported` | эмуляция через «последовательные запросы» = ложная атомарность |
| вложенный `tx.transaction()` (savepoint) | `unsupported` | без savepoint откат внутренней работы зацепил бы внешнюю |
| запись в ресурс с `hooks.beforeWrite`/`afterWrite`/`validateFinal` | `unsupported` **до SQL** | проверка результата + хуки требуют, чтобы «всё или ничего» держал сервер |
| `applyMigrationText` | `unsupported` | «частично применённая миграция» хуже, чем неприменённая |
| `set_config(..., true)` внутри транзакции (RLS-путь) | `unsupported` | GUC живёт в сессии; без транзакции нет гарантии, что следующий запрос увидит его |
| `withRetry` | `unsupported` | повтор имеет смысл только когда откатан целиком весь блок |
| `insertMany` с >1 чанком и `{ atomic: true }` | `unsupported` | без `atomic` пачка дописывается последовательно и честно (неатомарно) — см. §5 |

Всё остальное — `select`/`count`/`get`/`cursor`/keyset/`include`/`softDelete`/маски
полей/лимиты, `insert`/`update`/`delete` без хуков, `insertMany` в один чанк,
`estimate` — одиночные инструкции, и они работают одинаково на всех четырёх транспортах
(строки матрицы выше). Типы строк тоже не зависят от транспорта: приведация
`result()` → `normalizeValue` живёт в `adapters/shared.ts`, а не в `pg`.

**Бит `sqlstate`.** Прокси переносит ошибку как строку (`{statusCode, error}`), и в
`error.message` SQLSTATE не входит — сервер Juit отдаёт `error: error.message`
(`pgproxy-server/dist/server.mjs:231`). Значит `sqlstate: false`, и конфликт уникальности
деградирует: `409 conflict` → `500 database`. В матрице это видно по строке
«конфликт UNIQUE» — на `pg`/PGlite `ok`, на обоих прокси `kind=database`.

Что с этим делать, по возрастанию цены:

1. Проектировать запись так, чтобы конфликт не был сигналом: `insertMany({ onConflictIgnore: true })`
   или `update` c `onConflict` — они не нуждаются в коде ошибки (проверено: на HTTP `ok`).
2. Оставлять `conflict`-семантику только там, где есть `pg`/WS-сессия с полем `code`.
3. Если очень нужно поверх прокси — читать `error.message` и матчить текстовые маркеры. Это
   эвристика, не SQLSTATE: в пакет она не переносится.

Отдельная заметка «улучшение для апстрима»: если бы pgproxy переносил `code` из
`pg`-ошибки, HTTP-транспорт получил бы `sqlstate: true` и весь 409-путь бесплатно —
ядро менять не пришлось бы.

**Сессионные объекты.** `set_config` **вне** транзакции теряет значение на всех четырёх
транспортах, включая нативный пул (`pg`, `max: 4`) — это не баг прокси, а свойство пула:
следующий запрос может уйти на другой backend. TEMP-таблица в матрице «видна» и на HTTP —
только потому, что пул прокси в этом прогоне маленький; на `max: 1` она тоже стала бы
лотереей. Отсюда правило, которое ядро соблюдает само и требует от прикладного кода:
**состояние сессии — только `SET LOCAL` внутри транзакции** (`hooks` RLS-путь в
`resource.ts` делает именно так). `LISTEN`/`NOTIFY`, advisory locks, именованные
`PREPARE` и курсоры вне транзакции не используются нигде в пакете, поэтому он
transaction-pool-совместим по построению.

## 4. Провайдеры: что подключать

### Vercel (2026)

Своего Postgres у Vercel нет и не будет в виде продукта: `Vercel Postgres` недоступен,
существующие базы были автоматически перенесены на Neon (переезд начался в декабре 2024 и
закрывался в 2025), для новых проектов остаётся только **Marketplace Storage**. Postgres-
провайдеры маркетплейса: Neon, Supabase, Prisma Postgres, AWS Aurora Postgres, Nile,
CockroachDB — а PlanetScale (MySQL) и Upstash (Redis) к Postgres отношения не имеют.
Установка (`vercel install neon`) провижинит БД **у провайдера** и кидает в проект
переменные окружения; c апреля 2026 дашборд умеет выполнять SQL и править строки. «Vercel
нативно поддерживает Supabase» означает именно это: провижининг + env + встроенный браузер
данных. Данные при этом лежат не на Vercel.

Следствие для пакета: никакого кода под Vercel не нужно.

```ts
// src/lib/server/db.ts — стандартный путь, никаких env-фич кроме DATABASE_URL
import { openPgPool } from '$lib/db/sveltekit/node'
export const db = createDb({ driver: pgAdapter(openPgPool(process.env.DATABASE_URL!, { max: 1 })) })
```

`openPgPool` уже ставит serverless-дефолты (`max: 1` на инстанс — через `DB_POOL_MAX`,
`connectionTimeoutMillis 5000`, `idleTimeoutMillis 30000`, `statement_timeout`,
`application_name`). Миграции — скриптом/роутом вне request-пути; на `pgAdapter` они
работают, если строка соединения прямая (Neon pooled-строка с `-pooler` = transaction
mode → миграции в неё не ходят, `applyMigrationText` требует транзакцию).

### Cloudflare Workers + Hyperdrive

Своего Postgres у Cloudflare нет (D1 = SQLite; контейнеры эфемерны, Hyperdrive изнутри
контейнера не используется), поэтому ответ — Hyperdrive поверх любого внешнего PG.
Условия: `nodejs_compat`, `pg >= 8.16.3`, **новый `Client` на запрос** (пул держит
Hyperdrive), binding + `localConnectionString` в `wrangler.json`, `placement.mode = "smart"`.

Это ровно то, что делает `hyperdriveAdapter`: `openClient` заменяем (на нём стоят тесты
адаптера без БД), `maxInFlight = 5` fail-fast без очереди, `signal` проверяется до отправки.

Что запрещает Hyperdrive и как это выглядит в `lib/db`:

| Ограничение Hyperdrive | Поведение пакета |
|---|---|
| `LISTEN`/`NOTIFY` не поддерживаются | не используется; кэш ACL-схемы нельзя вешать на `LISTEN` — TTL (`schemaCacheTtlMs`) |
| advisory locks не поддерживаются | ядро их не берёт; локадч — `SELECT … FOR UPDATE` внутри `transaction()` |
| SQL-level `PREPARE`/`DEALLOCATE`/`DISCARD` | `pg` ходит unnamed statement'ом → не нужно |
| длинные транзакции держат соединение пула («keep transactions as short as possible», внешние вызовы внутрь не класть) | транзакции **разрешены и работают**: адаптер остаётся `transactionalCapabilities`, `hooks`/`validateFinal` доступны; `maxInFlight = 5` — под лимит воркера на исходящие соединения |
| session state не сохраняется | `SET LOCAL` внутри транзакции — единственный разрешённый вариант |

При `pooling mode = session` (или прямом соединении) транзакции доступны, и адаптер
ставит `transactionalCapabilities` — то есть переключается режимом пула, а не кодом.

### Supabase (в т.ч. бесплатный план через Vercel Marketplace)

**Бесплатный Supabase на Vercel есть**: интеграция из маркетплейса (`vercel install supabase`)
создаёт проект на Free-плане Supabase — 500 МБ БД, 1 ГБ хранилища, 50 000 MAU, до 2 проектов.
Проект на Free **ставится на паузу после 7 дней бездействия**, и Spend Cap (страховка от
перерасхода) на Free отсутствует [1](https://kuberns.com/blogs/vercel-supabase/),
[2](https://padezhnov.com/en/blog/vercel-supabase-free-tier-trap-real-costs-when-your-project-scales/).
Сторона Vercel — Hobby, а он запрещает коммерческое использование.

Дальше — то, что обычно и ломает ожидание «поднимаю БД у облака и подключаюсь напрямую»:
**режим доступа различается не только портом, но и версией IP-адреса**
[3](https://supabase.com/docs/guides/database/connecting-to-postgres):

| Режим | Хост:порт | Free | Paid | Paid + IPv4 add-on |
|---|---|---|---|---|
| Direct (без пулера) | `db.<ref>.supabase.co:5432` | **IPv6** | IPv6 | IPv4 |
| Shared pooler, session mode | `aws-<i>-<region>.pooler.supabase.com:5432` | **IPv4** | IPv4 | IPv4 |
| Shared pooler, transaction mode | `aws-<i>-<region>.pooler.supabase.com:6543` | IPv4 | IPv4 | IPv4 |
| Dedicated pooler (PgBouncer), transaction mode | `db.<ref>.supabase.co:6543` | — | IPv6 | IPv4 |

Исходящие IPv6-соединения у Vercel Functions не работают, и это ловят как `ENOTFOUND` /
`ETIMEDOUT` на `db.<ref>.supabase.co` [4](https://community.vercel.com/t/database-connection-from-vercel-to-supabase/25034);
IPv4 add-on платный ($4/мес) и **на Free недоступен**. Итог по вопросу «можно ли pg напрямую,
в обход Supabase»: **в обход supabase-js/PostgREST — да, и это штатный путь пакета; в обход
пулера (к 5432) с Vercel Free — нет**, там только shared pooler (он IPv4 на любом плане).

```ts
// src/lib/server/db.ts — ни @supabase/supabase-js, ни REST: только pg
import { createDb, conservativeLimits } from '$lib/db'
import { openPgPool } from '$lib/db/sveltekit/node'
import { pgAdapter } from '$lib/db/adapters/pg'

// строка shared pooler: пользователь `postgres.<PROJECT-REF>`, порт 5432 (session) или 6543 (transaction)
const runtime = openPgPool({
  connectionString: process.env.POOL_DB_URL!,  // со sslmode=require
  max: 1,                                      // тёплых инстансов на Vercel много; это потолок на инстанс
  startupParameters: 'skip',                   // за пулером GUC startup-пакетом не доезжают (см. ниже)
})
export const db = createDb({ driver: pgAdapter(runtime.pool), limits: conservativeLimits })
```

Что choosing режима меняет для `lib/db`:

- **session mode (5432 на пулер-хосте) — рекомендуемый путь на Free**: IPv4 есть на любом плане,
  и «ограничения transaction mode» к нему не относятся — prepared statements, курсоры,
  состояние сессии и pipelining поддерживаются [3](https://supabase.com/docs/guides/database/connecting-to-postgres).
  Цена: 1 клиент = 1 занятое серверное соединение (pool size на Free маленький) → `max: 1`,
  короткие транзакции, никаких пулов в global scope.
- **transaction mode (6543)**: транзакции работают (замер D1–D3: `BEGIN` … `COMMIT` через
  PgBouncer сохраняет атомарность и откат), теряются 4 вещи — именованные `PREPARE`,
  `with hold`-курсоры, состояние сессии между транзакциями, pipelining. Ядро не использует
  ни одного из них; отдельной настройки `node-postgres` не требуется — рекомендация Supabase
  для `pg` = «не передавать `name` в запросе» [3](https://supabase.com/docs/guides/database/connecting-to-postgres),
  а `pgAdapter` именно так и делает.
- **startup-GUC через пулер не доезжают** — измерено на PgBouncer 1.24.1 (тот же протокол, что
  у Supabase dedicated pooler): либо `FATAL: unsupported startup parameter in options: …`,
  либо параметр молча игнорируется (`SHOW statement_timeout` → `0`). Отсюда
  `startupParameters: 'skip'` выше и проверка `search_path` в `withTestDb`: без неё
  «изолированная тестовая схема» за пулером превращается в `public`.
- **Миграции и `pg_dump`** Supabase отправляет на direct [3](https://supabase.com/docs/guides/database/connecting-to-postgres) —
  с Vercel Free это недоступно по IPv6, поэтому `applyMigrationText` гонят из CI/локально
  (где IPv6 есть) либо через session-mode пулер; в transaction-mode он тоже пройдёт
  (DDL — одиночные инструкции, обёрнутые в один `BEGIN/COMMIT`), но это ровно тот случай,
  где «работало локально» и «работает под нагрузкой» расходятся.
- **Env-имена от интеграции Vercel**: в реальной практике интеграция отдаёт `POSTGRES_URL`
  (пулер) и `POSTGRES_URL_NON_POOLING` (direct) и **не** создаёт `DATABASE_URL`
  [5](https://github.com/batesy87/vehicle-movement-platform/pull/6) — сверьтесь с дашбордом и
  при необходимости заведите свои имена; в логи строку подключения не печатают (в ней пароль).
- **Лимит соединений на Free: 60 прямых подключений**
  [6](https://supaexplorer.com/best-practices/supabase-postgres/conn-pooling/) — ещё одна причина,
  почему «pg без пулера» на Free заканчивается отказом в соединении под первыми же десятками
  пользователей.

Два практических вывода для нашего слоя: `icontains`/`istartsWith` и `SET LOCAL`-контур RLS
не зависят от режима пулера; а вот `LISTEN`-инвалидация кэша схемы, `pg_dump`-бэкапы и
`ALTER ROLE … SET` требуют direct/session — см. README §5 (замеры по строкам) и §6.
### Neon

Два режима одним пакетом — и это лучший аргумент, что транспортов «много», а библиотек —
одна: Drizzle имеет `neon-http` и `neon-serverless`, живущие в **одной** либе.

- `neon()` (HTTP): один запрос за раз, без сессий и без интерактивных транзакций
  (батч `sql.transaction([...])` исполняется на сервере целиком, прикладной код между
  операторами вставить нельзя). → `capabilities = {transactions:false, savepoints:false, sqlstate:true, isolationLevels:[]}`:
  `NeonDbError` несёт `code`, поэтому 409-пакетная семантика сохраняется.
  Полезна только для read-only ручек и ручек без хуков.
- WS-`Pool`/`Client`: полноценная сессия + prepared-plan caching → все возможности
  включены. На Node ≤ 21 нужен `neonConfig.webSocketConstructor = ws`; на Vercel —
  держать одно WS-соединение на инстанс и закрывать его по завершении запроса, иначе
  воркеры не масштабируются.
- Ограничение, о котором стоит знать заранее: ни один режим не даёт `LISTEN`
  (нет сессии в HTTP), и observability за HTTP-запросами бесплатно не даётся — Sentry не
  делает spans на `@neondatabase/serverless` (getsentry/sentry-javascript#25144). Если
  нужны трейсы — оборачивать `Driver.query` своей обёрткой, а не ждать от провайдера.

### Три решения, которые следуют из §4 (и они же — правки в пакете)

| Решение | Что оно значит в коде |
|---|---|
| `capabilities` адаптера под pooler'ом **не** меняются | transaction-mode пулер держит `BEGIN…COMMIT` (замер D1–D3), поэтому `transactionalCapabilities` остаются честными; «не-транзакционный» профиль нужен HTTP-транспортам и statement-mode пулерам |
| startup-параметры (`statement_timeout`, `application_name`, `-c search_path`) отправляются только на прямом соединении | `openPgPool({ startupParameters: 'skip' })` под pooler; `withTestDb` проверяет применившийся `search_path` и на пулере отказывает (`unsupported`), а не пишет в `public` |
| IPv4/IPv6 у Supabase — не «деталь хостинга», а развилка | с Vercel Free direct недоступен (IPv6-only хост + нет исходящего IPv6); путь — shared pooler, и он же умеет session mode на том же IPv4 |

## 5. Нужен ли отдельный `lib/db-http`? Нет

Измеренная причина, по которой «не нужен»: разница транспортов умещается в 4 бита, а
разница поведения — в 7 явных `unsupported`. Ядро уже делает то, чего не делают ни Drizzle,
ни Kysely: отказывает **до** отправки SQL и не пытается эмулировать атомарность.

Отдельный пакет/форк означал бы два места, где живёт политика безопасности (`policy`,
`filterSQL`, маски полей, `ident()`), — то есть ровно тот класс рассинхрона, который
`PORTING.md` предотвращает. Вместо этого:

```ts
// весь «HTTP-транспорт» = 35 строк поверх существующего ядра
const driver: Driver = {
  capabilities: { transactions: false, savepoints: false, sqlstate: false, isolationLevels: [] },
  async query(s) { return result(await httpOneStatement(s.text, s.values), rowCount) },
  async transaction() { return unsupported() },          // не эмулируем
  async close() {},
}
```

Правила, которые делают такой адаптер безопасным (все три нарушены в типичных «fetch-to-SQL»
обёртках): (1) **одно утверждение на запрос** — прокси не обязан резать `;`, поэтому
`applyMigrationText` и любые мульти-стейтменты не должны в него попадать; (2) не передавать
значения конкатенацией; (3) не ставить `sqlstate: true`, если транспорт не переносит код
ошибки, — иначе `409` превращается в враньё вместо `500`.

**Решение по T3.2 (изменено 09.10.2026):** адаптеры **перенесены** — `src/lib/db/adapters/proxy.ts`,
entry `$lib/db/adapters/proxy` (`proxyHttpAdapter` / `proxyWsAdapter` / `proxyAdapter(mode, …)`),
без `@juit/pgproxy-client*`: транспорт — `fetch` + `WebSocket` + Web Crypto, поэтому пакет
остаётся zero-dep, а тесты гоняются на заглушке транспорта. Код и правила источника соблюдены:
`maxInFlight` fail-fast без очереди, `timeoutMs` на операцию, отмена через `AbortController`,
валидация конфига до первого сокета (без credentials/query в URL, HTTPS кроме localhost с
`allowInsecureLocalhost`, секрет ≥ 32). Приёмка — те же проверки, что и матрица:
`src/lib/db/probes/proxy-live.probe.mjs` против живого pgproxy (11 проверок → `PROXY_LIVE_OK`).

Что пришлось добавить против источника (потому что `PGClient` делал это за нас):

| Факт протокола | Что делает адаптер |
|---|---|
| `rows` — кортежи, значения — **текст**, имена/типы в `fields: [[name, oid]]` | собирает объекты и разбирает по OID: `bool`, `int2/4`, `float4/8`, `json/jsonb`, timestamps, pg-массивы; `int8` и `numeric` оставляются строками — ровно как `pg`, чтобы поведение не разъезжалось между транспортами |
| `params` принимаются как `(string \| null)[]` | сериализация под text-протокол: `undefined → null`, `true → "t"`, массив → `{a,"b\"c"}`, `Uint8Array → \\x…` |
| `?auth=` одноразовый (сервер помнит выданные 60 с), подпись = HMAC по **локальному** времени | новый токен на каждую операцию; 401/403 маппятся в `unavailable` с явной подсказкой про расхождение часов > 10 с — иначе это выглядит как «сломанные данные» |
| error-кадр без SQLSTATE (`server.mjs:231`) | `sqlstate: false` → конфликт уникальности = 500, а не 409; чинится только на сервере (поле `code` в кадре) |

## 6. Что отсюда следует для ACL-схемы и приёмки

Из §14 `docs/ACL-DESIGN.md`: приёмка ACL обязана прогоняться на 4 транспортах. Матрица
выше и есть форма этого прогона; на HTTP-транспорте часть ACL-возможностей (запись с
хуками, `SET LOCAL`-контекст для RLS, миграции) недоступна — значит политика «REST поверх
HTTP-прокси только для чтения» корректна, а запись требует pg/WS/Hyperdrive-session.

Кэш ACL-схемы нельзя строить на `LISTEN` (недоступен на Hyperdrive и в HTTP-транспорте) —
единственный безопасный механизм — TTL + явный `refresh` (как и запланировано).

После переноса `./adapters/proxy` формулировка «запись требует pg/WS/Hyperdrive-session»
означает concrete: в приложении достаточно `proxyWsAdapter({url, secret})`, и ни `hooks`,
ни `validateFinal`, ни `insertMany{atomic}`, ни `applyMigrationText` не придётся отключать —
WS-сессия держит один backend на всю транзакцию. Не хватает по-прежнему только `409`.

## 7. Postgres напрямую, без прокси: что показали замеры (2026-10-09)

Контейнер перевели на `exec postgres -D ...` (без pgproxy-лаунчера), чтобы смотреть поведение
чистого сервера. Наружу это ничего не вывело - по замерам, не по догадкам:

| канал | результат |
|---|---|
| DNS `pzlbdb.freesrv.com` | `104.21.5.34` / `172.67.132.221` - anycast Cloudflare, не IP контейнера |
| TCP `:5432` и `:5433` | connect проходит (anycast принимает всё), дальше **тишина**: на 8-байтовый `SSLRequest` ответа нет 9 с |
| `https://.../` и `https://.../healthz` | 200 с страницей хостера «**Web server isn't running**» (Subdomain proxy 502 -> custom page): HTTP-дверь контейнера пуста, pgproxy больше не слушает |

Вывод: **протокол PostgreSQL через этот фронт не проходит**. Cloudflare проксирует только
разрешённые HTTP(S)-порты; «серая» DNS-запись с прямым пробросом порта, Spectrum или Tunnel -
другая конфигурация, которой у free-контейнера нет. Для такого хостинга транспорт остаётся один:
HTTP/WS-прослойка (параграф 5, перенесённые адаптеры) - она проверена живьём и работает.

Правила, которые из этого вышли:

1. **Проверять доступность до пула, а не после.** `src/lib/db/probes/pg-live.probe.mjs` начинается с
   raw-хендшейка `SSLRequest` (4 с) и печатает `PG_LIVE_SKIPPED` с диагнозом. Без него `pg` жжёт
   `connectionTimeoutMillis` на каждый запрос: первый прогон против этого хоста дал 153 с «ошибок»
   вместо 4 с честного «недоступно», и выглядело это как деградация сервера, которой не было.
2. Тот же предполёт нужен **любому** клиенту `lib/db` на фронт-хостинге: REST-слою (T4), CI,
   health-чекам деплоя.
3. Прямое соединение с настоящим PostgreSQL зонд проверяет целиком (PG17, UTF8):
   **`PG_LIVE_OK (12 проверок)`** при 7 обращениях - и в нём ровно те две границы, которых у прокси
   нет: дубликат UNIQUE -> `conflict` + `details.sqlstate = 23505` (значит из REST-слоя возможен
   409), и savepoint-семантика вложенных `db.transaction` (внешняя транзакция продолжает работу
   после отката вложенной).

### 7.1 Домен не управляется - работает ip:port (замер 2026-10-09, вечер)

Хостинг отдал контейнеру прямой адрес `78.154.103.20:14055`, и он ведёт себя как настоящий
PostgreSQL: на `SSLRequest` отвечает `N` (не TLS), то есть перед нами wire-протокол, а не HTTP-фронт.
Домен в этой схеме - лишнее: Cloudflare его терминирует и на 5432 трафик не отдаёт, а ip:port идёт
мимо. Замеры тем же `src/lib/db/probes/pg-live.probe.mjs` (7 обращений, последовательно, пауза 250 мс):

```
предполёт: SSLRequest -> "N"
PostgreSQL 16.15 on x86_64-p | listen=* port=14055 | кодировка UTF8
PG_LIVE_OK (12 проверок)
```

То есть на живом сервере оператора подтверждены границы, которых не даёт транспорт через прокси:
дубликат UNIQUE -> `conflict` + `details.sqlstate = 23505` (=> из REST-слоя возможен **409**),
savepoint-семантика вложенных `db.transaction`, `icontains` без регистра (UTF8!), отказ политики
чужой роли = `forbidden`, DDL и `DROP` своей таблицы.

Что это меняет в приложении: вариант «`pg` напрямую» снова возможен - `DATABASE_URL` вида
`postgres://user:pass@78.154.103.20:14055/db`, `openPgPool({ ssl: false })` (сервер отвечает `N`,
TLS выключен - `ssl: true` только порвёт соединение соединение). На Vercel/Netlify (Node-runtime) исходящий
TCP на нестандартный порт проходит; на Cloudflare Workers - нет, там по-прежнему только Hyperdrive.
Оплата за это - RTT: `connect` 582 мс, `select 1` медиана **188 мс** на запрос (локальный pg -
0.34 мс). Отсюда всё та же рекомендация: `max: 1` на serverless-инвокацию, `estimate` вместо
`count`, миграции вне персист-слоя.

И то, что стоит прочитать оператору (замерено `select ... from pg_settings`, 1 запрос):

| параметр | значение | чем плохо |
|---|---|---|
| `listen_addresses` | `*` | порт смотрит в интернет |
| `ssl` | `off` | запросы и данные идут открытым текстом |
| `password_encryption` | `md5` | md5-challenge перехватывается и подбирается офлайн; нужен `scram-sha-256` |
| `idle_session_timeout` | `0` | висящие соединения не закрываются, `max_connections = 100` кончаются |
| пароль `admin` | короткий, словарный, светился в переписке | подберут вместе с открытым портом |

Минимальный набор правок: `password_encryption = scram-sha-256` + `alter role admin with password
'...'` (хэш пересчитается при следующей смене пароля), `idle_in_transaction_session_timeout`
несколько секунд, `idle_session_timeout` минуты, и либо `ssl = on` с самоподписанным сертификатом,
либо обратно pgproxy (тогда наружу торчит только HTTP, а токен одноразовый). После этого
в `pg_hba` стоит оставить `scram-sha-256` вместо `md5`.

### 7.2 «Хостинг кладёт БД» оказалось утечкой пула в нашем адаптере

Живой ip:port вскрыл не транспорт, а наш код. Симптом: приложение на живом PostgreSQL
отвечало 200 на первый запрос, а дальше — 500 через ровно `connectionTimeoutMillis`,
перезапуск процесса «лечил», `dev` ведёт себя иначе, чем `preview`. Развязка была простой:
сырой `Pool` из `pg` на том же соединении и с тем же 180-секундным простоем **не** ломался
(786 мс после простоя), а `pg_stat_activity` показывал соединения приложения вечно `idle`.

Причина — `pgAdapter.cancellableQuery`: клиент брался через `pool.connect()` и возвращался
только на пути ошибки. `signal` в SvelteKit есть у **каждого** запроса (`sveltekit/context.ts`
берёт `event.request.signal`), поэтому при `DB_POOL_MAX=2` две страницы вычерпывали пул, и всё
остальное ждало свободное соединение до таймаута. Поймать это мог только прогон с живым
соединением и серией запросов: тесты на заглушках пула `release` не считали, а PGlite и
одно-запросные проверки утечку не видят в принципе.

Фикс (0.2.1): успешный путь делает `release()`, сбойный — `release(err)`, то есть клиент
уничтожается, а не возвращается в пул убитым; приём и порядок — из pg-pool (`_releaseOnce`
запрещает второй release, поэтому `end()` оставлен только в `cancel()`). Регрессия — группа 29
`src/lib/db/port-specific.test.ts`: стаб считает `connect()`/`release()` и падает на двойном
release; проверка мутацией (убрать `release`) роняет её же со `releases: 0, checkedOut: 3`.

Замер «до/после» на сервере оператора (production-сборка, `preview`, `DB_POOL_MAX=2`):

| | до фикса | после фикса |
|---|---|---|
| 1-й запрос | 200, 2.7 с | 200, 2.6 с |
| 2-й и 3-й | 500 через 30.0 с | 200, 209 и 201 мс |
| POST-запись | — | 200, 205 мс (счётчик 7 → 8) |
| после 180 с простоя | 500 через 30.0 с | 200, 844 мс; следующий 204 мс |

Два побочных вывода, полезных любому клиенту `lib/db` на дешёвом хостинге:

1. `openPgPool` получил `keepAlive` по умолчанию (`keepAliveInitialDelayMillis: 10_000`): NAT,
   молча выбрасывающий неактивные соединения, — обычное дело, и TCP-пробы дешевле, чем
   «первый запрос после простоя = 500». Это не лечило утечку, но снимает отдельный класс
   обрывов; выключается явно (`keepAlive: false`).
2. Ленивый синглтон в приложении обязан кэшировать **только успешную** инициализацию:
   `opening ??= промис` запоминает и отказ, и тогда одна медленная первая страница (холодный
   контейнер) превращает 500 в состояние процесса до перезапуска. Плюс `connectionTimeoutMillis`
   на 30 с (`DB_CONNECT_TIMEOUT_MS`) вместо дефолтных 10 с, и лог причины: в production
   SvelteKit её не печатает.

## Источники

- Cloudflare: `developers.cloudflare.com/hyperdrive/` (features & limits, `examples/querying-postgres-with-node-postgres`, best-practices).
- Supabase: `supabase.com/docs/guides/database/connecting-to-postgres` — pooler modes, таблица
  «Direct / Session mode / Transaction mode» по версиям IP и планам, «Migrations, pg_dump,
  backup/restore, replication → Direct connection» (проверено 09.10.2026);
  `…/connecting-to-postgres/pooling-and-limits` — два независимых лимита и формула
  `direct + Supavisor + PgBouncer < max_connections`;
  `…/troubleshooting/disabling-prepared-statements-qL8lEL` — 4 ограничения transaction mode и
  решение для `node-postgres` = не передавать `name` в запросе.
- Vercel↔Supabase: `community.vercel.com/t/database-connection-from-vercel-to-supabase/25034` —
  исходящий IPv6 не работает; `vercel.com/docs/limits#hobby-and-pro-plans` — Hobby только для
  некоммерческого использования; Free-план Supabase (500 МБ, 2 проекта, пауза на 7 дней, без
  Spend Cap) — kuberns.com/blogs/vercel-supabase и padezhnov.com (сторонние, независимые,
  сходятся); `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` без `DATABASE_URL` — практика реального
  проекта (github.com/batesy87/vehicle-movement-platform/pull/6), **не** документация Vercel:
  имена проверяются в дашборде.
- Пулеры: `pgbouncer.org/usage.html` — «Feature support in pooling modes»;
  `github.com/pgbouncer/pgbouncer/issues/1635` — в 1.26.0 `search_path` из startup-пакета
  гоняет между клиентами вместо явной ошибки (1.24.1 у нас отказывал громко) — второй аргумент
  не полагаться на startup-`search_path` под пулером; `…/postgres/connection-pooling` (Neon) и
  `…/hyperdrive/concepts/connection-lifecycle/` (Cloudflare) — «new Client() per invocation»,
  `connectionString` не читать из `process.env` в рантайме.
- Neon: `github.com/neondatabase/neon` → `@neondatabase/serverless` README (HTTP vs WS, `webSocketConstructor`, `NeonDbError.code`).
- Vercel: `vercel.com/docs/postgres` («Vercel Postgres is no longer available… moved to Neon in December 2024»), `vercel.com/docs/marketplace-storage`, changelog «Query and manage Marketplace databases».
- Juit pgproxy: `github.com/juitnow/juit-pgproxy` README (протокол `{id,query,params}` → `{statusCode,command,rowCount,fields,rows}`, single-use `?auth=`, env `PGPROXYSECRET`).
- Sentry: `getsentry/sentry-javascript#25144` (нет spans на Neon-драйвере).
