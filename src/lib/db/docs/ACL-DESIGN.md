# ACL-схема и REST-слой: проект (v0, на согласование)

Документ отвечает на два вопроса, поставленных отдельно от кода:
**как должна работать схема** и **как она обеспечивает безопасность**.
Реализация — следующий шаг (`CHECKLIST-2.md`, T4); здесь только контракт и обоснования.

Изученные аналоги: **PocketBase** (API rules: 5 правил на коллекцию + `manageRule`,
правило = фильтр), **PostgREST/Supabase** (`?or=(…)`-строки + RLS как единственный
надёжный уровень), **Directus** (`{collection, action, permissions, validation, presets,
fields[]}` на политику), **Drizzle/Kysely** (формат документации). Из них берётся
**структура** (что описывается), и сознательно **не берётся их язык выражений** —
см. §4.1.

---

## 1. Три слоя, одна дверь

```
Resource (код, src/db)        что вообще существует: поля, колонки, операторы, хуки
   ↓ надстраивается
Collection schema (данные)    кто и что может: права × действия × поля × связи
   ↓ читается только через
authorize() (единственная дверь) → RestContext | DbFailure(forbidden)
   ↓ только с ним работают
REST-роуты /api/rest/[collection], /api/rest/users
```

Правило, которое делает схему безопасной по построению:

> **Ни один роут не вызывает `db.resource(...)` напрямую.** Роут получает
> `RestContext` из `authorize()` и обязан передать его первым аргументом в каждую
> операцию. `structure.check.mts` проверяет это грепом по `src/rest/**` +
> `test/acl-*.check.mts` — что обход `authorize` физически не даёт прочитать чужие строки.

Это тот же приём, что уже используется для `dbHandle` (principal собирается пакетом, а не
маршрутом), расширенный на поля и связи.

## 2. Схема коллекции: формат

```ts
/** docs только про форму; типы лягут в src/rest/schema.ts */
export interface CollectionSchemaV1 {
  /** 1. Имя коллекции: [a-z][a-z0-9_]{1,39}. Оно же — URL-сегмент и часть ключа кэша. */
  name: string
  /** Версия схемы. Участник scope'а курсора и ключ кэша компиляции (см. §6). */
  version: number

  /** 2. Источник строк: таблица | представление | SQL (read-only по умолчанию). */
  source:
    | { kind: "table"; table: string }
    /** sql обязан быть параметризованным и НЕ содержать `;` — режется splitSqlStatements. */
    | { kind: "sql"; sql: string; writable?: false }

  primaryKey: string

  /** Поля. Совпадают с `Field` ядра: схема ACL не вводит второй системы типов. */
  fields: Record<string, FieldDef>          // см. src/lib/db/types.ts: Field

  /** 3. Связи параметров (см. §3). */
  links?: Record<string, LinkDef>

  /** 4. Отдельные включения created_at / updated_at / deleted_at (см. §3.4). */
  timestamps?: {
    createdAt?: string          // имя колонки; DEFAULT + генерация сервером
    updatedAt?: string
    deletedAt?: string          // включает мягкое удаление = ядро `softDelete`
  }

  /** 5. Права: действие → правило. Отсутствующее действие = deny (fail closed). */
  acl: Partial<Record<Action, Rule>>

  /** Ограничения REST-поверхности (иначе дефолты консервативны). */
  limits?: Partial<Limits>
  /** 6. То, что обычно забывают — см. §5. */
  expose?: Expose
  hooks?: HooksDef
}

export type Action = "list" | "view" | "create" | "update" | "delete" | "restore" | "count"

export interface Rule {
  /** Условие доступа — AST-фильтр ядра, а не строка. true = публично, false = запрещено. */
  when: Filter
  /** Разрешённые поля. Массив — белый список; `"*"` — всё, что разрешено полем. */
  read?: readonly string[] | "*"
  write?: readonly string[] | "*"
  /** Значения, которые сервер ставит сам (владельчество, tenant). Клиент их не передаёт. */
  presets?: Record<string, PresetValue>
  /** Обязательные поля запроса (например, `confirm === true`). */
  require?: readonly string[]
  /** Максимум строк за вызов (для `list`/`update`/`delete` batch). */
  maxRows?: number
}

/** Значение из доверенного источника, а не из тела запроса. */
export type PresetValue =
  | { $principal: "id" }
  | { $principal: "roles" }
  | { $now: true }
  | { $const: unknown }
  | { $link: string; field: string }   // из связанной коллекции, см. §3.3
```

### Разбор пунктов заказчика

| Пункт | Как реализован |
|---|---|
| 1. Имя коллекции | `name` + `version`; валидируется регуляркой, идёт в `key` ядра (`${name}.v${version}`) → участвует в scope курсора |
| 2. SQL | `source.kind === "sql"`: компилируется в CTE/подзапрос, параметризуется; `writable` намеренно нет — через SQL-источник не пишут |
| 3. Связь параметров | `links` (§3): отношения, `exists`-условия и presetter `$link` |
| 4. created_at / updated_at / deleted_at | `timestamps` — три независимых переключателя, имена колонок свои; каждый даёт `generated: true` + `immutable` (клиент не пишет) и `deletedAt` включает `softDelete` + действие `restore` |
| 5. Права + поля на чтение/запись | `acl[action] = {when, read[], write[]}`; effective-маска = `(rule.read ∩ field.read)`, для записи `(rule.write ∩ field.create/update)` (§4.3) |
| 6. Что упущено | §5 — 10 пунктов, которые есть у аналогов и без которых ACL дырявый |

