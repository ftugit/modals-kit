# lib/cache: pg-драйвер общего хранилища (`sharedStore`)

Задача владельца (2026-10-21): довести db-драйвер lib/cache до
логичного конца — без него не стартует этап R4 фото-плана
(`docs/design/image-transfer.md`: токен-заявки в общем хранилище).
Перед стартом — уточнить архитектуру: lib/cache делался как ядро с
адаптерами (как paginate) или как lib только под этот фреймворк; если
через адаптеры — работа с БД отделяется за адаптером, и это задача
проектирования, а не «просто написать». Доступ к БД — через модели
lib/db (решение владельца); отдельный функционал, который иначе
каждый писал бы своим SQL, оформляется готовыми функциями у модели.

## Разведка (по коду)

- **lib/cache — ядро, не фреймворк-lib.** Модуль в списке
  `CORE_MODULES` стража `tooling/core-purity.mjs` наравне с
  form/paginate: ядро не импортирует ни один фреймворк, обвязки —
  только в названных зонах. Реализации контракта — соседние модули
  (`memory.ts` рядом с `types.ts`), как `adapter-*.ts` у paginate.
  Окружение библиотека не читает: какое хранилище куда, решает
  приложение в `src/lib/server/cache.ts`.
- Контракт уже спроектирован под сетевые хранилища: `Store` /
  `AtomicStore` с `MaybePromise`, значения JSON-совместимые,
  `ScopeOptions.max` сетевые хранилища вправе игнорировать
  (комментарий в `types.ts`). `sharedStore` (Postgres) запланирован
  в README lib/cache §7 и `docs/plan.md` (бронь форм, пишущих в БД),
  реализации нет — только `memoryStore`.
- Импорт ядра в ядро — принятая практика (paginate → form/address);
  lib/db — лист (ничего из lib не импортирует), цикла не будет.
  Драйверы lib/db из индекса не реэкспортируются, чтобы клиентские
  сборки не тянули pg/PGlite, — тот же приём нужен здесь.
- Модели lib/db: `defineResource` + регистрация в
  `schemaSpec.resources` (`src/lib/server/db.ts`); таблицы при
  открытии БД создаёт sync (`schema.gate`) на любом движке
  (pg/Hyperdrive/PGlite). Составные `db.unique`/`db.indexes` модель
  умеет; PK — одно поле. `ResourceApi`: get/insert/update/delete по
  PK, select по фильтрам, `insertMany({onConflictIgnore})`; upsert и
  массовых update/delete НЕТ. Сырой путь — `Database.query`
  (один оператор, параметры) и `api.raw()`; прецедент SQL по таблице
  модели — сид в `db.ts`.
- Прецедент «порт поверх модели»: `content/user/gateway.ts` —
  адаптеры портов на `db.resource(session|profile|auth)` с ctx
  `SYSTEM` (`roles: ['server','admin']`). Сессии — тот же жанр, что
  KV: токен + `expires_at`, срок сравнивается кодом.
- Транспорты: transaction-pooling и Hyperdrive — session-состояния
  нет, advisory locks не поддерживаются (`lib/db/docs/TRANSPORTS.md`);
  proxy-адаптер без транзакций. Вывод для драйвера: каждая операция —
  один оператор, без транзакций и сессионных привязок.
- Тесты БД: PGlite в памяти, один экземпляр на файл, схема
  пересоздаётся между проверками (`src/lib/db/test/db-sync.test.ts`);
  таблицы из моделей — `defineSchema({resources}).sync/gate`.

## Решение

**Отдельный вход `#lib/cache/pg.js`** — модуль `src/lib/cache/pg.ts`,
из `index.ts` НЕ реэкспортируется (клиентский импорт контракта не
тянет lib/db). Экспорты: модель `cacheKv` и фабрика `pgStore(db)`.
Всё остальное в lib/cache не меняется; контракт не расширяется.

**Модель** (`defineResource`, ключ ресурса `cache.kv.v1`):

- таблица `public.cache_kv`;
- `id` — uuid PK, `gen_random_uuid()` (модель требует один PK;
  естественный ключ пары даёт уникальность ниже);
- `scope` — text, путь области (`''` — корень, `a:b` — вложенная;
  `scope('a:b')` = `scope('a').scope('b')`, как у памяти);
- `key` — text, ключ внутри области как есть (URL и пр.);
- `value` — `f.json` (jsonb), JSON-совместимое значение контракта;
- `expires_at` — timestamptz, NULL = без срока (`Infinity`);
- `db.unique: [['scope', 'key']]`, `db.indexes: [['expires_at']]`
  (вычистка просроченного);
