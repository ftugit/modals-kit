# Общий слой состояния (кэш-слой): исследование

Статус: **исследование, ничего не реализовано.** Ход 86. Решения за владельцем, вопросы в §8.

## 1. Зачем это вообще

Сейчас всё серверное состояние живёт в памяти процесса (`Map`, `let` модуля). На одном
процессе (`npm run dev`, adapter-node) это работает. На Vercel и Cloudflare процессов
несколько: Vercel поднимает новые инстансы функции при нагрузке и в разных регионах,
у Workers свой изолят в каждой точке присутствия. Тогда у каждого инстанса своя копия
состояния, и это бьёт по трём вещам:

| Что ломается | Пример в коде | Последствие |
|---|---|---|
| **Пределы** | `windowThrottle` (30 отправок в минуту с адреса), зазоры к Shikimori | При N инстансах фактический предел в N раз выше. Shikimori: лимит «5rps и 90rpm» на весь сайт, а не на инстанс |
| **Идемпотентность** | `MemoryIdempotencyStore` | Повтор отправки, попавший на другой инстанс, выполнится второй раз. В комментарии к интерфейсу прямо сказано, что бронь должна быть атомарной (`SET NX` / `INSERT … ON CONFLICT`) |
| **Кэши внешних API** | схема фильтров (30 мин), словарь (1 ч), страницы (60 с) | Каждый холодный инстанс заново ходит во внешний API. Сборка схемы стоит несколько запросов к Shikimori. Это не ошибка, но лишняя нагрузка и задержка |

Второй довод, независимый от платформ: логика «Map + TTL + потолок + вычистка» сейчас
написана **семь раз** (`shikimori.ts` дважды, `graphql.ts`, `rickmorty.ts`, `live-cache.ts`,
`MemoryIdempotencyStore`, `windowThrottle`), и в одной из копий нет потолка (находка F59
ниже). Один memory-адаптер убирает дубли, даже если внешнее хранилище никогда не
подключат.

## 2. Инвентарь: всё состояние процесса в `src`

Источник: два grep по `src` (модульные `const/let = new Map|Set|WeakMap|null|0`, плюс
`class Memory*`, `windowThrottle`, `new Map(` в серверном и демо-коде). Затем каждое место
прочитано.

### 2.1. Серверное и разделяемое между запросами: кандидаты на слой

| # | Место | Что хранит | TTL / потолок | Если инстансов N |
|---|---|---|---|---|
| S1 | `server/shikimori.ts` l.309 `cache` | страницы каталога | 60 с / 256 | N копий, больше обращений к API |
| S2 | `server/shikimori.ts` l.434 `jsonCache` | справочники REST (жанры, студии…) | 60 с / 256 | то же |
| S3 | `server/shikimori.ts` l.508 `termsCache` | словарь fuzzy (несколько страниц API) | 1 ч / 1 | дорогая пересборка на каждом инстансе |
| S4 | `server/shikimori-schema.ts` l.289 `cached` | схема фильтров | 30 мин / 1 | то же, плюс разный `builtAt` у разных инстансов |
| S5 | `server/graphql.ts` l.82 `cache` | ответы GraphQL (Shikimori + R&M) | 60 с / **нет потолка** | см. F59 |
| S6 | `server/rickmorty.ts` l.106 `restCache` | ответы R&M REST | 60 с / 200 | N копий |
| S7 | `server/shikimori.ts` l.311 `lastStartedAt`, `graphql.ts` l.84 | зазор 250 мс между запросами | — | **предел ×N** (уже сейчас ×2: две очереди на один хост, ход 84) |
| S8 | `form/server.ts` l.229 `MemoryIdempotencyStore`, создан в `demo/form/handle.ts` l.17 | брони и результаты отправок | 24 ч, бронь 5 мин | **двойное выполнение** |
| S9 | `form/server.ts` l.300 `windowThrottle`, создан в `demo/form/handle.ts` l.21 | окна попаданий по адресу | 60 с | **предел ×N** |
| S10 | `server/live-cache.ts` l.26 `entries`/`generation` | ETag последнего ответа `/api/db-posts` | 1,5 с / 64 | запись на A не сбрасывает память B; B может отдать устаревший 304 до 1,5 с |

