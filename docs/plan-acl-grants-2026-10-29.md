# План: `defineAcl`, страж ACL, `grants`, `checkGrants` и `useGrants` (2026-10-29)

Статус: **реализовано и проверено на ветке `img` (`G1`: `14abf00`, `G2`: `aa71812`, `G3`: `ab33c0c`, `G4`: `14b0b61`, `G5`: документация в `src/lib/db/README.md`, `src/hooks/README.md`, `src/content/user/README.md`)**.

Документ сводит в одну систему четыре части:
1. **`defineAcl` и страж инвариантов ACL в `#lib/db`** — чтобы больше не разносить роли вручную по `select / insert / update / delete / hardDelete / readDeleted` и ловить дыры при объявлении модели (`defineResource`).
2. **`grants(resource)` и `checkGrants(actor, spec, options?)` в `#lib/db`** — единый источник прав из моделей и JSON-схем (`user.config`) с поддержкой массивов межмодельных связок (КНФ: `И` снаружи, `ИЛИ` внутри) и проверки за любого субъекта (`actor`) и владельца цели (`ownerId` / `forOwner`).
3. **`vault.permissions` и реактивный хук `useGrants(spec, options?)`** — синхронная проверка прав на SSR и клиенте (`0` лишних запросов в БД) с соблюдением границ `layer-guard` (`#lib/db` → `#hooks/db-grants.svelte.ts` → `#content/user`).
4. **Поэтапный перевод моделей, доменного кода и UI** (включая починку дыр ACL в `#lib/db`, `user.block`, `demo.post`, `user.profile`, `user.config` и доработку формы создания бана `1 + 3` с `field.multiselect`, `user.picker` и `<HoldButton>`).

---

## 1. Зафиксированные правила и решения владельца

### 1.1. Иерархия уровней доступа модели

1. **`read` (`select`)** — только чтение живых записей (`deleted_at IS NULL`).
2. **`insert`** — чтение живых записей **+** создание новых.
3. **`update` (без `delete`)** — чтение живых записей **+** изменение открытых маской полей, **без** права удаления. Законно **только** тогда, когда у модели есть защищённые поля, которые эта роль не может затереть (иначе обновление превращается в скрытое удаление данных).
4. **`softDelete` (мягкое удаление без права полного стирания)** — чтение живых записей **+** постановка метки `deleted_at` (только у моделей с `timestamps.deletedAt`). **Не даёт** права на физическое удаление (`hard: true`) и `restore` даже в сочетании с правом чтения удалённых (`deleted`). Пример — наёмный `moderator` в `user.block`: ошибочный бан он может снять (`until`) или мягко убрать в архив, но след (`by`, `reason`, `deleted_at`) стереть не может.
5. **`edit` (`update + delete`)** — чтение живых записей **+** изменение **+** удаление:
   - если у модели нет `deletedAt` — удаление сразу физическое;
   - если `deletedAt` есть — само по себе `edit` даёт мягкое удаление, а в связке с `deleted` открывает `restore` и окончательное физическое удаление (`hard: true`).
6. **`deleted` (`readDeleted`) — строго модификатор, а не самостоятельное право чтения:**
   - сам по себе `deleted` **не открывает чтение модели** (ни живых, ни удалённых строк);
   - если в системе завести сквозную роль вроде `"read_delete"` и вписать её в `deleted` нескольких моделей, сама по себе она не даст читать ни одну чужую модель;
   - чтение удалённых (`includeDeleted: true`) требует связки **`select` И `deleted`**;
   - окончательное удаление (`hard: true`) и восстановление (`restore`) у модели с мягким удалением требуют связки **`hardDelete` (`edit`) И `deleted`**.

### 1.2. Решения по конкретным моделям проекта

1. **Движок `#lib/db` (`src/lib/db/resource.ts`):**
   - Убирается обходное правило `selectDeleted`, из-за которого голое право `*.readDeleted` открывало чтение модели и сливало живые строки при `includeDeleted: true`. При `includeDeleted: true` всегда проверяются **и** `policy.select`, **и** `softDelete.readDeleted`.
   - В `Policy` добавляется опциональное правило `hardDelete?: (ctx: DataContext) => Filter` (по умолчанию при отсутствии равно `policy.delete`). При `delete(ctx, id, { hard: true })` на модели с `softDelete` движок требует **`policy.hardDelete` И `softDelete.readDeleted`**. Это гарантирует на уровне SQL-ядра, что роль из `softDelete` (например `moderator`) никогда не сотрёт запись физически, даже если получит роль чтения удалённых.