## 3. Связи (`links`): три разных вещи под одним словом

```ts
export type LinkDef =
  /** m:1 / 1:1 — FK у этой таблицы. Даёт include и валидацию значения. */
  | { kind: "foreign"; collection: string; localField: string; foreignField: string;
      onDelete?: "restrict" | "nullify" }
  /** 1:m / m:m — FK у той таблицы; m:m через junction. */
  | { kind: "referenced"; collection: string; foreignField: string; localField: string;
      junction?: { table: string; leftField: string; rightField: string } }
  /** Проверка «через третью таблицу» для ACL; значения клиента в ней быть не может. */
  | { kind: "exists"; collection: string; where: Filter; alias: string }
```

### 3.1 Чтение
`?include=author,team` → только имена из `links`, иначе `validation`. Каждый include
компилируется в `LEFT JOIN LATERAL (…)`, как уже делает ядро (`relations`), и **фильтр
политики связанной коллекции применяется внутри LATERAL** (ядро это уже делает: `policy.select`
цели) — то есть нельзя «разведать» содержимое скрытой коллекции через include:
получишь `null`, а не 403 (существование скрытой строки не протекает — то же
соглашение, что и для `delete` под `policy.deny()`).

### 3.2 Запись
`{ kind: "foreign" }` обязывает значение существовать и быть видимым: `insert` добавляет
`AND EXISTS (SELECT 1 FROM author WHERE id = $n AND (<политика author>)` — иначе `conflict`.
Без этого ACL обходят «привязал себя к чужому tenant».

### 3.3 Preset через связь
`presets: { tenantId: { $link: "membership", field: "tenantId" } }` +
`links.membership = { kind: "exists", collection: "memberships", where: {field:"userId", op:"eq", value:{$principal:"id"}}, alias: "m" }`
→ «пользователь пишет только в те tenant, где он состоит», выразимо без строк и без
самодельного SQL. Компилируется в `tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id = $1)`.

### 3.4 Временные колонки
`createdAt`/`updatedAt`/`deletedAt` — серверные: `generated: true`, `immutable: true`, в
любой `write`-маске они недоступны **даже у админской роли** (иначе `updated_at`
перестаёт быть аудиторским фактом). Нужен ручной ввод времени → отдельное действие
`admin:*` вне этой схемы, не маска.

## 4. Безопасность: 8 правил, каждое — с механикой, а не с надеждой

### 4.1 Никаких строк в правилах
PocketBase допускает `“@request.auth.id != ''”`, Directus — JSON-фильтры, PostgREST —
`?filter=eq.foo`. Все три требуют парсера, а парсер ACL — единственная точка, где ошибка
= обход прав. У нас уже есть AST `Filter` (`boolean | {field,op,value} | {and} | {or} | {not}`)
и его компилятор `filterSQL`, который: whitelist'ит поля по дескриптору ресурса,
операторы — по `field.filters`, значения — только параметры, глубину/узлы — по `limits`
(`filterDepth 8`, `filterNodes 100`). **ACL-правила — этот же AST и этот же компилятор.**
Новых парсеров не появляется; дыра в компиляторе ломает и клиентские фильтры, то есть
тестируется одним корпусом (что уже есть в `ported/db-lib`).

### 4.2 Политика всегда в `AND`
`WHERE (<policy.when>) AND (<клиентский filter>)` — порядок не важен, важно, что `or`
клиента не может «обогнуть» политику. Для `update/delete` предикат =
`(policy.update) AND (<фильтр запроса>) AND (mask-условия)`, как делает ядро в
`idWhere`/`where` сегодня.

### 4.3 Маска полей: пересечение, а не замена
```
readable(c, a)  = ∩? …   effective_read  = rule.read ∩ { f | grants(f.read, ctx) }
                          effective_write = rule.write ∩ { f | grants(f.create|update, ctx) }
```
ACL **сужает**, никогда не расширяет: поле, закрытое в коде (`read: () => false`),
не откроется никакой схемой. Неизвестное имя поля в `rule.read` = ошибка **загрузки
схемы**, а не рантайм (`validateSchema(collection, registry)` при старте) — опечатка в
схеме не должна превращаться в «поле видно всем».
Незапрошенное поле в ответе: `projection` строится из `effective_read`, `select` не
имеет пути обойти проекцию (`mandatoryRead` добавляет PK, он всегда в маске).

### 4.4 Mass assignment закрыт
`create`/`update` принимают **только** ключи из `effective_write`; лишний ключ →
`validation` + `publicFields` (список имён), а не тихое отбрасывание: тихая фильтрация
даёт «сохранил не то, что отправили». `presets` перетирают любые попытки клиента
(значение подставляется после валидации тела, до SQL).

### 4.5 Nothing-to-leak в ошибках
`authorize` возвращает только `forbidden`/`not_found` — без «нет такого поля», «политика
не совпала», «связь запрещена». Внутренняя причина идёт в `onError`-наблюдатель (серверные
логи), не в ответ. 404 vs 403: **неаутентифицированный → 401, аутентифицированный без
права на конкретную строку → 404** (существование не подтверждается). Правило фиксируется
тестом «скрытая строка неотличима от отсутствующей» — для всех шести действий.

### 4.6 Доверенные константы — не строки
`{$principal:"id"}` — маркер, который `filterSQL` превращает в **параметр** из
`ctx.principal.id`; клиентский JSON не может содержать объект этого вида, потому что
`inputRecord` уже отвергает `toJSON`/геттеры/прототипные ключи (перенесённая защита
источника), а `value` обязан быть скаляром/массивом скаляров.