### 2.2. Должно остаться в процессе (общий слой не нужен или невозможен)

| Место | Почему остаётся |
|---|---|
| `inflight`/`jsonInflight` (`shikimori.ts`), `inflight` (`graphql.ts`), `restInflight` (`rickmorty.ts`), `building` (`shikimori-schema.ts`) | Это `Promise`, их нельзя положить в хранилище. Они склеивают одновременные запросы внутри инстанса. Между инстансами то же даёт блокировка (`SET NX`), см. §5.3. Это опция, не обязательная часть |
| `form-security.ts` l.22 `origins` | Мемо конфигурации, у всех инстансов одинаковое |
| `db/resource.ts` `managed` (WeakMap), `form/server.ts` l.141 `pendingSource` (WeakMap) | Метаданные объектов внутри процесса, ключи — объекты |
| `db/sync` `prepared`, флаг `pending` в `gate` | `pending` перепроверяет БД на каждом запросе (`upToDate`), значит источник правды уже общий. Advisory lock живёт в Postgres |
| `paginator/definition.ts` l.411 `liveTransport`, l.429 `rickMortyTransport`, `db-list/definition.ts` l.98 `serverTransport` | Подключение транспорта при импорте, у всех инстансов одинаковое |
| `server/db.ts` `db` (`lazyDriver`) | Соединение по определению принадлежит процессу |
| Константные `Set` (списки допустимых значений) | Неизменяемые |

### 2.3. Только браузер (к слою отношения не имеют)

`paginate/store.ts` `clientStore`, `paginate/registry.ts`, `paginate/core.ts` (сеансы, WeakMap),
`storage-default.ts` (на сервере уже no-op, C11), `search/stats.ts`, `search/registry.ts`,
`modals/store.ts` `client`, `filters/schema-memory.ts` (решение хода 73: схема в RAM
вкладки), `paginator/definition.ts` l.220 `filterSchemaInflight`, `router/sveltekit.ts` `writer`.

### 2.4. Демо-данные

`demo/form/handle.ts` l.26 `created: string[]` (счётчик созданных) и `src/content/items.ts` l.88
`demoFault`. При N инстансах счётчик «прыгает» между ответами. Для демо это допустимо.
Если нужна честность, переводить на слой (`incr`), а не чинить отдельно.

### 2.5. Попутные находки (ничего не исправлено)

- **F59 (средняя).** `graphql.ts` l.82: у `cache` нет потолка и вычистки. Просроченные записи
  только перезаписываются тем же ключом. Ключ — `JSON.stringify([url, doc, variables, …])`,
  а `variables` у R&M строятся из фильтра пользователя (`rickmorty.ts` l.179 `filter: params`).
  Каждый уникальный запрос оставляет запись навсегда, память процесса растёт без предела.
  Это рост памяти, управляемый извне. У соседей (`shikimori.ts`, `rickmorty.ts`) потолок есть.
- **Комментарий `live-cache.ts`** («потеря равна одному лишнему 200») неточен для
  нескольких инстансов. Возможен и устаревший 304 на срок до TTL (1,5 с, один тик опроса).
  Вред мал, но комментарий обещает больше, чем есть.
- **PGlite в памяти** (`server/db.ts`, без `DATABASE_URL`) — это тоже состояние процесса: на
  Vercel у каждого инстанса была бы своя БД. Это не кэш, и решение уже есть: в проде нужен
  `DATABASE_URL`. Упоминаю для полноты.

## 3. Что предлагают платформы

### 3.1. Vercel

