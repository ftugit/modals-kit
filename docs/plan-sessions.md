# Сессии пользователя: прямая модель `user.session.v1`, функции и UI-компоненты

Статус: **в планах** (технический план; реализация — по отдельной команде владельца).

---

## 1. Исходное состояние и цель переноса

Сейчас таблица сессий `public.user_session` (`key: 'user.session.v1'` в `src/content/user/schema.ts`) остаётся на низкоуровневом `policy`, где изменение и мягкое удаление разрешены только ролям `['server', 'admin']`, в каталоге прав не задействованы `session.read` / `session.edit`, а секретный токен куки `jti` открыт на чтение (`read: () => true`). Из-за этого:

- чтение своих устройств и отзыв сессии вынуждены идти через отдельные обёртки `listSessions` / `revokeSession` в `src/content/user/auth.ts` и `SessionStorePort` под системным контекстом `SYSTEM` (`roles: ['server']`);
- адресация устройств снаружи строится по секретному `jti`, а не по штатному первичному ключу модели `id: uuid`;
- пользовательский интерфейс списка устройств, переименования и отзыва сессий ещё не подключён.

**Цель плана**:
1. Перенести все пользовательские и административные операции над сессиями из прав системы (`SYSTEM`) и отдельных обёрток `auth.ts` / `ports.ts` **на самого пользователя (`principalOfRow`) напрямую через модель `db.resource(session)`** по образцу `user.block` и `storage_server`.
2. Построить функции и UI-компоненты сессий **целиком поверх уже реализованных механизмов проекта** (`#lib/db`, `#lib/paginate`, `#lib/modals`, `#lib/address`, `#lib/form`, `#hooks/db-form`, `#hooks/db-grants`, `#components/paginator`, `#components/ui`) без дублирующей обвязки.

---

## 2. Прямая модель `user.session.v1` и пирамида прав (`defineAcl`)

### 2.1. Каталог прав (`src/content/user/permissions.ts`)

Группа «Сессии» приводится к полному единообразию с группами «Аккаунты» и «Блокировки»:

- `session.read` — видеть живые сессии и устройства любого аккаунта (название, страну, хеш подсети, историю смен подсети, времена активности).
- `session.edit` — переименовывать устройства и отзывать (мягко удалять) живые сессии любого аккаунта, включая массовое завершение.
- `session.readDeleted` — конъюнктивное дополнение к чтению модели (`selectDeleted`): открывает мягко удалённые (отозванные) записи сессий для аудита; само по себе без права `select` чтения не даёт.

### 2.2. Декларативный ACL ресурса (`src/content/user/schema.ts`)

Ресурс `session` переводится с ручного `policy` на `defineAcl`:

```ts
const SESSION_ACL = defineAcl({
  owner: { field: 'auth_id', can: ['read', 'update', 'softDelete'] },
  read: ['session.read'],
  insert: ['server'],
  update: ['session.edit'],
  softDelete: ['session.edit'],
  edit: ['admin', 'server'],
  deleted: ['session.readDeleted', 'admin', 'server'],
})
```

Что гарантирует эта матрица на уровне `#lib/db` (проходит все 7 аксиом `validateResourceAcl` без `allowAnomalies`):

- **Владелец (`owner` по `auth_id`)** напрямую через модель читает свои живые сессии (`select`), переименовывает свои устройства (`update`) и отзывает свои сессии мягким удалением (`delete` → `deleted_at`). При этом владелец **не имеет** `insert` (нельзя создать сессию в обход входа), `deleted` / `hardDelete` (нельзя стереть след отзыва из таблицы, чтобы украденная кука `auth_sid` всегда распознавалась фаерволом как `'revoked'`, а не `'unknown'`) и `restore` (нельзя воскресить отозванную сессию без нового входа).
- **Держатель `session.read`** читает живые сессии любого пользователя и глобальный журнал `/sessions`.
- **Держатель `session.edit`** читает живые сессии, переименовывает `device_name` и отзывает (`softDelete`) сессии любого пользователя без права физического стирания и восстановления.
- **Связка с `session.readDeleted`** открывает просмотр отозванных сессий (`includeDeleted: true`), а `admin` / `server` (`edit` + `deleted`) держат каскадное и окончательное удаление (`hard: true`, `chain: true` от `user.auth`).

Параллельно в `src/content/user/schema.ts` на `defineAcl` выравнивается и `user.auth.v1` с сохранением действующих ролей (`account.read`, `account.edit`, `account.readDeleted`, `admin`, `server`).

### 2.3. Маски полей, фильтры и сортировки модели `session`