- политика — только `server` (как у сессий: пишет серверный слой).

Регистрацию в `schemaSpec.resources` делает приложение (`db.ts`) —
библиотека модель только описывает, таблицу создаст sync при
подключении. UNLOGGED не используем: моделью не создаётся, а для
брони потеря при краше недопустима (исследование координации).

**Операции драйвера** — каждая одним оператором через `db.query` по
таблице модели (имена таблицы/колонок берутся из дескриптора, не
дублируются строками отдельно). Это и есть «готовые функции у
модели»: будущие места берут контракт `AtomicStore`
(`storeIdempotency`, `windowThrottle`, заявки R4) и своего SQL не
пишут. Часы — базы (`clock_timestamp()`): один источник времени на
все инстансы, срок считается в SQL из ttl-параметра.

| Операция | Оператор (суть) |
|---|---|
| `get` | SELECT value WHERE scope,key AND жив (expires NULL или > now) |
| `set` | INSERT … ON CONFLICT (scope,key) DO UPDATE value, expires |
| `add` | INSERT … ON CONFLICT DO UPDATE … WHERE существующая просрочена, RETURNING: строка есть — `true` |
| `incr` | INSERT 1 … ON CONFLICT DO UPDATE: просрочено → 1 и новый срок; живо и число → +1, срок прежний; живо и не число → без записи, драйвер бросает TypeError (как память) |
| `delete` | DELETE по scope,key |
| `clear` | DELETE WHERE scope = своя ИЛИ вложенная (`starts_with(scope, своя \|\| ':')`); корень — все строки |
| `scope(name)` | тот же драйвер с выросшим префиксом; пустое имя — TypeError, `max` игнорируется (контракт разрешает сетевым) |

Просроченное вычищается лениво чтением (фильтр в SELECT) плюс
оппортунистический sweep на записях не чаще раза в минуту на инстанс
(как память): `DELETE WHERE expires_at <= now` по индексу.
Невалидный ttl (0/отрицательный/NaN) — RangeError до похода в БД,
как у памяти.

**Подключение:** `db.ts` добавляет `cacheKv` в ресурсы;
`src/lib/server/cache.ts` экспортирует `sharedStore = pgStore(db)`
рядом с `localStore` (фабрика I/O не делает, соединение ленивое).
Существующие потребители НЕ мигрируют: у каждого своё решение по
README §6/§7; первый потребитель — заявки R4. На dev-движке PGlite
`sharedStore` честно равен памяти процесса по охвату (БД одна на
процесс) — семантика та же, охват даёт настоящий Postgres.

**Тесты:** `src/lib/cache/pg.test.ts` — PGlite один на файл,
`defineSchema({resources:[cacheKv]}).gate` → `createDb` → `pgStore`.
Контрактный набор зеркалит `memory.test.ts`: срок и граница ttl,
Infinity, невалидные ttl, `add` один раз и после срока, `incr`
фиксированное окно и TypeError на не-числе, области не пересекаются,
`clear` чистит свою и вложенные, параллельные `add` — ровно один
`true`, `requireAtomic` пропускает. Отдельно: таблица и
уникальность созданы sync-ом из модели (проверка каталога).

**Документация:** README lib/cache — новый раздел про `pgStore`,
таблица подключений и §6 (sharedStore сделан); комментарий в
`server/cache.ts`; `docs/plan.md` — пункт про sharedStore;
`image-transfer.md` — предпосылка R4 закрыта.

## Чеклист

- [x] Разведка архитектуры и этот проект (checkpoint).
- [x] `src/lib/cache/pg.ts`: модель `cacheKv` + `pgStore` (AtomicStore целиком) — `db01cfb`.
- [x] `src/lib/cache/pg.test.ts`: контрактный набор на PGlite — зелёный (13 тестов).
- [x] Подключение: `db.ts` (ресурс), `server/cache.ts` (`sharedStore`) — `db01cfb`.
- [x] Гейты: check 0, unit полный, guard 120/0 (цифры — в отчёте владельцу).
- [x] Документация: README lib/cache (§3 pgStore), server/cache.ts, docs/plan.md, image-transfer.md.
- [x] Локальный коммит(ы), отчёт владельцу с блоком доказательств.

Не входит: миграция существующих потребителей localStore; бронь в
транзакции операции у DB-форм (отдельный контракт lib/form ↔ lib/db);
потолок `max` у pg-областей (контракт разрешает игнорировать);
UNLOGGED-вариант таблицы.
