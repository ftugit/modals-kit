# `#lib/db/index.js` — серверный слой данных

Обычный `lib` этого приложения, такой же, как `#lib/form/index.js` или `#lib/modals/index.js`: TS-исходники
в `src/lib/db`, импорт через `#lib/db/index.js`, тесты рядом (`src/lib/db/test/*.test.ts`), проверки
границ — в `tooling/`. Отдельного пакета, `dist`-сборки и tarball-установки больше нет.

Слой **перенесён** из `server/lib/db` репозитория SolidHono (эталон: `f8079b1`) и
адаптирован под SvelteKit (эталон приложения: `modals-kit@f82734f`, сверено с `5d08da7`
на `b1`). Карта переноса, снятые проверки и правила ре-синхронизации — [`PORTING.md`](./PORTING.md).

Ядро (`#lib/db/index.js`) про HTTP не знает вообще: это компилятор SQL + политики +
валидация + транзакции. SvelteKit-слой (`#lib/db/sveltekit/index.js`) добавляет ровно то,
чего ядру не хватало: `event.locals`, разбор query из `load`, ошибки в формате
`error()`/`fail()`, курсорный секрет из env, прогон миграций.

```
Драйверы          pg (пул) · PGlite (dev/тесты) · Hyperdrive (Workers, клиент на запрос)
Ресурс            defineResource: поля × Grant (read/create/update) × policy × relations
Валидация         Standard Schema (~standard): своя zero-dep схема ИЛИ zod — на выбор
Безопасность      идентификаторы через ident(), значения через параметры, deny-safe query
Пейджинация       offset (page/limit) и keyset-курсор (HMAC + kid + TTL + scope)
Транзакции        savepoint'ы, откат по сигналу, afterCommit-очередь, «отравленный» parent
Схема            defineSchema: таблицы из ресурсов, безопасное — само, конфликт → schema_pending
Миграции          splitSqlStatements + applyMigrationText (один BEGIN/COMMIT)
```