| Поле | Чтение (`read`) | Создание (`create`) | Изменение (`update`) | Фильтры и сортировка |
|---|---|---|---|---|
| `id` (`uuid`, PK) | `() => true` | `createValue` | `immutable: true` | `filters: ['eq', 'ne', 'in']`, `orderable: true` |
| `auth_id` (`uuid`, FK → `auth`, `chain: true`) | `() => true` | `['server']` | `immutable: true` | `filters: ['eq', 'in']`, `orderable: true` |
| `jti` (`text 21..64`, `unique`) | **`['server']`** | `['server']` | `immutable: true` | `filters: ['eq']` (только внутренний фаервол) |
| `version` (`integer >= 0`) | **`['server']`** | `['server']` | **`['server']`** | нет (только внутренняя ротация `renew`) |
| `device_name` (`text 1..120`, `nullable`) | `() => true` | `['server']` | **`() => true`** | `filters: ['eq', 'icontains', 'isNull', 'isNotNull']`, `orderable: true` |
| `subnet_hash` (`text`, `nullable`) | `() => true` | `['server']` | `['server']` | `filters: ['eq', 'isNull', 'isNotNull']` |
| `country` (`text 2..64`, `nullable`) | `() => true` | `['server']` | `['server']` | `filters: ['eq', 'in', 'icontains', 'isNull', 'isNotNull']`, `orderable: true` |
| `subnet_history` (`json`, default `'[]'`) | `() => true` | `['server']` | `['server']` | `filters: ['eq', 'ne']` (`ne: []` — была смена подсети) |
| `last_seen_at` (`timestamp`, `nullable`) | `() => true` | `['server']` | `['server']` | `filters: ['gte', 'lte', 'isNull', 'isNotNull']`, `orderable: true` |
| `expires_at` (`timestamp`, `required`) | `() => true` | `['server']` | `['server']` | `filters: ['gt', 'lte', 'gte']`, `orderable: true` |
| `created_at` / `updated_at` / `deleted_at` | авто-поля `timestamps` | авто | авто | `created_at`, `deleted_at` — `orderable` / диапазоны |

Ключевые следствия:
- **Секретный `jti` и `version` полностью закрыты от чтения человеком** (`read: ['server']`): ни владелец, ни `session.read`, ни `admin` не получают материал токена продления; все внешние ссылки используют безопасный `id: uuid`.
- **`device_name` — единственное поле с `update: () => true`**: круг допуска задаёт сам `policy.update` модели (`owner`, `session.edit`, `admin`, `server`), а валидаторы формы автоматически выводятся из схемы поля через `formParams(session).device_name` (`#hooks/db-form.ts`).
- Срок `expires_at`, подсеть и активность защищены маской `update: ['server']`: ни владелец, ни администратор через клиентскую форму не могут искусственно продлить токен или подменить сетевой след.

---

## 3. Разделение прямой работы через модель и внутреннего фаервола токенов

### 3.1. Что удаляется и сокращается

- Из `src/content/user/auth.ts` удаляются `listSessions`, `revokeSession` и старый тип `SessionView` (экспонировавший `jti`).
- Из `src/content/user/gateway.server.ts` удаляются `u.listSessions()` и `u.revokeSession(jti)`.
- Из `SessionStorePort` (`src/content/user/ports.ts`) удаляется `listByAuth`: системный порт сессий больше не обслуживает экраны и действия пользователя. Промежуточный порт `SessionManagementPort` **не создаётся** — прикладной серверный модуль работает с `db.resource(session)` напрямую (как `app-storage.server.ts`).

### 3.2. Признак текущего устройства (`isCurrent`) без раскрытия `jti`

- В `SessionRecord` (`ports.ts` / `gateway.server.ts`) добавляется первичный ключ строки `id: string`.
- `guard()` в `auth.ts` уже загружает запись сессии по `payload.dt`; в возвращаемый результат `guard()` и в `u.actor()` (`gateway.server.ts`) добавляется `sessionId: record.id`:
  `actor = { id: string, sessionId: string, permissions: readonly string[] }`.
- При формировании карточек сессий флаг `isCurrent` вычисляется на сервере строгим сравнением `row.id === actor.sessionId`, без передачи `jti` в браузер, URL или скрытые поля форм.

### 3.3. Серверные функции прямой работы с моделью (`src/content/user/sessions.server.ts`)