### 4.7 Перечисление коллекций — тоже ACL
`GET /api/rest` отдаёт только коллекции, у которых у данного principal есть хотя бы одно
действие с непустой `when !== false` (Directus `fetchAllowedCollections` так же). Схема
не публикуется целиком: `GET /api/rest/{c}/schema` отдаёт **только** `fields ∩
effective_read`, допустимые операторы, `links ∩ видимые коллекции`, и ничего про
`presets`/`when` (иначе клиент узнает, как выглядит проверка владельца → задача подбора id).
Эндпоинт схемы включается `expose.schema: true` (по умолчанию off).

### 4.8 Бюджеты и скорость
На каждый вызов: `maxRows` (default 100, hard = `limits.maxPageSize`), `inValues 100`,
`inputKeys 64`, `filterDepth 8` — всё из `conservativeLimits`; плюс на auth-действия —
скользящее окно `authorize({rate: {...}})` (см. §5.6). Отсутствие лимита = вектор
«один запрос = полный скан + N LATERAL».

## 5. Пункт 6 заказчика («что-то я упустил») — что добавляем сразу

| # | Что | Откуда это у аналогов |
|---|---|---|
| 1 | **`presets`** (принудительные значения) | Directus presets; PocketBase «CreateRule auto-set author» |
| 2 | **`require`** — обязательные поля действия | PB `@request.data.*`; иначе «согласие» приходит молча отсутствующим |
| 3 | **`manage`** — отдельное действие для правки чужого (admин-режим) | PB `manageRule`; без него роль «editor» неизбежно получает `update` на чужое |
| 4 | **`count` как отдельное действие** | PostgREST `Prefer: count` — дорогой запрос, права свои |
| 5 | **`restore` вместо «обнови deleted_at»** | чтобы право восстановить запись не смешивалось с правом на редактирование |
| 6 | **`expose.constraints`** — какие SQLSTATE-констрейнты можно показывать | уже есть в `Resource.constraints`; без этого дедуп-ошибка = утечка схемы |
| 7 | **`status`-скоупы** (draft/published в одном наборе правил) | Directus `status` в permissions |
| 8 | **`rate`** — окно на действие | у PB/Directus нет; у нас auth-эндпоинты без него непригодны |
| 9 | **`If-Match`/`updatedAt`-конфликт** → 409 `conflict` | Directus validation; без него lost-update в REST |
| 10 | **аудит-лог мутаций** (`requestId` уже есть в `DataContext`) | у PB — в ядре; у нас `hooks.afterCommit` покрывает |

## 6. Версия, кэш, миграции

- `version` + канонический JSON-хэш схемы (`schemaHash`, сортировка ключей) → участвуют:
  1) в `resource.key` (`posts.v3.<hash8>`), значит в **scope курсора** — курсор со старой
     схемой отсекается (`cursor` → 400), а не перечитывается с новыми правами;
  2) в ключе кэша скомпилированного предиката;
  3) в `ETag` ответа `view` (дешёвый optimistic-concurrency: `If-Match` → 409).
- Схема живёт в коде (TS) и/или в JSON в `collections/*.json`; в БД — только сама БД.
  Причина: ACL как таблицы (Directus) требует миграций на каждое изменение прав и
  даёт окно «права изменились, кэш старый». Если понадобится admin-UI — схема
  ложится в таблицу `kit_collection_acl` поверх того же валидатора, но это отдельный
  этап (вопрос Q1 в чате).
- `validateSchema()` вызывается при старте процесса и в тестах; ошибки — бросок, а не
  лог: приложение с дырявой схемой не поднимается.

## 7. REST-контракт

```
GET    /api/rest/{collection}            list   ?fields&filter&order&page&limit&include&after
GET    /api/rest/{collection}/{id}       view
POST   /api/rest/{collection}            create
PATCH  /api/rest/{collection}/{id}       update
DELETE /api/rest/{collection}/{id}       delete (soft, если timestamps.deletedAt)
POST   /api/rest/{collection}/{id}/restore   restore
POST   /api/rest/{collection}/-/count    count
GET    /api/rest                          список доступных коллекций
POST   /api/rest/users/signup | /signin | /signout | /forgot | /reset | /verify-email
```

Тела/ответы: `{data}` | `{code, message, fields?}`; ошибки — ровно `toKitError`-форма
из `./sveltekit`, чтобы UI не различал транспорт. `filter` — тот же JSON-AST, что и в
`parseListInput` (`?filter={"and":[…]}`), новых операторов REST не вводит.

## 8. Auth-коллекция `users`

```ts
auth: {
  passwordField: "password",            // никогда не в read-маске, никогда в ответах
  identity: "email",                    // нормализуется: trim + lowercase (Unicode NFKC)
  /** scrypt есть только в node:crypto; WebCrypto его не поддерживает. Поэтому
   *  хешер внедряется: createScryptHasher() — из ./sveltekit/node (Node/Vercel),
   *  createPbkdf2Hasher() — universal (Workers/PGlite-тесты), PBKDF2-HMAC-SHA256. */
  hash?: { kind: "scrypt"; N: number; r: number; p: number; keyLen: number }
       | { kind: "pbkdf2"; iterations: number; keyLen: number }
  token: { kind: "hmac", ttlSeconds: 900, once: true },           // для reset/verify
  session: { kind: "cookie", name: "sid", ttlSeconds: 2592000, sameSite: "lax" },
  verify: { required: false },
  rate: { signin: { max: 5, windowSeconds: 60 }, forgot: { max: 3, windowSeconds: 600 } },
}
```