| Продукт | Что это | Атомарные операции | Годится для |
|---|---|---|---|
| **Redis из Marketplace** (Upstash и др.) | Vercel KV закрыт: «Vercel KV is no longer available… automatically moved to Upstash Redis in December 2024. For new projects, install a Redis integration from the Marketplace» ([1](https://vercel.com/docs/redis)). Интеграция сама кладёт переменные окружения: `KV_REST_API_URL`/`KV_REST_API_TOKEN` или `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, в зависимости от даты подключения ([2](https://layerbase.com/blog/vercel-kv-sunset-migration)) | да: `SET NX PX`, `INCR`, `EXPIRE`, Lua | всё: S1–S10 |
| **Runtime Cache** (`getCache()` из `@vercel/functions`) | «regional, ephemeral cache… across Vercel Functions, Routing middleware, and build» ([3](https://vercel.com/docs/caching/runtime-cache)). Методы `get`/`set(ttl, tags)`/`delete`/`expireTag`, запись до 2 МБ, отдельный кэш для preview и production ([4](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)). Записи могут вытесняться раньше TTL. Сама документация пишет, что он не подходит для «data that must be retained for its full TTL» ([3](https://vercel.com/docs/caching/runtime-cache)) | **нет** (нет `incr`, нет «записать, если пусто») | только кэши S1–S6. Без отдельного сервиса, оплата за чтения и записи по региону |
| Edge Config | хранилище конфигурации, читается часто, пишется редко | нет | не наш случай |

Кэш на Vercel региональный: в двух регионах две копии. Для кэша внешних API это
нормально, для пределов и идемпотентности — нет.

### 3.2. Cloudflare

| Продукт | Что это | Атомарность и согласованность | Годится для |
|---|---|---|---|
| **Workers KV** | глобальное KV, TTL не меньше 60 с. «Writes… can take up to 60 seconds… to be visible in other parts of the world». Не больше одной записи в секунду в один ключ, иначе 429 ([5](https://developers.cloudflare.com/kv/api/write-key-value-pairs/)) | eventual consistency, конкурентные записи затирают друг друга | кэши S3, S4 (долгий TTL, редкие записи). S1/S2/S6 с TTL 60 с проходят по нижней границе. **Не годится** для S7–S9 |
| **Durable Objects** | один экземпляр объекта на ID во всём мире, «transactional and strongly consistent storage» ([6](https://developers.cloudflare.com/workers/platform/storage-options/)). На бесплатном плане доступны с хранилищем SQLite ([7](https://developers.cloudflare.com/durable-objects/llms-full.txt)) | строгая: один писатель на объект | S7 (очередь к хосту — объект на хост), S8, S9. Оговорка: DO-класс экспортируется из воркера, а воркер генерирует adapter-cloudflare. Обычно DO выносят в отдельный Worker и привязывают через `script_name`. **Не проверено в этом ходе**, проверить до выбора |
| **Rate Limiting binding** | `env.X.limit({ key })` → `{ success }`, период только 10 или 60 с. Счётчики «local to the Cloudflare location» ([8](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)) | по точке присутствия, приблизительная | S9 (входящий предел формы) как «грубый щит». **Не годится** для S7: он умеет только отказывать, а нам нужно ждать очереди, и лимит Shikimori глобальный |
| Cache API (`caches.default`) | HTTP-кэш в одном дата-центре | нет | кэш ответов, слабее KV |
| D1 / Hyperdrive→Postgres | SQL | транзакции | см. §3.4 |

Привязки Cloudflare приходят через `platform.env` запроса, а не через переменные процесса.
`init` в `hooks.server.ts` их не видит. Отсюда требование к слою: адаптер выбирается
лениво, при первом обращении с доступом к `event.platform`.

### 3.3. Работает везде: Upstash по HTTP

Upstash — Redis с REST-доступом: обычный `fetch`, без TCP-соединений. Поэтому один и тот же
адаптер работает в Node, на Vercel и в Workers. Бесплатный план: 500K команд в месяц,
256 МБ ([9](https://agentdeals.dev/vendor/upstash), сверено с upstash.com/pricing 2026-10-04).
Сверх него $0.2 за 100K команд ([10](https://layerbase.com/blog/upstash-alternative)). REST — это
«команда в URL/теле», поэтому адаптер можно написать на `fetch` без SDK: нужно около пяти
команд (`GET`, `SET … PX … NX`, `DEL`, `INCR`+`PEXPIRE` или один `EVAL`).

### 3.4. Уже есть у нас: Postgres

`DATABASE_URL` в проде обязателен (решение хода 50), то есть общее строгое хранилище
**уже есть**. Атомарность: `INSERT … ON CONFLICT DO NOTHING` для брони,
`UPDATE … SET n = n + 1 RETURNING n` для счётчика. Минусы: запрос к БД на каждую проверку,
просрочку нужно вычищать самим (`DELETE WHERE exp < now()` попутно), кэш больших
JSON в БД — сомнительная экономия. Плюс: ни одного нового сервиса и переменной. Для S8/S9
это, по-моему, лучший первый шаг. Для S7 (до 5 обращений в секунду к счётчику) и кэшей
лучше Redis.

## 4. Классы задач: одно хранилище не покрывает всё

Из §3 следует главное: у мест **два разных требования**.

| Класс | Места | Нужно от хранилища | Подходит |
|---|---|---|---|
| **A. Кэш** (потеря допустима, вытеснение допустимо) | S1–S6, S10 | `get`, `set(ttl)`, `delete` | memory, Runtime Cache, CF KV, Cache API, Redis |
| **B. Координация** (потеря = ошибка) | S7, S8, S9, счётчик демо | атомарные `add(ttl)` («записать, если пусто») и `incr(ttl)` | memory (один процесс), Redis/Upstash, Durable Objects, Postgres |

Поэтому предлагаю **два интерфейса**, а не один. Иначе адаптер Runtime Cache
пришлось бы «эмулировать» `incr` через `get`+`set`, что создаёт гонку, и S8 тихо снова стал бы
двойным выполнением.

## 5. Предлагаемый слой (эскиз для обсуждения)

### 5.1. Интерфейсы

```ts
// #lib/cache/types.ts
export interface CacheStore {               // класс A
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
}

export interface CoordStore {               // класс B
  /** Атомарно: записать, только если ключа нет. true — записали. */
  add<T>(key: string, value: T, ttlMs: number): Promise<boolean>
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  /** Атомарно +1; TTL ставится при создании ключа. Возвращает новое значение. */
  incr(key: string, ttlMs: number): Promise<number>
}
```

Фиксированное окно на `incr` (ключ `rl:<id>:<номер окна>`) проще скользящего и
поддерживается всеми строгими хранилищами. Сейчас `windowThrottle` скользящий, это
нужно согласовать (§8, вопрос 4).

### 5.2. Адаптеры

| Адаптер | Cache | Coord | Зависимости |
|---|---|---|---|
| `memoryStore({ max })` | ✓ | ✓ (на один процесс) | нет; заменяет 7 копий логики |
| `upstashStore({ url, token })` | ✓ | ✓ | нет, `fetch` |
| `vercelRuntimeCache()` | ✓ | — | `@vercel/functions` |
| `cloudflareKv(binding)` | ✓ | — | нет, привязка |
| `postgresCoord(db)` | — | ✓ | наш `lib/db` |
| `durableObjectCoord(ns)` | — | ✓ | отдельный Worker, см. оговорку §3.2 |

Список — потолок возможного. Минимальный набор предлагаю в §7.

### 5.3. Обвязки поверх интерфейсов (переносят текущую логику)

- `cached(store, key, ttl, load)` — кэш плюс single-flight внутри процесса (тот самый
  `inflight`). Опция `lock: coord`: перед загрузкой `add('lock:'+key, 1, 10 s)`, чтобы
  холодные инстансы не грузили одно и то же одновременно. Защита от «stampede» не
  обязательна.
- `hostLimiter(coord, { rps, rpm })` — для fetch-хука хода 85: перед запросом
  `incr('rl:<host>:s:<сек>')` и `incr('rl:<host>:m:<мин>')`. При превышении спать до
  следующего окна и повторить. Даёт **глобальные** 5rps/90rpm, а не на инстанс.
- `IdempotencyStore` поверх `CoordStore`: `reserve` = `add`, `put` = `set`, `release` = `delete`
  с проверкой. Интерфейс `lib/form` не меняется. `MemoryIdempotencyStore` становится
  `coordIdempotency(memoryStore())`.
- `windowThrottle({ store })` — тот же API плюс необязательное хранилище.

### 5.4. Выбор адаптера по окружению

`lib/cache` (как и `lib/db`) окружение **не читает**: библиотека — фабрика. Выбор делается
в одном месте приложения, `src/lib/server/cache.ts`, по образцу `server/db.ts`:

| Окружение | Cache | Coord |
|---|---|---|
| задан `UPSTASH_REDIS_REST_URL`+`TOKEN` (или `KV_REST_API_*`) | upstash | upstash |
| Vercel без Redis (`VERCEL=1`) | Runtime Cache | memory + предупреждение в лог (или Postgres, §8, вопрос 2) |
| Cloudflare: привязка KV в `platform.env` | KV | memory + предупреждение (или DO/Postgres) |
| иначе (dev, adapter-node) | memory | memory |

Переменные добавляются в `src/env.ts` (перечень и проверки), как остальные.

## 6. Риски и цена

- **Задержка.** Каждое обращение к Upstash — HTTP-запрос (единицы–десятки мс). Для кэша
  внешних API это всё равно быстрее самого API. Для `hostLimiter` это два `incr` на каждый
  запрос к Shikimori (можно одним `EVAL`).
- **Сериализация.** Внешние хранилища держат JSON. Сейчас в кэше лежат объекты. Нужно
  убедиться, что там нет `Date`/`Map` (схема и страницы — обычный JSON, проверить при
  переносе).
- **Отказ хранилища.** Кэш при отказе → идём в источник (fail-open). Координация при
  отказе → выбор политики: S8 лучше отказать (503), чем выполнить дважды; S7 лучше
  деградировать до локального предела.
- **Бюджет клиента не меняется:** всё серверное.
- **Тесты:** memory-адаптер с часами `now` (как сейчас). Upstash — контрактный тест
  против фейкового REST-сервера. Общий набор тестов прогоняется на каждом адаптере.

## 7. Рекомендация

1. **Сейчас, без внешних сервисов:** `#lib/cache` с интерфейсами и `memoryStore`. Перевести
   на него S1–S10 и `MemoryIdempotencyStore`/`windowThrottle`. Поведение не меняется,
   дубли уходят, F59 закрывается сам (потолок в адаптере).
2. **Вместе с fetch-хуком (ход 85):** `hostLimiter` поверх `CoordStore`. На memory это
   «одна очередь на хост в процессе», что уже лечит ×2 из хода 84.
3. **Когда выбрана платформа:** `upstashStore` (один адаптер на обе платформы, без SDK).
   Остальные адаптеры — только по реальной нужде (правило хода 75: API под сценарий).

## 8. Вопросы владельцу

1. **Платформа деплоя:** Vercel, Cloudflare или обе? От этого зависит пункт 3 рекомендации.
   Вопрос из §10 так и не закрыт.
2. **Postgres как Coord-хранилище** (идемпотентность и пределы без нового сервиса), или
   сразу Upstash?
3. **Подключать ли `live-cache` (S10) к слою?** Я против. Его смысл — ответить 304 без
   ввода-вывода, а поход в Redis съедает выигрыш. Предлагаю оставить в памяти и
   исправить комментарий.
4. **`windowThrottle`:** перейти на фиксированное окно (так проще во всех хранилищах; на
   границе окна можно получить до 2× лимита) или сохранить скользящее (Lua в Redis,
   больше кода)?
5. **F59:** исправить отдельно сразу или вместе с переводом на memory-адаптер?
6. **Счётчик демо `created`:** переводить на слой или оставить как есть?

## Источники

1. Vercel, «Redis on Vercel» — https://vercel.com/docs/redis
2. «Vercel KV sunset» (переменные окружения интеграции) — https://layerbase.com/blog/vercel-kv-sunset-migration
3. Vercel, «Runtime Cache» — https://vercel.com/docs/caching/runtime-cache
4. Vercel, `@vercel/functions` `getCache` — https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
5. Cloudflare, KV «Write key-value pairs» — https://developers.cloudflare.com/kv/api/write-key-value-pairs/
6. Cloudflare, «Choose a data or storage product» — https://developers.cloudflare.com/workers/platform/storage-options/
7. Cloudflare, Durable Objects (лимиты, планы) — https://developers.cloudflare.com/durable-objects/llms-full.txt
8. Cloudflare, Rate Limiting binding — https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
9. Upstash free tier, сверка 2026-10-04 — https://agentdeals.dev/vendor/upstash
10. Upstash pricing, сверка 2026-09-06 — https://layerbase.com/blog/upstash-alternative