Содержание:
· [Установка](#установка)
· [Composition root](#1-composition-root)
· [Доверенный контекст: `hooks.server.ts`](#2-доверенный-контекст-hooksserverts)
· [Чтение в `load`](#3-чтение-в-load)
· [Запись в actions](#4-запись-в-actions)
· [Драйверы](#5-драйверы)
· [Схема и миграции](#6-схема-и-миграции)
· [Публичный API](#7-публичный-api)
· [Свой код в TypeScript](#8-свой-код-в-typescript)
· [Разработка слоя](#9-разработка-слоя) · перенос и расхождения — [PORTING.md](./PORTING.md) · транспорты/serverless — [docs/TRANSPORTS.md](./docs/TRANSPORTS.md) · что не сделано — [docs/plan.md](../../../docs/plan.md) (общий план проекта)

## Установка

Никакой: слой лежит в этом же дереве, `import { createDb } from '#lib/db/index.js'` работает сразу.
Зависимости, которые слой реально тянет, уже в `package.json` приложения:

| Зависимость | Зачем | Где |
|---|---|---|
| `@standard-schema/spec` | только типы (`StandardSchemaV1`) | `src/lib/db/types.ts`, `src/lib/db/schema.ts` |
| `pg` | пул PostgreSQL в Node | `src/lib/db/adapters/pg.ts` |
| `@electric-sql/pglite` | dev/тесты без Docker и прав | `src/lib/db/adapters/pglite.ts` |
| `zod` (devDep) | опциональный совместимый вход | `src/lib/db/zod.ts` |

`pg` и `PGlite` намеренно **не** реэкспортируются из барреля: клиентская/edge сборка не
должна их тянуть. Импорт движков — только из под-путей `#lib/db/adapters/*` и
`#lib/db/sveltekit/node.js`.

`@sveltejs/kit` слой в рантайме не импортирует (нужен только типам), поэтому
`#lib/db/sveltekit/index.js` работает и в Cloudflare Workers.

## 1. Composition root

Единственный владелец соединения и ресурсов — серверный модуль (`#lib/server`), как в
официальном SvelteKit FAQ «How do I set up a database?»: синглтон процесса, а не на
запрос. Лень важна: `vite dev` и `vite build` спорят из-за file-lock каталога PGlite.

```ts
// src/lib/server/db.ts
import { createDb, conservativeLimits, defineResource, f, field, policy, s, type Driver } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { lazyDriver } from '#lib/db/adapters/lazy.js'
import { openNodeDatabase, openPgPool } from '#lib/db/sveltekit/node.js'
import { DATABASE_DIR, DATABASE_URL, DB_CURSOR_KID, DB_CURSOR_OLD_KEYS, DB_CURSOR_SECRET, DB_POOL_MAX, VERCEL } from '$app/env/private'
import { cursorCodecFromEnv } from '#lib/db/sveltekit/index.js'
import { defineSchema } from '#lib/db/sync/index.js'

export const posts = defineResource({
  key: 'demo.post.v1',                    // участвует в scope курсора: переименование = сброс курсоров
  table: 'public.demo_post',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true,
                 orderable: true, filters: ['eq', 'in'], db: { default: 'gen_random_uuid()' } }),
    title: field(s.text({ min: 3, max: 120 }), {
      read: () => true, create: () => true, update: () => true, required: true,
      normalize: (v) => (typeof v === 'string' ? v.trim() : v),
      filters: ['eq', 'contains', 'startsWith'], orderable: true,
    }),
    created_at: f.timestamp({ read: () => true, generated: true, db: { default: 'clock_timestamp()' },
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

// Таблицы — из ресурсов (§6): в проде достаточно DATABASE_URL.
export const schema = defineSchema({ resources: [posts] })

// Соединение откроется при первом запросе к БД, а не здесь: страницы без БД её не поднимают.
// Движок выбирает окружение, остальной код от него не зависит.
export const db = createDb({
  driver: lazyDriver(openDriver),
  limits: conservativeLimits,
  cursorCodec: cursorCodecFromEnv((key) => ({ DB_CURSOR_SECRET, DB_CURSOR_KID, DB_CURSOR_OLD_KEYS })[key], {
    ttlSeconds: 60 * 60 * 24 * 30,
  }),   // без DB_CURSOR_SECRET → undefined (только page)
})

async function openDriver(): Promise<Driver> {
  const driver = DATABASE_URL
    ? openPgPool({ connectionString: DATABASE_URL,
                   max: DB_POOL_MAX ?? (VERCEL ? 1 : 4) }).driver
    : pgliteAdapter((await openNodeDatabase(process.cwd(), DATABASE_DIR ?? 'data/postgres',
                                            { memory: !DATABASE_DIR })).db)
  return schema.gate(driver) // недостающее создаётся само; конфликт → запросы отвечают schema_pending
}
```

`lazyDriver` открывает драйвер один раз; параллельные первые запросы ждут одно открытие,
неудачное открытие не запоминается (следующий запрос пробует снова).

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
import { dbHandle } from '#lib/db/sveltekit/index.js'
import type { Handle } from '@sveltejs/kit/hooks'
import { db, DEMO_PRINCIPAL } from '#lib/server/db.js'

// Пользователь — на каждом запросе; БД при этом не поднимается (её откроет первый запрос
// к ней, см. `lazyDriver`). С авторизацией principal берут из сессии.
export const handle: Handle = dbHandle({ db, principal: () => DEMO_PRINCIPAL })
```

`paths` (необязательно) ограничивает, где резолвится principal: вне них `locals.dbCtx` —
гость. Префикс сравнивается по границе сегмента: `'/api'` покрывает `/api` и `/api/…`, но
не `/apiary`.

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
import type { KitErrorBody, LocalsDb } from '#lib/db/sveltekit/index.js'

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
  const api = event.locals.db.resource(posts)
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
`{ rows, exact, method }` — `pg_class.reltuples`, когда пользователю видна вся таблица (нет
фильтра, политика `select` без условий, удалённые строки не скрыты; дешевле на порядки), иначе
план `EXPLAIN (FORMAT JSON)` с тем же предикатом, что у `select` (политика, soft-delete,
фильтр), точный `count(*)` как откат. Проверки — как у `count`: право чтения, ключи ввода,
`includeDeleted` только с `readDeleted`. `exact: false` обязан
отражаться в UI («~12 000»), цифры с `estimate` нельзя показывать как подтверждённые.

Составная коллекция (например «аниме за юзером» = VIEW над 4 таблицами с `jsonb_agg`
тегов) работает так же, как табличная: та же политика, `count`, сортировка и пагинация.
Кейс разобран и проверен на реальном PostgreSQL 17 — `src/lib/db/probes/shikimori-view.probe.mjs`,
выводы — `docs/ACL-DESIGN.md` §13.

Курсорная страница: `api.cursor(ctx, input)` → `{ items, nextCursor, prevCursor, atEdge }`.
Закладки подписанные (`DB_CURSOR_SECRET`), версия+`kid`+TTL+scope из `principal` и
`resource.key`, поэтому курсор не переносим между пользователями и не переживает смену
политики. Без секрета `cursorCodecFromEnv` возвращает `undefined`, а `api.cursor` —
`unsupported` (501): пагинатор обязан остаться на `page`.

- `items` — всегда в порядке ресурса, как бы ни читали.
- `nextCursor` — закладка ПОСЛЕДНЕЙ строки: с нею читают дальше (`after`); `null` — дальше нет.
- `prevCursor` — закладка ПЕРВОЙ строки (сторона «новее»): с нею читают назад (`before`).
- `atEdge` — «новее этой порции ничего нет»: лента дошла до края свежих данных. Проверяется
  тем же условием в обратном направлении и `LIMIT 1` (на первой странице без закладки — `true`).

```ts
let after: string | null = null // null — первая страница
do {
  const page = await api.cursor(ctx, { limit: 50, after })
  handle(page.items)
  after = page.nextCursor
} while (after)
```
Назад (подгрузка новых к верху ленты) — `api.cursor(ctx, { limit: 50, before: page.prevCursor })`:
вернутся строки НОВЕЕ закладки, снова в порядке ресурса. Закладка хранит значения
`(порядок)`, а не ссылку на строку: удаление строки-закладки обратное чтение не ломает.
`after` и `before` вместе — ошибка `validation`.

## 4. Запись в actions

Валидация схемы — часть `insert`/`update`/`delete`, отдельного `safeParse` в маршруте не
нужно. Ошибку превращает в поля `toFormFailure`.

```ts
export const actions: Actions = {
  create: async (event) => {
    try {
      const input = await readJson(event.request)                  // или formData → объект
      const row = await event.locals.db.resource(posts).insert(event.locals.dbCtx, { title: input.title })
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

- `title: "ab"` → `fieldErrors.title = ["Too small: expected string to have >=3 characters"]`
  (код `minLength`, `{ min: 3 }` — в `details.errors`, см. ниже),
  `aria-invalid`, строка **не** вставлена;
- клиент не может прислать `id`: у поля `immutable` + `createValue` → `forbidden` (403);
- `delete` строки, скрытой политикой → `not_found` (404), а не 403: факт существования
  не протекает;
- `toFormFailure`/`toKitError` никогда не отдают `cause`, текст SQL и параметры — в dev
  добавляется только `diagnostic` (`sqlstate`, `condition`, `field`);
- отказ прав на стороне БД (`RLS`, `GRANT`, `RAISE EXCEPTION … ERRCODE 42501/42502` из
  триггера) идёт в `forbidden` → **403**, а не в 500: «нельзя» и «сервер упал» различимы.

### Ошибки по полям и свои тексты

Коротко: `lib/db` сообщает, **какое поле** не так и **почему** (код + параметры), сразу по всем
полям. Текст можно задать в модели, а форма `lib/form` покажет ошибку под нужным полем, без
импорта библиотек друг в друга.

#### Что лежит в ошибке

Отказ (`DbFailure`) несёт `details.errors` — список ошибок:

```ts
interface FieldError {
  field?: string                    // поле ресурса; нет — ошибка про запись целиком
  code: string                      // 'minLength', 'unique', … (таблица ниже)
  params?: Record<string, unknown>  // { min: 3 }, { max: 120 }, { fields: ['a', 'b'] }
  message: string                   // готовый текст (свой текст с подстановками или текст схемы)
  template?: string                 // свой текст до подстановок — только если он задан
}
```

- **Все поля сразу.** `insert`/`update` проверяют каждое присланное поле и бросают одну ошибку
  `validation` со всеми проблемами. Раньше отказ был на первом плохом поле.
- **Права проверяются раньше значений.** Если в запросе есть поле, которое этому `ctx` писать
  нельзя, ответ — `forbidden` (403), сколько бы плохих значений там ни было.
- Старые поля `details.field` и `details.issues` остались (первое поле и его тексты) — на них
  стоит старый код.

#### Коды

| Код | Когда | `params` | Текст в форме по умолчанию (`lib/form`, словарь `ru`) |
|---|---|---|---|
| `required` | поле не пришло, `null` у не-`nullable`, NOT NULL в БД | — | Обязательное поле |
| `minLength` / `maxLength` | `s.text({ min, max })`, `z.string().min/max` | `{ min }` / `{ max }` | Минимум N символов / Не больше N символов |
| `minValue` / `maxValue` | `s.integer({ min, max })`, `z.number().min/max` | `{ min }` / `{ max }` | Не меньше N / Не больше N |
| `integer` | не целое (`s.integer`, `z.number().int()`) | — | Введите целое число |
| `step` | `z.number().multipleOf(n)` | `{ step }` | Шаг N |
| `oneOf` | `s.enumOf`, `z.enum` | — | Выберите значение из списка |
| `pattern` | `s.text({ pattern })`, `z.string().regex` | — | Значение не соответствует формату |
| `email` / `url` | `z.email()` / `z.url()` | — | Введите корректный адрес почты / ссылку |
| `minCount` / `maxCount` | `s.array(…, { min, max })`, `z.array().min/max` | `{ min }` / `{ max }` | Выберите хотя бы N / Не больше N вариантов |
| `type.date` / `type.datetime` | `s.date()` / `s.timestamp()` | — | Введите дату / Введите дату и время |
| `unique` | уникальный индекс из модели (`db: { unique: true }`, `db.unique`) | составной: `{ fields }` | Это значение уже занято |
| `check` | CHECK из модели сработал в обход кода | — | *нет — текст схемы (англ.)* |
| `invalid` | схема не дала кода (uuid, bigint, json; строгие `gt`/`lt` zod; valibot…) | — | *нет — текст схемы (англ.)* |
| `custom` | `s.custom`, `z.refine(…, 'текст')` | — | свой текст схемы |

Коды совпадают с кодами правил `lib/form`, поэтому словари формы подходят без доработок.
Коды zod (4 и 3) переводятся по виду ошибки, zod при этом не импортируется. Строгие границы
(`gt`/`lt`) нарочно не переводятся: «не меньше 3» для `> 3` было бы неправдой.

#### Ошибки самой БД (ограничения из модели)

Ограничения, которые `defineSchema` построила из модели, тоже становятся ошибками поля:

| PostgreSQL | Вид отказа | Ошибка |
|---|---|---|
| уникальный индекс (`23505`) | `conflict`, 409 | `{ field, code: 'unique' }` |
| составной уникальный индекс | `conflict`, 409 | `{ code: 'unique', params: { fields } }` — без поля, общая |
| CHECK (`23514`) | `validation`, 422 | `{ field, code: 'check' }` |
| NOT NULL (`23502`) | `validation`, 422 | `{ field, code: 'required' }` |

Поле указывается, **только если этот `ctx` сам пишет это поле** (оно есть в запросе и есть
право `create`/`update`): значение прислал он, и узнать «занято» ему можно. Если значение
подставил сервер (`createValue`) или поле не пишется этим пользователем — ошибка общая, как
раньше. Ограничения, созданные вручную SQL-ом, к полю не привязываются (имя неизвестно), для
них остаётся `constraints` ресурса (`publicFields`). `insertMany` привязывает так же, но какая
именно строка пачки виновата, не сообщает: PostgreSQL пишет это только текстом, а текст
драйвера мы не разбираем.

Уникальный индекс — единственная защита от гонки двух одновременных запросов. Проверка
«такого email нет» запросом заранее её не заменяет.

#### Свои тексты

Как у правил формы (`v.minLength(3).message('…')`): текст по коду, подстановки — из `params`.

```ts
email: field(s.text({ max: 254 }), {
  read: () => true, create: () => true, required: true,
  db: { unique: true },
  messages: {
    unique: 'Этот email уже зарегистрирован',
    maxLength: 'Не длиннее {max} символов',
    required: 'Укажите email',
  },
}),
```

Откуда берётся текст, от сильного к слабому:

1. свой текст схемы — `s.text({ pattern, message })`, `s.custom(() => 'текст')`, `z.refine(…, 'текст')`;
2. `messages` поля модели (выше);
3. в форме — `messages` поля формы (`field.email({ messages: { unique: '…' } })`), затем словари
   формы, приложения и пакета по коду;
4. текст схемы как есть (`message`).

Пункты 1–2 приходят в форму как `template` и сильнее её словарей: текст модели действует во
всех формах. Нужен разный текст в разных формах — задавайте его в форме, а не в модели.

#### В форму `lib/form`

`failureIssues(e)` отдаёт ошибки как issues Standard Schema: `{ message, path: ['поле'], code,
params?, template? }`; `null` — у сбоя нет ошибок по полям (отказ прав, недоступность БД), его
показывают иначе. `ctx.fail` в обработчике формы принимает такие issues сам:

```ts
import { failureIssues } from '#lib/db/index.js'
import { createFormHandler } from '#lib/form/server.js'

const handler = createFormHandler({
  description: signup,
  async execute(ctx) {
    try {
      await locals.db.resource(users).insert(locals.dbCtx, ctx.values)
    } catch (e) {
      const issues = failureIssues(e)
      if (issues) ctx.fail(issues)   // под поля: «Этот email уже зарегистрирован»
      throw e                        // остальное — общая ошибка «Операция не выполнена»
    }
    ctx.commit()
    return { redirect: '/welcome' }
  },
})
```

Без JS форма перерисуется с ошибкой под полем и `aria-invalid`, с JS — то же без перезагрузки.

#### Без формы: API и простые actions

- `toKitError(e)` → `body.errors` (без `template`):

  ```json
  { "code": "conflict", "message": "Data conflict",
    "errors": [{ "field": "email", "code": "unique", "message": "Этот email уже зарегистрирован" }] }
  ```

- `toFormFailure(e)` → `data.fieldErrors` (`{ email: ['…'] }`) и `data.formErrors` готовыми
  текстами — для форм без `lib/form` (пример в начале раздела).
- Своя схема через `make(vendor, check)`: `check` может вернуть `{ message, code, params? }`
  (`CodedIssue`) — код дойдёт до формы так же, как у `s.*`.

### Правила один раз: модель → форма, `fill`/`store`, `checks`, `validator`, метка проверки

Кто за что отвечает:

| Правило | Где описано | Кто проверяет |
|---|---|---|
| Значение поля (длина, границы, набор, обязательность) | схема поля модели — `s.text({ min: 3, max: 120 })`, `required` | форма (валидаторы из модели, `formParams`); БД — если метки нет или она не совпала |
| Своё правило формы (`sameAs`, файлы, `check`), поле не из модели («согласен») | форма | только форма |
| Очистка ввода (ссылки, запрещённые слова) | `prepare` обработчика формы | только сервер формы, до правил; импорт в БД её не проходит |
| Правило данных («slug занят», «черновик без даты») | `checks` модели | только БД, всегда, в транзакции записи |
| Последняя защита | CHECK, индексы PostgreSQL | PostgreSQL |

**Форма из модели: `formParams`.** Переходник `#lib/db/form.js` (ядро `lib/db` форму не
импортирует; переходник нужен только тем, кто использует обе библиотеки) — как `formParams`
у фильтров пагинатора:

```ts
// модель — общий модуль (форма работает и в браузере): только поля, права и порядок, без соединения
export const posts = defineResource({
  fields: {
    title: field(s.text({ min: 3, max: 120 }), { read: () => true, create: () => true, required: true, … }),
    // …
  },
  // …
})

// описание формы
import { formParams } from '#lib/db/form.js'
const post = formParams(posts)
export const dbCreate = defineForm({
  id: 'db_demo_create',
  fields: post.fields({
    title: field.text({ label: 'Заголовок', ...post.title }),   // required + minLength(3) + maxLength(120)
    agree: field.checkbox({ label: 'Согласен с правилами', validate: [v.required()] }),   // только форма
  }),
})
```

| Модель | Валидатор формы |
|---|---|
| `required: true` без `fill`/`createValue`/`generated` | `v.required()` |
| `s.text({ min, max })` | `v.minLength`, `v.maxLength` |
| `s.integer({ min, max })` | `v.integer()`, `v.minValue`, `v.maxValue` |
| `s.enum([...])` | `v.oneOf([...])` |
| zod ≥ 4.2, valibot (Standard JSON Schema) | длина, границы, набор — что известно |

Свой валидатор — рядом с выданными: `validate: [...post.title.validate, v.email()]`.
`post.fields({...})` в разработке предупреждает, если поле формы развернуло параметры чужого
поля модели. Поле модели с именем `fields` занято обёрткой — `formParams` откажет.

**Метка проверки.** Если правила схемы переведены в валидаторы формы целиком (`s.text` без
`pattern`, `s.integer`, `s.enum`, `s.boolean`; у необязательного поля — без `min`: пустое поле
форма не проверяет на длину), параметры несут `rulesFrom: { schema, rules }`. На сервере формы
`pick` отдаёт копию нужных полей с меткой «проверено этой схемой» (неперечисляемое
свойство-символ `Symbol.for('modals-kit.validated-proof.v1')`):

```ts
async execute({ values, pick, commit }) {
  await db.resource(posts).insert(dbCtx, pick(['title']))   // только поля модели; agree остаётся у формы
  commit()
  return {}
}
```

`insert`/`update` читают метку и не повторяют правила схемы, если совпало всё: объект схемы
(`proof.schema === field.schema`) и значение **после** `normalize` (строки, числа, булевы —
`Object.is`, массивы таких — поэлементно). Не совпало что-то одно — поле проверяется полностью.
Метки нет и у поля, чьи выданные правила форма заменила (`validate: [v.required()]` вместо
`...post.title`). Отдать в запись `values` целиком нельзя: поле не из модели (`agree`) — отказ
`forbidden`, а не молчаливый пропуск (опечатка в имени не теряется).

Метка — только способ не проверять дважды, не доверие: её может поставить лишь код приложения,
а он и так может записать что угодно. `checks`, CHECK и индексы выполняются всегда; метка не
переживает копию объекта, JSON и HTTP — получатель просто проверит заново. Тип и ключ метки
скопированы в обе библиотеки (`src/lib/db/proof.ts`, `src/lib/form/proof.ts`), совпадение держат
тесты с каждой стороны. Запись из кода (импорт, бэкап) идёт без метки — правила модели
проверяются, очистка формы (`prepare`) — нет.

**`fill` — заполнить, если не передано.** `(values, ctx, operation) => значение | undefined`:
`values` — уже проверенные переданные поля (снимок только для чтения). Вызывается после
проверки переданных полей и только если они без ошибок; результат проходит правила поля.
`undefined` — не заполнять (так у `update` поле остаётся как было). Переданное значение
(если `create`/`update` его разрешает) побеждает. Заполненное — server-owned, как
`createValue`: `beforeWrite` его не меняет. Обязательное поле с `fill` во входе не требуется.

```ts
slug: field(s.text({ max: 80 }), { read: () => true, nullable: true, fill: (v) => slugOf(v.title) }),
```

**`store` — как хранить.** `(value, ctx) => значение` (может быть асинхронной), вызывается после
правил поля и `fill`, до `beforeWrite`, `checks` и SQL; `null` не передаётся. Правила описывают
то, что приходит (пароль 8–72), а колонка хранит результат (хэш), поэтому нужен явный `db.type`
(без него `defineResource` откажет), и CHECK из правил не строится. Метка `store` не отменяет.

```ts
password: field(s.text({ min: 8, max: 72 }), { create: () => true, read: () => false, store: (v) => hash(v), db: { type: 'text' } }),
```

Порядок записи: вход → `normalize` → правила полей (или метка) → `createValue`/`fill` →
`store` → `beforeWrite` → `checks` → SQL.

**`checks` — правила данных в модели.** Выполняются при каждой записи: после проверки полей и
`beforeWrite`, в той же транзакции (поэтому ресурсу с `checks` нужен транспорт с транзакциями,
иначе `unsupported`). Возвращают нарушения; пусто или ничего — записать можно:

```ts
export const posts = defineResource({
  // …
  checks: async ({ db, values, operation, before }) => {
    const taken = await db.query({ text: 'SELECT 1 FROM public.post WHERE slug = $1', values: [values.slug] })
    return taken.rows.length ? [{ field: 'slug', code: 'unique' }] : []
  },
})
```

| Поле события | Что |
|---|---|
| `values` | значения после проверки полей и `beforeWrite` (снимок только для чтения) |
| `operation` | `insert` / `update`; `check` — только из `validator` |
| `db` | транзакция записи (в `validator` — сама база) |
| `before` | строка до изменения — только у `update` |

Нарушение — `{ field?, code, params?, message? }`. Текст: `message` (свой текст правила, с
подстановками `{param}`) → `messages` поля по коду → словарь формы по коду (`unique` → «Это
значение уже занято»). Без `field` — ошибка всей записи. У JSON-поля (`f.json`) `field` может
указать ключ внутри: `data.mail` — значения пользовательских полей записи; путь issue тогда
`['data', 'mail']`. Нарушение попадает в форму тем же путём, что и ошибки полей
(`failureIssues` → `ctx.fail`). `checks` не заменяет уникальный
индекс: гонку двух записей закрывает только индекс (`db: { unique: true }`), его ошибка тоже
приходит под поле.

**`validator` — проверка без записи** для форм, которые ничего не пишут (вход, сброс пароля):

```ts
const handler = createFormHandler({
  description: login,
  schema: db.resource(users).validator(dbCtx, 'check'),   // Standard Schema: issues с path → под поля
  execute: …,
})
```

Проверяет поля ресурса, которые есть во входе (чужие ключи формы — «запомнить меня» —
пропускает), затем `checks`. `check` — только значения и `checks`; `insert`/`update` — как
настоящая запись: права на поля (`forbidden` — исключение), у `insert` — обязательные поля.
Сбой БД — исключение, а не issue.

Пакетная вставка — `insertMany`: один `INSERT … VALUES (…),(…) RETURNING` на чанк, валидация
каждой строки — тем же `draftInput`-путём, что и у `insert`.

```ts
const created = await db.resource(posts).insertMany(ctx, rows, { chunkSize: 200 })
// rows.length > 1 чанка → внутри db.transaction; на транспорте без транзакций
// пачка дописывается последовательно, а { atomic: true } = unsupported до первого запроса
```

Отличия от цикла из `insert` — все три проверены тестом: разный набор полей у строк =
`validation` (иначе часть строк получила бы `DEFAULT`, а `RETURNING` ввёл бы в заблуждение);
`hooks`/`validateFinal`/`checks` с пакетным путём несовместимы = `unsupported`; короткий `RETURNING`
без `onConflictIgnore` = `database`, а не тихий недобор. Лимиты: 1…5000 строк, чанк =
`min(chunkSize, 500, 30000/(колонок+1))` — чтобы не упереться в 65535 параметров протокола.

Сериализационный конфликт — единственная ошибка, при которой повтор всего блока безопасен:

```ts
import { withRetry } from '#lib/db/index.js'
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
| `unavailable`, `schema_pending` | | | | | | | • | |
| `database`, `post_commit` | | | | | | | | • |

## 5. Драйверы

| Адаптер | Ввод | Транзакции | Когда |
|---|---|---|---|
| `#lib/db/adapters/pg.js` | `pgAdapter(pool, maxInFlight = 32, transactionTimeoutMs = 30000)` | да (savepoint'ы) | Node-сервер, long-lived |
| `#lib/db/adapters/pglite.js` | `pgliteAdapter(db)` | да | dev/тесты; один пользователь, WASM, не для Workers |
| `#lib/db/adapters/hyperdrive.js` | `hyperdriveAdapter({ connectionString, timeoutMs = 15000, maxInFlight = 5 })` | да, на одном `Client` | Cloudflare Workers + Hyperdrive |
| `#lib/db/adapters/lazy.js` | `lazyDriver(open, capabilities = как у pg)` — обёртка над любым драйвером из этой таблицы | как у открытого драйвера | БД открывается при первом запросе, а не при создании `db`: страницы без БД её не поднимают; движок (pg, PGlite, Hyperdrive, прокси) не важен |
| `#lib/db/adapters/proxy.js` | `proxyHttpAdapter(config)` / `proxyWsAdapter(config)` / `proxyAdapter(mode, config)` | HTTP — **нет**, WS — да (один сокет = один backend) | Postgres за HTTP/WS-прокси (`@juit/pgproxy`-протокол): хостинг без TCP, free-контейнеры, домен за Cloudflare |
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
import { createDb, conservativeLimits } from '#lib/db/index.js'
import { proxyWsAdapter } from '#lib/db/adapters/proxy.js'

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

## 6. Схема и миграции

### Схема из моделей: `defineSchema`

```ts
import { defineSchema } from '#lib/db/sync/index.js'
export const schema = defineSchema({
  resources: [posts, comments],
  sql: [{ id: 'comments-trigger', text: 'CREATE FUNCTION …; CREATE TRIGGER …' }], // один раз на id
})
// в open() у lazyDriver:
return schema.gate(driver, { onReport: (r) => console.warn(r) })
```

Таблица строится из ресурса: тип колонки — из схемы поля (`s.text` → `text`, `f.timestamp` →
`timestamptz`, `s.json` → `jsonb`, …; у чужих схем — из Standard JSON Schema, если схема его
реализует: zod ≥ 4.2, valibot; иначе `db: { type }`, без него открытие
БД отказывает `validation` с именем поля), `NOT NULL` — если поле не `nullable` (метка `softDelete`
всегда допускает NULL), `DEFAULT` — `db: { default: 'clock_timestamp()' }`, `CHECK` — из
`s.text({ min, max })`, `s.integer({ min, max })`, `s.enum` или из JSON Schema (`minLength`/`maxLength`,
`minimum`/`maximum`, `enum`; `pattern` не переносится — регулярные выражения JS и PostgreSQL разные), индекс — под сортировку `order`
(+ `primaryKey`, как его пишет `orderSQL`), уникальность — `db: { unique: true }` у поля или
`db: { unique: [[…]], indexes: [[…]] }` у ресурса. У ресурса с `softDelete` индексы частичные —
по неудалённым строкам (удалённый `slug` можно занять снова). `timestamps` добавляет индексы под
опрос изменений: `(updatedAt, primaryKey)` по живым строкам и `(deletedAt, primaryKey) WHERE
deletedAt IS NOT NULL` — по удалённым (частичный по живым был бы пуст).

Ход сверки для показа ожидания — `onStep` у `gate` и `sync`:

```ts
schema.gate(driver, { onStep: ({ done, total, step, name }) => show(done, total, step, name) })
// { done: 0, total: 3, step: 'check' } → { done: 1, step: 'table', name: 'public.post' }
// → { done: 2, step: 'sql', name: 'seed' } → { done: 3, total: 3 }   (total = 1 + ресурсы + скрипты)
```

Быстрой проверки хватило — сразу итог `{ done: total, total }`. Слова для человека
(«Таблица …») — у приложения, пакет отдаёт только этапы.

При открытии БД (`gate` → `sync`):

1. Один SELECT из `kit_schema`: отпечатки моделей и `id` ручного SQL совпали — ничего не делать.
2. Иначе — транзакция под `pg_advisory_xact_lock` (экземпляров много, меняет один): чтение
   `pg_catalog`, сравнение, выполнение шагов `auto`.
3. Шаги `conflict` не выполняются; пока они есть, каждый запрос к БД отвечает `schema_pending`
   (503) и перед этим перепроверяет `kit_schema` — снятый конфликт отпускает запросы без
   перезапуска. Страницы без запросов к БД работают.

| Само (`auto`) | Конфликт (`conflict`, блокирует) | Ждёт решения (`notice`) |
|---|---|---|
| новая таблица; новая колонка, если NULL допустим, есть DEFAULT или таблица пуста; `DROP NOT NULL`; `SET NOT NULL` без NULL в данных; DEFAULT; CHECK (`NOT VALID`) и индексы — новые создаются, свои старые (имя `<таблица>_ck|ix|ux_<хеш>`) удаляются | обязательная колонка без DEFAULT на непустой таблице; пропала и появилась колонка одного типа (переименование или замена?); смена типа; `NOT NULL` при NULL в данных; уникальность при дублях; колонка вне модели с `NOT NULL` без DEFAULT; другой primary key; изменённый текст ручного SQL под тем же `id` | колонка в БД, которой нет в модели (вставкам не мешает) |

Отпечаток таблицы записывается, когда у неё не осталось конфликтов. Чужие объекты (ручные
CHECK/индексы) не трогаются. Изменение схемы мимо моделей при совпавшем отпечатке не
замечается — сверка идёт по записи в БД, как у WordPress. Нужен транзакционный драйвер
(pg, PGlite, Hyperdrive); без транзакций — `unsupported`. Роль из `DATABASE_URL` должна
иметь право `CREATE` на схему.

**Внешние ключи.** `db: { references: { resource: () => authors, field?: 'id', onDelete?: 'no action' | 'restrict', chain?: true } }`
у поля. Ключ (имя `<таблица>_fk_<хеш>`) добавляется после всех таблиц и `NOT VALID` — старые
строки без пары не мешают открытию, новые проверяются; пропал из модели — удаляется.
`field` по умолчанию — первичный ключ цели. База сама связанные строки не удаляет и не
обнуляет (`cascade`/`set null` — ошибка объявления): это делает цепочка удаления (`chain: true`,
§7); колонке такой ссылки строится индекс. У таблиц без ключей
отпечаток прежний. Нарушение (`23503`/`23001`, вид `conflict`, 409): запись со ссылкой на несуществующую
строку — ошибка поля с кодом `reference` (если поле пишет этот ctx), удаление строки, на которую
ссылаются, — общая ошибка `referenced`; тексты — `messages` поля или словарь форм.

**Решение конфликтов.** Конфликт снимает человек: правкой модели (или данных) либо решением —

```ts
import { choices, stepKey } from '#lib/db/sync/index.js'
const report = await schema.sync(driver)          // что ждёт решения
for (const step of report.conflicts) choices(step) // ['rename', 'replace'] | ['apply'] | [] — само не снять
await schema.sync(driver, { resolve: { [stepKey(report.conflicts[0])]: 'rename' } })
// report.resolved — что выполнено по решению; запросы отпускает без перезапуска
```

`rename` переименовывает колонку (данные остаются), `replace` удаляет старую и планирует заново
(новая колонка может оказаться новым конфликтом), `apply` выполняет предложенный SQL (смена
типа с приведением, удаление лишней колонки). Решение и автоматические шаги — одна
транзакция: ключ шага, которого в свежем плане уже нет (схему успел поменять другой
экземпляр), — `conflict`, неподходящее решение — `validation`, отказ БД — откат целиком.
Дубли под уникальностью, `NULL` под `NOT NULL` и обязательная колонка без DEFAULT вариантов не
имеют (`choices` → `[]`): их снимает правка данных или модели.

Приложение показывает это экраном на страницах с БД (`src/routes/(site)/(app)/db-demo/SchemaPending.svelte`):
кнопка «Выполнить» спрашивает `DB_ADMIN_TOKEN` (`src/lib/server/schema-admin.ts` сверяет его
за постоянное время до обращения к БД); без переменной кнопки нет, экран объясняет, что задать.

### SQL-файлы: `applyMigrationText`

```ts
import { applyMigrationText, splitSqlStatements } from '#lib/db/sveltekit/index.js'
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
Прогон — явный скрипт/роут/флаг. Таблицы демо `applyMigrationText` больше не создаёт — это делает `defineSchema`.

## 7. Публичный API

| Экспорт | Что |
|---|---|
| `#lib/db/index.js` | `createDb`, `DbFailure`, `normalizeFailure`, `fail`, `failFields`, `failureIssues` (+ типы `FieldError`, `FailureIssue`), `defineResource`, `field`, `f`, `s`, `make`, `policy`, `owner`, `link` (ключи доступа, §7), `createCursorCodec`, `conservativeLimits`, `withRetry` + тип `RetryOptions`, типы (`Database`, `Driver`, `DataContext`, `Capabilities`, `Limits`, `Row`, …) |
| `#lib/db/schema.js` | zero-dep Standard Schema: `s.text/uuid/integer/bigint/decimal/boolean/date/timestamp/json/array/enum/custom`, `make` (предикат вправе вернуть `CodedIssue` — код и параметры дойдут до формы) |
| `#lib/db/adapters/pg.js` | `pgAdapter` |
| `#lib/db/adapters/pglite.js` | `pgliteAdapter` |
| `#lib/db/adapters/hyperdrive.js` | `hyperdriveAdapter` |
| `#lib/db/adapters/lazy.js` | `lazyDriver` |
| `#lib/db/adapters/proxy.js` | `proxyAdapter`, `proxyHttpAdapter`, `proxyWsAdapter` (+ типы `ProxyConfig`, `ProxyMode`) |
| `#lib/db/sync/index.js` | `defineSchema`, `canonicalType`, типы `SchemaSpec`, `SchemaReport`, `SqlStep`, `Step`, `DbSchema` |
| `#lib/db/sveltekit/index.js` | `dbHandle`, `createRequestContext`, `toKitError`, `toFormFailure`, `FAILURE_STATUS`, `parseListInput`, `readJson`, `readBoundedBody`, `BodyTooLarge`, `cursorCodecFromEnv`, `splitSqlStatements`, `applyMigrationText`, типы `LocalsDb`/`MinimalEvent`/`Principal` |
| `#lib/db/sveltekit/node.js` | `openNodeDatabase`, `openPgPool` (в т.ч. `startupParameters: 'skip'` для pooler), `resolveDatabaseDir` (тут же `node:`/PGlite — в Workers этот entry не импортируют) |
| `#lib/db/testing/index.js` | `withTestDb`, типы `TestDb`, `TestDbOptions`, `TestDbEncoding` |
| `#lib/db/zod.js` | `z` (zod) + `field`/`f`/`defineResource`: позволяет переносить схемы вида `field(z.string().min(1), {...})` без правок; пакет zod не тянет, импорт опциональный |
| `#lib/db/form.js` | `formParams(resource)` → параметры полей формы из модели (`...post.title`, `post.fields({...})`) + типы `DbFieldParams`, `DbFormParams`; ядро (`index.js`) от `#lib/form` не зависит (§4) |

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

`Field`-флаги: `column`, `schema`, `kind`, `read`/`create`/`update` (маски: нет ключа или `null` — всем,
`[]` — никому, список ролей или функция — по ним; системные поля — `primaryKey`, `ownerField`,
`generated`, `createValue`, `immutable` при `update` — клиент не пишет при любой маске),
`generated`, `immutable`, `required`, `nullable`, `normalize`, `createValue`, `fill` и `store` (§4), `filters`,
`orderable`, `db` (`type`/`default`/`unique`, §6), `messages` (свои тексты ошибок по коду, §4). `Resource`: `key`, `table`, `primaryKey`, `ownerField`, `mandatoryRead`,
`policy` (нет `policy` или `null` — без ограничения; нет правила операции — без ограничения для неё; `restore` без своего — как `delete`; другие ключи — именованные правила для ключей доступа), `access` (ключи доступа, §7), `order`, `hooks`, `checks` (правила данных, §4), `relations`, `constraints`, `validateFinal`, `softDelete`, `timestamps`, `db` (§6).
`db.resource(r)`: `select`, `get`, `count`, `cursor`, `estimate`, `insert`, `update`, `delete`, `canDelete`, `chain`, `restore`,
`insertMany`, `validator(ctx, 'insert' | 'update' | 'check')` (проверка без записи, §4), `without`, `behavior`, `raw` (ниже).
`#lib/db/form.js`: `formParams(resource)` — параметры полей формы из модели (§4; переходник
импортирует `lib/form`, ядро — нет).

`timestamps` — системные поля времени; значение — имя поля (и колонки), поле создаёт
`defineResource`, объявить его ещё и в `fields` — `validation`:

```ts
export const posts = defineResource({
  key: 'demo.post.v1', table: 'public.demo_post', primaryKey: 'id',
  fields: { id: f.uuid({ … }), title: field(s.text({ min: 3, max: 120 }), { … }) },
  policy: { …, restore: policy.roles(['admin']) }, // restore — необязательно, иначе как у delete
  order: [['created_at', 'desc']],
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: { field: 'deleted_at', readDeleted: ['admin'] }, // или просто 'deleted_at'
  },
})
```

Каждое поле — время (`timestamptz`), читается всеми, кто видит строку, клиент его не пишет
(`generated` + `immutable`), сортировка и фильтры `gt/gte/lt/lte` разрешены. Значение ставит
база — `clock_timestamp()`, часы приложения не участвуют: `createdAt` и `updatedAt` — DEFAULT
колонки, `updatedAt` ещё и при каждом `update`/`restore`. `deletedAt` — мягкое удаление:
`delete` ставит метку, чтение её скрывает, `restore(ctx, id)` снимает. Удалённые не видит
(`includeDeleted`) и не восстанавливает никто, пока не задан `readDeleted` в объектной форме;
`restore` нужна ещё политика `restore` (нет — `delete`), не удалённая строка — `not_found`,
ресурс без мягкого удаления — `unsupported`. Для хуков восстановление — `update`. Вместе с
ручным `softDelete` — `validation`. Пустое значение — метка выключена: `null`, `''`, нет ключа
(у объектной формы — `{ field: '' }` или `{ field: null }`); `timestamps: null` — все три.

`liveCapabilities(resource)` → `{ inserted: true, updated, deleted }` — что ресурс умеет
сообщить опросу изменений: новые — всегда, изменённые — есть `updatedAt`, удалённые — есть
`deletedAt`. Индексы под опрос строит `defineSchema` (§6).

**Разовое отключение автоматики — `without(paths, fn)`.** `fn` получает временный экземпляр:
ту же модель, заново собранную из описания, где опции по путям заменены на `null`. Остальной
код (параллельные запросы) модель не теряет — общего состояния нет.

```ts
const api = db.resource(posts)
await api.without(['timestamps.updatedAt'], (p) => p.update(ctx, id, { views: 5 })) // не двигать updated_at
await api.without(['policy', 'grants'], (p) => p.select(ctx))                     // все строки и поля
await api.without(['timestamps.deletedAt'], (p) => p.delete(ctx, id))            // навсегда; чтение видит удалённые
api.behavior() // { timestamps: { createdAt, updatedAt, deletedAt }, live: { inserted, updated, deleted }, off: [], raw: false }
```

Пути — пути схемы: `policy`, `policy.<правило>`, `access`, `access.<поле>`, `grants` (маски всех полей), `hooks`,
`hooks.<хук>`, `checks`, `validateFinal`, `timestamps.createdAt|updatedAt|deletedAt`, `softDelete`,
`fields.<поле|*>.read|create|update|normalize|createValue|fill|store|required`; и `protect`
(ниже). Выключенное поле метки клон не знает: `timestamps.updatedAt` — метка не двигается и не
читается; `timestamps.deletedAt` — удаление навсегда и удалённые видны. Путь, которого у модели
нет, неизвестный путь, пустой список — `validation`. Внутри `fn` экземпляр сообщает
выключенное (`behavior().off`); вложенный `without` складывает пути, включить выключенное
нельзя. `tx.resource(posts).without(…)` пишет в ту же транзакцию. Таблицу клон не описывает:
синхронизация схемы — только по исходной модели; ключи `without` — только из кода.

**Системные поля с работающей автоматикой — `without(['protect'])`.** Переданное системное поле
(`primaryKey`, `ownerField`, `generated`, `createValue`, `immutable` при `update`, метки
`timestamps`) берётся как есть; не переданное — как обычно (`createValue`, DEFAULT, сдвиг
`updatedAt`). Передали `updatedAt` — в этой операции метка не двигается. Проверка схемой поля,
`normalize`, хуки, `checks`, `policy` и маски работают, если их не выключили тем же `without`.

```ts
await posts.without(['protect'], (p) => p.insert(ctx, { id, title, created_at: '2020-01-01T00:00:00Z' }))
```

**Сырой экземпляр — `raw(fn)`.** Что передали, то и записано: нет прав строк и полей, защиты
системных полей, проверки схемой, `normalize`/`fill`/`createValue`/`store`, хуков, `checks`,
`validateFinal`, сдвига `updatedAt`, мягкого удаления (`delete` — настоящий `DELETE`). Чтение —
все строки (и удалённые) и все поля, фильтр и сортировка по любому полю, без лимита страницы.
Остаётся то, без чего запроса нет: имена полей переводятся в колонки (неизвестное поле —
`validation`), значения уходят параметрами SQL, транзакция, отмена; остальное проверяет
Postgres. Связанные записи (`include`) — тоже сырые: все поля, без правил строк, и удалённые.
`estimate` считает всю таблицу, и удалённые (без фильтра — статистика планировщика). Нет
`cursor` (значения полей сортировки уходят клиенту в указателе, а сортировать сырой экземпляр
может по закрытому полю), `restore` (мягкого удаления у него нет — `update` метки),
`validator` (проверять нечего), `without` (выключено всё). Числовой счётчик после вставки
своих id не поднимается — это дело того, кто вставлял.

```ts
await users.raw((u) => u.insertMany(ctx, rowsFromOldDb)) // свои id, даты, готовые хэши
```

**Удаление — `delete(ctx, id, { hard, chain })` и `canDelete(ctx, ids)`.** `delete` удаляет
запись по правилу `delete`: у модели с мягким удалением — ставит метку, `hard: true` — навсегда
(у модели без мягкого удаления — всегда навсегда). Уже удалённую (мягко) строку `hard` достаёт
только у того, кто видит удалённые (`readDeleted`). Без `chain` удаляется только эта запись:
если на неё ссылаются другие — отказ базы (`conflict`, код `referenced`). `chain: true` —
вместе с цепочкой (ниже) без отдельного вызова `chain()`; ответ — удалённая запись. `canDelete` отвечает
без удаления: `{ allowed: [ключи, которые этот ctx может удалить], soft }` (только живые строки,
`soft` — удаление по умолчанию мягкое).

**Цепочка удаления — `chain(ctx, id)`.** Ссылка-принадлежность `references: { resource: () => posts,
chain: true }` (только на первичный ключ цели) говорит: строка живёт вместе с целью. Из таких
ссылок моделей, переданных в `createDb({ resources })`, строится цепочка; круг принадлежности
между моделями — ошибка `createDb` (ссылка модели на себя — дерево — можно). Без `resources` —
`unsupported`. `chain` ничего не удаляет: возвращает корень и звенья с правами.

```ts
const plan = await posts.chain(ctx, id)
// plan.root  { model, id, allowed, soft }
// plan.links [{ model, path, ids, allowed, total, soft }]  — allowed: сколько из total можно удалить
await plan.delete()                 // мягкий корень — все звенья мягко
await plan.delete({ hard: true })   // всё навсегда, и уже мягко удалённые дети
await posts.delete(ctx, id, { chain: true })  // то же без просмотра: собрать, проверить, удалить
```

`plan.delete` (и `delete` с `chain: true`) в одной транзакции собирает цепочку заново с блокировкой строк и проверяет:
корень или звено не разрешены правилом `delete` — `forbidden` с `{ model, path, count }`; при
мягком удалении звено без мягкого удаления — `unsupported` с тем же. Удаляет с конца (дерево — с
нижних уровней), корень последним; ошибка SQL откатывает всё. Звено с хуками или
`validateFinal` удаляется по одной строке через свой `delete`, без них — одним запросом на
уровень. Предел — `createDb({ chainRows })` строк (по умолчанию 10000) и 64 уровня. Уже мягко
удалённый корень показывается для удаления навсегда (`root.soft: false`). Выключенное у
экземпляра (`without`, `raw`) действует и на звенья.

**Ключи доступа — `access`.** Поле-ключ включает проверку прав, когда его значение есть в
запросе. `owner(ops?)` — значение сравнивается с
`ctx.principal.id`; `link({ операция: правило })` — поле ссылается на модель (`db.references`,
на первичный ключ), и операция проверяется правилом цели: строка цели жива, проходит её
`policy.select` и названное правило (`select` или именованное правило её `policy`). Нет операции
в описании — ключ её не разрешает.

```ts
// модель записи: именованное правило — кто может комментировать
policy: { select: …, update: …, comment: (ctx) => ({ field: 'comment_mode', op: 'eq', value: 'all' }) },
// модель комментария
access: { author_id: owner(), post_id: link({ select: 'select', insert: 'comment', delete: 'update' }) },
```

- **Чтение** (`select`, `count`, `cursor`, `estimate`): каждое значение ключа, переданное в
  фильтре (`eq`/`in`, не под `not`), проверяется — один запрос на все значения, а не на каждую
  строку. Не прошло — `forbidden` с полем ключа. Без ключей — без проверки (это ORM, а не API:
  маршрут сам просит комментарии записи). `get` по id ключей не передаёт.
- **Вставка** (`insert`, `insertMany`): все ключи обязательны (нет или `null` — `forbidden`) и
  все проходят. Владельца удобно ставить `createValue: (ctx) => ctx.principal.id`.
- **Изменение и удаление по id** (`update`, `delete`, `restore`, `canDelete`, звенья цепочки):
  ключи берутся из строки, достаточно одного разрешающего операцию (`restore` — как `delete`);
  ни один не разрешает — строки «нет» (`not_found`). Новое значение ключа в `update`
  проверяется как при вставке.
- `policy` модели действует всегда и может сузить. Мягкое удаление — не права: удаление записи
  не прячет её комментарии от «моих». `without(['access'])` выключает ключи, `raw` — тоже.
- Правило цели — правило её строк: условия по другим моделям (видимость коллекции записи) в
  нём пока не выражаются.
Строки `select` типизированы как `Partial<…>` — проекция вправе вернуть не все поля, а
relations добавляются через `include`.

Условия окружения: `DB_CURSOR_SECRET` (не короче 32 байт — более короткий ключ
отказывается сам кодек, `createCursorCodec`, а не молча подписывает слабым HMAC),
`DB_CURSOR_KID` (имя действующего ключа в токене, по умолчанию `v1`), `DB_CURSOR_OLD_KEYS`
(кольцо старых ключей для мягкой смены секрета, `kid:secret,...`; смена: новое имя в
`DB_CURSOR_KID`, прежний секрет — под прежним именем; имя действующего ключа в кольце —
ошибка запуска), `DB_CURSOR_TTL_SECONDS` (по умолчанию 1800). Остальные имена
(`DATABASE_URL`, `DATABASE_DIR`, `DB_POOL_MAX`, `HYPERDRIVE_CONNECTION_STRING`, `VERCEL`)
читает приложение — пакет принимает значения, а не env. Полный перечень с
описанием каждого ключа (и разбором `403 origin.rejected` из `KIT_TRUSTED_ORIGINS`) —
в `.env.example` в корне приложения; перечень и проверки значений — `src/env.ts`.

## 8. Как слой связан с деревом приложения

Слой — часть приложения, поэтому никаких `exports`/`files`/`tsconfig.build.json` у него
нет: Vite резолвит `#lib/db/index.js` в `src/lib/db`, a `svelte-check` видит `.ts` как есть. Единствен-
ное ограничение, которое теперь держит контракт потребителя, проверяется аудитом: приложение
импортирует слой **только** через `#lib/db…` (никаких `../../lib/db`), а карта entry-поинтов
ниже — единственное, что считается публичным API.

## 9. Разработка слоя

Слой проверяется теми же командами, что и всё приложение:

```sh
npm run test:db       # vitest по src/lib/db (структура, порт-специфика, перенесённые проверки, аудит доков)
npm run test          # всё: vitest по src + node --test tooling/
npm run check         # svelte-check по всему дереву (тесты слоя из него исключены, как и остальные *.test.ts)
npm run build         # здесь важен и layer-guard: обход #lib/form роняет сборку
npm run test:db:probes # пробы на живых движках (см. ниже) — нужен поднятый PG/прокси
```

Тесты слоя — 141 группа в семи файлах (на PGlite выполняются 140: одна группа требует
настоящего PostgreSQL):

| Файл | Группы | О чём |
|---|---|---|
| `src/lib/db/test/db-structure.test.ts` | 6 | границы слоя: у `./sveltekit` нет импортов `node:`/`pg`/PGlite, каждый `FailureKind` замаплен, баррель не тянет адаптеры, `src/lib/db/migrations/*.sql` парсятся |
| `src/lib/db/test/db-port-specific.test.ts` | 39 | поведение, которого в источнике не было (курсоры в обе стороны, внутренний текст БД только в dev, `parseListInput`, отмена и пул, прокси-транспорты, Hyperdrive, замок каталога) |
| `src/lib/db/test/db-sync.test.ts` | 33 | схема из моделей (`defineSchema`: каждый вид изменения, ход сверки `onStep`, `kit_schema`, ручной SQL, `schema_pending`, внешние ключи, решения конфликтов), цепочка удаления (`chain`, `delete({ chain })`: права, мягко/навсегда, отказы, дерево, круг, хуки, `without`/`raw`), сырые связанные записи и `estimate` у `raw`, ключи доступа (`access`: чтение, вставка, по id, перенос, цепочка, ошибки объявления, ссылка на себя), ошибки по полям (все сразу, коды, `messages`, уникальный индекс → поле), тип и CHECK из Standard JSON Schema zod — один PGlite на файл |
| `src/lib/db/test/db-rules.test.ts` | 33 | правила один раз: метка проверки (договорённость с `lib/form`, пропуск и отказ), тип и CHECK из JSON Schema поля, `checks` в транзакции записи (и ключ JSON-поля `data.mail`), `validator` без записи, маски и `policy` по умолчанию, `fill` (заполнение, приоритет переданного, правила результата, защита от хука) и `store` (после правил, с меткой, требование `db.type`); `timestamps` (поля, DEFAULT и индексы под опрос, время базы, мягкое удаление, `readDeleted`, `restore` и его политика, ошибки объявления, пустые значения = выключено, `liveCapabilities`, цепочка ставит время базы); `without` и `behavior` (клон без меток, прав, хуков, `store`; параллельный код, вложенность, транзакция, ошибки путей), `protect` (свои id и даты, автоматика остального), `raw` (запись как есть, чтение без фильтров), `delete({ hard })` и `canDelete` |
| `src/lib/db/test/ported/db-lib.script.ts` | 16 | перенесённые проверки источника (один `it` на скрипт из `test/db-ported.test.ts`: PGlite/PG поднимаются раз на файл) |
| `src/lib/db/test/ported/db-hardening.script.ts` | 5 | устойчивость отказов: отмена, дедлайны, отравленный parent |
| `src/lib/db/test/ported/db-followup.script.ts` | 9 | дополнения переноса (из 12 групп источника снято 3, причины — `src/lib/db/PORTING.md`) |
| `src/lib/db/test/db-docs.test.ts` | — | боевой прогон `tooling/db-docs.mjs`: README/PORTING против кода |

Аудит документации живёт как остальные стражи приложения: правила и разбор — в
`tooling/db-docs.mjs` с юнит-тестами `tooling/db-docs.test.mjs` (`node --test tooling/`),
а сверка с настоящим кодом — тестом внутри слоя, потому что `.ts` читается только там, где
есть TS-транспиляция. `dist`-сборки, `fix-esm` и `npm pack` из прошлого жизненного цикла пакета
больше нет: приложение компилирует исходники само.

Есть и прогон на живых движках: `src/lib/db/probes/` — PGlite (`pglite.probe.mts`),
нативный PostgreSQL 17 и четыре транспорта сразу (`transport-matrix.probe.mjs`, требуется
поднятое окружение; матрица и выводы — [`docs/TRANSPORTS.md`](./docs/TRANSPORTS.md)); там же
`testdb-encoding.probe.mjs` — ловушка `SQL_ASCII` для `icontains`, `pooler.probe.mjs` —
поведение под PgBouncer'ом, `proxy-live.probe.mjs` — живое включение `adapters/proxy`,
`src/lib/db/probes/pg-live.probe.mjs` — прямой TCP к PostgreSQL: предполёт-хендшейк (не грузить
недоступный порт таймаутами пула) + границы, которых у прокси нет (`sqlstate` → `conflict`, savepoints).
Пробы — `.mjs`/`.mts` со `import`-ами TS-исходников, поэтому запускаются через tsx:
`node --import tsx src/lib/db/probes/<имя>.probe.mjs`.