Правила, которые ломают 90% самодельных auth:

1. `signin` отвечает **одинаково** на «нет такого пользователя» и «неверный пароль»
   (401 `invalid_credentials`), время тоже сравниваем постоянно: хэш всегда считается,
   даже если пользователь не найден (по фиктивному солту).
2. `forgot` всегда 202 «письмо отправлено, если адрес зарегистрирован». Никаких
   «такого email нет» — иначе REST = база подписчиков.
3. В БД — **хэш токена**, не токен; одноразовый `used_at`, привязка к `identity` +
   `sessionId`, TTL 15 минут.
4. Все auth-действия идут **мимо** `acl` данных коллекции (`acl` описывает CRUD над
   строками), но **через** `authorize({action: "auth:signin"})`, чтобы rate-limit,
   аудит и `signal` были в одном месте.
5. Смена email/пароля — `manage`-право или подтверждение текущим паролем; «забыл
   пароль» ≠ «смени пароль» (разные токены, разные TTL).
6. Rate-limit в памяти процесса — это потолок «до первого горизонтального
   масштабирования»; документировать честно (или `pg`-таблица, см. Q3).

## 9. Минимальные правки в порту (чтобы ядро осталось диффимым)

| Что | Где | Объём |
|---|---|---|
| `filterSQL` должен понимать `{$principal:"id"}` в `value` | `src/lib/db/query/sql.ts` | ~15 строк, один новый узел в ветке значений |
| `projection` по явному белому списку + `mandatoryRead` | уже есть | 0 |
| `restore` = `update` c `deletedAt IS NOT NULL` | `src/lib/db/resource.ts` | +1 метод (или `mutate(ctx,'restore')`) |
| `schema.ts`/`validation.ts`: поле `writeMask` не нужно — маски живут в ACL | — | 0 |
| Новый вход `$lib/db/rest`: `defineCollection`, `validateSchema`, `authorize`, `handleRest(req, {registry, ctx})` (framework-agnostic, возвращает `Response`) | `src/rest/**` | новый код, ядро не трогает |
| SvelteKit-тонкость: `export const handle` → `/api/rest/**` через `dbHandle({paths})` + `+server.ts`, который вызывает `handleRest` | `src/lib/db/sveltekit/**` | ~20 строк |

Ядро **не** импортирует `@sveltejs/kit` и `node:crypto` в universal-входе. Это важно и
для паролей: `scrypt` есть только в `node:crypto`, в WebCrypto его **нет** — универсальный
вариант `PBKDF2-HMAC-SHA256` через `crypto.subtle.deriveBits`. Отсюда два хешера и два
входа (`sveltekit/node` → scrypt, universal → pbkdf2), а `structure.check.mts` сторожит,
чтобы `node:crypto` не уехал в universal-код.

## 10. Приёмочные тесты ACL (что значит «безопасно»)

1. **Матрица 6 действий × 4 субъекта** (guest / owner / member / admin) × `visible` vs
   `hidden`: каждый непроходной случай обязан дать ровно ожидаемый код (401/403/404/409)
   и **не изменить БД** (проверка `count` до/после).
2. **Фаззинг query-строк** (`?filter=`, `?order=`, `?fields=`, `?include=`): 200
   мутаций против эталонного «политика+фильтр» SQL → ни одна не расширяет видимое
   множество (инвариант: `rows(mutation) ⊆ rows(no-mutation)`).
3. **Cross-collection leak**: скрытая коллекция не определяется ни через `include`,
   ни через `exists`-пресет, ни через 404-оттенки.
4. **Mass assignment**: каждое поле вне `effective_write` в теле → 422 со списком полей;
   `createdAt/updatedAt/deletedAt` — всегда вне.
5. **Cursor replay**: курсор, выпущенный под `v1`, под `v2` (смена маски) → 400, а не
   данные.
6. **Auth**: 200 одинаковых «нет пользователя» vs «неверный пароль» — разница по времени
   < 5 ms (в песочнице — относительная проверка, не абсолютная); одноразовость токена;
   TTL; переиспользование старого токена после смены пароля (сессионный generation).
7. **Structure**: во всех файлах `src/rest/**` есть вызов `authorize`, и ни одного
   импорта `db.resource`/`Sql`/`filterSQL` напрямую (grep-тест, как уже сделано для
   `node:`-импортов).
8. Прогон **на реальном PostgreSQL 17** (уже поднят в песочнице, см. `CHECKLIST-2.md` §0):
   вся матрица × `pg`, × `hyperdrive`, × `juit-http`, × `juit-ws` — потому что «policy в
   WHERE» обязан вести себя одинаково у всех четырёх транспортов.

## 11. Вопросы и их статус (ответы заказчика — 2026-10-09)

Q1 — где живёт схема: TS-код / JSON-файлы / таблица в БД (admin-UI).
Q2 — REST-поверхность: один generic-роут с реестром или генерируемые типобезопасные роуты.
Q3 — auth: свой минимум в пакете (scrypt + cookie-сессии) или только «крюки», а
пользователей ведёт приложение/Better-Auth.
Q4 — объём адаптеров и «своей БД» на Vercel/Cloudflare: документация + `neon http/ws`
адаптер, или также `pgproxy`-адаптеры источника (Juit) как публичный вход.

---

## 12. Схема в БД + кэш в памяти: как это работает (решение Q1)

### 12.1 Хранилище

