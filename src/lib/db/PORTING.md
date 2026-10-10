# PORTING.md — как этот пакет соотносится с источниками

Документ для того, кто продолжает работу **без доступа к чату**. Он отвечает на три
вопроса: что откуда взято, почему именно так, и как перенести изменения дальше
(upstream SolidHono → пакет; пакет → обновлённый `modals-kit`).

## 0. Рамка задачи

> адаптируй от solidhono для modal-kit серверную `lib/db`; изучи, как в SvelteKit
> используется база данных и насколько совместимы `lib/db`; modal-kit получит
> обновление, поэтому переноси отдельно, а не сразу в него; изучи интернет/GitHub на
> возможность улучшения кода адаптации.

Эталонные ревизии: SolidHono `f8079b19a4fa6150728a3dc685fc148e2175666a`
(кончик `origin/shiki-final`), modals-kit `f82734f08aa95757a562ee6255586af011a375d8`
(рабочий пин перенесён на **`5d08da7`** — реальный кончик `b1` на GitHub, 2026-10-09;
`modals-kit` публичный, fetch анонимный; `origin/main` = `03eaf77`, 2026-10-06. Причина, по
которой я сначала объявил его приватным, разобрана в §9.1: в клоне не было remote-а)
(кончик `origin/b1`). Форма передачи, выбранная по итогам обсуждения: **отдельный
npm-пакет, потребляемый как зависимость**. `apply.sh`/`format-patch` не нужны; в дерево
`modals-kit` этот порт не пишет никогда — ни файлами, ни `git am`.

> **Эталон переноса изменён (2026-10-09).** SolidHono - самописный каркас, от него решено
> отказываться в пользу нормального фреймворка, поэтому `f8079b1` больше **не** то, с чем
> сверяются: это отметка происхождения кода (откуда что перенесено), а не источник обновлений.
> Дальнейшие сверки - только с `modals-kit` (`b1`), и критерий правки - конвенции приложения, а не
> «как у SOURCE». Репозиторий к тому же приватный (`git ls-remote` запрашивает учётку), так что
> «подтянуть свежий SolidHono» технически невозможно без токена - и больше не нужно.

Клоды для диффов: `/home/user/repos/solidhono` (`work/f8079b1`),
`/home/user/repos/modal-kit` (`work/f82734f`, **read-only reference**).
`origin` в обоих очищен от токена; пушей нет — коммиты только локальные.

## 1. Карта «файл → файл»

Левая колонка — путь в SolidHono, правая — в этом пакете.