2. **`user.block` (`src/content/user/schema.ts`):**
   - `moderator` — наёмник с подконтрольным следом: читает живые, создаёт баны, снимает бан (`until`), может мягко удалить (`softDelete`), но **не может** править `reason` и **не может** физически удалить запись (`hard: true`).
   - Ошибочный `ownerOrRoles('auth_id', …)` убирается из `update` (владелец `auth_id` только читает свои живые баны).
   - Во все серверные правила и маски дописывается `'server'`.
3. **`user.auth.v1` и `user.session.v1`:**
   - Набор прав и работа через отдельные серверные функции **пока не меняются** (`docs/plan-auth-session-rights.md` остаётся отложенным до проектирования прав гостевой записи и UI сессий).
   - Единственная поправка в `auth` в связи с п. 1.1: убирается `selectDeleted` (в `accounts.ts` список удалённых аккаунтов и так уже требовал связку `account.read` + `account.readDeleted`, а шаг `restore` владельца работает системным контекстом `auth.ts`). Метки `policy.*` на `auth` и `session` позволяют `grants(auth)` сразу отдавать `auth.select`, `auth.selectDeleted` и `auth.relations.profile`.
4. **`user.config` (`src/content/user/schema.ts`, `src/content/user/config-api.ts`):**
   - Архитектура конфига сохраняется без ломки: строки без владельца (`auth_id IS NULL`) — глобальные умолчания из каталога со своей полной JSON-схемой владения ключом (`editDefault`, `assign`, `editUser`, `deleteUser`), новые глобальные ключи с улицы не создаются; строки с `auth_id = <uid>` — переопределения со своей упрощённой схемой (`editUser`, `deleteUser`).
   - В `schema.ts` две сырые стрелки `config.policy.{update,delete}` заменяются на `defineAcl`, а `config-api.ts` внутри `ruleAllows` переводится на общий `checkGrants` (динамическая `schema` ключа имеет ту же форму `Record<string, readonly string[]>`, что и выход модели).
5. **`demo.post.v1` и `user.profile.v1`:**
   - В `demo.post` чинится дыра `delete`: `ownerOrRoles('author_id', ['editor'])` вместо `roles(['author', 'editor'])` (чужой `author` больше не удаляет чужие посты, владелец может удалить свой).
   - `user.profile` переводится на `defineAcl` с `extend.select` для условия `profile.visibility` и явным `'server'` во всех операциях.

---

## 2. Конструктор `defineAcl` и страж инвариантов (`#lib/db`)

### 2.1. API `defineAcl` (`src/lib/db/acl.ts`, реэкспорт из `#lib/db/index.js`)

```ts
export type AclCapability = 'read' | 'insert' | 'update' | 'softDelete' | 'edit' | 'deleted'

export type AclRuleName =
  | 'insert-implies-select'
  | 'update-implies-select'
  | 'delete-implies-select'
  | 'hard-delete-implies-delete'
  | 'update-has-writable-field'
  | 'update-without-delete-needs-protected-field'
  | 'soft-delete-requires-deleted-at'

export interface AclInput {
  /** Публичное чтение живых строк (`publicRows()`). */
  readonly publicRead?: boolean
  /** Возможности владельца строки (`ctx.principal.id === row[field]`). */
  readonly owner?: {
    readonly field: string
    readonly can: readonly AclCapability[]
  }
  /** Только чтение живых записей (`select`). */
  readonly read?: readonly string[]
  /** Чтение живых + создание (`select` + `insert`). */
  readonly insert?: readonly string[]
  /** Чтение живых + обновление открытых полей БЕЗ удаления (`select` + `update`). */
  readonly update?: readonly string[]
  /** Чтение живых + мягкое удаление БЕЗ `hardDelete` (`select` + `delete`). */
  readonly softDelete?: readonly string[]
  /** Чтение живых + обновление + удаление + право на `hardDelete`/`restore` с `deleted`. */
  readonly edit?: readonly string[]
  /** Модификатор доступа к `deleted_at` (`softDelete.readDeleted`); сам чтения не даёт. */
  readonly deleted?: readonly string[]
  /** Расширение SQL-предиката поверх базового правила (например `profile.visibility`). */
  readonly extend?: {
    readonly select?: (base: Filter, ctx: DataContext) => Filter
    readonly update?: (base: Filter, ctx: DataContext) => Filter
    readonly delete?: (base: Filter, ctx: DataContext) => Filter
  }
  /**
   * Осознанные исключения для уникальных моделей с нестандартными правилами:
   * отключают только перечисленные проверки стража, оставляя остальные активными.
   */
  readonly allowAnomalies?: readonly AclRuleName[]
}
```