```sql
-- 003-kit-acl.sql
CREATE SCHEMA IF NOT EXISTS kit;

CREATE TABLE IF NOT EXISTS kit.collection (
  name        text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{1,39}$'),
  version     int  NOT NULL CHECK (version > 0),
  schema      jsonb NOT NULL,            -- CollectionSchemaV1: поля, links, timestamps
  acl         jsonb NOT NULL,            -- {action: {when:<AST-фильтр>, read, write, presets}}
  schema_hash text NOT NULL,             -- канонический sha256 от (version, schema, acl)
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by  uuid
);

-- единственный источник «протух ли кэш»: одна строка, один int8
CREATE TABLE IF NOT EXISTS kit.acl_epoch (
  id     int PRIMARY KEY CHECK (id = 1),
  epoch  bigint NOT NULL,
  bumped_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO kit.acl_epoch (id, epoch) VALUES (1, 1) ON CONFLICT DO NOTHING;

-- любое изменение kit.collection обязано задеть epoch — иначе кэш не узнает об изменении
CREATE OR REPLACE FUNCTION kit.acl_touch() RETURNS trigger AS $$
  UPDATE kit.acl_epoch SET epoch = epoch + 1, bumped_at = clock_timestamp() WHERE id = 1;
  RETURN NEW;
$$ LANGUAGE sql;
CREATE TRIGGER kit_collection_touch AFTER INSERT OR UPDATE OR DELETE ON kit.collection
  FOR EACH STATEMENT EXECUTE FUNCTION kit.acl_touch();
```

Почему `epoch`, а не «перечитать все строки»: проверка актуальности стоит один `SELECT
epoch FROM kit.acl_epoch WHERE id = 1` (индекс не нужен, одна строка, кэш-дружественно),
и она **не зависит** от числа коллекций.

### 12.2 Кэш и «обновится сам» — четыре канала, по возрастанию надёжности

| # | Канал | Задержка | Где работает | Что даёт |
|---|---|---|---|---|
| 1 | **`epoch` внутри транзакции записи** | 0 (в рамках текущей операции) | везде | **корректность** |
| 2 | `LISTEN kit_acl` + `NOTIFY` на *выделенном session-соединении* | ~мс | только Node/direct-connection | оперативность отзыва |
| 3 | `POST /-/schema/refresh` (admin) | по запросу | везде | точечный сброс + `NOTIFY`, если канал 2 есть |
| 4 | TTL (default 30 с, jitter ±20%) | ≤ TTL | везде | универсальный floor, если ничего нет |

Главное, что стоит понять про подписку:

> **Подписаться на таблицу в PostgreSQL нельзя; `LISTEN` — это отдельное постоянное
> session-соединение, и на целевых платформах оно недоступно.** Cloudflare Hyperdrive
> официально не поддерживает `LISTEN`/`NOTIFY`, advisory locks и любой per-session state
> ([docs](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/));
> в transaction-mode пулерах (PgBouncer/Neon `-pooler`/Supavisor) `LISTEN` тоже
> нерабочий, потому что соединение отдаётся на одну транзакцию. Значит канал 2 можно
> делать только как **опциональное ускорение**, и он обязан отсутствовать без изменения
> семантики — что у нас и так принцип (ядро построено transaction-pool-safe, PORTING §3).

Поэтому корректность держится на канале 1, а не на подписке:

```
read  (list/view/count): снимок реестра, актуальный ≤ TTL. Отзыв права виден не сразу.
write (create/update/delete/restore): внутри той же транзакции, что и мутация:
        SELECT epoch FROM kit.acl_epoch WHERE id = 1 FOR NO KEY UPDATE;  -- сравнить со своим
        если изменился → DbFailure('transaction') → повтор с новым снимком (≤ 2 раза)
```

Смысл: операция, начатая со «старым» снимком, **не может** закоммититься поверх отзыва
права — она либо откатится, либо применит новый снимок. Для чтения такая строгость не
платится (двойной round-trip на каждый GET того не стоит, а утечка ограничена TTL и
обсуждается отдельно: можно потребовать `maxAclStalenessMs` у чувствительных коллекций —
тогда канал 1 включается и для чтения; **открытый вопрос к заказчику**).

### 12.3 Свойства реестра

- **Атомарность снимка**: `registry = Object.freeze({byName, epoch, builtAt})`; сборка идёт
  в побочном промисе, подмена — одна присваивание ссылки. Запрос, начатый на старом
  снимке, дорабатывает на нём (иначе «политика поменялась в середине запроса» = дыра).
- **Отказ при битой схеме**: если `validateSchema()` на новой строке падает — кэш остаётся
  на прошлом валидном снимке, ошибка идёт в `onError` + `X-Kit-Acl-Stale: true` в ответе
  admin-эндпоинта. Дырявая схема не должна уметь «выключить» ACL ценой синтаксиса.
- **Отрицательный кэш**: неизвестная коллекция = 404 на время TTL (не SQL-запрос на каждый
  спам-запрос).
- **Кэш компиляции**: `(name, version, schema_hash)` → собранный `Resource` + предикаты.
  Ресурсы источника (те, что в TS) сосуществуют: `defineCollection` компилирует строку БД
  в `defineResource` + policy-колбэки, читающие снимок.
- **Кто изменяет `kit.collection`**: только сервисный путь (`/api/admin/collections` с ролью
  `manage`), и он же в той же транзакции обновляет `epoch = epoch + 1` (триггер делает это сам).
  Прямой доступ приложения к `kit.*` закрыт `policy.deny()` на отдельном «системном»
  ресурсе: иначе «создай себе коллекцию с `when: true`» = обход всей схемы.