Все функции принимают проверенного `actor` из `u.actor()`, формируют контекст `ctx = principalOfRow(actor)` и вызывают `database.resource(session)` напрямую (принимая необязательный `{ db = defaultDb, now = () => Date.now() }` для быстрых PGlite-тестов по образцу `policy.test.ts` и `app-storage.server.ts`):

1. **`listSessionsPage(actor, args, deps?)`**
   - Обслуживает три режима одним кодом:
     - собственные сессии (`mode: 'self'`, `fixedUid = actor.id`);
     - сессии конкретного пользователя (`mode: 'user'`, `fixedUid = targetUid`; для чужого `uid` проверяет `checkGrants(actor, gSession.select, { ownerId: fixedUid })` и существование аккаунта с учётом `gAuth.selectDeleted`);
     - глобальный журнал сессий (`mode: 'global'`, `fixedUid = null`; требует `checkGrants(actor, gSession.select)`).
   - Собирает серверный `Filter` для `#lib/db`:
     - `auth_id` (`eq` для фиксированного пользователя либо `in` по выбранным `uids` в глобальном списке);
     - текстовый поиск `q` (`or` по `device_name icontains`, `country icontains`, а в глобальном списке при праве `gProfile.select` — дополнительно `exists` по `profile.nickname`);
     - `state`: `'active'` (`expires_at > nowIso` на живых строках), `'expired'` (`expires_at <= nowIso` на живых строках), `'all'` (все живые), `'deleted'` (`includeDeleted: true` и `deleted_at >= iso(0)` при наличии `gSession.selectDeleted`);
     - `country` (`icontains` / `eq`) и `changed === true` (`{ field: 'subnet_history', op: 'ne', value: [] }`).
   - Выполняет параллельно `[api.select(ctx, { page, limit: pageSize, filter, order, includeDeleted }), api.count(ctx, { filter, includeDeleted })]`, проецирует строки в `SessionItemView` (с вычисленным `status: 'active' | 'expired' | 'revoked'` и `isCurrent: row.id === actor.sessionId`) и возвращает срез вместе с флагами прав `canSeeLive`, `canSeeDeleted`, `canPickUsers`, `canRevokeAny`.

2. **`readSessionDetail(actor, { sessionId, expectedUid? }, deps?)`**
   - Вызывает `api.get(ctx, sessionId, { includeDeleted: canSeeDeleted })`.
   - Ошибки `not_found` / `forbidden` (включая попытку обычного пользователя запросить чужой UUID) единообразно маппятся в факт `{ code: 'auth.session-unknown' }` — чужой идентификатор неотличим от несуществующего.
   - Возвращает `SessionDetailView`: данные сессии (`SessionItemView`), права `canRename`, `canRevoke`, `canHardDelete` (через `checkGrants(actor, grants(session), { ownerId: row.auth_id })`) и `holdSeconds` из конфига модуля.

3. **`renameSessionDevice(actor, { sessionId, deviceName }, deps?)`**
   - Нормализует пустую строку в `null`, вызывает `api.update(ctx, sessionId, { device_name })` напрямую под контекстом `ctx`.

4. **`revokeSessionById(actor, { sessionId, hard? }, deps?)`**
   - Вызывает `api.delete(ctx, sessionId, hard ? { hard: true } : undefined)` напрямую под контекстом `ctx`.
   - Возвращает `{ revokedCurrent: sessionId === actor.sessionId }`: если пользователь отозвал сессию текущего браузера, маршрутный/форменный обработчик вызывает `u.clearCookies()` и возвращает клиентской форме шаг `{ step: 'entry' }`.

5. **`revokeBulkSessions(actor, { uid, scope: 'others' | 'all' }, deps?)`**
   - Выполняется внутри `database.transaction(async (tx) => ...)`: выбирает живые сессии пользователя `uid` через `tx.resource(session).select(ctx, { filter })` (при `scope === 'others'` добавляет `{ field: 'id', op: 'ne', value: actor.sessionId }`) и отзывает каждую строку вызовом `tx.resource(session).delete(ctx, row.id)`.
   - Возвращает `{ count, revokedCurrent: scope === 'all' && uid === actor.id }`.

### 3.4. Что остаётся за `logout` / `logoutAll` и системным `SessionStorePort`

- При живом `actor` штатные кнопки выхода (`logout` / `logoutAll`) отзывают сессию через ту же прямую модель под `principalOfRow(actor)`.
- Системный `SessionStorePort` (`SYSTEM`) сохраняется **только для внутренних операций без актора-человека**:
  - создание строки на входе и восстановлении (`create`);
  - чтение и ротация по секретному `jti` внутри `guard` и `renew` (`get`, `save`);
  - аварийное гашение сессии по сырой куке `auth_sid` (`softDelete`, `softDeleteAllByAuth`), когда короткий `access` уже истёк, а аккаунт заблокирован или ожидает удаления;
  - фоновая зачистка удалённых аккаунтов `sweepDeletions`.

