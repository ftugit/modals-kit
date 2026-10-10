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
| гейты этого среза | vitest 35 файлов / 618 тестов · tooling 104/104 · слой 40/40 (30 в `db-port-specific`) · svelte-check 0 ошибок (47 warning'ов в `src/lib/paginate` и демонах) · build ~10 s · `test:db:probes` ORDER OK · `INTEGRATION_HTTP_OK (30)` и `HTTP_ROUNDTRIP_OK` на обоих движках (5173 PGlite, 5174 живой PG) · `probes/db-demo-browser.check.mjs` → `DB_DEMO_BROWSER_OK (12)` — браузерная проверка обязательна: HTTP-проба не видит класса ошибок «SSR зелёный, гидрация мёртвая» (Chromium ставится `npx playwright install chromium`, порт превью обязан быть в `PREVIEW_PORTS`, иначе Kit отвечает 403 на POST формы) |
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
| **Превью демо (`/db-demo`, `/paginator`)** | `npm run build && DATABASE_DIR=data/postgres DB_CURSOR_SECRET=$(openssl rand -hex 24) npm run preview -- --port 5173 --host 0.0.0.0` (порт — из `PREVIEW_PORTS`, иначе Kit отвечает 403 на POST формы). Секрет короче 32 байт = 500 с `DB_CURSOR_SECRET непригоден` — это отказ конфига, а не бага демо | пробы: `node probes/db-demo-http.check.mjs` (30 шагов) и `node probes/db-demo-browser.check.mjs` (12 проверок, нужен Chromium); `data/postgres` переживает пересоздание песочницы, но перенесённый каталог PGlite иногда не открывает («PGlite failed to initialize properly») → каталог удалить, корпус вернётся миграцией и сидом; замок `.kit-db.lock` мёртвого владельца снимается сам (живой — отказ) |
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
      Проверка — `probes/db-demo-http.check.mjs`: 30 шагов, `INTEGRATION_HTTP_OK (30)`.
      В шагах про курсор проверяется свойство, а не разметка: цепочка `cur=1` +
      `after`-ссылок покрывает весь список без повторов и пропусков и идёт в том же
      порядке, что `?page=N` (иначе keyset выглядел бы «работающим» и с потерянными
      строками); `size=3` = ровно 3 строки; битый токен = 400 с текстом, а не чужая
      страница; `?page.cur=on` (чекбокс нативного GET) даёт те же строки, что `=1`.
      Ключи адреса — общие (`?page`, `?page.size`, `?page.flt`, `?page.ord`, `?page.mode`);
      `?page.flt`/`?page.ord` уходят в слой, отказ фильтра виден как `ErrorRow`; отдельный
      шаг следит, что `POST /db-demo/submit` отвечает JSON, а не HTML (отправка без
      перезагрузки), а шаг `?page.mode=stream` — что режим навигации работает и без JS.
      SSR-проверка не видит класс ошибок «в браузере белый экран», поэтому рядом лежит
      `probes/db-demo-browser.check.mjs` — 12 проверок в chromium (`DB_DEMO_BROWSER_OK (12)`):
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
неаккуратной смерти превью больше не требует ручного удаления `data/postgres/.kit-db.lock`:
   владелец замка проверяется по pid, и запись мёртвого процесса снимается сама (в stderr —
   строка `[kit-db] … снят`). Живой владелец — по-прежнему отказ: два писателя PGlite не
   переживает, и здесь «самопомощь» была бы порчей данных (см. §П).

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

Постановка, из которой вырос раздел: «кроме курсора проверь, что ещё умеет слой для
страниц от БД; нужна обычная навигация со списком страниц». «Обычная навигация» — НЕ
пункт изучения, она уже сделана кодом (34d288d: `PageNav` + `?page`, режим переключается
панелью, проверка в живом браузере). Изучается остальное — что ещё слой умеет сверх
курсора и номерова списка (T6.1), и кто вообще обязан грузить страницу при смене
номера (T6.5 — вопрос задал заказчик 10.10.2026).

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

### T6.5 Кто грузит страницу при смене номера: SSR или ядро (вопрос заказчика 10.10.2026)

Замерено на собранном превью (клик по «2» в `PageNav`, лог сети Chromium):

    GET /api/db-posts?page=2&size=5   ×3   (prefetch с наведения/фокуса + сама страница;
                                           клик БЕЗ наведения даёт ровно один запрос)
    GET /db-demo/__data.json?page=2   ×1   (SvelteKit перезапустил `+page.server.ts` load)

Как в SolidHono (первоисточник, `repos/solidhono`):
- `src/ui/paginator/nav.tsx:67` — тот же `e.preventDefault()` + `goPage()`, с комментарием
  «JS есть — SPA-переход через ядро; нет JS — сработает href». То есть страница-номер и там
  НЕ была перезагрузкой документа: SSR отдавал только первую отрисовку.
- `src/routes/_app/(demo)/paginator.tsx:33` — `loaderDeps: () => ({})` с комментарием
  «Смена страницы и настроек обслуживается paginator adapter, не route loader»: лоадер
  маршута ЯВНО не зависит от `?page`, поэтому смена страницы его не перезапускает.
  Данные для страницы идут через `createServerFn` (`getItemsPage`, endpoint `items.getPage`).

Как в порту (modals-kit):
- Клиентская часть совпадает: `PageLink` (`src/lib/ui/paginator/PageLink.svelte:47`) —
  preventDefault + `goPage`, данные берёт ядро через `source` → `fetch('/api/db-posts')`
  (`src/lib/ui/demo/db-list/definition.ts`, клиентская ветка `data`). SSR-снапшот строится
  тем же конвейером на сервере (`src/lib/server/db-list.ts`), без self-fetch.
- Расхождение: запись адреса идёт через `goto` (`src/lib/router/sveltekit.ts:62`), а `goto`
  с новым `?page` = навигация SvelteKit → `+page.server.ts` load выполняется заново →
  второй запрос к БД на каждое нажатие. Его результат списком не читается: `snapshot`
  принимается хостом ОДИН раз при инициализации (`PaginatorHost.svelte:126`, `let snap =
  snapProp` вне `$effect`), а `onExternalPage` на совпадающей странице — no-op (echo-guard,
  `core.ts:394`). То есть лишний round-trip без пользы, чего у SolidHono не было.
- Что при этом честно SSR-ится: первая отрисовка по любому адресу (в т.ч. `?page=3`,
  `?page.mode=stream`) и весь путь без JavaScript — `<a href="?page=2">` работает как
  настоящая навигация (проверки в `probes/db-demo-http.check.mjs` — «?page=2 отдаёт ДРУГИЕ
  строки», «?page.mode=stream без JS отдаёт ссылку подгрузки»).

Решение (не принято; ничего не менять без слова заказчика):
- [x] Вариант A — **ВЫБРАН и сделан 10.10.2026** (T7.2): «ядро грузит, адрес правится молча», как в solidhono: записи пагинатора
      из `persist` гнать через `syncAddress` (history replace) вместо `goto`, а в
      `+page.server.ts` load оставить только первую отрисовку. Плюсы: минус один запрос к БД
      на клик, адрес всё ещё ссылается. Минус: `page.url` в компонентах отстаёт от стора.
- [ ] Вариант B — «SSR источник истины для страниц»: load остаётся, а клиентский fetch
      убирается (source на клиенте читает `data`, а не `/api/db-posts`). **Отклонён:**
      на каждую страницу, ровно «по идее» заказчика. Минусы: теряются prefetch/hover и
      мгновенный accumulate-край; `?page.mode=stream` всё равно обязан оставаться ядром.
- [ ] Вариант C — оставить как есть, но прекратить двойную работу: `snapshot` хосту
      обновлять при смене `data` (не только на init) → лишний ответ лоадера перестаёт быть
      мусором. Самый дешёвый, но дублирует источник данных (стор и props).
- [ ] Что бы ни выбрали: проверить тем же логом сети, что на клик остаётся ОДИН запрос к
      БД (A/C) или одна навигация (B) — иначе «экономия» останется на словах.

## T7. Один источник на две демо-страницы: `page` + `cursor` (постановка 10.10.2026)

Дословно заказчик: «Твой источник работает как со страницами так и с курсор. В странице
пагинатора именно для твоего источника можно включить cursor. У db-demo тоже самое,
отображается пагинатор, но нет выбора хранилища и источника. Опция включения cursor тоже
есть.» И: «твоя демка это развитие работы с бд. А страница пагинатора просто получит из
твоей демки пункт источника».

Принятая форма (правка к тому, что я предлагал раньше — там я ошибся дважды):

- общий у двух страниц — **источник** (он же транспорт SSR/HTTP) и **компонент списка**;
  `/db-demo` НЕ заводит своего `slice` и не остаётся отдельной разметкой;
- `/db-demo` = тот же пагинатор, но панели нечего выбирать: источника и хранилища там нет;
  на `/paginator` тот же список опций плюс `src`/`store`;
- курсор — **возможность источника**, а не третья накопительная режим-опция: тумблер
  появляется на обеих страницах и ровно тогда, когда выбран источник БД;
- `?page.mode=pages|stream` (моя ручка 34d288d) **снят**: его роль выполняет тумблер
  курсора, двух ручек для одного решения не остается.

### T7.1 Семантика адресов (решение, по которому проверяются пробы)

| режим | адрес | что делает сервер | что в UI |
|---|---|---|---|
| страницы (выключен) | `?page=N&page.size=S&page.flt=&page.ord=` | `parseListInput` → `select`+`count` (offset) | `PageNav` с номерами (totalPages известны) |
| курсор (включён) | `?page.cur=1&page.after=<токен слоя>` + тот же `size/flt/ord` | `parseListInput(…, {cursor:true})` → `api.cursor` (keyset, `limit+1`) | номеров нет (totals не отдаются, R12), есть «↓ дальше» и «↑ выше», обе — ссылки |

Правила, которые обязан держать и сервер, и панель:

- `page` и `after` взаимоисключающи на уровне слоя (`parseListInput` отказывает сам,
  `resource.ts:160`); в адресе номер остаётся **меткой слота** ядра, при `cur=1` сервер
  читает токен и номером не пользуется;
- токен выдаёт сервер (`cursorCodecFromEnv`, HMAC + TTL); клиент его не строит и не
  подделывает; без `DB_CURSOR_SECRET` курсор **выключен честно** — панель показывает
  причину, а не работающий вхолостую тумблер (слой на `api.cursor` отвечает `unsupported`);
- курсорный режим смотрит в одну сторону: `after` = «следующее после последней
  загруженной страницы». «Назад» = память ядра (страницы уже в окне) или кнопка «Назад»
  браузера; ссылки `?page=N-1&after=<старый токен>` не существует намеренно — она бы
  показала не ту страницу;
- ключи, влияющие на выборку (`cur`, `size`, `flt`, `ord`), — в `reloadKeys` (смена =
  новая выдача со слота 1); `after` в `reloadKeys` НЕ входит, иначе каждый ответ
  перезапускал бы загрузку, из-за которой он и появился.

### T7.2 Стадии (каждая — локальный снимок, порядок не менять)

- [x] **Ядро пагинатора: ответ источника может дописать свои ключи extra.** Без этого
      токена нет в адресе, а значит no-JS-ссылки «дальше» не существует и курсор
      превращается в JS-подгрузку (запрещено правилом «адрес несёт и JS-, и no-JS-путь»).
      Реализовано: `PageResponse.extra?: Extra` (`types.ts`) + слияние в `applyResult`
      (`core.ts`) по тому же deny-safe правилу, что и `setExtra` (непроглашенные ключи
      отбрасываются с предупреждением); `sourceState` для этого НЕ использован — он
      «restore only by a cursor-aware adapter», а адресный курсор — часть extra.
      Плюс `HrefContext.extra`: `hrefFor` дописывает объявленные ключи состояния,
      которых нет в адресе (на SSR адрес править нечем, иначе ссылка и клик вели в
      разные адреса). Тесты: 4 новых в `paginate.test.ts` (603 зелёных), гейт totals
      указатель больше не съедает.
- [ ] **Сервер: один `queryPage` на оба адреса** (`src/lib/server/db-list.ts`) — `cur`
      выбирает `select`+`count` или `cursor`, ответ `PageResponse` дополняется `extra.after`;
      `/api/db-posts` принимает `cur`/`after` и отклоняет всё, чего не объявил; SSR-снапшот идёт
      тем же путём (self-fetch запрещён как был).
- [ ] **Источник: `dbPostsSource` объявляет курсор как возможность** — `cur`+`after` в
      спеке extra и в `filters`, `totals` снимаются гейтом при `cur=1` (панель и `PageNav`
      гасят номера сами, по `capabilities`, без знания имени источника).
- [ ] **Панель `/db-demo`: только `page.size`, сортировка, курсор** — `PaginatorSettings` с
      `fields` из трёх пунктов; `noscriptHint` говорит про адрес, `footer` — живые числа
      (`ListMeta`), а не константа.
- [ ] **`/paginator`: пункт «БД» в списке источников + тумблер курсора для него** —
      `DemoSrc` пополнился значением `db`, `makeSource` собирает его из того же
      `dbPostsSource` (не копии), поле `cur` в `DEMO_FIELDS` связывается с `src` через
      `enabledBy`, курсорный `requires` берётся из возможностей.
- [x] **Запись адреса — `syncAddress`, а не `goto` (вариант A из T6.5)** — одно нажатие на
      страницу = один запрос к данным; лоадер маршрута остаётся только за первую
      отрисовку. Отличие от solidhono («`loaderDeps: () => ({})`») закрыто на нашей
      стороне контракта: адаптер писал адрес «переходом», теперь правит записью истории.
      Проверка — лог сети: `x-sveltekit-invalidated` на клик обязан исчезнуть.
      Сделано в `createUrlAdapter.persist` (`adapter-url.ts`): при роутере с
      `syncAddress` адрес правится заменой записи истории, `navigate` остаётся
      роутерам без такой возможности. Попутно найден и закрыт дефект prefetch'а:
      hover и focus по одной ссылке давали два одинаковых запроса (буфер проверялся
      только по завершении), а ответ предзагрузки, приехавший после смены фильтра,
      попадал в буфер нового набора — теперь полёт на страницу один, а поколение
      буфера отбрасывает устаревший ответ. Тесты: 4 новых в `paginate.test.ts`
      (52 в файле, 618 в vitest), `npm run check` — 0 ошибок (47 warning'ов).
- [x] **Пробы переписаны под обе формы адреса** (сделано 10.10.2026, прогоны ниже): HTTP (`probes/db-demo-http.check.mjs`) —
      `?page.cur=1&page.after=…` отдаёт следующую страницу, битый/чужой токен → отказ
      текстом, `page`+`after` → отказ; браузерная (`…-browser.check.mjs`) — тумблер
      курсора на обеих страницах, номера гаснут, «дальше» = один запрос, без JS ссылка
      работает; `test:db:probes`/`test:guard`/`npm run test`/`npm run check` — зелёные.
      Прогоны: `INTEGRATION_HTTP_OK (30)`, `DB_DEMO_BROWSER_OK (12)`,
      `PAG_SKEL`-наблюдение (БД в обоих режимах, HTTP 200, `load-next` 1 в курсоре),
      vitest 35 файлов / 618 тестов, `svelte-check` 0 ошибок.
      Что пробы поймали (то есть проверка была нужной, а не ритуальной):
      в SSR-разметке `/db-demo` ссылка «дальше» шла ПЕРВОЙ до токена, и поиск
      «`data-testid` … потом `page.after`» ловил не ссылку, а шум; в браузерной пробе
      шаг про токен стартовал из конца списка (там `EndRow` законно съел ссылку);
      `getAttribute('href')` возвращает значение с якорем `#paginator-db-demo`, поэтому
      форма токена в regex — `[^&#]+`, а не `[^&"]+`.

### T7.3 Долг, который эти стадии оставляют видимыми

- [ ] Секрет курсора живёт в переменных процесса, а не в `.env`: `envReader` читает
      `process.env` и `import.meta.env`, а серверные ключи в `.env` не доезжают (проверено
      на `DATABASE_DIR`). Значит превью надо поднимать так:
      `DATABASE_DIR=data/postgres DB_CURSOR_SECRET=<не короче 32 байт> npm run preview`, и это
      обязана повторять строка запуска в §0. Короткое значение — не «курсор помягче»:
      `createCursorCodec` отказывает (`Invalid cursor key/TTL configuration`), и демо
      падало в 500 на каждый запрос. Отказ назван (в логе — `DB_CURSOR_SECRET непригоден:
      …`), а каталог после отказа больше не остаётся заблокированным (см. ниже про замок).
      В песочнице секрет удобно брать из генератора: `DB_CURSOR_SECRET=$(openssl rand -hex 24)`
      — в отличие от литерала он не попадает ни в редакторский буфер, ни в фильтры
      маскирования, которые съедают длинные значения в командной строке (проверено:
      `…32b` доезжает до процесса обрезанным). TTL 1800 с — ссылка «дальше», оставленная на
      полчаса, отказывает `cursor`; это правильное поведение, но оно должно быть сказано в
      панели, а не открыто пользователем на глаз.
- [x] Источник обязан работать с одним и тем же transport-мостом на обеих страницах:
      серверный транспорт ставится `$lib/server/db-list`, и если `/paginator` не подставит
      его (а хук — не навесит `dbCtx` на этот путь), «тот же источник» окажется правдой
      только для `/db-demo`: там серверный рендер, там — догрузка через HTTP.
      Сделано: `import '$lib/server/db-list'` стоит в `src/hooks.server.ts` — side-effect
      на весь процесс, поэтому транспорт есть у обоих демо и у API независимо от того,
      какой роут обрабатывает запрос. В лоадере `/paginator` его держать нельзя:
      `+page.ts` — universal, его граф доходит и до браузера, а `$lib/server/*` —
      серверные модули; попытка кончилась удвоением инстанса синглтона `getRuntime`
      (две копии модуля в серверном бандле → вторая считала каталог занятым и демо
      отвечало 500 на каждый запрос). Проверка — шаг HTTP-пробы «/paginator: пункт «БД»
      рисует те же строки, что /db-demo»: id совпадают по порядку, и отказа нет.
- [x] `/db-demo` и `/paginator` различаются только полем `showSelectors`: решение
      изменено 10.10.2026 по указанию заказчика — `/db-demo` остаётся полигоном
      разработки БД (своих селекторов источника/хранилища у него нет), а `/paginator`
      получает пункт «БД». Дублирование снимается не общим компонентом-страницей, а
      общими кусками, у которых ОДИН смысл: источник (`fetchDbPosts` + `withDbCursor`),
      строка записи (`DbPostRow.svelte`), разбор адреса (`DB_LIST_EXTRA_SEARCH`,
      `cursorExtraField`, `cursorPointerField`) и режим (`useCursorMode`). Различия —
      только в том, что страницы действительно разные: у `/db-demo` шире строка
      (`full` — полный id для формы удаления) и свой `mode`/`bottomTrigger` на хосте.
      Если появится третье такое различие, честный ответ — не проп в общую компоненту,
      а признание, что это два разных потребителя одного источника.

## T8. Изучение: автоподгрузка новых постов и «фэйковая» карточка (постановка 10.10.2026)

Право на код не даёт: сначала разбор, решение за заказчиком. Что сказал заказчик:
«в зависимости от сортировки новые посты будут появляться либо с конца либо в начало
пагинатора. Автоматически. По идее в режиме чата это будет всегда курсор, тут ты должен
уже сам исследовать»; «сразу после отправки формы, если она прошла валидацию, создаётся
card в поток за последним id… когда REST/БД ответит, данные у card перезаписываются…
фэйковый card должен быть немного прозрачным. Если сервер вернул неудачу — в зависимости
от опции card либо удаляется, либо можно повторить отправку».

- [x] **Что уже есть в слое и почему этого мало.** `EdgeTrigger = off|direction|edge|chat|manual`
      (`types.ts:207`), `chat` = «только в сторону движения» (не даёт пропустить край при
      отрисовке), `LoadMoreLink` + `EdgeSentinel` + `prependBehavior`. Это про **жест
      пользователя**; новых строк, которых ещё нет в выдаче, слой не замечает: у него нет
      точки «переспросить текущее окно» (T6.2) и нет места для строки, которой нет в
      ответе источника (`pending` — только слоты-скелетоны, `core.ts:308`).
- [x] **Как это делают снаружи** (изучение 10.10.2026, детали и ссылки —
      `src/lib/db/docs/LIVE-APPEND.md`): ключевое — различать *дифф* и *переключение
      указателя*: новые строки добавляются по ключу (id/`created_at`), окно не
      пересобирается, пропущенные дыры достаются тем же `after`-шагом; poll без
      backoff и без `visibilitychange` = спам запросами (0.42–2 с на вкладке в фоне —
      типичная цена ошибки); для одного пользователя честнее 1–2 с poll, чем SSE, пока
      нет шины; optimistic-строка обязана быть **в той же нумерации окон**, иначе при
      ответе сервера список «подпрыгнет». Записано целиком с первичными ссылками в
      `src/lib/db/docs/LIVE-APPEND.md` (§2).
- [x] **Почему «в чате всегда курсор»** — обосновано и записано (решение Р1/Р2 в `LIVE-APPEND.md`): offset при новых строках
      сдвигает границы страниц (строка дублируется на двух страницах или исчезает),
      keyset-токен привязан к значению сортируемого ключа и потому дыру не теряет;
      обратное направление (чаты «вверх») требует `before`-токена, которого в слое нет →
      либо `order` разворачивается на запрос, либо «вверх» остаётся offset-ом. Выбран
      разворот порядка: обратного токена в контракте слоя нет, и вводить его ради
      одного направления — значит менять форму токена и его scope.
- [x] **Решения Р1–Р7** (кто опрашивает, куда вставляется карточка, поведение при
      неудаче, держать/не держать дно, участвует ли карточка в `totalItems`) — в
      `LIVE-APPEND.md` §3; в §4 порядок: сначала T8.1 без правки ядра (и пробы,
      которые меряют «нет скачка» и «пауза на скрытой вкладке»), примитив ядра
      (`state.shadow`, `refresh({ keepWindow: true })`) — только если T8.1 покажет,
      что слиянию нужно знание окон. Три вопроса оставлены заказчику (интервал,
      участие карточки в счётчике, нужен ли `Prefer: wait=`).
- [ ] **Решение заказчика нужно по трём вещам:** (1) кто опрашивает БД — `setInterval` в
      хосте, `refresh({keepPage:true})` из ядра (T6.2) или поток от сервера; (2) куда
      вставляется фэйковая карточка при `order desc` (в начало окна, т.е. prepend при
      нулевой странице = «первая страница сверху»); (3) поведение при неудаче — удалить /
      оставить с «повторить» (заказчик просил «в зависимости от опции», значит в панели
      появится третий тумблер).

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