Что возвращает `const ACL = defineAcl(input)`:
- замороженный дескриптор `AclDefinition`, который передаётся в `defineResource({ ..., acl: ACL })`;
- готовые дедуплицированные списки ролей `ACL.roles.{select, insert, update, delete, hardDelete, deleted, edit}` — чтобы маски полей (например `reason: field(..., { create: BLOCK_ACL.roles.insert, update: BLOCK_ACL.roles.edit })`) брали роли из того же объекта без копипасты массивов.

При передаче `acl` в `defineResource`:
- автоматически генерируются меченые правила `policy.{select, insert, update, delete, hardDelete, restore}`;
- если у модели задан `timestamps.deletedAt` строкой (`deletedAt: 'deleted_at'`) или объектом без `readDeleted`, `acl.deleted` автоматически подставляется в `softDelete.readDeleted` (если `deleted` не задан — `[]`, т.е. удалённые никто не читает). Одновременное задание `acl` и ручного `policy` запрещено с понятной ошибкой валидации.

### 2.2. Логика стража инвариантов ACL (`validateResourceAcl`)

Страж запускается прямо внутри `defineResource(...)` — и для моделей с `acl: defineAcl(...)`, и для моделей со старым низкоуровневым `policy: { ... }` (если все его правила размечены фабриками `policy.*`; неразмеченные произвольные замыкания `(ctx) => …` страж не угадывает и пропускает без ложных падений, пока их не обернут в `policy.extend` или `defineAcl`).

Проверяемые аксиомы (каждую можно точечно погасить в `allowAnomalies` для уникальной модели):

| Код аксиомы | Что ловит | Почему не ломается на `moderator`, `block`, `config`, `auth` |
|---|---|---|
| `insert-implies-select` | Роль в `insert` отсутствует в живом `select` (при непубличном `select`). | В `defineAcl` выполняется по построению; в `auth`/`session`/`config` `'server'`/`'admin'` есть в `select` (исключение по умолчанию для чисто фонового `'server'`, если модель не читается вообще — не требуется, у всех моделей `'server'` читает). |
| `update-implies-select` | Роль (или `'owner'`) в `update` отсутствует в живом `select`. | В `defineAcl` выполняется по построению. |
| `delete-implies-select` | Роль (или `'owner'`) в `delete` отсутствует в живом `select`. | Сразу бы поймал старую ошибку `demo.post` и забытый `'server'` в `profile.select`. |
| `hard-delete-implies-delete` | Роль в `hardDelete` отсутствует в мягком `delete`. | Для `block`: `hardDelete = ['block.edit', 'admin', 'server'] ⊆ delete = ['moderator', 'block.edit', 'admin', 'server']` — проходит штатно. |
| `update-has-writable-field` | Роль (или `'owner'`) вписана в `policy.update`, но в `fields` нет **ни одного** изменяемого ею поля. | Сразу ловит фантомный `'owner'` в старом `block.policy.update` и `auth.policy.update`. *(Для `auth`, которую пока не трогаем по решению п. 3, либо меняем в `auth.policy.update` `ownerOrRoles` на `roles(['server', 'admin'])` — у владельца там и так `0` открытых на update полей, так что поведение 100% идентично, — либо помечаем в `allowAnomalies`.)* |
| `update-without-delete-needs-protected-field` | Роль (или `'owner'`) может делать эффективный `update`, не имеет `delete`, и при этом в модели **нет ни одного защищённого пользовательского поля**, которое она не может обнулить/переписать. | У `block` для `moderator` защищены `auth_id`, `scope`, `by` (`immutable: true`) и `reason` (`update: ['block.edit', 'admin', 'server']`) — модератор меняет только `until`, поэтому страж считает это **законным**! А в `profile` оба поля `nickname`/`avatar_url` nullable и открыты — попытка дать `update` без `delete` упадёт сразу. |
| `soft-delete-requires-deleted-at` | В `defineAcl` указаны `softDelete` или `deleted`, но у модели нет `timestamps.deletedAt`. | Защищает от опечатки, когда автор думал, что удаление мягкое, а таблица удаляет строки физически. |