---

## 4. Компоненты, маршруты и модальные пары (поверх готовых механизмов)

Архитектура UI повторяет канон `user.block` и `SeedUsersList`: **конечный компонент сам догружает данные через `preloadData` своего маршрута при открытии в модалке и принимает `initial` при SSR/no-JS на странице, а модалка и `+page.svelte` остаются тонкими носителями с `Acl`**.

### 4.1. Источник пагинатора и ревизия (`src/content/user/ui/sessions-list/`)

- `source.ts`:
  - `SESSIONS_NAME = 'user-sessions'`, `SESSIONS_PAGE_PARAM = 'sessions'`, `SESSIONS_PAGE_SIZE = 30`, `SESSIONS_PAGE_SIZES = 30..100`;
  - `SESSIONS_FILTER_KEYS = ['ord', 'state', 'country', 'changed', 'uids']` + внутренний ключ `_uid` (`'_self'` для `/user/sessions`, UUID для `/user/[id]/sessions`, пусто для `/sessions`);
  - `defineSource<SessionItemView>` + `definePaginator` + `createUrlAdapter` (`#lib/paginate/index.js`).
- `load.server.ts`:
  - `loadSessionsRouteData(event, target: 'self' | { uid: string } | 'global')` — выставляет `Cache-Control: private, no-store`, разбирает параметры `sessions.*` и вызывает `listSessionsPage`.
- `revision.svelte.ts`:
  - `getSessionsRevision()` / `bumpSessionsRevision()` — реактивное инвалидирование открытого списка после переименования или отзыва в дочерней модалке (аналог `blocks-list/revision.svelte.ts`).

### 4.2. Переиспользуемые компоненты и новые экраны (`src/content/user/ui/`)

| Компонент | Что переиспользует | Назначение |
|---|---|---|
| `SessionsList.svelte` + `sessions-list/SessionCard.svelte` | `PaginatorScope`, `Paginator` (`mode="accumulate"`), `SearchBar`, `Skeleton` (`#components/paginator`), `Button`, `Badge`, `TimeAgo` (`#components/ui`), `useGrants(grants(session))`, `useModalLink` | Универсальный список сессий (свои / целевого аккаунта / глобальный). На строке: название устройства, `Badge` «Это устройство» (`isCurrent`), `Badge` статуса (`Активна` / `Истекла` / `Отозвана`), страна и `8`-символьный префикс `subnetHash`, индикатор смены подсети (`history.length`), `TimeAgo` последней активности. В шапке: `SearchBar`, кнопка «Фильтры (N)» и кнопка массового завершения («Завершить остальные» для себя при наличии других активных устройств либо «Завершить все» для чужого аккаунта). |
| `SessionsModal.svelte` | `Acl`, `SessionsList` | Модальный носитель пары `user.sessions`. |
| `SessionsFiltersForm.svelte` + `SessionsFiltersModal.svelte` | `#lib/form` (`defineForm`, `bind`, `Form`), `Field`, `Button`, `UserPicker.svelte` (`user.picker` + `mirrorToField`) | Фильтры списка: порядок сортировки (`last-seen-*`, `created-*`, `expires-*`, при `canSeeDeleted` — `deleted-*`), состояние (`active`, `expired`, `all`, при `canSeeDeleted` — `deleted`), фильтр страны, чекбокс «Только со сменой подсети», размер страницы и выбор пользователей через готовый `user.picker` (только в глобальном режиме `/sessions`). |
| `session-detail/` (`SessionDetail.svelte`, `form.ts`, `session-detail.form.server.ts`) + `SessionDetailModal.svelte` | `bindComponentForm`, `formParams(session).device_name` (`#hooks/db-form`), `Form`, `Field`, `Common`, `Button`, `Badge`, `TimeAgo`, `Alert`, `Skeleton`, `useGrants` | Карточка сессии: подробные метки времени (`createdAt`, `lastSeenAt`, `expiresAt`, `deletedAt`), текущая подсеть и полная история смен подсетей `history` (`hash`, `country`, `TimeAgo`), форма переименования `device_name` (активна при `canRename`, иначе read-only просмотр) и кнопка «Завершить сессию» → `user.sessions.revoke`. |
| `session-revoke/` (`SessionRevoke.svelte`, `SessionBulkRevoke.svelte`, `form.ts`, `session-revoke.form.server.ts`) + `SessionRevokeModal.svelte`, `SessionBulkRevokeModal.svelte` | `bindComponentForm`, `Form`, `Field`, `Common`, `HoldButton`, `Alert`, `Button`, `Skeleton`, `useGrants` | Подтверждение отзыва одной сессии или пакета сессий удержанием `HoldButton` (`holdSeconds`). Показывает предупреждение `Alert`, если затрагивается текущее устройство (`isCurrent`), и условный чекбокс `hard` («Удалить запись навсегда») только при `useGrants(gSession.hardDelete)`. При отзыве текущей сессии очищает `vault.clear()` и уводит на `next` / закрывает модалку. |