### 12.4 Миграции и доставка

- `003-kit-acl.sql` — в `src/lib/db/migrations/` пакета, прогон через `applyMigrationText` (один
  BEGIN/COMMIT). Таблицы `kit.*` не содержат данных пользователей.
- Начальное заполнение — seed-скрипт приложения (`collections/*.json` → `INSERT`),
  чтобы «схема в БД» не означала «в свежей БД нет прав вообще»: без строк ACL = deny, и
  приложение выглядит живым, но отвечает 404 на всё. Проверка на старте: если
  `count(kit.collection) = 0` и REST включён — `warn` в observer (не бросок: миграция
  могла ещё не быть применена).
- Типы: `GET /api/rest/-/registry` отдаёт `{name, version, fields: <read-маска>, actions}` —
  из него генерируется типизированный клиент (`npx kit-db codegen > rest-registry.d.ts`),
  что и закрывает Q2 «а что лучше, если коллекции создаются через БД»: generic-роут +
  реестр, а **типы — из снимка реестра, по требованию**, а не из файлов роутов.

### 12.5 Что меняется в §7 (REST) из-за решения Q1

```
GET    /api/rest/-/registry                 список доступных коллекций (ACL-filtered)
GET    /api/rest/{collection}               list      — тот же parseListInput
POST   /api/rest/{collection}               create
PATCH  /api/rest/{collection}/{id}          update
DELETE /api/rest/{collection}/{id}          delete
POST   /api/rest/{collection}/{id}/restore  restore
POST   /api/rest/{collection}/-/count       count
POST   /api/admin/collections[/{name}]      create/update коллекции (роль manage) + bump epoch
POST   /api/admin/-/refresh                 сброс кэша (NOTIFY, если канал 2 доступен)
```

`/api/rest/**` и `/api/admin/**` — два разных `paths`-скоупа в `dbHandle`, чтобы
generic-роут не тянул сессию на модалки и статику (тот же приём, что в демо `/db-demo`).

---

## 13. Кейс «коллекция как Шикимори»: составная коллекция (проверено на реальном PG 17)

Запрошенная модель: теги закреплены за категорией, категории — за юзером, аниме — за
категорией; конечная коллекция содержит SQL, соединяющий таблицы, и отдаёт список
аниме за юзером. Это **проверенный** сценарий, а не гипотеза: `src/lib/db/probes/shikimori-view.probe.mjs`
поднимает схему в реальном PostgreSQL 17 и гоняет её через публикуемое `dist` порта
(`node src/lib/db/probes/shikimori-view.probe.mjs` → `PROBE_OK`).

### 13.1 Как это выглядит в схеме

```jsonc
// shiki.user_anime — «составная коллекция»; источник — VIEW, не таблица
{
  "name": "user_anime", "version": 1,
  "source": { "kind": "table", "table": "shiki.v_user_anime" },
  "primaryKey": "id",
  "fields": {
    "id":          { "schema": "uuid",  "read": true, "immutable": true, "orderable": true, "filters": ["eq","in"] },
    "user_id":     { "schema": "uuid",  "read": true, "filters": [] },
    "category_id": { "schema": "uuid",  "read": true, "write": true, "filters": ["eq","in"], "orderable": true },
    "category":    { "schema": "text",  "read": true, "filters": ["eq","contains"], "orderable": true },
    "title":       { "schema": "text(1..120)", "read": true, "write": true, "required": true, "filters": ["eq","contains","startsWith"], "orderable": true },
    "kind":        { "schema": "text",  "read": true, "write": true, "filters": ["eq"] },
    "rating":      { "schema": "decimal", "read": true, "write": true, "nullable": true, "filters": ["gt","gte","lt","lte"] },
    "added_at":    { "schema": "timestamptz", "read": true, "generated": true, "orderable": true },
    "tags":        { "schema": "jsonb", "read": true, "filters": [] }
  },
  "timestamps": { "createdAt": "added_at" },
  "acl": {
    "list":   { "when": { "field": "user_id", "op": "eq", "value": { "$principal": "id" } },
                "read": "*", "write": ["title", "kind", "rating", "category_id"] },
    "view":   { "when": { "field": "user_id", "op": "eq", "value": { "$principal": "id" } } },
    "create": { "when": true, "require": ["title", "category_id"] },
    "update": false,
    "delete": { "when": { "field": "user_id", "op": "eq", "value": { "$principal": "id" } } },
    "restore": false
  }
}
```

```sql
CREATE VIEW shiki.v_user_anime AS
SELECT ac.anime_id AS id, ac.user_id, ac.category_id, c.name AS category,
       a.title, a.kind, a.rating, ac.added_at,
       COALESCE((SELECT jsonb_agg(t.name ORDER BY t.name)
                   FROM shiki.category_tags ct JOIN shiki.tags t ON t.id = ct.tag_id
                  WHERE ct.category_id = ac.category_id), '[]'::jsonb) AS tags
  FROM shiki.anime_categories ac
  JOIN shiki.categories c ON c.id = ac.category_id
  JOIN shiki.animes a ON a.id = ac.anime_id
 WHERE ac.removed_at IS NULL;
```

### 13.2 Что показал прогон (пять решений, которые иначе пришлось бы угадывать)