---

## 3. Извлечение прав `grants(resource)` и чистая проверка `checkGrants` (`#lib/db`)

### 3.1. Представление правил (КНФ без лишних обёрток)

- **`GrantAtom`** — строка роли из `principal.roles`, плюс два зарезервированных маркера:
  - `'*'` — публичный доступ (`policy.publicRows()` или маска поля `() => true` / `undefined`), проходит для любого субъекта (включая гостя);
  - `'owner'` — срабатывает, когда `actor.id !== null && ownerId !== null && actor.id === ownerId`.
- **`GrantClause` (`readonly string[]`)** — одно дизъюнктивное правило (**ИЛИ**): субъект проходит клаузу, если подходит хотя бы один атом (`[]` = `policy.deny()`, не проходит никто; `null` = правило задано неразмеченной функцией и статически неизвестно).
- **`GrantSpec`** — единый вход для `checkGrants` и `useGrants`:
  - одиночная `GrantClause` (`['admin', 'owner']` — в том числе напрямую из JSON-поля `user_config.schema.assign`!);
  - составная цепочка модели (массив клауз `[clause1, clause2]` — **И**);
  - привязанное к конкретному владельцу требование `forOwner(ownerId, spec)` (чтобы внутри одного массива смешивать адресные проверки с глобальными справочниками без утечки `'owner'`);
  - произвольно вложенный массив `readonly GrantSpec[]` — **конъюнкция (`И`) всех элементов**: возвращается `true` тогда и только тогда, когда субъект проходит **каждый** элемент массива.

Пример межмодельной связки:
```ts
// true, если у субъекта выполнено право select модели A (напр. есть 'test')
// И одновременно выполнено право insert модели B (напр. есть 'test2'):
checkGrants(actor, [grants(modelA).select, grants(modelB).insert])
```

### 3.2. Что возвращает `grants(resource)` (мемоизация через `WeakMap<Resource, ModelGrants>`)

`grants(resource)` один раз вычисляет и кэширует полную карту эффективных прав модели с учётом всех связок самого движка `#lib/db`:

```ts
export interface ModelGrants<F extends Fields = Fields, R extends Relations = Relations> {
  /** Живое чтение: policy.select И наличие хотя бы одного читаемого поля. */
  readonly select: GrantChain
  /** Чтение удалённых (`includeDeleted: true`): policy.select И softDelete.readDeleted. */
  readonly selectDeleted: GrantChain
  /** Создание: policy.insert И объединение масок create записываемых полей. */
  readonly insert: GrantChain
  /** Обновление: policy.update И объединение масок update изменяемых полей. */
  readonly update: GrantChain
  /** Удаление по умолчанию (мягкое при наличии softDelete, иначе физическое). */
  readonly delete: GrantChain
  /** Физическое удаление (`hard: true`): при softDelete — policy.hardDelete И readDeleted, иначе delete. */
  readonly hardDelete: GrantChain
  /** Восстановление мягко удалённой строки: (restore ?? hardDelete) И readDeleted. */
  readonly restore: GrantChain
  /** Права по каждому полю модели с уже включённой политикой операции ресурса. */
  readonly fields: {
    readonly [K in keyof F]: {
      readonly read: GrantChain
      readonly create: GrantChain
      readonly update: GrantChain
    }
  }
  /** Чтение связанных моделей (`include` / `exists` по связи): select источника + localField.read + select цели. */
  readonly relations: {
    readonly [K in keyof R]: GrantChain
  }
  /** Чтение целевых моделей внешних ключей (`db.references`, например пикер для `block.auth_id -> auth`). */
  readonly refs: Readonly<Record<string, GrantChain>>
}
```