### 4.3. Типизированные маршруты (`routes.ts`) и регистрация модалок (`modals.ts`)

Каждое действие имеет полноценную пару «модалка + SSR-маршрут» для работы как с JavaScript, так и через нативный `GET`/`POST` без JavaScript:

- `userSelfSessionsRoute` (`/user/sessions`) ↔ `user.sessions` (`{}`): собственные устройства текущего пользователя;
- `userSessionsRoute` (`/user/[id=uuid]/sessions`) ↔ `user.sessions` (`{ id }`): сессии целевого пользователя;
- `sessionsListRoute` (`/sessions`) ↔ `user.sessions` (`{ global: true }` / прямой переход): глобальный журнал сессий для `session.read` / `session.edit` / `admin`;
- `sessionsFiltersRoute` (`/sessions/filters`) ↔ `user.sessions.filters`: страница-fallback и модалка фильтров;
- `userSessionDetailRoute` (`/user/[id=uuid]/sessions/[sessionId=uuid]`) и `sessionDetailRoute` (`/sessions/[sessionId=uuid]`) ↔ `user.sessions.detail`;
- `userSessionRevokeRoute` (`/user/[id=uuid]/sessions/[sessionId=uuid]/revoke`) и `sessionRevokeRoute` (`/sessions/[sessionId=uuid]/revoke`) ↔ `user.sessions.revoke`;
- `userSelfSessionsRevokeAllRoute` (`/user/sessions/revoke-all`) и `userSessionsRevokeAllRoute` (`/user/[id=uuid]/sessions/revoke-all`) ↔ `user.sessions.revoke-bulk`.

### 4.4. Точки входа в существующих компонентах

1. **`src/content/user/ui/MenuBody.svelte`**:
   - кнопка «Устройства» (`asModalLink('user.sessions')`) для каждого вошедшего пользователя рядом с «Профиль» и «Настройки»;
   - кнопка «Все сессии» (`asModalLink('user.sessions', { global: '1' })` / `/sessions`) при `useGrants(grants(session).select).current` (по аналогии с «Серверы хранилища»).
2. **`src/content/user/ui/Profile.svelte`**:
   - кнопка «Сессии» (`asModalLink('user.sessions', data.isOwn ? {} : { id: uid })`) рядом с «Настройки» и «Блокировки» в обоих состояниях карточки профиля (заполненной и «профиль не создан»), видимая при `data.isOwn || useGrants(grants(session).select, { ownerId: () => uid }).current`.

---

## 5. Проверка и покрытие тестами при реализации

1. **Инварианты схемы и ACL (`schema.test.ts`, `acl.test.ts`, `permissions.test.ts`)**:
   - `validateResourceAcl(session)` и `validateResourceAcl(auth)` возвращают `0` нарушений;
   - проверка клауз `grants(session)` через `checkGrants`: владелец видит и мягко удаляет свои строки, меняет только `device_name`, не видит удалённые, не может делать `insert`, `hardDelete`, `restore` и никогда не читает `jti` / `version`.
2. **Прямое исполнение на PGlite (`policy.test.ts` и `sessions.test.ts`)**:
   - чтение, фильтрация (`active` / `expired` / `deleted` / `changed` / `country`), переименование `device_name`, одиночный отзыв и пакетный отзыв «остальных» / «всех» устройств напрямую через `db.resource(session)` под контекстом владельца, `session.read`, `session.edit`, `session.read + session.readDeleted` и `admin`;
   - проверка маскирования `jti` и `version` (`undefined` для всех человеческих ролей, включая `admin`) и неотличимости чужого `sessionId` (`auth.session-unknown`).
3. **Обновление `emulate.test.ts`**:
   - замена старых проверок `listSessions` / `revokeSession(jti)` на прямые сценарии модели `session` и проверку `guard` → `sessionId` + отзыва текущей/соседней сессии.