1. **Составная коллекция = VIEW, а не «SQL с параметром»** — ядро компилирует фильтры,
   сортировку, проекцию и `count` против `table(r)`, и вьюха для него не отличается от
   таблицы. Скомпилированный запрос из прогона:
   `… FROM "shiki"."v_user_anime" WHERE ("…"."user_id" = $1) AND (TRUE) AND (TRUE)
   ORDER BY "…"."id" ASC NULLS LAST LIMIT $2 OFFSET $3` — скоуп юзера пошёл **параметром из
   `ctx.principal`**, как и у обычной таблицы. Отсюда правило для схемы: `source.kind:"sql"`
   остаётся лазейкой на крайний случай для редких случаев, а нормальный путь составной коллекции — `view` +
   обычная `policy`. Вьюха обязана отдавать `user_id` колонкой (иначе политике не за что
   цепляться), и `count` над ней бесплатен (в `count` нет `include`/проекции).
2. **Запись в составную коллекцию возможна и без «двух API»**: `INSTEAD OF INSERT/DELETE`
   на вьюхе + `SELECT set_config('kit.user_id', $1, true)` в начале транзакции. Проверено:
   строка появилась у u1 (3 записи), у u2 — 0; открепление сработало как мягкое удаление
   связи, аниме в `shiki.animes` осталось. Смысл для схемы: **кто пишет, приходит из
   транзакции, а не из тела запроса** — того же принципа, на котором PostgREST/Supabase
   держат jwt-claims. Значит в `CollectionSchemaV1` нужен `writeThrough`:
   `{ kind: "trigger", session: { "kit.user_id": { $principal: "id" } } }`, и `insert`
   обязан выполняться **внутри `db.transaction`** (иначе GUC не установлен → 42501).
3. **Отказ прав на стороне БД должен быть 403, а не 500.** Триггер кидает
   `ERRCODE 42501`, и в первом прогоне это приехало как `database`/500 — «внутренняя
   ошибка» вместо «нельзя». Исправлено в `normalizeFailure` (`42501`, `42502` →
   `forbidden`) + тест «SQLSTATE отказа прав идёт в forbidden» (16-я проверка
   `port-specific`), прогон подтвердил: теперь `403/forbidden`, и в теле по-прежнему нет
   ни SQL, ни имени триггера.
4. **«Аниме с тегом X» за один запрос сегодня невозможно** — и это не баг, а пробел
   формата. Два факта из прогона: (а) `relations` ядра дают **одну** связанную строку
   (`LEFT JOIN LATERAL … LIMIT 1`), поэтому «много тегов» живёт не в `include`, а как
   агрегатная колонка вьюхи (`jsonb_agg` → поле `kind:"json"`); (б) отфильтровать по тегу
   можно только через отдельный запрос к `category_tags` и последующий `in` — ровно то,
   ради чего в схеме `links.exists`: компилируется в
   `EXISTS (SELECT 1 FROM shiki.category_tags ct WHERE ct.category_id = x.category_id AND ct.tag_id = $1)`
   и **не отдаёт строк связки** (в прогоне связка приходится отдельной коллекцией с
   собственным `policy.select` — заметим, что это дыра в перечислении, если её открыть).
   Альтернатива, если нужен именно `?tags.has=[a,b]` по массиву: оператор `overlaps`
   (`&&`) для `kind:"json"`-полей; решение отложено до момента, когда станет ясно, что
   чаще встречается — `exists` покрывает и m:m без новых операторов.
5. **Проекция молча сужается, а не отвергается.** `readable()` фильтрует `?fields=` по
   `own(fields) && grants(read)`, поэтому `(SELECT 1)`/`password_hash` просто отбрасываются
   — утечь нечему (проверено: в запросе остались только `id` и `title`), но опечатка
   клиента превращается в «меньше колонок». Для ядра это оставляем как есть (безопасно и
   совпадает с источником), а **REST обязан** отдавать 422 на неизвестное имя: поле `expose.strictFields`
   (default `true`) и проверка по `fields` коллекции в `handleRest`.

### 13.3 Что из этого следует для остальных пунктов схемы

| Место | follow-up после прогона |
|---|---|
| §2 `source` | добавить `kind:"view"` (то же, что `table`, но с `writeThrough`-блоком) и явно сказать: `sql` — только read-only |
| §3 `links.exists` | становится основным способом фильтра «по связи»; требует разрешения на **чтение** целевой коллекции без отдачи строк (`EXISTS` компилируется против linked collection, её `policy.select` учитывается) |
| §3.4 timestamps | `added_at` во вьюхе = `generated: true` (проверено), а `removed_at` **не** попадает в projection составной коллекции: иначе клиент увидит дату открепления скрытой строки |
| §4.8 бюджеты | `in`-фильтр по «категориям с тегом X» ограничен `inValues 100` → при больше 100 категорий запрос обязан разбиваться или отказывать (в прогоне 1–2, лимит стоит проверить тестом) |
| §10 тесты | матрица × составная коллекция + `pg`-индексы: `(user_id, removed_at, added_at DESC, anime_id)` на связке и `(tag_id, category_id)` для `EXISTS` — иначе keyset по вьюхе деградирует в сортировку всего результата |

### 13.4 Три вопроса про составную коллекцию (ответы = прогон, а не рассуждение)