### 3.3. Сигнатуры `checkGrants` и `forOwner` (`src/lib/db/grants.ts`)

```ts
export interface GrantActor {
  readonly id: string | null
  readonly permissions: readonly string[]
}

export interface CheckGrantsOptions {
  /** Владелец целевой записи по умолчанию для непривязанных клауз с `'owner'`. */
  readonly ownerId?: string | null
  /**
   * Что возвращать, если встретилось неразмеченное кастомное правило (`null`):
   * по умолчанию `false` (fail-closed для безопасности); UI при желании может передать `true`.
   */
  readonly onUnknown?: boolean
}

/** Привязать `ownerId` локально к конкретному поддереву правил внутри общего массива. */
export function forOwner(ownerId: string | null | undefined, spec: GrantSpec): BoundGrantSpec

/** Одиночная проверка (включая массив связок `[grants(a).select, grants(b).insert]`): */
export function checkGrants(
  actor: GrantActor | null | undefined,
  spec: GrantSpec,
  options?: CheckGrantsOptions,
): boolean

/** Пакетная проверка словаря действий (например `grants(block)` или `configRow.schema`): */
export function checkGrants<T extends Record<string, GrantSpec | undefined | null>>(
  actor: GrantActor | null | undefined,
  specMap: T,
  options?: CheckGrantsOptions,
): { readonly [K in keyof T]: boolean }
```

Ключевые детали поведения `checkGrants`:
- `actor == null` трактуется как гость `{ id: null, permissions: [] }` — проходят только публичные правила `['*']`;
- `undefined` или `null` в значении словаря (например отсутствующий ключ в упрощённой JSON-схеме `user_config`) даёт `false`;
- в отличие от старого `config-api.ts`, `admin` **не зашивается магической константой** внутрь `#lib/db` (ядро БД не знает доменных строк): в моделях `'admin'` и так присутствует во всех списках `defineAcl`, а для динамических JSON-схем `user.config` при чтении схемы в `config-api.ts` гарантируется присутствие `ADMIN_ROLE` (оно уже есть во всех сидах и проверяется `validSchema`).

---

## 4. Права в сессии (`vault.permissions`) и реактивный хук `useGrants`

### 4.1. Проброс прав текущей сессии без походов в БД

1. В `src/content/user/auth.ts`:
   - в запечатанный короткий токен `auth_tmp` (`issueTokens` / `freshAccess`) и его расшифровку добавляется `perms: [...row.permissions]` (до 16 коротких строк — ~150–250 байт, запас до потолка куки `4096 Б` более чем десятикратный);
   - публичный снимок сессии `VaultSessionMeta` (`src/content/user/vault.ts`) получает поле `readonly permissions: readonly string[]`, а `snapshotKeyOf` учитывает отсортированный список прав (смена прав на сервере при обновлении `auth_tmp` сразу реактивно обновляет все вкладки через `BroadcastChannel`).
2. В `src/content/user/vault.svelte.ts`:
   - `UserVault` получает read-only геттер `readonly permissions: readonly string[]`, который до гидратации читает `page.data.user?.permissions ?? []` (полная работоспособность на SSR и без JS!), а после гидратации — реактивное состояние в памяти вкладки.

### 4.2. Разделение по слоям (`layer-guard`) и сигнатура `useGrants`

По правилу `tooling/layer-guard.mjs` слой `src/hooks/` не может импортировать `src/content/`. Поэтому хук делится ровно так же, как `component-form`:

1. **`src/hooks/db-grants.svelte.ts`** — универсальная фабрика реактивного хука поверх `#lib/db`:
   ```ts
   export interface UseGrantsOptions {
     /** Целевой владелец записи (значение или геттер `() => uid` для реактивных пропсов Svelte 5). */
     readonly ownerId?: string | null | (() => string | null | undefined)
     /**
      * Другой проверяемый субъект вместо текущего пользователя
      * (например строка `SeedUserView` в списке аккаунтов или превью выдачи прав).
      */
     readonly actor?: GrantActor | null | (() => GrantActor | null | undefined)
     readonly onUnknown?: boolean
   }

   export function createUseGrants(getDefaultActor: () => GrantActor | null)
   ```
   - При передаче одиночного `GrantSpec` или массива `[grants(a).select, grants(b).insert]` возвращает реактивный ридер `{ readonly current: boolean }` (совместимо с правилами реактивности Svelte 5 без потери сигнала при деструктуризации).
   - При передаче объекта `{ create: ..., pickUsers: [...], hardDelete: ... }` возвращает объект с геттерами `{ readonly create: boolean, readonly pickUsers: boolean, readonly hardDelete: boolean }` — в шаблоне пишется прямо `{#if can.pickUsers}` и `{#if can.hardDelete}` без `.current`!