| Источник | Порт | Что изменилось |
|---|---|---|
| `server/lib/db/types.ts` | `src/lib/db/types.ts` | добавлено `Statement.signal`, `TxOptions.signal`; `StandardSchemaV1` берётся из `@standard-schema/spec` (не из `zod`); `conservativeLimits` без изменений |
| `server/lib/db/errors.ts` | `src/lib/db/errors.ts` | копия по смыслу: `DbFailure`, `normalizeFailure` (только структурный SQLSTATE, без разбора текста), `presentFailure` сохранён — он и в источнике не про HTTP |
| `server/lib/db/sqlstate.ts` | `src/lib/db/sqlstate.ts` | 1:1 (каталог SQLSTATE PostgreSQL 18, 262 записи) |
| `server/lib/db/policy.ts` | `src/lib/db/policy.ts` | `roles`/`ownerOrRoles` работают с `readonly string[]` (в источнике principal был `Set`) |
| `server/lib/db/database.ts` | `src/lib/db/database.ts` | `withSignal(...)` в 5 местах обращения к драйверу; `guard`/`onError`/`afterCommit` без изменений |
| `server/lib/db/resource.ts` | `src/lib/db/resource.ts` | `withSignal` в select/count/mutate-пути; Hono-обвязки нет и не было; +`insertMany` (пакетная вставка) и `estimate` (оценка строк для пагинатора) — см. §3.1 |
| `server/lib/db/validation.ts` | `src/lib/db/validation.ts` | `field()` принимает **любую** Standard Schema; `f.*` переписаны на `src/lib/db/schema.ts`; `defineResource` без изменений; `checkShape` дополнен: `primaryKey` обязан быть `orderable` (его дописывает `orderBy` как tie-breaker) |
| `server/lib/db/query/sql.ts` | `src/lib/db/query/sql.ts` | 1:1 (`ident/col/expr/projection`, `filterSQL`, `keyset`, `readable`) + ветка `ILIKE` для `icontains`/`istartsWith` с общим экранированием |
| `server/lib/db/cursor/codec.ts` | `src/lib/db/cursor/codec.ts` | 1:1 (HMAC-SHA256, версия + `kid` + TTL + scope) |
| `server/lib/db/adapters/shared.ts` | `src/lib/db/adapters/shared.ts` | `runTransaction`/`scope`: savepoint'ы, «отравленный» parent, `COMMIT`-тег; + проброс `signal` |
| `server/lib/db/adapters/pg.ts` | `src/lib/db/adapters/pg.ts` | приём `maxInFlight = 32`, дедлайн транзакции 30 с; конфиг пула вынесен в `openPgPool` (`sveltekit/node`) |
| `server/lib/db/adapters/pglite.ts` | `src/lib/db/adapters/pglite.ts` | обёртка над уже открытым `PGlite`; `relaxedDurability: false` закреплён в `openNodeDatabase` |
| `server/lib/db/adapters/proxy.ts`, `proxy-client.ts`, `proxy-http.ts`, `proxy-ws.ts` | `src/lib/db/adapters/proxy.ts` (1 entry: `./adapters/proxy`) | перенесены всеми четырьмя, но **без `@juit/pgproxy-client*`**: транспорт = `fetch` + `WebSocket` + Web Crypto (пакет остаётся zero-dep). Протокол те же байты в те же поля; отличаются детали — см. §3.1 |
| `server/modules/probe/resources.ts` | `test/fixtures/resources.ts` | только как тестовый корпус ресурсов |
| `server/modules/probe/rest.ts` | `test/fixtures/probe-rest.ts` + `src/lib/db/sveltekit/query.ts` | разбор `?limit/page/filter/order/fields/include/includeDeleted` стал `parseListInput`; conflict-правило `page`+`after` сохранено |
| `server/modules/probe/api.ts` | — (не переносится) | реестр Hono-роутов: в SvelteKit его роль выполняют `+page.server.ts`/`+server.ts` |
| `server/runtime/request-body.ts` | `src/lib/db/sveltekit/query.ts` | `readBoundedBody`/`readJson` (лимит 64 KiB по умолчанию, `BodyTooLarge` → 413) |
| `SolidHono/tooling/vite/db.mjs` | — (не переносится) | «серверная граница» в SvelteKit — `$lib/server/*` + `svelte-check`; vite-плагин не нужен (проверено: импорт `$lib/server` из клиента ломает сборку) |
| `src/lib/db/migrations/001-db-probe.sql`, `002-db-probe-page-index.sql` | `src/lib/db/migrations/*` | 1:1, как образец схемы под этот слой (не автоприменение) |
| `docs/db-lib.md`, `docs/en/db-lib.md` | [`README.md`](./README.md) | переписано под SvelteKit-идиомы, добавлены §5–§7 (драйверы, миграции, API-матрица) |
| `test/checks/db-lib.mjs` | `src/lib/db/test/ported/db-lib.script.ts` | 16/16 групп, без правок ожиданий |
| `test/checks/db-hardening.mjs` | `src/lib/db/test/ported/db-hardening.script.ts` | 5/5 групп |
| `test/checks/db-followup.mjs` | `src/lib/db/test/ported/db-followup.script.ts` | 8 групп из 12; снятые — см. §4 |
| `test/checks/db-{proxy,build,entrypoints,graph,types}.mjs`, `database.mjs` | `src/lib/db/test/db-structure.test.ts` (частично) | проверки сборочного графа Hono/Vite к порту не применимы; перенесено только то, что про контракт: границы entry-поинтов, полнота `kind → status`, парсинг миграций |
| — | `src/lib/db/schema.ts` | zero-dep Standard Schema-примитивы (`s.text/uuid/integer/…`), ответ на «zod не обязан быть в приложении» |
| — | `src/lib/db/zod.ts` | обратный мост: `z` + `field/f/defineResource`, чтобы `resources.ts` источника переносился без правок |
| — | `src/lib/db/adapters/hyperdrive.ts` | адаптер «`pg.Client` на запрос» по инструкции Cloudflare (см. §3) |
| — | `src/lib/db/sveltekit/{handle,context,errors,query,cursor,migrate,node,index}.ts` | SvelteKit-слой (см. §3) |
| — | `src/lib/db/test/db-port-specific.test.ts`, `src/lib/db/test/fixture.ts`, `tooling/db-docs.mjs` | тесты именно порта; сборка `dist`, runner `test/run.mjs`, `fix-esm` и `tsconfig.build.json` после переезда в дерево не нужны — их удалили |
| — (в источнике нет) | `src/lib/db/ops.ts` | `withRetry`: повтор только при `e.details.retryable === true` (`40001`/`40P01`), экспоненциальная пауза с джиттером, инъектируемый `wait` |
| — (в источнике нет) | `src/lib/db/testing/index.ts` | `withTestDb`: изолированная схема в нативном PG (`KIT_TEST_PG_URL`) или PGlite in-memory; отдельный entry, чтобы `pg`/PGlite не попадали в клиентский бандл |
| `test/checks/db-proxy.mjs` + `adapters/proxy*.ts` | `src/lib/db/test/db-port-specific.test.ts` (группы 25–28) + `src/lib/db/probes/proxy-live.probe.mjs` | решение изменено 09.10.2026: адаптеры перенесены. Проверки источника (`A03` энкодер, `A17` WSS-дедлайны) переписаны на заглушках транспорта — сеть в `npm run check` не нужна; поведение на живом прокси измерялось раньше матрицей (`src/lib/db/probes/transport-matrix.probe.mjs`, её эталонная копия `src/lib/db/probes/lib/proxy-driver.mjs` осталась) |

Правая колонка «`src/lib/db/**`» — код, унаследованный от источника: при ре-синхронизации
его диффят первыми. `src/lib/db/sveltekit/**` — собственный слой, апстрим его не касается.

## 2. Совместимость: что оказалось переносимым как есть

Ядро с SvelteKit не конфликтует ни в одной точке, и это главное, что стоило проверить:

1. `lib/db` **не импортирует Hono**: HTTP-контракт — это `Request`/`DataContext`/`Statement`.
2. Строки проходят `normalizeValue` (`Date` → ISO, `bigint` → `string`) → уже
   devalue-совместимы, то есть пригодны как есть в `load`-данных SvelteKit.
3. Валидация уже идёт через `~standard`, т. е. через тот же контракт, на котором
   SvelteKit 2 строит `error()`/`fail()` и через который работает `$lib/form/schema.ts`
   в `modals-kit`. Поэтому вместо «перевести на zod» получилось «снять обязательный zod».
4. Именование ошибок уже таблицей `kind → status`; в `modals-kit` его достаточно
   обернуть в `throw error(status, body)` (Kit требует `{status, body}`, а не `Response`).
5. Миграции в источнике явные — ровно так же, как это принято в SvelteKit
   (ни одного «на импорте»).

Расхождения, закрытые портом: `@server/*`-алиасы → относительные импорты; `zod` как
обязательная зависимость → опция; `principal.roles: Set` → `readonly string[]`;
отсутствие `AbortSignal` → `Statement.signal` + `withSignal`; пул `max: 4` на serverless →
дефолты `openPgPool`; PGlite в одном каталоге на `dev` и `build` → lock-файл + `memory`.