**В: можно ли этой же коллекцией фильтровать («только теги/студии X»), или это «просто список»?**
О: фильтруется наравне с табличной — любой столбец вьюхи с объявленным `filters`
(`eq/ne/lt/lte/gt/gte/in/notIn/isNull/isNotNull/contains/startsWith`), политика подмешивается
в тот же `WHERE` до клиентского фильтра, и `count` / `ORDER BY` / `page` / keyset работают по
колонкам из JOIN. Проверено: `startsWith` по `title` = 2, `gte` по `rating` (numeric) = 1,
`lte` по `episodes` = 1, `contains` по `note` (колонка самой связи) = 1, вложенный `and` =
ровно «Фрирен», `count(kind='tv')` = 2, `ORDER BY rating DESC` первым даёт `9.2`, страница
2/2 и keyset-`after` — корректные хвосты. Два ограничения, которые надо зафиксировать в
реализации: (1) `contains`/`startsWith` = `LIKE` со **значимым регистром** и экранированием
`%`/`_` (`ILIKE` в ядре нет — при необходимости это отдельный оператор, а не «настройка»);
(2) m:m (теги, студии) — не столбец, а **отдельный шаг**: `category_tags`/`anime_studios` →
`in` по id; ради одного запроса и введён `links.exists` (компилируется в `EXISTS`, строк
связки не отдаёт). Агрегат-колонку (`tags`, `studios`) показывать можно, фильтровать по ней
нельзя, пока нет оператора (`overlaps` для jsonb-массивов).

**В: эта коллекция не будет поддерживать insert/update/delete?**
О: поддерживает все три, но с шестью обязательными условиями (каждое — из прогона):

| # | условие | чем объяснено |
|---|---|---|
| 1 | у связи **суррогатный `id`** (одна колонка = `primaryKey`) | `UNIQUE(anime_id, category_id)` адресовать строку не даёт: ядро бьёт по `id`, а «аниме во всех категориях юзера» — уже другой смысл |
| 2 | запись внутри `db.transaction` + `set_config('kit.user_id', $1, true)` | иначе `v_claim()` = NULL → `42501` → 403; «анонимной» записи не бывает |
| 3 | `INSTEAD OF INSERT` обязан вернуть `NEW` с заполненными `id`/`anime_id` | `RETURN NEW` без присваивания → `insert()` вернёт `id: null`, и клиент потеряет ключ |
| 4 | вычисляемые колонки в ответе записи = `null` | `tags`/`studios`/`added_at` считаются вьюхой, а `RETURNING` триггерной вьюхи отдаёт `NEW`; нужен ре-SELECT, если UI ожидает массив сразу |
| 5 | `softDelete`/`restore` — на **одно-табличной** вьюхе связи, не на join-вьюхе | ядро пишет метку `UPDATE … SET removed_at`; на вьюхе с JOIN это `error_view_not_updatable` (проверено), а простую вьюху PostgreSQL обновляет сам |
| 6 | `validateFinal`/`hooks` на join-вьюхе — можно | пред-чтение `SELECT … FOR UPDATE` PostgreSQL разрешает (блокируются строки базовых таблиц): update с валидной схемой + `beforeWrite` прошёл, hook получил `before` |

Отдельно про «корзину»: `includeDeleted: true` **не означает** «только удалённые» — оно
означает «не скрывать». Список удалённых = `includeDeleted: true` + `filter isNotNull` по
полю метки, и всё это под грантом `softDelete.readDeleted` (без него `includeDeleted` = 403
на любое обращение). В схеме ACL это отдельный флаг `restore.visible`/грант, а не «доступно
всем, у кого есть delete».

**В: что если политика запрещает отдавать поля тегов (кроме `name`)? Конечная коллекция
вернёт запретное или join использует `name`, а не `*`?**
О: **вернёт только разрешённое — `SELECT *` в ядре не генерируется никогда.** Связь
собирается как

```sql
LEFT JOIN LATERAL (
  SELECT jsonb_build_object($2::text, c."id", $3::text, c."user_id", $4::text, c."name",
         $5::text, to_char(c."created_at" AT TIME ZONE 'UTC', …)) AS payload
    FROM "shiki"."categories" c
   WHERE c."id" = v."category_id" AND (TRUE)   -- политика связанной коллекции
   LIMIT 1
) …
```

т. е. список полей строит `readable(связанная_коллекция, ctx)` под **того же**
принципала: у пользователя в `include.categoryRef` keys = `created_at,id,name,user_id`,
`slug` (`read: ['staff']`) отсутствует; у того же юзера с ролью `staff` — тот же запрос
возвращает 5 полей. Сузить список запросом нельзя (`include` принимает только имена),
расширить — тем более; фильтр по staff-only полю = 403 (фильтром проверяют значение
вслепую, поэтому он строже проекции); явный `fields: ["slug"]` = тихое отбрасывание
(в проекции `slug` не появится — утечь нечему, но REST обязан отвечать 422, см. §13.2 п.5).

**Исключение, о котором надо помнить:** всё выше — про *отношения* (LATERAL). Для
агрегатной колонки вьюхи маска действует на **колонку целиком**: `jsonb_agg(t.name)`
выполняется внутри вьюхи до любой ACL-маски. В прогоне это видно как баг-доказательство:
приватный тег «взрослый» попал в `tags`, потому что вьюха его агрегировала. Значит
правило компилятора: в агрегат составной коллекции кладутся только поля, открытые **всем**,
кто видит коллекцию; чувствительные — либо фильтруются внутри вьюхи
(`WHERE t.visibility = 'public' OR …`), либо выносятся в отдельную коллекцию/вьюху
(`masks.selectView`). Проверять это должен `defineResource`-путь компиляции — и он теперь
падает на форме конфигурации (`softDelete` без `value`/`readDeleted`, `generated` +
write-маска, неизвестный оператор в `filters`, битые связи, `validateFinal` не-схема,
`order` по не-`orderable`) с причинами в `details.issues`: битая схема из `kit.collection`
= «коллекция не опубликована», а не 500 на первом запросе.