2. **`src/content/user/grants.svelte.ts` (и реэкспорт из `#content/user/index.js`)**:
   ```ts
   export const useGrants = createUseGrants(() =>
     vault.authorized ? { id: vault.principal, permissions: vault.permissions } : null,
   )
   ```

---

## 5. Документация (обязательное требование)

Функции `defineAcl`, `grants`, `checkGrants`, `forOwner` и `useGrants` документируются в трёх местах с живыми примерами простых, составных и межмодельных проверок:
1. **`src/lib/db/README.md`** — отдельный раздел: декларативное описание прав `defineAcl`, таблица уровней и аксиом стража (`allowAnomalies`), устройство `grants(resource)` (КНФ, поля, связи, ссылки), `checkGrants` и `forOwner` с примерами одиночной модели, связки двух моделей `[grants(a).select, grants(b).insert]`, динамической JSON-схемы и проверки за другого актора.
2. **`src/hooks/README.md`** — описание `db-grants.svelte.ts` (`createUseGrants`, реактивные геттеры для одиночного требования и словаря действий, передача `ownerId` и чужого `actor`).
3. **`src/content/user/README.md`** — описание `vault.permissions` и прикладного `useGrants` на примерах профиля, списка аккаунтов, блокировок и схем `user.config`.

---

## 6. Перевод существующего кода и доработка блокировок (`1 + 3`)

### 6.1. Где убираются ручные списки ролей и самописные проверки

- **`src/content/user/schema.ts`**:
  - `block` → `BLOCK_ACL = defineAcl(...)` (`owner: read`, `read: ['block.read']`, `insert/update/softDelete: ['moderator']`, `edit: ['block.edit', 'admin', 'server']`, `deleted: ['block.readDeleted', 'admin', 'server']`; маски полей из `BLOCK_ACL.roles`);
  - `profile` → `PROFILE_ACL = defineAcl(...)` с `extend.select` для `profile.visibility`;
  - `config` → `CONFIG_ACL = defineAcl(...)` вместо сырых стрелок `update`/`delete`;
  - `auth` и `session` → не меняют своих бизнес-правил, но у `auth` снимается `selectDeleted` (остаётся `readDeleted` как модификатор) и убирается мёртвый `owner` из `auth.policy.update` (`roles(['server', 'admin'])`, т.к. у владельца `0` открытых на update полей).
- **`src/content/demo-catalog/posts/posts.ts`** → `defineAcl` с починкой `delete` (`owner: ['edit']`, `insert: ['author']`, `edit: ['editor']`, `publicRead: true`).
- **`src/content/user/blocks.ts`** → удаляются ручные `BLOCK_READERS`, `BLOCK_WRITERS`, `BLOCK_REASON_EDITORS`, `BLOCK_DELETED_READERS`, `canBlock`, `canReadBlocks`, `canSeeDeletedBlocks`, `canEditBlockReason`, `canHardDeleteBlock` и ручной подсчёт `canPickUsers`; все проверки идут через `checkGrants(actor, grants(block)...)` и `[grants(auth).select, grants(block).insert]`. Модератор перестаёт удалять записи с `hard: true` даже при наличии `block.readDeleted`.
- **`src/content/user/accounts.ts`** → проверки доступа к списку, `canSeeDeleted` и `canSeeNickname` переводятся на `checkGrants` по `grants(auth).select`, `grants(auth).selectDeleted` и `grants(auth).relations.profile`.
- **`src/content/user/profile.ts`** → удаляется `PROFILE_READ_ROLES`; `canEdit`, `canDeleteProfile`, чтение чужого несозданного профиля и показ блокировок сверяются через `checkGrants` с `grants(profile)` и `grants(block)` (включая показ причины/срока активного бана держателям прав чтения блокировок).
- **`src/content/user/config-api.ts`** → `ruleAllows` переводится на `checkGrants` (с сохранением всей логики глобальных умолчаний и пользовательских переопределений).
- **UI-компоненты `src/content/user/ui/*`** (`BlocksFiltersForm.svelte`, `BlockForm.svelte`, `BlockDelete.svelte`, `BlocksList.svelte`, `Profile.svelte`) → кнопки и возможности проверяются через `useGrants(...)` напрямую от моделей `auth`, `block`, `profile`.