## 3. Что добавлено поверх переноса (результат исследования источников)

Каждый пункт — с причиной, «откуда взято» и тестом, который это сторожит.

| Улучшение | Обоснование | Где проверено |
|---|---|---|
| `Statement.signal` + `withSignal` во всех обращениях к драйверу; `TxOptions.signal` | SvelteKit отменяет `event.request.signal` на уходе клиента; без отмены SQL продолжает занимать соединение isolate | `port-specific`: «ctx.signal попадает в Statement», «отменённый до запроса signal не порождает SQL у Hyperdrive» |
| Адаптер Hyperdrive: новый `pg.Client` на запрос, дедлайн, `client.end()` в `finally`, `maxInFlight` fail-fast без очереди, инъекция `openClient` | [Cloudflare: `pg` в Workers требует `nodejs_compat` + `pg>=8.16.3`, пул владеет Hyperdrive, клиент на запрос — recommended](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/) | 2 группы в `port-specific`: «отменённый до запроса signal не порождает SQL у адаптера Hyperdrive», «backpressure отказывает сразу, без очереди» (дедлайн проверяется в `ported/db-hardening`) |
| Дефолты `openPgPool`: `max` 1 на Vercel / 4 иначе, `connectionTimeoutMillis 5000`, `idleTimeoutMillis 30000`, `statement_timeout`, `application_name` | [serverless pool sizing](https://www.fronttribe.com/insights/postgres-connection-pooling-on-serverless…): `max` умножается на число холодных стартов; `application_name` иначе не отличить инстансы | реальный прогон `pg`-пула в `dist`-смоук и в интеграции (DATABASE_URL отсутствует → PGlite, путь пула покрыт тестами адаптера) |
| `parseListInput` deny-safe: неизвестный/повторяющийся ключ, `page` рядом с `after`, битый JSON = `validation`; `?/action`-маркер — исключение | SvelteKit кладёт `?/create` в `event.url` на POST; игнорировать мусор — значит тихо принимать чужие ключи; принимать — значит падать на каждом action | `port-specific`: 2 группы на `parseListInput` (включая маркер) |
| `toFormFailure`: сообщения Standard Schema доезжают до `fieldErrors` | в источнике они терялись (`fail('validation', key)`), в UI шёл только «Invalid input»; в Kit формат ошибок формы — `{fieldErrors, formErrors}` | `port-specific` + реальный браузер (`role=alert`, `aria-invalid`) |
| `toKitError` возвращает **данные** `{status, body}`, а не бросает | `error()`/`fail()` живут в `@sveltejs/kit`; импорт оставлен приложению → `./sveltekit` не тянет kit и работает в Workers | `structure.check.mts`: у `./sveltekit` нет `node:`/`pg`/PGlite-импортов; полнота `FAILURE_STATUS` по всем `FailureKind` |
| `splitSqlStatements` вместо `split(';')` | `;` внутри строк/комментариев/`$tag$` режет оператор пополам | `port-specific` + проверка на `src/lib/db/migrations/001` (5 операторов) |
| `openNodeDatabase(..., {memory})` + lock-файл каталога | PGlite в одном каталоге из `dev` и `build` даёт «database directory is already open by process N» ([пример](https://github.com/AaronBuxbaum/diveday/issues/2101)) | тестов нет; проверено руками: `resolveDatabaseDir(root,'idb://db')` → `DATABASE_DIR must be a filesystem path, not a storage URI`, обычный путь → абсолютный; в интеграции демо шло `memory: true` |
| Zero-dep `s.*` + `field(zodSchema)` одновременно | Kit 2 и Superforms валидируются через Standard Schema ([обсуждение](https://github.com/sveltejs/kit/discussions/13336), [zod v4 `~standard`](https://medium.com/@ariawhenujoseph/…superforms…)); жёсткая зависимость от `zod` = лишний деп в `modals-kit`, где его нет | `port-specific`: «`field()` принимает и zod-схему, и свою»; дифференциальный корпус против `zod@4.6.5` |
| `defineResource` проверяет форму конфигурации (`checkShape`) | переносчик поймал три «молча не работающих» конфигурации на реальном PG: `softDelete` без `value`/`readDeleted` (метка пишется `undefined`, `includeDeleted` = вечный 403), `generated` + write-маска (значение теряется), `validateFinal: true` вместо схемы (500 на записи). Источник проверял только идентификаторы и существование полей | `port-specific`: «defineResource отклоняет конфигурации, которые иначе молча не работают» (7 случаев); на реальном прогоне `src/lib/db/probes/shikimori-view.probe.mjs` тот же путь зелёный |
| SQLSTATE отказа прав (`42501`/`42502`) → `forbidden` (403) | составная коллекция с `INSTEAD OF`-триггером отвечала 500 на «в чужую категорию нельзя» — «запрещено» было неотличимо от «упало» ([PostgreSQL: 42501 insufficient_privilege](https://www.postgresql.org/docs/current/errcodes-appendix.html)) | `port-specific`: «SQLSTATE отказа прав идёт в forbidden, а не в database»; сквозной прогон `src/lib/db/probes/shikimori-view.probe.mjs` → `403/forbidden` |
| RLS не включается и не обещается | [RLS — второй эшелон](https://patotski.com/blog/postgres-row-level-security-multi-tenant/), app-level фильтры первичны; `SET LOCAL` — единственная безопасная форма при transaction pooling ([pgbouncer](https://codelit.io/blog/database-pooling-pgbouncer)) | документировано в README §5; `policy`+`filterSQL` закрытыported-тестами источника |
| AsyncLocalStorage не используется | [Kit явно не принимает ALS для запросного состояния](https://github.com/sveltejs/kit/discussions/13336); `DataContext` передаётся из доверенного хука | `port-specific`: «чужие поля ctx — нет», `structure.check.mts`: ядро не импортирует `node:async_hooks` |

## 3.1 Волна T2 (2026-10): пакетная вставка, оценка строк, ретраи, ILIKE, `./testing`

Отправная точка — тот же обзор (Drizzle, Kysely, Slonik, pg-mem, PostgREST, PocketBase,
Directus, Supabase-js, `@neondatabase/serverless`), но взято только то, что не конфликтует с
контрактом ядра (deny-safe, «отказ до SQL», zero-dep) и не требует нового транспорта.

| Что | Зачем и почему именно так | Где проверено |
|---|---|---|
| `insertMany(ctx, rows, { chunkSize, onConflictIgnore, atomic })` | у источника только построчный `insert`; импорт на 1000 строк = 1000 round-trip. Один `INSERT … VALUES (…),(…) RETURNING` на чанк, валидация — тот же `draftInput`. Набор полей обязан быть одинаковым у всех строк, иначе `RETURNING` вводит в заблуждение; `atomic: true` = отказ **до** первого запроса, если транспорт не умеет транзакций. Лимиты: 1…5000 строк, чанк `min(chunkSize, 500, 30000/(колонок+1))` — чтобы `строк × колонок` не упиралось в 65535 параметров протокола | `port-specific`: «insertMany: один INSERT на пачку, валидация та же, лимиты честные» (в т.ч. «отказ до первого INSERT») |
| `estimate(ctx, filter)` → `{ rows, exact, method }` | точный `count(*)` — отдельная проблема больших таблиц; Drizzle/PostgREST точность не обещают и не врут. Порядок: `pg_class.reltuples` (без фильтра) → `EXPLAIN (FORMAT JSON)` / `Plan Rows` (с фильтром) → точный `count(*)`. Выборка ограничена `relkind IN ('r','p','m')`, иначе статистика берётся с объекта, которого нет в плане | `port-specific`: «estimate: reltuples без фильтра, EXPLAIN с фильтром, точный count как откат» |
| `icontains` / `istartsWith` | PocketBase и Directus разделяют `like`/`ilike`; в UI поиск по «атака» обязан находить «Атака». Тот же экранирующий путь, что у `LIKE`, и то же требование «оператор объявлен в `filters` поля» | `port-specific`: «icontains/istartsWith: ILIKE там, где LIKE был регистрозависимым» |
| `withRetry(db, fn, opts)` (`src/lib/db/ops.ts`) | сериализационный конфликт — единственный класс ошибок, где повтор всего блока безопасен (у Slonik/pg-boss ретраи есть, у источника не было). Ретрай строго по `e.details.retryable === true` (из `normalizeFailure`, не по тексту ошибки), пауза экспоненциальная с джиттером, `wait` инъектируется | `port-specific`: «withRetry: повторяет только на откатанные транзакции, паузы экспоненциальные» |
| `./testing` → `withTestDb` | идея pg-mem/PGlite: приложению нужен способ получить «чистую схему на прогон» без Docker. `KIT_TEST_PG_URL` → уникальная схема `kit_test_<hex>` + `-c search_path` (не `SET`: при transaction pooling `SET` теряется между запросами), иначе PGlite in-memory; `DROP SCHEMA … CASCADE` в `finally` | `port-specific` (PGlite) + прогон на реальном PG17; изоляция между вызовами проверена |
| `withTestDb` проверяет энкодинг тестовой БД | `icontains`/`istartsWith` (и любые `upper()/lower()`) в `SQL_ASCII`-кластере складывают регистр только по ASCII → «ложная пустота»: запрос валиден, ответ пуст, тест зелёный. Дефолт `initdb` при `LANG=C` даёт именно такой кластер, поэтому проверка стоит в хелпере, а не в README. Замерено: UTF8 → 1 строка, SQL_ASCII → 0 при живом `contains` | `port-specific`: «withTestDb: …» (UTF8-путь) + `src/lib/db/probes/testdb-encoding.probe.mjs` → `ENCODING_PROBE_OK` (обе базы, включая отказ хелпера и `{ encoding: 'any' }`) |
| `openPgPool({ startupParameters })` | найденное при проверке «можно ли pg напрямую к Supabase на Vercel»: под pooler'ом в transaction mode `statement_timeout`/`application_name` в startup-пакете либо отбиваются (`FATAL: unsupported startup parameter in options: …`), либо молча обнуляются (замер PgBouncer 1.24.1: `SHOW statement_timeout` → `0`). Дефолт `send` не меняем — на прямом соединении GUC полезны; `skip` = «поставь их на роли». Попутно `max`/`maxInFlight` валидируются как ≥ 1 (ноль = ждать соединения вечно и тихий deadlock в admission-cap), таймауты — ≥ 0 | `port-specific`: «openPgPool: serverless-дефолты и startupParameters для пулера» + `src/lib/db/probes/pooler.probe.mjs` (строки A1–A4) |
| `withTestDb` сверяет `search_path` | тот же класс ловушки: pooler отбрасывает `-c search_path`, и «изолированная» тестовая схема незаметно превращается в `public` — тест пишет в чужие данные. Хелпер читает `current_schema()` на двух отдельных подключениях пула и при несовпадении бросает `unsupported`. Проверка дешёвая, ловит и PgBouncer, и Supavisor | `src/lib/db/probes/pooler.probe.mjs`, строка I1 (отказ на живом пулере) + `npm run check` на прямом PG17 (проход) |
| `adapters/proxy`: транспорт — `fetch`/`WebSocket`/Web Crypto вместо `@juit/pgproxy-client*` | пакет остаётся zero-dep, и адаптер можно прогнать на заглушке транспорта (именно так устроены тесты 25–28). Подписанный `?auth=`-токен генерится на месте: 48 байт = int64LE(`Date.now()`) + nonce + HMAC-SHA256, base64url на 64 символа — байт в байт с ожиданием сервера | `port-specific`: «proxyHttpAdapter: …», «pgproxy носит значения текстом…» |
| `adapters/proxy`: строки собираются из кортежей по `fields` | прокси отдаёт `rows: [["42","t"]]` + `fields: [[name, oid]]` и **текст** значений; ядро же ожидает объекты с нативными типами. Без разбора по OID `count` приходил бы строкой, а `field(t.boolean)` падал на валидации собственных данных; `int8`/`numeric` намеренно остаются строками — как `pg`, чтобы не разъезжалось между транспортами | `port-specific`: группа 28 (+ обратное чтение pg-литерала массива) |
| `adapters/proxy`: `params` сериализуются под text-протокол | интерфейс прокси принимает `(string \| null)[]`; `undefined` → `null`, `true` → `"t"`, массив → `{a,"b\"c"}` (как `postgres-array`), `Uint8Array` → `\\x…` — иначе массив уехал бы JSON-ом и(Postgres) прочитался бы как строка | `port-specific`: группа 28 |
| `adapters/pg`: `release()` на обоих путях отменяемого запроса | найдено живым прогоном, а не тестами: `cancellableQuery` брал клиент из пула и возвращал его только на пути ошибки. `signal` в SvelteKit есть у каждого запроса (`sveltekit/context.ts` берёт `event.request.signal`), поэтому при `max: 2` пул высыхал за две страницы: дальше каждый запрос висел до `connectionTimeoutMillis` и отдавал 500, а перезапуск процесса чудесным образом «лечил» — из-за этого симптом читался как «хостинг кладёт БД». Успешный путь теперь делает `release()`, сбойный — `release(err)` (то есть клиент уничтожается, приём из pg-pool); `end()` в `cancel()` оставлен, двойного release пул не простит | `port-specific`: группа 29 (стаб считает connect/release и падает на двойном release); мутация «убрать release» роняет её же — `releases: 0, checkedOut: 3` |
| `adapters/proxy`: схема не подменяется, а выводится | источник брал `ws://`/`wss:` из входного URL; у нас `http → ws`, `https → wss`, а `http://localhost` — только с `allowInsecureLocalhost`. Самовольная замена схемы на «безопасную» ломает локальный прокси с `ERR_SSL_WRONG_VERSION_NUMBER` — это и был первый сбой живого прогона | `port-specific`: группа 26 |
| `checkShape`: `primaryKey` обязан быть `orderable` | `orderBy` дописывает PK как tie-breaker; на не-`orderable` PK сортировка падала бы `forbidden` в рантайме, а не в момент объявления ресурса | весь перенесённый корпус зелёный → ни одна легитимная конфигурация не отвалилась |

Сознательно **не** перенесено из того же обзора (долг зафиксирован в `CHECKLIST-2` §T2):
страж стоимости запроса на `EXPLAIN` (порог «дорого → 503» — решение приложения, а план
становится источником flaky-ошибок), таблица истории миграций `kit_migration` (меняет контракт
`applyMigrationText` и требует миграций у самого порта), computed/virtual поля (нуждаются в
`expr()`-белом списке, а это новая SQL-поверхность — только вместе с ACL-треком).

## 4. Что снято с переноса и почему

Из `db-followup.mjs` (12 групп) перенесено 8. Снятые группы и причины:

| Группа источника | Причина снятия |
|---|---|
| `A04` readiness-секреты и коалесинг | проверка Hono-роута readiness; у порта нет роутов |
| `A03` Juit HTTP-энкодер и JSONB | зависел от `@juit/pgproxy-client`; после переноса проверется своим энкодером (см. `port-specific`, группа 28) |
| `A17` WSS-дедлайны | транспорт `proxy.ts` перенесён; проверка дедлайна/отмены — в `port-specific` (группа 27) |
| `A17` HTTP-deadline/overload | то же; аналогичное поведение (fail-fast `maxInFlight`, дедлайн) проверяется на Hyperdrive-адаптере |
| `A16` bounded-stream (число чанков) | **не снята, а переписана**: «readJson: лимит тела срабатывает до парсинга, мусор = validation» в `port-specific` |

Движки (`pg`, `@electric-sql/pglite`) — зависимости **приложения**, и слой их не
реэкспортирует из барреля; `pgAdapter`/`pgliteAdapter` принимают готовый объект.
`zod` — `devDependencies`: он нужен только опциональному входу `src/lib/db/zod.ts` и
фикстурам. Единственная prod-зависимость, которую принёс сам слой, —
`@standard-schema/spec` (только типы). `@sveltejs/kit` слой в рантайме не импортирует.

## 5. Тесты: что считать зелёным

```sh
npm run test:db     # == npx vitest run src/lib/db — шестой файл, аудит документации, внутрь не входит
# ✓ src/lib/db/test/db-structure.test.ts       6 групп  (границы слоя)
# ✓ src/lib/db/test/db-port-specific.test.ts  30 групп  (новое поведение)
# ✓ src/lib/db/test/db-ported.test.ts          3 it'а: db-lib 16, db-hardening 5, db-followup 9
# ✓ src/lib/db/test/db-docs.test.ts            1 группа: README/PORTING против кода
# ИТОГО 65 групп; на PGlite выполняются 64 — одна группа db-followup требует нативного PG
npm run test        # всё приложение: vitest по src + node --test tooling/ (стражи, 88 тестов guard'а)
npm run check       # svelte-check: 0 ошибок
# то же против нативного PostgreSQL 17 (портированные наборы идут через pgAdapter):
DB_LIB_TEST_PG_URL='postgres://postgres@127.0.0.1:5433/kitdb_lib' \
DB_HARDENING_PG_URL='postgres://postgres@127.0.0.1:5433/kitdb_follow?host=%2Ftmp' npm run test:db
```

Рантайм-проверки вне тестов, сделанные для этого отчёта (их надо повторять после
правок, которые меняют сборку или публичный API):

1. `npm run build` — сборка приложения: слой компилируется вместе с ним (никакого
   `dist`/`fix-esm` больше нет, `.js`-суффиксы в относительных импортах не нужны:
   `rewriteRelativeImportExtensions`), и сборка же прогоняет `tooling/layer-guard.mjs`.
2. `npm run check` = `svelte-kit sync && svelte-check` → **0 ошибок** (46 warning'ов —
   все предсуществующие в `modals-kit`, в `src/lib/paginate`; тесты слоя исключены из
   `check` так же, как тесты `$lib/form`).
3. Реальный браузер (`playwright` 1.64 + chromium) на `/db-demo`: SSR 7 строк без JS →
   невалидный `title` = `role=alert` + `aria-invalid` + строка не вставлена → валидный =
   `role=status` + 8 строк + запись в выдаче → delete через `use:enhance` = 6 → 5 →
   `?filter`/`?order`/`?limit` работают → неизвестный ключ = 422 → `/` (модалки) жив.
   (Позже список демо переведён на пагинатор приложения: ключи адреса — `?db`,
   `?db.size`, `?db.flt`, `?db.ord`, а отказ по неизвестному ключу показывает
   `/api/db-posts` = 422 `validation`; на странице битый фильтр не 500 и не пусто,
   а состояние `error` пагинатора — `ErrorRow` с причиной и «Повторить».)
   Зонд составной коллекции: `node src/lib/db/probes/shikimori-view.probe.mjs` (реальный PG 17,
   VIEW + `INSTEAD OF` + скоуп по `principal` + маски полей связи) → `PROBE_OK`.
4. Сквозной прогон без браузера: `node src/lib/db/probes/http-roundtrip.mjs` против запущенного
   `npm run dev` копии приложения — 14 проверок (SSR-список пагинатора, `?/remove`/`?/create` с
   перечитыванием состояния, `?db.flt=<json>`, `?db.ord`, 422 на мусор в фильтре и `ErrorRow`
   на странице вместо 500)
   → `HTTP_ROUNDTRIP_OK`. Дешевле браузера и не зависит от `~/.cache/ms-playwright`,
   который не переживает пересоздание песочницы; Playwright-прогоны (§5.3) остаются
   обязательными для изменений, касающихся `use:enhance` и гидрации.
5. Скрипты: `/home/user/integration/browser-check.mjs` (итоговая строка `BROWSER_OK`) и
   `/home/user/integration/delete-check.mjs` (счётчик по SSR-HTML до/после, `DELETE_OK`) —
   второй нужен потому, что в первом шаг «удаление» читает ещё не инвалидированный счётчик.
6. Песочница: 1.9 GiB RAM. Если параллельно работает `vite dev`/`vite preview` с PGlite,
   прогон `ported/db-followup` ловит SIGKILL (rc=137) — это OOM, а не падение логики:
   `npm run test:db` запускают после остановки dev/preview (тогда 38 тестов проходят).

## 6. Баги, найденные самим переносом (уже исправлены в коде порта)

Не «мелкие правки», а результаты дифференциальных тестов — их стоит перечитать перед тем,
как «чинить» это снова:

| Симптом | Причина | Исправление / тест |
|---|---|---|
| `splitSqlStatements` съедал последний символ `$tag$…$tag$`-блока | off-by-one в `slice`/вычислении `last` | `src/lib/db/sveltekit/migrate.ts`; тест «`;` внутри строк, комментариев и `$$…$$` не режет оператор» |
| `timestamp()` принимал `'2020-01-01 00:00:60'`, zod — нет | `TIME_TAIL` допускал пробельный разделитель и `:60` | `src/lib/db/schema.ts`: требуется `T`, `ss <= 59`; тест — дифференциальный корпус против `zod` |
| `load` на `POST ?/create` падал в 500 | `parseListInput` считал маркер action неизвестным ключом | `parseListInput` принимает одиночный `/name` с пустым значением; дубликаты/`/a/b`/`/create=1` = `validation` |
| `App.Locals` не дополнялся | `interface Locals extends import("…").LocalsDb {}` **внутри** `declare global` не мержится | в `app.d.ts` — `import type` верхнего уровня (файл и так модуль из-за `export {}`); зафиксировано в README §2 |
| `delete` строки, скрытой политикой, выглядел как «тихое no-op» | `policy.deny()` даёт `FALSE` в предикате → 0 затронутых → `not_found` | так и оставлено (не протекает существование); задокументировано в README §4 |

## 7. Опровергнутые гипотезы — не чинить

Три «бага источника» оказались неверными после прогонов на реальном коде
(`src/lib/db/probes/order.probe.mts`, `src/lib/db/probes/pglite.probe.mts`):

- **`filterSQL`: порядок `$n` и значений при асинхронной Standard Schema** —
  `WHERE ("x"."a" = $2 AND "x"."b" = $1)`, `VALUES = [222, 111]`, строка корректна:
  привязка ставится в момент генерации фрагмента.
- **`expr()` для timestamp теряет UTC** — для `timestamptz` (что и в миграциях)
  `col AT TIME ZONE 'UTC'` уже даёт UTC; риск только если приложение объявит `timestamp`
  без зоны → это требование к колонке, а не баг.
- **`keyset()` теряет хвост NULL при `NULLS LAST`** — ветка `v === null → FALSE` +
  `IS NULL` на более глубоких ключах + всегда добавляемый PK-tiebreaker дают семантику
  `(a,b) > (x,y)`.

Ещё одна несостоявшаяся «оптимизация»: `node --test` как раннер — не подходит, потому что
перенесённые файлы ассертят на верхнем уровне. В приложении их не переписывали под `it()`:
`test/db-ported.test.ts` — тонкая обёртка: каждый скрипт под ней один `it`, потому что
их тела выполняют всё на верхнем уровне (общий прогон PGlite/PG, общий `try/finally`) и
переписывать перенесённый код под `it()` смысла нет. Свой runner `test/run.mjs` не нужен.

## 8. Ре-синхронизация с upstream

Обновление **источника** (SolidHono) → слоя в этом дереве:

```sh
cd /home/user/repos/solidhono && git fetch origin && git log --oneline f8079b1..origin/shiki-final -- server/lib/db
# пофайловый дифф того, что унаследовано:
for f in types errors sqlstate policy database resource validation query/sql cursor/codec \
         adapters/shared adapters/pg adapters/pglite; do
  diff -u "server/lib/db/$f.ts" "/home/user/integration/src/lib/db/$f.ts" | less
done
```

Правила, чтобы порт не расползся:

1. Правки источника переносятся в `src/lib/db/**` **без** добавления framework-импортов;
   если правка их требует — она не переносится, а переписывается на слой (`src/lib/db/sveltekit/**`).
2. Всё, что касается `DataContext`, обязано остаться frozen + передаваемым из хука (см. §3 про ALS).
3. Новые `FailureKind` немедленно добавляют и в `FAILURE_STATUS`, и в тест полноты —
   иначе `src/lib/db/test/db-structure.test.ts` не зелёный (он же сверяет матрицу README).
4. После переноса: `npm run test:db` → `npm run check` → `npm run build` → §5.2–5.3.
   `tooling/db-docs.mjs` (тот же `npm run test:db`) заставит обновить счётчики и таблицы.

Обновление **приложения** (`modals-kit`): слой лежит в том же дереве, поэтому апгрейд
может задеть и его — при переносе новой ревизии сверяют шесть мест: `src/app.d.ts`
(augmentation), `src/hooks.server.ts` (`dbHandle`), `src/lib/server/db.ts` (composition
root), `src/lib/server/db-list.ts` + `src/routes/api/db-posts/**` (данные для пагинатора
демо: SSR-транспорт и HTTP-доводка — один конвейер на оба пути) и `src/routes/db-demo/**`
со `src/lib/ui/demo/db-{form,list}/**` (страница-витрина: формы — отдельные компоненты,
список — пагинатор). Ниже — чек-лист того, что в приложении обязательно.

## 9. Интеграция в приложение: чек-лист и грабли

```sh
# 0) слой уже в дереве (src/lib/db) — нужно только развернуть приложение
cd /home/user/integration && npm install
npx svelte-kit sync && npx svelte-check
npm run dev -- --host 0.0.0.0 --port 5173 && node browser-check.mjs
#   ...или на 2 ГБ песочнице: npm run build && npm run preview -- --host 0.0.0.0 --port 5173
#   (vite dev + chromium = OOM rc=137; в preview POST без заголовка Origin = 403 — см. 9.1)
```

### 9.1 Перенос на свежую ревизию приложения (2026-10-09)

`modals-kit` **публичный**: `git -C /home/user/repos/modal-kit remote add origin
https://github.com/ftugit/modals-kit.git` и анонимный `git fetch origin b1 main` работают.
Я ранее записал «репозиторий приватный» — причина падения `git fetch` была в том, что в клоне
**не было ни одного remote** (`git remote -v` пуст), а не в правах. Практический вывод жёсткий:
локальные `origin/*` были устаревшими, и «самый свежий known ref» (`15d4355`) оказался на 20+
коммитов старше реального кончика `b1` = **`5d08da7`** (2026-10-09, 132 файла, +7299). Перед
любым «сверить с последним» надо смотреть `git ls-remote`, а не fetched-refs. (Так же проверил
`SolidHono`: `git ls-remote https://github.com/ftugit/SolidHono.git` запрашивает учётные данные —
тот репозиторий действительно приватный.)

Порядок обновления копии (тот же, что и в 0-м пункте выше): `git archive <ref> | tar -x -C
/home/user/integration`, затем `rm` путей из `git diff --name-status <старый> <новый> | grep -E
'^(D|R)'` (на `5d08da7` это 29 путей: `src/routes/{form,modals}/**` → `$lib/ui/demo/{form,modals}/**`,
`ui/paginator/fields/*` → `$lib/ui/settings/*`), затем вернуть своё: deps в `package.json`,
`src/app.d.ts`, `src/hooks.server.ts`, `src/lib/server/db.ts`, `src/lib/server/db-list.ts`,
`src/routes/api/db-posts/**`, `src/routes/db-demo/**`, `src/lib/ui/demo/db-form/**`,
`src/lib/ui/demo/db-list/**`. Дальше
`npm install && npx svelte-kit sync && npx svelte-check && npm run build && npm run test:guard`.

Что потребовало правок именно на `5d08da7`:

- **`tooling/layer-guard.mjs` запретил сырые form-теги** (`pattern /<(form|input|select|textarea)([
  \t\n>])/`, allow-list: `src/lib/form/`, `src/lib/ui/primitives/`, `src/lib/ui/settings/`,
  `src/lib/shell/`). Это vite-плагин из `vite.config.ts`, идущий первым, — валит и `vite dev`, и
  `vite build`; смотрит по исходнику файла целиком, поэтому закомментированный тег в шапке тоже
  красит сборку. `src/routes/db-demo/+page.svelte` переписан на `Form` из `$lib/form/svelte` и
  `Input`/`Button` из `$lib/ui/primitives`: `Form` требует `formProps()`, и демо отдаёт
  `{ method: 'post', action, onsubmit: () => {} }` — submit остаётся нативным SvelteKit-путём
  (демо проверяет слой БД, а не формы кита), скрытые id-пары идут через `hiddenFields`.
- `package.json` приложения изменился только скриптами (`test:browser:errors`) — зависимости не
  двигались; `playwright@^1.63.0` теперь devDependency приложения, в пробах он резолвится как
  `await import('playwright')`, а не путём из npx-кэша (кэш песочницы — не источник истины).

Как гонять проги на 2 ГБ песочнице:

- `vite dev` + chromium = **OOM** (`Killed`, rc=137; всего 1982 MB). Для браузерных проверок
  поднимать **`npm run preview`** на готовом билде: сотни мегабайт вместо гига, и заодно
  проверяется production-путь.
- **`dev` и `preview` различаются на POST-формах**: в проде SvelteKit включает `csrf_check_origin`
  (`@sveltejs/kit/src/runtime/server/respond.js`): POST/PUT/PATCH/DELETE с form-content-type, у
  которого `Origin` ≠ `url.origin` (или заголовка нет и он не в `csrf_trusted_origins`) = **403**
  «Cross-site POST form submissions are forbidden». Рукописный `fetch` без `origin` в dev зелёный,
  в preview — 403. То же касается любого клиента `lib/db`: запросы к form-action/REST надо слать с
  корректным `Origin`.
- Вердикты проб — только относительные: `seeded === 7 && after === 8` давало ложную регрессию,
  когда корпус сдвигался предыдущим прогоном (PGlite живёт в памяти процесса сервера). Нужно
  `after === seeded + 1`.
- Счётчик строк обязан различать «нет `<tbody>`» и «ноль строк»: страница отказа (403/422) тоже без
  tbody, и «0» в логе выглядит как «фильтр не нашёл». Реальный пример: `?filter={"op":"icontains"}`
  на ресурсе, где в `field.filters` объявлены только `eq/contains/startsWith`, = **403**, и это
  корректное deny-safe поведение, а не регрессия `ILIKE`.
- Чтобы `icontains`/`istartsWith` (T2) заработали в приложении, их надо **объявить** в `filters`
  поля — пакет за приложение этого не делает.

- Прямое TCP-подключение (`DATABASE_URL=postgres://…@ip:port/db`) в приложении включается
  `openPgPool`-ом с `ssl: false`, если сервер ответил `N` на `SSLRequest`; `ssl: 'require'` к
  такому хосту только порвёт соединение. Строку подключения не печатать: в зондах пароль
  маскируется (`…:***@host`), так же стоит делать и в логах `getRuntime()`.
- **Вход в демо обязан быть кликабельным**: ссылка на `/db-demo` - в шапку
  (`src/lib/components/header/nav.ts`) и на главную (массив `demos` в `src/routes/+page.svelte`).
  Превью не даёт менять URL, поэтому демо без ссылки из превью непроверяемо; заодно прод-сборка
  (`npm run build` + `npm run preview`) проверяет layer-guard, а `dev` - нет.
- `db`/ресурсы — только в `$lib/server/**`; импорт оттуда в `.svelte` должен падать на
  сборке (в `modals-kit` за этим и так следит `tooling/layer-guard.mjs`).
- `getRuntime()` — ленивый синглтон; `dbHandle({ db })` принимает и фабрику, чтобы
  PGlite не поднимался на каждый запрос.
- `parseListInput` вызывать **внутри** `try`, иначе отказ уходит в Kit как 500.
- В `actions`: `readJson(event.request)` (лимит) или `formData`, затем `toFormFailure` →
  `fail(status, data)`; форма обязана быть с `use:enhance`, если вы хотите `form.fieldErrors`
  без перезагрузки (native POST тоже работает, но `form`-проп придёт только на следующем
  визите).
- `app.d.ts`: `import type` — верхнего уровня (см. §6); `RequestHandler` в
  `+page.server.ts` из `./$types` **не** импортируют.
- Поле с `immutable` + `createValue` клиент прислать не может → `forbidden`; не пытайтесь
  «обойти» это, передавая `id` из формы.
- PGlite: `memory: !env('DATABASE_DIR')`; файловый каталог требует lock-файл — не
  подменяйте его `idb://` (`resolveDatabaseDir` на URI отказывает намеренно).
- TypeScript один на всё дерево (версия приложения) — расхождения «пакет vs приложение»
  больше нет; `.d.ts` не публикуются, `svelte-check` видит исходники.
- Релятивные импорты внутри слоя пишутся **без** `.js` (в отличие от пакета): `tsconfig.json`
  приложения включает `rewriteRelativeImportExtensions`, а `moduleResolution: bundler` не
  требует суффиксов. При возврате к отдельному пакету суффиксы надо будет вернуть.

## 10. Незакрытое (осознанные долги)

- RLS: пакет не управляет `SET LOCAL role`/`set_config`. Нужен второй эшелон —
  добавлять в `policy`/миграции приложения, не в ядро.
- pgproxy-адаптеры перенесены (`./adapters/proxy`). Не перенесено ровно одно: `409` на
  конфликте уникальности — прокси не переносит SQLSTATE (`pgproxy-server/dist/server.mjs:231`
  собирает кадр без кода). Починить можно только на сервере: добавить `code` в error-фрейм,
  после чего в адаптере ставится `sqlstate: true` и `expose.constraints` заработает.
- Отдельного пакета нет: с 09.10.2026 слой живёт в дереве приложения как обычный `lib`
  (решение пользователя). История порта (`9927dd9` + все ветки) сохранена в
  `/home/user/db-port-history.bundle`; если пакет снова понадобится, `exports`/`fix-esm`
  придётся восстанавливать оттуда.
- `drizzle`-подобный генератор ресурсов из SQL-каталога — не делался: `defineResource`
  остаётся явным, что и даёт сопоставимость с источником.
