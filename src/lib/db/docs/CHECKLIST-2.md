# CHECKLIST-2 — расширение порта `$lib/db`


## П. Процедура (переживает сжатие контекста)

Шесть правил, которые действуют в каждом ходе, а не «когда будет удобно»:

1. Нет VCS в дереве → сначала `git init` + baseline-коммит, потом правки.
2. Изменены файлы вне `/tmp` и прогнан зелёный гейт → коммит сразу, а не «в конце этапа».
3. «Готово/работает» без вывода гейтов и `git log --oneline -3` — запрещено.
4. Невыполнимое требование называется вслух; молча опущенное = ложный отчёт.
5. После правки от пользователя: стоп, ответ на вопрос, ждать решения — не править.
6. Демо-страницы следуют конвенциям приложения: список — только через пагинатор
   (`$lib/paginate` + части `$lib/ui/paginator`), форма создания/правки — отдельный
   компонент. В `+page.svelte` ни то ни другое не размечается: ни `slice` со
   ссылками, ни `bind`+`Form` inline.


| Пункт | Состояние |
|---|---|
| VCS | `/home/user/integration/.git` — есть (локальный, без `origin`); коммиты только локальные |
| последний коммит | `e6107da` refactor(db-demo): список через пагинатор, формы — отдельные компоненты |
| baseline | `de0fe0d` = срез `modals-kit@5d08da7`, всё остальное в истории — адаптация |
| гейты этого среза | vitest 33 файла / 599 тестов · tooling 104/104 · слой 39/39 · svelte-check 0 ошибок (46 warning'ов в `src/lib/paginate`) · build 8.14 s · `test:db:probes` ORDER OK · `INTEGRATION_HTTP_OK (20)` и `HTTP_ROUNDTRIP_OK` на обоих движках (5173 PGlite, 5174 живой PG) · `probes/db-demo-browser.check.mjs` → `DB_DEMO_BROWSER_OK (8)` — браузерная проверка обязательна: HTTP-проба не видит класса ошибок «SSR зелёный, гидрация мёртвая» (Chromium ставится `npx playwright install chromium`, порт превью обязан быть в `PREVIEW_PORTS`, иначе Kit отвечает 403 на POST формы) |
| SKIPPED | нет |
| долг пользователя | отозвать вставленные в чат PAT GitHub; `drop database if exists kitdb_demo with (force)`, когда демо не нужно |

Открытые ветки задачи: T1 (docs: разделение `docs/`, `docs/security.md`, `api-doc.mjs`,
`scripts/ports.env.example`) — не начато; T4 (REST + versioned ACL) — отложено по решению
пользователя, обязано унаследовать тот же origin/error контракт.

Новый чеклист по запросу пользователя. Предыдущий (`CHECKLIST.md`) закрыт: порт ядра +
SvelteKit-слой + документация + проверка на реальном приложении — всё зелёное
(коммиты `7e5324a … 07fe2a6`). Здесь — четыре новых блока работ, их критерии приёмки и
то, что уже сделано в этом шаге.

## 0. Окружение: что поднято прямо сейчас (важно после пересоздания песочницы)

| Компонент | Состояние | Как поднять заново |
|---|---|---|
| **PostgreSQL 17.11** (нативный, не PGlite) | **работает**: TCP `127.0.0.1:5433`, unix-сокет `/tmp`, БД `kitdb`, `kitdb_lib`, `kitdb_follow`, `shikidb` (для зонда), auth=trust; **энкодинг `SQL_ASCII`** (поднят до того, как в рецепт попал `--encoding=UTF8`) → ci-тесты идут через `kitdb_utf` | `sudo -n apt-get install -y --no-install-recommends postgresql postgresql-client` → `sudo -n -u postgres /usr/lib/postgresql/17/bin/initdb -D /tmp/pgdata -A trust -U postgres --encoding=UTF8 --locale=C.UTF-8` (**энкодинг обязателен**: без него кластер выходит `SQL_ASCII`, и `lower()`/`ILIKE` складывают регистр только по ASCII — см. `src/lib/db/probes/testdb-encoding.probe.mjs`) → `pg_ctl -D /tmp/pgdata -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" -l /tmp/pg.log start` → `psql -h /tmp -p 5433 -U postgres -c "create database kitdb"` (нужны ещё `kitdb_lib`, `kitdb_follow`, `shikidb`; для зонда энкодинга — `kitdb_utf` с `--encoding=UTF8 --locale=C.UTF-8` и `kitdb_ascii` с `--encoding=SQL_ASCII`, обе из `template0`) |
| **PG17 локально** (нужен для `pg-live.probe.mjs`, `transport-matrix.probe.mjs`) | поднимается заново после пересоздания песочницы: `apt-get install -y postgresql`, потом `initdb -D /tmp/pgdata -A trust --encoding=UTF8 --locale=C.UTF-8` и `pg_ctl -D /tmp/pgdata -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" -l /tmp/pg.log start` (бинарники в `/usr/lib/postgresql/17/bin`) |
| **`node_modules` пакета и приложения** | не переживают пересоздание песочницы (исключены из снапшота) -> `npm install` на каждом новом заходе. Если tarball пакета пересобран, а `package-lock.json` приложения помнит старый хэш, обычный `npm install` падает с `EINTEGRITY` - ставить заново: `npm install ../db-port/ftugit-kit-db-0.2.0.tgz` |
| **PgBouncer** (для `src/lib/db/probes/pooler.probe.mjs`) | **не запущен** после пересоздания песочницы — поднимать по §0.2 (`/usr/sbin/pgbouncer /tmp/pgb/pgbouncer.ini`, `auth_type = any`) |
| **Свежесть эталонных ревов** | определять `git ls-remote <публичный репо>`, а не локальными `origin/*`: у `modals-kit` кончик `b1` = `5d08da7` (2026-10-09), локальные refs показывали `15d4355`. Приватные (`SolidHono`) без токена не берутся — это проверено тем же `ls-remote` |
| **Juit pgproxy (HTTP + WS)** | **работает**: `127.0.0.1:5434`, секрет в env, health-check отвечает и ходит в PG17 | в `/home/user/pgproxy-lab`: `npm i @juit/pgproxy-server @juit/pgproxy-cli @juit/pgproxy-client @juit/pgproxy-client-whatwg ws pg` → `PGPROXYSECRET=<≥32 символа> PGPROXYADDRESS=127.0.0.1 PGPROXYPORT=5434 PGPROXYHEALTHCHECK=/healthz PGHOST=/tmp PGPORT=5433 PGDATABASE=kitdb PGUSER=postgres ./node_modules/.bin/pgproxy-server --debug` |
| Зависимости пакета | `npm i` в `/home/user/db-port` (24 пакета, 2 с) | **`node_modules`, `dist`, `/tmp/pgdata` не входят в снапшот песочницы** — при пересоздании песочницы всё это теряется, восстановление: `npm i && npm run build` |
| Node | v20.20.2 — **глобального `WebSocket` нет** (нужен `ws` для WS-клиента), `fetch` есть | — |
| git identity | `.git/config` **исключён из снапшота** → после пересоздания песочницы коммит падает (`Author identity unknown`) | `git config user.name "db-port agent" && git config user.email "agent@localhost"` в `/home/user/db-port` |

Доказано в этом шаге (реальные прогоны, не предположения):

```
npm run docs:check                                   → docs-audit: актуально (10 entry-поинтов)
node test/run.mjs                                    → 5/5, 64 группы (PGlite · port-specific 29)
node src/lib/db/probes/shikimori-view.probe.mjs                   → PROBE_OK (составная коллекция)
node src/lib/db/probes/transport-matrix.probe.mjs                 → TRANSPORT_MATRIX_OK (4 транспорта)
node src/lib/db/probes/testdb-encoding.probe.mjs                  → ENCODING_PROBE_OK (UTF8 vs SQL_ASCII)
node src/lib/db/probes/pooler.probe.mjs                           → POOLER_PROBE_DONE (нужен PgBouncer, §0.2)
DB_LIB_TEST_PG_URL=… DB_HARDENING_PG_URL=… node test/run.mjs → 5/5 на нативном PG17
                                                       (БД обязаны быть свежими: «requires fresh database»)
node src/lib/db/probes/http-roundtrip.mjs                         → HTTP_ROUNDTRIP_OK (демо без браузера)
curl http://127.0.0.1:5434/healthz                    → 200 {"available":1,…}
PGClient…query('SELECT 1+1 …')                        → [{"two":2,"fresh":true}]     (HTTP)
PGClient…connect(BEGIN/INSERT/SELECT/DROP)            → rows [{n:"3",s:"6"}]        (WS, сессия)
```

---

### 0.2 PgBouncer для проверки pooler-поведения

`src/lib/db/probes/pooler.probe.mjs` требует пулер поверх того же кластера:

```bash
sudo -n apt-get install -y --no-install-recommends pgbouncer
mkdir -p /tmp/pgb && cat > /tmp/pgb/pgbouncer.ini <<'INI'
[databases]
kitdb = host=/tmp port=5433 dbname=kitdb user=postgres
[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
unix_socket_dir = /tmp/pgb
auth_type = any            # НЕ trust: в pgbouncer «trust» читается как имя метода аутентификации и ломает вход
pool_mode = transaction    # ровно тот режим, что у Supabase shared pooler / Hyperdrive
default_pool_size = 4
server_reset_query = DISCARD ALL
ignore_startup_parameters = options,statement_timeout   # без неё строки A1–A3 падают FATAL — это и есть вывод
INI
/usr/sbin/pgbouncer /tmp/pgb/pgbouncer.ini &
POOLER_URL=postgres://postgres@127.0.0.1:6432/kitdb \
  DIRECT_URL=postgres://postgres@127.0.0.1:5433/kitdb node src/lib/db/probes/pooler.probe.mjs
```

Строку `ignore_startup_parameters` оставляют включённой, чтобы остальные проверки прогона
(транзакции, TEMP, prepared, курсоры) дошли до конца; поведение без неё — строки A1–A3.

## T1. Документация: актуальность + оформление

- [x] **Аудит актуальности скриптом** — `tooling/db-docs.mjs`, `npm run docs:check`:
      сверяет README с фактическими экспортами `dist` (10 entry-поинтов), матрицу
      `kind → HTTP status` (10), `conservativeLimits` (7 чисел), env-ключи, счётчики
      тестов (59), число операторов в `src/lib/db/migrations/001` (5) и ссылки на файлы пакета — включая
      `docs/TRANSPORTS.md`. С 2026-10-09 добавлено встречное условие: каждый `exports`-ключ
      `package.json` обязан быть в списке аудита, иначе новый entry-поинт просто не
      проверялся бы (аудит сам это поймал на `./testing`).
      Первый прогон нашёл 8 расхождений — все исправлены; сейчас `docs-audit: актуально`.
- [x] Включён в `check`? — **нет, осознанно** (аудиту нужен `dist`), но `docs:check` стоит в
      `prepublishOnly`-цепочке (`check && docs:check`): публикация с протухшим README невозможна.
- [ ] Формат по образцу похожих репозиториев (Kysely/Drizzle/PocketBase/PostgREST):
  - [ ] `docs/` с навигацией: `README` (зачем+быстрый старт) → `docs/01-setup.md` … `08-rest-acl.md`;
  - [ ] оглавление + «стол» вверху README (PocketBase style), бейджи статуса/версии (Drizzle style);
  - [ ] для каждой возможности — «зачем это нужно» до примера кода (Kysely style);
  - [ ] отдельная страница `docs/security.md` (модель угроз: что гарантирует пакет, что нет)
        и `docs/recipes/{vercel,cloudflare,pglite,tests}.md`;
  - [ ] таблица «Что не поддерживается» (Drizzle `limitations`, PostgREST `notes`) —
        сейчас это разбросано по §7 README/§10 PORTING.
- [ ] API-reference по `dist/*.d.ts` (не руками): минимальный генератор `scripts/api-doc.mjs`,
      который печатает сигнатуры из `.d.ts` — чтобы README §7 не мог соврать (аудит ловит
      только «нет такого экспорта», а не «изменилась сигнатура»).

## T2. Расширение возможностей (похожие репозитории → фичи)

Доноры идей: Drizzle, Kysely, Slonik, pg-mem, PostgREST, PocketBase, Directus, Hasura,
Supabase-js, Payload, `@neondatabase/serverless`, pg-boss, graphile-worker. Отбирались те
возможности, которые не ломают контракт ядра (deny-safe, «отказ до SQL», zero-dep) и не
требуют нового транспорта. Обоснование каждой строки — `PORTING.md` §3.1.

- [x] **Bulk insert — `insertMany`** (`ResourceApi.insertMany(ctx, rows, { chunkSize, onConflictIgnore, atomic })`):
      один `INSERT … VALUES (…),(…) RETURNING` на чанк вместо N round-trip (Drizzle
      `insert().values()`, Kysely `insert().values()`). Валидация каждой строки — тем же
      `draftInput`-путём; разный набор полей = `validation`; `hooks`/`validateFinal` =
      `unsupported`; короткий `RETURNING` = `database`; >1 чанка — внутри `db.transaction`,
      а на транспорте без транзакций — последовательно, если не выставлен `atomic: true`
      (тогда `unsupported` **до** первого запроса; повод — замер в T3).
- [x] **`estimate` для UI-пагинатора** (`estimate(ctx, filter) → { rows, exact, method }`):
      `pg_class.reltuples` без фильтра (только `relkind IN ('r','p','m')`), `EXPLAIN (FORMAT JSON)`
      / `Plan Rows` с фильтром, точный `count(*)` как откат. `exact: false` обязан
      отображаться как «~», а не как подтверждённое число.
- [x] **Transaction retry — `withRetry`** (`src/lib/db/ops.ts`, экспорт из корня + `RetryOptions`):
      повтор при `40001`/`40P01`, то есть строго когда `e.details.retryable === true`
      (флаг ставит `normalizeFailure`; поля `retryable` у `DbFailure` **нет**), пауза
      экспоненциальная с джиттером, `attempts` ≤ 10, `onRetry` для метрик, `wait` инъектируется.
- [x] **`icontains` / `istartsWith`** — регистронезависимые `ILIKE`-пары к `contains`/`startsWith`
      (PocketBase `_ilike`, Directus `_icontains`) с общим экранированием и `ESCAPE E'\'`;
      `OP_LIST` расширен, оператор по-прежнему обязан быть объявлен в `filters` поля.
- [x] **Тестовый harness — `$lib/db/testing`**: `withTestDb(fn, options)` → PGlite в памяти
      или настоящий PostgreSQL в уникальной схеме `kit_test_<hex>` (`-c search_path`, не `SET`),
      миграции текстом, `DROP SCHEMA` в `finally`. Отдельный entry — по той же причине, по какой
      ядро не реэкспортирует адаптеры (`pg`/PGlite не должны попадать в клиентский/edge-бандл).
- [x] **`checkShape`: `primaryKey` обязан быть orderable** — `orderBy` дописывает его как
      tie-breaker, иначе `forbidden` возникает на первом же `select`.
- [ ] Что из списка **не** берём: generic query-builder наружу (наружу — только ресурс),
      «авто-схема из БД» (`drizzle-kit`-генератор — вне скоупа, PORTING §10).
- [ ] **Отложено осознанно** (не «забыто»; причина — в `PORTING.md` §3.1):
  - [ ] `explain`/cost guard как *отказ* запроса: порог «дорого → 503» — решение приложения,
        а план запроса становится источником flaky-ошибок (vacuum/статистика меняют его без
        изменения кода). В `estimate` `EXPLAIN` используется только как оценка.
  - [ ] таблица истории миграций `kit_migration` + CLI `migrate up|down|status`: меняет контракт
        `applyMigrationText` и требует миграций у самого пакета (сейчас `src/lib/db/migrations/*` — образцы).
  - [ ] computed/virtual fields: нужен `expr()`-белый список = новая SQL-поверхность → только
        вместе с ACL-треком (T4), иначе дыра «поле-выражение читает то, что поле не разрешено».
  - [ ] `expect`-хелперы/сиды поверх `withTestDb` — покрывается `sql`/`tables` из `TestDb`.

- [x] **Страховка энкодинга в `withTestDb`** (побочный, но важный результат прогона `icontains`
      на нативном PG): в кластере `SQL_ASCII` (дефолт `initdb` при `LANG=C`) `lower()`/`ILIKE`
      складывают только ASCII → регистронезависимый поиск по-русски даёт **ложную пустоту**, и
      тесты остаются зелёными. Хелпер теперь проверяет `lower('А') = 'а'` и отказывает
      (`unsupported`), `{ encoding: 'any' }` отключает проверку; `TestDb.encoding` отдаёт
      `{ encoding, caseFolds }`. Замер обеих баз — `src/lib/db/probes/testdb-encoding.probe.mjs` →
      `ENCODING_PROBE_OK`; рецепт `initdb` в §0 дополнен `--encoding=UTF8 --locale=C.UTF-8`.
- [x] **страховка `search_path` в `withTestDb` + `startupParameters: 'skip'` в `openPgPool`** —
      найдено при проверке «есть ли бесплатный Supabase и можно ли к нему `pg` напрямую»: pooler в
      transaction mode отбрасывает startup-параметры (замер PgBouncer 1.24.1: `-c search_path` не
      применяется, `SHOW statement_timeout` → `0`; без `ignore_startup_parameters` — outright
      `FATAL: unsupported startup parameter in options: …`), из-за чего тест с «изолированной»
      схемой писал бы в `public`. Хелпер сверяет `current_schema()` на двух подключениях и
      отказывает `unsupported`; заодно `max`/`maxInFlight` валидируются как ≥ 1 (ноль = ждать
      вечно + тихий deadlock в admission-cap). Тест — `port-specific` группа 24, замер —
      `src/lib/db/probes/pooler.probe.mjs` (строки A1–A4, I1, J1–J3).

Приёмка T2: `node test/run.mjs` → 5/5, 64 группы (`port-specific` 29), `npx tsc --noEmit` чисто,
`node src/lib/db/probes/transport-matrix.probe.mjs` → `TRANSPORT_MATRIX_OK`, `npm run docs:check` → актуально
(10 entry-поинтов). Отдельно проверено на реальном PostgreSQL 17.11: `withTestDb` (insertMany,
select/count, estimate, icontains, изоляция между вызовами) и `insertMany`/`estimate` в матрице
транспортов.

## T3. Vercel/Cloudflare: «своя БД» через `lib/db` — только исследование

Решение пользователя: **не** переносить `adapters/proxy*.ts` и не писать новых адаптеров;
требуется ответить, работает ли БД провайдера через текущий `lib/db`, что отваливается и
корректно ли ведёт себя ядро с недостающими частями. Ответ — `docs/TRANSPORTS.md`.

### T3.1 Что измерялось вместо чтения доков

- [x] `src/lib/db/probes/transport-matrix.probe.mjs` — один и тот же корпус операций над четырьмя
      транспортами: `pg` (пул к PG17) · PGlite · pgproxy HTTP (без сессий) · pgproxy WS.
      Результат: **7 операций** (`transaction`, savepoint, запись с `hooks`/`validateFinal`,
      `applyMigrationText`, `set_config` в транзакции, `withRetry`, `insertMany` c `atomic`)
      на HTTP = `unsupported` **до** генерации SQL; 8 одиночных инструкций (`select`/`count`/
      keyset/`estimate`/`insert`/`update`/`delete`/`insertMany`/`ILIKE`-фильтр/DDL) = `ok`
      на всех четырёх. Матрица целиком — `docs/TRANSPORTS.md` §2.
- [x] Цена round-trip (localhost, 40 повторов одного `select limit 1`): `pg` 0.34 мс ·
      PGlite 0.70 мс · pgproxy HTTP 5.40 мс · WS 5.04 мс ⇒ каждый `include`-запрос на
      HTTP-транспорте стоит ×15; вывод для планов «N+1 поверх прокси» — в §2 документа.
- [x] `sqlstate`-потеря: сервер pgproxy отдаёт ошибку как строку (`error: error.message`,
      `pgproxy-server/dist/server.mjs:231`) → SQLSTATE не переносится → `conflict` (409)
      деградирует в `database` (500) на HTTP и WS. Проверено матрицей; записан обходной путь
      (`onConflictIgnore`, `update` c `onConflict`).
- [x] Сессионное состояние: `set_config(..., true)` **вне** транзакции теряет значение на всех
      четырёх транспортах (включая `pg` с `max: 4`) ⇒ правило «только `SET LOCAL` внутри
      транзакции» подтверждено, а TEMP-таблица «видна» через прокси лишь из-за маленького пула
      (лотерея, не гарантия).
- [x] Инвентаризация `Capabilities`: читается ядром ровно в 3 точках (`database.ts:116`,
      `resource.ts:356`, `sveltekit/migrate.ts:81`) — «транспорт без сессий» не размазан по коду.

### T3.2 Перенос HTTP/WS-адаптеров — **сделан** (решение от 09.10.2026 изменено: «переноси»)

- [x] `src/lib/db/adapters/proxy.ts` → entry `$lib/db/adapters/proxy`: `proxyHttpAdapter`,
      `proxyWsAdapter`, `proxyAdapter(mode, config)`. Zero-dep: `fetch` + `WebSocket` + Web
      Crypto, `@juit/*` в зависимости не добавлены. Подняты все четыре правила источника
      (одно утверждение на запрос, никаких значений конкатенацией, `sqlstate:false`,
      `maxInFlight` fail-fast) и добавлено то, чего в источнике не было: разбор `rows`-кортежей
      по `fields`/OID и сериализация `params` под text-протокол (иначе `count` — строка, а
      `boolean`-поле падает на валидации). Различия режима — в `PORTING.md` §3.1.
- [x] Отказ от `409` задокументирован как свойство транспорта, а не пакета: pgproxy не несёт
      SQLSTATE, поэтому `conflict` собирается только на `pg`/PGlite. Лечится полем `code` в
      error-фрейме на стороне прокси (после этого — `sqlstate: true`).

- [x] Изучено и зафиксировано без переноса: `src/lib/db/probes/lib/proxy-driver.mjs` — рабочая копия
      `proxy-{client,http,ws}.ts` источника (116/22/7 строк), использованная только для прогона
      матрицы. `@juit/*` не добавлены ни в `dependencies`, ни в `devDependencies` пакета:
      они резолвятся из лаборатории через `PGPROXY_MODULES`.
- [x] Тесты без сети: `port-specific` группы 25–29 (4 шт.) — отказ транзакции в HTTP-режиме
      **до** отправки, одноразовость `?auth=`, сверка `id`, `database` вместо `conflict`,
      не-JSON ответ, `maxInFlight` без очереди, один сокет на `BEGIN…COMMIT`, savepoint-откат,
      отмена сигнала закрывает сокет, валидация конфига, типы по OID и pg-литералы массивов.
- [x] Живой прогон: `src/lib/db/probes/proxy-live.probe.mjs` — 11 проверок против настоящего
      `@juit/pgproxy-server` (`127.0.0.1:5434`, тот же PG17) → `PROXY_LIVE_OK`. Прогон
      последовательный, ≤ 12 обращений, пауза `PROXY_GAP_MS` — чтобы free-хостинг не лёг.
      Тот же зонд точит прод: `PROXY_URL=https://… PROXY_SECRET=… node
      src/lib/db/probes/proxy-live.probe.mjs` (для `http://127.0.0.1` — `PROXY_INSECURE=1`).
- [x] **Прогон на прокси пользователя** (`https://pzlbdb.freesrv.com/`, PG16 в free-контейнере,
      TLS терминирует Cloudflare): `PROXY_URL=… PROXY_SECRET=$(cat .proxy-secret)
      PROXY_GAP_MS=700 node src/lib/db/probes/proxy-live.probe.mjs` → **`PROXY_LIVE_OK (11 проверок)`**:
      HTTP читает и пишет, `transaction()` отказывает до сети, дубликат ключа = `database`
      (не `conflict`), WS держит `BEGIN…ROLLBACK` и видит свои строки внутри транзакции, типы
      приехали разобранными (`select 1 as one` → `{"one":1}`, не `{"one":"1"}`). Секрет
      читается из `.proxy-secret` (в `.gitignore`): 64-символьный hex в командной строке
      обрезается редактором песочницы, поэтому `write_file` + `$(cat …)` — единственный
      воспроизводимый способ его передать. Пауза 700 мс, ≤ 12 обращений.

### T3.3 Выводы по провайдерам (2026, зафиксированы в `docs/TRANSPORTS.md` §4)

- [x] **Vercel**: собственного Postgres нет с 2025 (закрыт `Vercel Postgres`), только
      Marketplace Storage (Postgres: Neon, Supabase, Prisma Postgres, AWS Aurora Postgres,
      Nile, CockroachDB; PlanetScale = MySQL и Upstash = Redis — не Postgres),
      перенос существующих баз на Neon — декабрь 2024;
      который провижинит БД и **выдаёт переменные окружения**. «Vercel нативно поддерживает
      Supabase» = провижининг + env, а не отдельный драйвер → кода под Vercel в пакете не нужно:
      `pgAdapter(openPgPool(...))` + `max: 1`. Раньше в этом чеклисте было записано «Vercel
      Postgres = first-party» — неверно, исправлено.
- [x] **Cloudflare**: своего Postgres нет (D1 = SQLite), ответ — Hyperdrive поверх внешнего PG;
      адаптер «новый `pg.Client` на запрос» уже есть. Запреты Hyperdrive (`LISTEN`/`NOTIFY`,
      advisory locks, SQL-level `PREPARE`, session state) пакету не мешают; при transaction
      pooling в воркере недоступны транзакции → ресурсы без `hooks`/`validateFinal`, миграции
      отдельно. Гипертаблица «что запрещает Hyperdrive и как это выглядит в `lib/db`» — в §4.
- [x] **Supabase**: transaction-mode пулер 6543 работает «как есть» (ядро не использует
      `PREPARE`, pipelining и сессионный `SET`); прямая/`session`-строка нужна для миграций и
      `pg_dump`. Задокументирован и реальный инцидент с именованными prepared statements через
      пулер (`prepared statement does not exist` при HTTP 200).
- [x] **Neon**: `neon()` HTTP — только одиночные запросы (read-only пути), `capabilities`
      с `transactions: false`, но `sqlstate: true` (у `NeonDbError` есть `code`); WS-`Pool` —
      полноценная сессия. Отдельной библиотеки не требуется: Drizzle решает то же различие
      двумя драйверами внутри одной либы.
- [x] **Вердикт по «нужен ли отдельный lib/db-http»**: нет. Разница транспортов = 4 бита,
      разница поведения = 7 явных `unsupported`; ядро отказывает до SQL, тогда как
      Drizzle/Kysely на том же транспорте падают на `BEGIN`. Отдельный пакет означал бы два
      места, где живёт политика безопасности (`policy`, `filterSQL`, маски, `ident()`).
- [ ] Рецепты в `docs/recipes/{vercel,cloudflare,pglite,tests}.md` — отложены вместе с T1
      (разделением документации): текст уже есть в `docs/TRANSPORTS.md`, раскладывать по
      файлам смысла нет до финальной структуры `docs/`.
- [x] CI-эквивалент «один корпус на 4 транспортах» сделан как зонд (не как тест-файл):
      `src/lib/db/probes/transport-matrix.probe.mjs`, требует поднятых PG17 и pgproxy (§0).

### T3.4 Синхронизация с приложением (перенос на свежий `modals-kit`)

- [x] **Поправка: `modals-kit` публичный, я был неправ.** В прошлом пункте я записал «GitHub pull
      невозможен — репозиторий приватный». Причина падения `git fetch` была другой: в
      `/home/user/repos/modal-kit` **не было ни одного remote** (`git remote -v` пуст → git
      спрашивает учётку и падает). После `git remote add origin
      https://github.com/ftugit/modals-kit.git` анонимный fetch прошёл. Цена ошибки: мои
      fetched-refs были устаревшими, и «свежайший известный» `15d4355` отстаёт от реального
      `b1` на 20+ коммитов. Правло выведено в §0: «свежее» определять по `git ls-remote`.
- [x] Рабочий пин: `f82734f` → **`5d08da7`** (кончик `b1`, 2026-10-09; 132 файла, +7299;
      `origin/main` = `03eaf77`; на GitHub также `b2 9881614`, `v2`, `v3` — перенос сверян по
      `b1`, как указано оператором). `package.json` приложения за дифф изменился только scripts-ом
      (`test:browser:errors`) → deps возвращать руками, но версии те же.
- [x] **Апдейт реально сломал сборку демо**: новый гард `tooling/layer-guard.mjs` запрещает сырые
      form-теги вне `src/lib/form/` и примитивов (паттерн по исходнику целиком — комментарий с
      тегом тоже красит). `src/routes/db-demo/+page.svelte` переписан на `Form`
      (`$lib/form/svelte`, `formProps()` = `{method:'post', action, onsubmit: () => {}}`) +
      `Input`/`Button` из `$lib/ui/primitives`, скрытые id-пары через `hiddenFields`. Смысл
      демо (SvelteKit form actions + `dbHandle`) сохранён: обёртка взята ради инвариантов
      разметки, а не ради связанной формы кита.
- [x] Переезд демо-блоков довершен: `src/routes/{form,modals}/**` → `$lib/ui/demo/{form,modals}/**`,
      `src/lib/ui/paginator/fields/*` → `$lib/ui/settings/*` (29 удалённых путей сняты по
      `git diff --name-status | grep -E '^(D|R)'`, пустые каталоги вычищены).
- [x] Гейты на `5d08da7`: `npx svelte-kit sync && npx svelte-check` → **0 ошибок** (45
      предупреждений, в `db-demo`/`lib/server/db.ts`/`hooks.server.ts` — 0); `npm run build` →
      **ок** (до переписывания разметки падал на гарде); `npm run test:guard` → **80/80**.
- [x] Живой прогон на **production-сборке** (`npm run preview`, чтобы не ловить OOM от
      `vite dev` + chromium на 2 ГБ): `browser-check.mjs` → **`BROWSER_OK (7 → 8)`**,
      `delete-check.mjs` → **`DELETE_OK`** (7 → 6), `probes/db-demo-http.check.mjs` →
      **`INTEGRATION_HTTP_OK (9)`**. Вердикт браузера переведён с абсолютного (`seeded === 7 &&
      after === 8`) на относительный: корпус в PGlite живёт в памяти процесса, и предыдущий прогон
      сдвигал строки — абсолютный ожидаемый номер давал ложную регрессию.
- [x] **Найдено различие `dev` и `preview`, важное для любых HTTP-клиентов `lib/db`:** SvelteKit в
      проде включает `csrf_check_origin` — POST с form-content-type и `Origin ≠ url.origin`
      (или без заголовка) = **403** «Cross-site POST form submissions are forbidden». Мой probe
      в dev проходил, в preview падал, пока не начал слать `origin`. Для REST-слоя T4 это
      значит: тесты обязаны отправлять корректный `Origin`, а `csrf.trustedOrigins` — часть
      конфигурации деплоя, не «мелочь».
- [x] **Тот же 403 — причина, почему POST не работает в превью (замерено, не гипотеза):** это не
      CSP/CORP/`X-Frame-Options` (их в приложении нет вообще: `svelte.config.js` = только
      `adapter`, по всему дереву `b1` ни одного совпадения), а собственная проверка SvelteKit.
      `respond.js` держит её под `if (!__SVELTEKIT_DEV__)` — в `vite dev` её нет, в `preview`
      есть; `url.origin` берётся из `:authority || host` (`preview/index.js:208`), а превью-прокси
      обращается к `127.0.0.1:5173`, поэтому браузерный `Origin` всегда «чужой».
      Wildcard в белом списке не работает — сравнение `csrf_trusted_origins.includes(origin)`,
      из «магии» только `'*'`, которое на сборке выключает проверку
      (`write_server.js:41`: `csrf_check_origin: checkOrigin && !trustedOrigins.includes('*')`).
      Лечение: `kit.csrf.trustedOrigins` из переменной `KIT_TRUSTED_ORIGINS` в `svelte.config.js`;
      превью собирается с `KIT_TRUSTED_ORIGINS='*'`, прод — с конкретным адресом
      (`KIT_TRUSTED_ORIGINS=https://pzlbdb.freesrv.com npm run build`).
      До: `POST` с чужим `Origin` → 403 «Cross-site POST form submissions are forbidden».
      После: `200` (и с чужим `Origin`, и без `Origin`), `INTEGRATION_HTTP_OK (9)`,
      `svelte-check` 0 ошибок, `test:guard` без падений.
- [x] **Запрет обхода `lib/form` стал машиночитаемым (2026-10-09, по требованию оператора).**
      Гард `tooling/layer-guard.mjs` умел ловить только сырой `<form …>` и промахивался на
      `<form/>`, `</form>`, `<FORM>`, `<svelte:element this="form">` (замерено прогоном
      образцов), а главное — не видел обход в скрипте. Добавлено: поддержка `isSourceCheck`
      (правила идут и на `.ts`/`.js`, `transform` больше не ограничен `.svelte`), ключ
      `require` («правило молчит, если в файле есть этот узор») и четыре правила: ручной
      `formProps` вне `src/lib/form/`, `document.createElement('form')`, «`export const actions`
      обязан импортировать `$lib/form`», «тело читает слой, а не маршрут
      (`request.formData()` / `await request.json()` вне файлов, знающих `createFormHandler`)».
      Узор сырых тегов закрыл все четыре дыры. Тестов гарда: 80 → **88**, мутация проверена
      на живой сборке: scratch-файл с ручным `formProps`, с `<form/>` и с `actions` без
      `$lib/form` — каждый роняет `npm run build` с объясняющим сообщением.
- [x] **Защита формы из `lib/form` включена всегда, а не по вкусу маршрута:** новый
      `src/lib/server/form-security.ts` собирает `SECURITY_LAYERS` (метод → origin → тело →
      имена) и `originGuard` = `originLayer({ strict: true })` + поддержка wildcard-хостов
      (`https://*.e2b.app`), которых у SvelteKit нет. Список один на всё приложение —
      `KIT_TRUSTED_ORIGINS`, к нему добавляются локальные порты и адрес превью из
      `E2B_SANDBOX_ID`; тот же список (без wildcard'ов) едет в `kit.csrf.trustedOrigins`,
      поэтому `'*'` больше не нужен: в собранном сервере `csrf_check_origin: true`.
      Порядок обязан быть именно такой: проверка фреймворка стоит ДО `handle`
      (`respond.js`), поэтому на form-encoded POST отказ всегда отдаёт SvelteKit
      (текст «Cross-site POST form submissions are forbidden»), а слой 02 приложения
      отвечает там, где фреймворк слеп (чужие хосты, JSON-пути, REST из T4).
      Проверка — `probes/db-demo-http.check.mjs`: 23 шага, `INTEGRATION_HTTP_OK (23)`.
      Ключи адреса — общие (`?page`, `?page.size`, `?page.flt`, `?page.ord`, `?page.mode`);
      `?page.flt`/`?page.ord` уходят в слой, отказ фильтра виден как `ErrorRow`; отдельный
      шаг следит, что `POST /db-demo/submit` отвечает JSON, а не HTML (отправка без
      перезагрузки), а шаг `?page.mode=stream` — что режим навигации работает и без JS.
      SSR-проверка не видит класс ошибок «в браузере белый экран», поэтому рядом лежит
      `probes/db-demo-browser.check.mjs` — 11 проверок в chromium (`DB_DEMO_BROWSER_OK (11)`):
      гидрация, клик по странице, создание без перезагрузки (метка на `window` жива +
      `total` вырос + `GET /api/db-posts`), переключение режима панелью, чистая консоль.
- [x] **Ошибки показаны как ошибки формы, а не как «не-JSON ответ»:** транспорт вынесен в
      `src/lib/ui/demo/form/transport.ts` (`jsonTransport(path)`) и отвечает `Result`'ом с
      `origin: 'external'`, `outcome: 'unknown'` и человеческим текстом на любой ответ не по
      контракту (в том числе на HTML и на `{ message }` фреймворка) — потому что на
      `kind: 'network'` связка показывает `code` вместо `detail` (`submit.ts`:
      `message: outcome.code`), и пользователь читал бы «http.403». `db-demo` переписан на
      `bind` + `createFormHandler` (описания `db_demo_create` / `db_demo_remove`,
      `continuation` = результат экшена, `intent`-метка «какая форма получила ответ»),
      ручного `formProps` в приложении больше нет.
- [x] **Ловушка, на которой я и споткнулся: `id` формы ограничен `INSTANCE_RE`**
      (`src/lib/form/envelope.ts:22`, `[a-z][a-z0-9_-]{0,31}:…`). Описание с id
      `db-demo.create` прошло `defineForm`, клиент честно отрендерил
      `__form_instance=db-demo.create:new`, а сервер отверг каждую отправку с
      `400 envelope.invalid`. Кандидат на правку в библиотеку: сверять id с `INSTANCE_RE`
      в `defineForm` (падать на описании, а не на первом сабмите) + тест.
- [x] `playwright` в пробах резолвится из devDependencies (`await import('playwright')`);
      бинари браузера + системные либы после пересоздания песочницы ставятся заново
      (`npx playwright install chromium && sudo npx playwright install-deps chromium`).
- [ ] Найти в приложении место для `icontains`/`istartsWith`: демо-ресурс объявляет в
      `field.filters` только `eq/contains/startsWith`, поэтому `?filter={"op":"icontains"}` = 403
      (deny-safe работает как надо). Добавить один элемент в массив — и поиск без регистра оживёт.
- [ ] Если релизной веткой окажется `main` (отстаёт от `b1` на 03eaf77 vs 5d08da7) — сверить
      перенос по ней же, рецепт в `PORTING.md §9.1`.

### T3.5 Прямой PostgreSQL без прокси (проверено 2026-10-09)

- [x] Скрипт контейнера переключён на `exec postgres -D ...` (без прокси) - и снаружи ничего не
      появилось: TCP `:5432`/`:5433` открываются (anycast Cloudflare) и молчат по протоколу
      (9 с на `SSLRequest`), а `https://.../` и `/healthz` отдают страницу хостера
      «Web server isn't running» (502 -> custom page). Протокол PG этим фронтом не проксируется:
      замер и разбор в `docs/TRANSPORTS.md` параграф 7.
- [x] Проверка не сожгла таймауты зря: у `src/lib/db/probes/pg-live.probe.mjs` есть предполёт (raw-хендшейк,
      4 с) -> `PG_LIVE_SKIPPED: TCP есть, ответа по протоколу нет ...`. Первый прогон без него дал
      153 с (по 15 с `connectionTimeoutMillis` на запрос) и выглядел как деградация чужого
      сервера - ложная.
- [x] Зонд валидирован на настоящем PG (PG17, UTF8, `127.0.0.1:5433`, своя таблица + DROP):
      **`PG_LIVE_OK (12 проверок)`** при 7 обращениях - `conflict/23505` на дубликате UNIQUE,
      savepoint во вложенной `db.transaction`, `icontains` без регистра, `forbidden` чужой роли.
      Поймано в самом зонде (не в пакете): `api.select()` отдаёт **массив строк**, а не `{items}` -
      обёртка со `totalItems` живёт на уровне sveltekit/REST; и информационная строка не должна
      печатать «галочку» поверх исключения.
- [x] Демо-роут сделан доступным из превью: ссылка `/db-demo` добавлена в шапку
      (`src/lib/components/header/nav.ts`) и на главную (`demos` в `src/routes/+page.svelte`);
      `npm run build` зелёный (гарды тоже), `npm run preview` отдаёт обе ссылки,
      `INTEGRATION_HTTP_OK (9)`.
- [x] **Инструкция «забрать последние изменения SolidHono и перенести `db` на них» закрыта отказом
      оператора (2026-10-09)**: SolidHono - самопис, от него уходят в пользу нормального
      фреймворка; `f8079b1` остаётся отметкой происхождения в `PORTING.md`, сверок с ним больше не
      делать. (Проверено тем же способом, что и с modals-kit: SolidHono действительно приватный,
      `git ls-remote` требует учётку.)
- [x] **Прямой ip:port проверен живьём** (домен не управляется, а хостер отдал
      `78.154.103.20:14055`): `SSLRequest` -> `N`, `PostgreSQL 16.15`, `listen_addresses=*`,
      кодировка UTF8, **`PG_LIVE_OK (12 проверок)`** за 7 обращений - включая `conflict` +
      `sqlstate 23505` (=> 409 в REST реалистичен), savepoint-семантику вложенных транзакций и
      `icontains`. Латентность: `connect` 582 мс, `select 1` медиана 188 мс (RTT, не сервер).
      Приложение переключается на этот путь одной строкой `DATABASE_URL` + `ssl: false`; для
      Cloudflare Workers по-прежнему не годится (нужен Hyperdrive).
- [x] **Живой ip:port нашёл настоящую ошибку в пакете** (не в транспорте): `pgAdapter` не
      возвращал соединение в пул на успешном отменяемом запросе → при `DB_POOL_MAX=2` приложение
      вычерпывало пул за две страницы и дальше отдавало 500 через `connectionTimeoutMillis`.
      Развязка «pg или мы»: сырой `Pool` из `pg` тот же простой переживал (786 мс), а
      `pg_stat_activity` показывал вечные `idle` от приложения. Исправлено в 0.2.1
      (`release()` на успехе, `release(err)` на сбое), регрессия — `port-specific` группа 29,
      проверка мутацией. Замер на сервере оператора после фикса: 200 за 2.6 с, затем 209/201
      мс, POST 205 мс, после 180 с простоя 844 мс → `LIVE_POOL_OK`. Попутно: `keepAlive` по
      умолчанию (10 с), и в приложении — ретрай инициализации вместо запоминания отказа.
- [x] Версия пакета **0.2.1** (fix + новая опция `openPgPool`), tarball пересобран, приложение
      поставлено на него (`npm install ../db-port/ftugit-kit-db-0.2.1.tgz` — иначе `EINTEGRITY`).
      09.10.2026: способ доставки изменён — слой лежит в `src/lib/db`, tarball не ставится.
- [ ] **Безопасность хоста - задача оператора, но измерено нами**: `ssl = off`,
      `password_encryption = md5`, `idle_session_timeout = 0`, `max_connections = 100`,
      `listen_addresses = *` на порту, открытом в интернет, со слабым паролем из переписки.
      Минимум: `password_encryption = scram-sha-256` + смена пароля, `idle_in_transaction_session_timeout`,
      `ssl = on` (или вернуть pgproxy и оставить наружу только HTTP), `pg_hba` на `scram-sha-256`.
      Пока это не сделано, любые секреты в этой базе считать скомпрометированными.

## T4. REST-слой + ACL-схема (`/api/rest/*`)

Дизайн уже написан: **[`docs/ACL-DESIGN.md`](./docs/ACL-DESIGN.md)** — формат схемы
(`CollectionSchemaV1`), связь параметров, маски полей, `authorize()` как единственная дверь,
auth-коллекция `users`, 10 «забытых» пунктов, приёмочные тесты. Реализация — отсюда:

- [x] **Решения заказчика (2026-10-09) зафиксированы в `docs/ACL-DESIGN.md` §11–§12:**
      схема в БД (`kit.collection` + `kit.acl_epoch`) с кэшем-снимком в памяти; REST — только
      generic-роут + реестр (коллекции создаются в рантайме, файл-роут нельзя задеплоить
      заранее); auth `users` делает пакет (свой минимум); язык правил — **отложено**,
      каноническое хранение уже AST в JSONB, поэтому обратимо без миграции данных.
- [ ] `src/rest/` (framework-agnostic, возвращает `Response`):
      `defineCollection`/`CollectionSchemaV1`, `validateSchema` (падает на старте),
      `registry`, `authorize(ctx, collection, action, input)`, `handleRest(request, {registry})`,
      `rate`-лимит, `schemaHash`.
- [ ] Ядро — только минимальные диффы (таблица в §9 дизайн-дока): `{$principal}` в значениях
      фильтра, `restore`, `capabilities` без изменений, `withSignal` уже повсюду.
- [ ] Роуты в приложении (`src/routes/api/rest/[collection]/+server.ts` + `users/+server.ts`) —
      **в `/home/user/integration`**, не в `repos/modal-kit`; в `modals-kit` попадёт только
      по явному согласию владельца, и то как 20-строчный файл-обёртка над пакетом.
- [ ] `select`/`insert`/`update`/`delete`/`restore` для коллекций; `signup|signin|signout|forgot|reset|verify-email|change-password`
      для `users`; каждый вызывает `authorize` (иначе grep-тест красный).
- [ ] Тесты: матрица §10.1 (6 действий × 4 субъекта), фаззинг `?filter/order/fields/include`
      с инвариантом «мутация не расширяет видимое множество», утечки 404/403,
      mass-assignment, курсор-реплей после смены `version`, auth-тайминги/одноразовость,
      **и всё это на четырёх транспортах** (PGlite, pg, http-proxy, ws-proxy).
- [ ] Документация: `docs/08-rest-acl.md` + `docs/security.md` + раздел README §10.

## T4.1 Инфраструктура ACL-схемы (следствие «схема в БД»)

- [ ] `src/lib/db/migrations/003-kit-acl.sql`: `kit.collection`, `kit.acl_epoch`, триггер `acl_touch`
      (любое изменение коллекции поднимает epoch), `policy.deny()` на системные таблицы.
- [ ] `src/rest/registry.ts`: сборка снимка (`Object.freeze`), атомарная подмена,
      отрицательный кэш, «битая схема → остаёмся на прошлом снимке + warn».
- [ ] Актуальность: каналы 1–4 из §12.2. **Корректность держится на канале 1**
      (`SELECT epoch … ` внутри транзакции записи → `transaction` → повтор ≤ 2 с новым
      снимком), `LISTEN` — только ускорение и только на direct-соединении.
- [ ] Проверено и зафиксировано: Hyperdrive **не поддерживает** `LISTEN`/`NOTIFY`, advisory
      locks и per-session state ([docs](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)),
      PgBouncer/Neon-pooler в transaction-mode — тоже; значит подписка не может быть
      механизмом корректности. Отсюда и отсутствие `LISTEN` в ядре порта.
- [ ] Тесты инвалидации: (а) отзыв права **до** коммита записи не даёт записи состояться
      (проверяется на реальном PG17: второй сеанс меняет строку схемы между `BEGIN` и `COMMIT`);
      (б) чтение после отзыва становится закрытым не позже TTL; (в) смена `schema_hash`
      инвалидирует курсоры; (г) 404 на несуществующую коллекцию кэшируется (нет SQL на спам).
- [ ] **Открытый подвопрос к заказчику**: для чувствительных коллекций включать ли
      проверку epoch и для чтения (`maxAclStalenessMs`) — это +1 round-trip на GET.

## T4.2 Следствия из прогона «Шикимори» (`src/lib/db/probes/shikimori-view.probe.mjs`, PG 17)

- [x] **Составная коллекция работает уже сейчас**: `table: "shiki.v_user_anime"` +
      `policy.select: (ctx) => ({field:'user_id',op:'eq',value:ctx.principal.id})` —
      компилятор отдаёт `WHERE ("…"."user_id" = $1) AND (TRUE) AND (TRUE)`; `count`,
      `order`, `page` над вьюхой — зелёные (`PROBE_OK`).
- [x] `SQLSTATE 42501/42502 → forbidden` (было 500) + тест 16-й в `port-specific`.
- [ ] `source.kind: "view"` в схеме (отдельно от `table`: у вьюхи есть `writeThrough`),
      `source.kind: "sql"` — только read-only и обязан отдавать `user_id` колонкой.
- [ ] `writeThrough: { kind: "trigger", session: { "kit.user_id": { $principal: "id" } } }`:
      вставка/удаление составной коллекции выполняются **внутри `db.transaction`** с
      `SELECT set_config('kit.user_id', $1, true)` (проверено: u1 видит 3, u2 — 0;
      открепление = мягкое, `shiki.animes` не тронут). Для `proxy-http` (без транзакций)
      этот путь = `unsupported` — зафиксировать в матрице возможностей.
- [ ] `links.exists` как основной фильтр «по связи» (в прогоне это два запроса:
      `category_tags` → `in` по id); решение про оператор `overlaps` для jsonb-массивов —
      отложить до первого реального требования (см. §13.2 п.4).
- [ ] `expose.strictFields` (default true): неизвестное `?fields=` = 422, а не тихое
      сужение (ядро сужает намеренно — `readable()` фильтрует по `own && grants`).
- [ ] Индексы под составные коллекции + тест лимита: `(user_id, removed_at, added_at DESC, id)`
      на связке, `(tag_id, category_id)` для `EXISTS`; `inValues 100` на «категориях с тегом»
      обязан отказывать, а не расширять выборку.
- [x] Ядро больше не принимает молча нерабочую форму: `defineResource` → `checkShape`
      (`softDelete.value`/`readDeleted`, `generated` + write-маска, неизвестный оператор в
      `filters`, `localField`/`foreignField`, `validateFinal` не-схема, `order` без
      `orderable`), причины — в `details.issues`; тест 17-й в `port-specific`. Компилятор
      схемы обязан вызывать тот же путь (битая коллекция = не опубликована, а не 500).
- [ ] «Корзина» в REST: `includeDeleted` = «не скрывать», а не «только удалённые»;
      список удалённых = `includeDeleted` + `isNotNull` по метке, под грантом
      `softDelete.readDeleted` → в схеме это явный `restore.visible` (+грант), не «всем».
- [ ] Компилятор: у составной коллекции `primaryKey` = суррогатный id связи;
      `INSTEAD OF INSERT` обязан вернуть `NEW` с `id`/внешними ключами; `softDelete`
      вешается только на одно-табличную вьюху; в `masks` — правило «в агрегат только поля,
      открытые всем» (проверено: приватный тег иначе утекает в `tags`).
- [x] `src/lib/db/probes/http-roundtrip.mjs` — сквозная проверка пакета на приложенном приложении
      без Playwright (14 проверок, `HTTP_ROUNDTRIP_OK`); годится как приёмка после каждой
      правки `src/lib/db/sveltekit/**`, когда браузера в песочнице нет.
- [ ] Ответственность за регистр: `contains`/`startsWith` = `LIKE` (регистр значим,
      `%`/`_` экранированы). Либо в UI честное «чувствительно к регистру», либо оператор
      `icontains` в ядре — решить при T2.
- [ ] Приёмочный фикстур: прогон становится `test/acl-shikimori.check.mts` с теми же
      утверждениями (скоуп, mass assignment, чужая категория, мягкое открепление,
      отсутствие SQL в ответе) × четыре транспорта (pg, PGlite, proxy-http, proxy-ws).

### §0.1 Что не переживает пересоздание песочницы

`~/.cache/ms-playwright` (chromium) и `node_modules/.cache` — **не** сохраняются, как и
`node_modules` целиком (имена в списке исключений снапшота). После пересоздания
песочницы проверка в браузере падает дважды: сначала на `ERR_MODULE_NOT_FOUND`
(`playwright` нет в дереве), затем chromium стартует и умирает с
`libnspr4.so: cannot open shared object file` (системные библиотеки тоже вычищены).
Восстановление проверено 09.10.2026: `cd /home/user/integration && npm ci --no-audit
--no-fund && npx playwright install chromium && npx playwright install-deps chromium`.
Либо пользоваться `node src/lib/db/probes/http-roundtrip.mjs` (браузер не нужен) — он
покрывает SSR + actions + разбор query без гидрации, но НЕ видит класс ошибок
«на сервере всё хорошо, в браузере белый экран».

Ещё два следа от пересоздания: каталог PGlite (`data/postgres`) пустой — записи демо
надо создавать заново (пробы это делают), и `Database directory is locked` после
неаккуратной смерти превью лечится удалением `data/postgres/.kit-db.lock` (см. §П).

## T4.3 Безопасность «схема вместо роутов» (см. docs/ACL-DESIGN.md §14)

- [x] Тест-страховка компиляторной части: `port-specific` «данные-как-схема» — враждебные
      `table`/имена полей → `validation`; `{raw:…}`/недекларированный оператор/скрытое
      поле в фильтре → `validation`/`forbidden`; значение и лимит — только параметры;
      звёздочки в проекции нет. (18-я проверка)
- [ ] `collections/*.json` в git + seed-миграция; CI-проверка `schema_hash`
      (drift = падение сборки). Без этого пункта схема хуже ручных роутов (§14.3.1).
- [ ] Миграция `00x-kit-role.sql`: роль приложения **без** `SUPERUSER`/`BYPASSRLS`,
      `GRANT` только на рабочие схемы, `REVOKE INSERT,UPDATE,DELETE ON kit.collection`,
      `SELECT` на `kit.acl_epoch`. Тест: «схему нельзя поменять из приложения».
- [ ] Интеграционный тест привилегий: коллекция, опубликованная «от имени атакующего»,
      над таблицей, которой нет в грантах роли → `database`/403 и **пустой** ответ, не
      список; и `kit.*` не читается через REST (`policy.deny()`).
- [ ] `allowSources` + `links`-белый список в конфиге `dbHandle`; `source.kind:"sql"`
      запрещён вне доверенного namespace (тест на отказ компиляции).
- [ ] `scripts/acl-lint.mjs` (`when:true` + `read:'*'` + `sensitive` = ошибка;
      write-маска не должна включать `user_id`/`ownerField`/timestamps) и
      `scripts/acl-explain.mjs <collection> [--as role]` → печать `WHERE`, масок и лимитов.
- [ ] Kill switch публикации (`enabled=false` → 404 без редеплоя) + аудит `updated_by`;
      `POST /-/schema/refresh` — только `paths.admin`.
- [ ] README/`docs/security.md`: раздел «кто и как может менять схему» (3 абзаца),
      потому что это граница, а не деталь реализации.

## T6. Список демо и пагинатор: что изучать дальше (постановка 09.10.2026)

Записано по просьбе «запиши всё в чеклист на изучение». Это **план изучения**, а не
одобрение сборки: пункты 2–3 менять код не вправе, пока не решено.

### T6.1 Инвентарь: чем слой отличается от «списка с пагинацией»

Задача — решить, что из этого обязано быть в демо, а что лишнее (урок уже пройден:
`?db.size`/`?db.flt`/`?db.ord` в демо были лишними ручками, а уникальное — `?after` —
потерялось). Проверять по коду, не по памяти; строки указаны на 34d288d.

- [ ] Адресная часть URL-адаптера: `extraSearch` (валидатор на ключ), `extraDefaults`
      (ключ со значением по умолчанию в адрес не пишется), `reloadKeys` (смена данных →
      сброс на первую страницу), `searchSpec`, `pageSizes`. Референс:
      `src/lib/ui/demo/db-list/definition.ts`.
- [ ] Режимы и триггеры: `mode` хоста (`single` | `accumulate`) и
      `EdgeTrigger = off | direction | edge | chat | manual`
      (`src/lib/paginate/svelte/PaginatorHost.svelte:187-221`).
      **Чат-режим уже в слое** — `case 'chat'` в `canAuto` (низ грузится без жеста,
      вверх — только по жесту и с бюджетом). Значит «научить пагинатор чат-режиму» —
      задача не слоя, а конфига/демо: показать `bottomTrigger="chat"` + `EdgeSentinel`.
- [ ] Гейты возможностей источника: `capabilities` + `featureGates` (панель гасит
      то, чего источник не умеет, а не включает вхолостую) — в демо БД не задействованы.
- [ ] Состояния: `Skeleton`, `ReplaceLoadingRow`, `EndRow`, `PendingIndicator`,
      `StatusRow`, `EventLog`, `EmptyState`, `ErrorRow` — из них демо показывает только
      `EmptyState`/`ErrorRow`/`LoadingIndicator`.
- [ ] Якоря и прокрутка: `PageAnchor`/`hashAnchor` (ссылка страницы несёт
      `#paginator-<name>`), `scrollToPage`, `prefetchPage`.
- [ ] Честность первой отрисовки: `snapshot` хоста + `snapshotSafeError`
      (расхождение SSR-страницы и первого клиентского рендера показывается как ошибка).
      Демо наступило на это вслепую: режим бралось из стора вне области видимости,
      и на SSR он пуст → теперь значение доится из снимка лоадера
      (`DbPostsList.svelte`, `modeOf`).
- [ ] Принять списком: «в демо БД есть …», «в демо БД не будет …» (иначе экран
      превращается во витрину всех пропов).

### T6.2 Чего в слое нет: перезапрос текущей страницы

- [ ] В `usePaginatorActions` нет `refetch`: набор — `goPage/loadMore/retry/reset/
      prefetchPage/setPageSize/setExtra/scrollToPage/requestMore`
      (`src/lib/paginate/svelte/context.svelte.ts:175-190`). Единственный способ
      «показать свежие данные» сегодня — `reset()` (`core.ts:491`), а он ведёт на
      первую страницу и переписывает адрес.
- [ ] Для «создал запись» это правильно (новая запись — первая). Для «изменил/удалил
      строку на третьей странице» — нет: пользователя выбрасывает на первую.
      Решение искать здесь, а не в демо: `refresh({ keepPage: true })` (перезапрос
      текущего `page` и, в accumulate, всех `loadedPages`) или публичный
      `updatePages`. Пока решено малым: демо зовёт `reset()` и честно называет это
      «обновить источник» (`src/routes/db-demo/+page.svelte`).
- [ ] Проверить гипотезу на живом браузере (проба `probes/db-demo-browser.check.mjs`):
      удалённая с третьей страницы строка исчезает только вместе с переходом на первую
      — это и есть аргумент в пользу `refresh`.

### T6.3 Оптимистичная («фэйковая») строка: изучать, не строить

- [ ] Что есть: `pending: { page, mode: 'prepend' | 'append', count }`
      (`core.ts:308`) — состояние «идёт подгрузка», оно и рисует скелет в
      `Skeleton`/`ReplaceLoadingRow`. Подставных ДАННЫХ слой не держит: вставить
      фантом в `pages[page]` можно только через `store.update`, и это обход контракта.
- [ ] Что надо решить до кода: (а) кто владеет фантомом — источник или пагинатор;
      (б) как сверять с сервером (ждать строку с этим `id` в ответе страницы и заменить
      фантом ею); (в) откат, если сервер отказал или записи нет через N попыток;
      (г) счётчик `totalItems` и порядок (`created_at DESC` ⇒ фантом в начало) —
      расхождение с ответом сервера должно быть видно, а не подметено;
      (д) что делает фантом в accumulate-режиме на третьей странице.
- [ ] Форма решения — не «кнопка вставляет строку», а примитив вида
      `optimisticRow(page, row, { until: 'server' | ms })` в слое + тест на откат.
      Без этого демо получит локальный колдун, который потом никто не повторит.

### T6.4 Мелкий долг, найденный по пути

- [ ] `FormState.submitCount` объявлен (`src/lib/form/state.ts:15`) и инициализирован
      нулём, но ядром не увеличивается нигде. Реакция «одна отправка = одно событие»
      в db-демо построена на переходе `status` в `success`. Либо поле довести до ума
      (и тогда перейти на него), либо убрать из контракта: оно обещает то, чего нет,
      и эффект на нём молчит (именно так первый вариант и не работал).
- [ ] Превью и тесты спорят за один каталог: `vite preview` держит блокировку
      `data/postgres`, и `npx vitest run src/lib/db` на этом же `DATABASE_DIR` даёт
      2 ошибки и 18 непройденных тестов (проверено 09.10.2026: 21 passed (39) →
      39 passed (39) после останова превью). Либо тесты берут свой каталог, либо в
      README — строка «сначала останови превью».
- [ ] `vite preview` обязан быть перезапущен после `npm run build`: серверный бандл
      импортируется при старте, и после пересборки превь отдаёт старый HTML с
      удалёнными ассетами (ENOENT → падение процесса → следом «Database directory is
      locked» у следующего запуска).

## T5. Готовность и правила (для следующей ветки/агента)

1. Порядок: ответы Q1–Q4 → T3.2 (перенос http/ws, всё уже поднято) → T3.3 (Neon) →
   T4.1 (`authorize`+схема, без роутов) → T4.2 (REST) → T2 (фичи по остатку) → T1-хвосты.
   Причина: перенос адаптеров даёт транспорт для тестов ACL; фичи из T2 без ACL не нужны.
2. Каждая правка проходит: `npm run check` (typecheck+build+тесты) → `npm run docs:check` →
   `node test/run.mjs` с нативными env (PG17) → `npm pack` + `svelte-check` в
   `/home/user/integration` → Playwright `/db-demo`. Проксированные транспорты —
   ещё и `PROXY_HTTP_URL`/`PROXY_WS_URL`.
3. В `repos/modal-kit` не пишем никогда (ограничение пользователя: апстрим будет
   обновляться). В `/home/user/integration` — можно, это черновик-приложение.
4. `docs/` (включая этот чеклист и дизайн) в npm-тарбалл **не** кладём: `files` =
   `dist, src, migrations, README.md, PORTING.md`; решение пересмотреть, когда дизайн
   станет договором (тогда `docs/` в `files` + версия `0.2.0`).
5. Снапшот-ограничения: `node_modules`, `dist`, `/tmp/pgdata`, `pgproxy-lab/node_modules`
   не персистентны → перед любыми прогонами выполнять §0.
6. Безопасность: токены/секреты (PGPROXYSECRET, `DB_CURSOR_SECRET`, строки подключения) — только
   в env песочницы; в коммиты не попадают (`.gitignore` + `pre-commit` не проверяется —
   следить руками, `git grep -I "github_pat\|postgres://.*:.*@"`).
7. Отзыв PAT'а пользователя в GitHub всё ещё не сделан (его action item с первого шага).