### 6.2. Мультивыбор пользователей при создании блокировки (Вариант `1 + 3` поверх `useGrants`)

После появления `useGrants` форма создания блокировки в глобальном списке (`!uid`) собирается без единого лишнего ACL-пропса:
1. В `BlocksList.svelte` ссылка «Новая блокировка» передаёт в `BlockForm` текущие `uids` из фильтра `blocks.uids` (предварительно отфильтровав `vault.principal`, чтобы актор не попадал в список на бан самого себя).
2. В `BlockForm.svelte` (`mode === 'create'` без фиксированного `uid`):
   - поле получателей переводится на штатный `field.multiselect` (`<Select multiple>`) со съёмными чипсами выбранных `id`;
   - кнопка добора/замены через `user.picker` показывается реактивно по `can.pickUsers` (`useGrants([grants(auth).select, grants(block).insert])`) — у модератора без `account.read` пикер скрыт, а у `admin` или связки `moderator + account.read` работает штатно;
   - при `selectedUids.length > 1` кнопка отправки переключается на `<HoldButton>` с явным счётчиком `Заблокировать (N)` (с graceful degradation в обычную submit-кнопку без JS).
3. Серверный обработчик `saveBlock` / `saveBlocksBatch` валидирует массив получателей (отклоняя пустой список и `actor.id`) и создаёт записи блокировки по каждому выбранному пользователю.

---

## 7. Поэтапный план работ (коммиты и проверки)

| Этап | Состав работ | Проверки |
|---|---|---|
| **`G1`** | `#lib/db`: `defineAcl`, страж инвариантов в `defineResource`, правка `resource.ts` (`includeDeleted` как `select + readDeleted`, `policy.hardDelete`), `grants(resource)`, `checkGrants`, `forOwner` + юнит- и PGlite-тесты (`src/lib/db/test/db-acl-grants.test.ts`). | `vitest` по `src/lib/db`, `core-purity`, `npm run check` |
| **`G2`** | Сессия и хуки: `perms` в `auth_tmp` → `VaultSessionMeta.permissions` → `vault.permissions` (`vault.test.ts`), `src/hooks/db-grants.svelte.ts` (`createUseGrants` + тест), `src/content/user/grants.svelte.ts` (`useGrants`). | `vitest` по `vault` и `hooks`, `layer-guard`, `npm run check` |
| **`G3`** | Модели и домен: перевод `schema.ts` (`block`, `profile`, `config`, правка `auth`) и `demo.post` на `defineAcl` / чистые правила; перевод `blocks.ts`, `accounts.ts`, `profile.ts`, `config-api.ts` на `grants` + `checkGrants`; обновление `policy.test.ts`, `blocks.test.ts`, `accounts.test.ts`. | Полный `vitest` домена и PGlite, `npm run check` |
| **`G4`** | UI на `useGrants` + мультивыбор `1 + 3` в `BlockForm` / `BlocksList` / `BlocksFiltersForm` (`field.multiselect` из фильтра без `self`, `user.picker` по `useGrants([grants(auth).select, grants(block).insert])`, `<HoldButton>` при `N > 1`) + SSR- и браузерные тесты `test/browser/blocks.mjs`. | SSR-тесты, `npm run build`, Playwright `blocks.mjs` и `auth.mjs` |
| **`G5`** | Подробная документация в `src/lib/db/README.md`, `src/hooks/README.md`, `src/content/user/README.md` и актуализация `docs/audit-user-blocks-2026-10-29.md` / `docs/audit-delete-rights-2026-10-29.md`. | Все статические стражи (`tooling/*.test.mjs`), `npm run check`, `npm run build` |
