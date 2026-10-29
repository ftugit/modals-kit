# Аудит и целевая архитектура: компонент блокировок (`user.block`)

**Дата:** 2026-10-29  
**База проверки:** ветка `img` (`5fd04f2` .. локальные док-коммиты)  
**Статус:** документ аудита и проектирования для поочерёдного редактирования (без правок рантайм-кода)

---

## 1. Аудит текущей реализации (`src/content/user/ui/profile-blocks/`)

### 1.1. Что уже есть в домене и UI

1. **Домен и модель БД (`src/content/user/schema.ts`, `blocks.ts`, `spec-block.ts`)**:
   - Ресурс `user.block` (`public.user_block`): поля `id`, `auth_id` (`immutable`, `filters: ['eq', 'in']`), `scope` (`immutable`), `reason` (`update: ['block.edit', 'admin']`), `until` (`update: ['moderator', 'block.edit', 'admin']`), `by` (`immutable`), плюс `timestamps` с `deleted_at` (`readDeleted: ['server', 'block.readDeleted', 'admin']`).
   - Политики модели (с учётом коммита `5fd04f2`):
     - `select` (живые строки): владелец цели + `server`, `moderator`, `block.read`, `block.edit`, `admin`;
     - `selectDeleted` (чтение с удалёнными): тот же круг + `block.readDeleted`;
     - `insert` / `update` / `delete`: круг записи (`moderator`, `block.edit`, `admin`);
     - окончательное удаление `delete(id, { hard: true })`: слой `#lib/db` требует связку политики `delete` **и** гранта `readDeleted` (`admin`, либо `block.edit`/`moderator` + `block.readDeleted`).
   - Экраны факта бана при входе (`BanNotice.svelte`, `RestrictionsNotice.svelte` и плашка `fullBlock` в `Profile.svelte`) построены поверх `<Acl>` и работают корректно.

2. **Архитектурное несоответствие `ui/profile-blocks` остальным компонентам `user/ui`**:
   - **Не самодостаточный компонент**: в отличие от `Profile.svelte`, `ProfileForm.svelte`, `ProfileDelete.svelte` и `SeedUsersList.svelte`, `ProfileBlocks.svelte` не имеет собственной пары «маршрут + модалка», не умеет сам запрашивать данные (`listBlocks` в `blocks.ts` в приложении нигде не вызывается) и не общается с носителем через `onAcl` / `<Acl>`.
   - **Потерян на аккаунтах без созданного профиля (`Profile.svelte:144`)**: `<ProfileBlocks>` вставлен только в ветку `{:else if data?.profile}`, а в ветке `{:else if data?.notCreated}` пропущен — забанить свежий seed-аккаунт без анкеты профиля из UI невозможно.
   - **Не использует возможности модели `user.block`**: в UI нет ни пагинации, ни фильтрации/сортировки, ни правки `reason` / `until` существующей записи, ни мягкого и полного удаления.
   - **Не подключён к сессии и продолжению форм**: в `bindComponentForm` не переданы `session: userSession` и `continuation` (`form?.result`).

3. **Критические баги текущей реализации `ProfileBlocks.svelte` и `BlockLift.svelte`**:
   - **100% отказ при отправке «Заблокировать» и «Снять» (и с JS, и без JS)**: вызван `mirrorToField(bound, 'subject', ...)`, но в DOM внутри `<Form>` отсутствуют `<div hidden aria-hidden="true"><Field of={bound.f.subject} /></div>` и `block_id`. `new FormData(el, submitter)` отправляет пустой `subject` → сервер всегда отвечает `auth.identity-unknown`.
   - **Сломан режим без JS и падает `assertEnvelope` в DEV**: в `<Form>` не передан `hiddenFields={bound.hidden()}` (тот же пропуск есть и в `ProfilePrivacy.svelte:35`). Без JS POST уходит без `__form_id` и получает `405 Method Not Allowed`.
   - **Бесконечный реактивный цикл (`effect_update_depth_exceeded`) на длительности**: `$effect` в `ProfileBlocks.svelte:41-48` читает `bound.f.dur_n.value` / `bound.f.dur_unit.value` из `$state.raw` снимка и тут же вызывает `bound.f.until.onInput(...)`, заменяющий тот же снимок новым объектом.
   - **Список не обновляется после действия с JS**: после успешного ответа ни `ProfileBlocks`, ни `BlockLift` не триггерят перезапрос данных и не очищают форму.
   - **Пустая причина даёт `auth.forbidden` вместо ошибки поля**: в `form.ts:30` у `reason` стоит `v.minLength(1)` без `v.required()`; в `#lib/form` `minLength` пропускает пустую строку, запрос уходит на сервер и падает с «Доступ запрещён», а `specBlocks.reasonRequired` остаётся мёртвым кодом.
   - **Огрехи UX**: ручной `name="intent"` вместо `{...bound.intent('lift')}` (нет `formnovalidate`), поля даты/длительности не скрываются при включённом «Навсегда», форма бана рендерится у модератора даже в собственном профиле (`isOwn`), `by` выводится сырым UUID.

4. **Попутная находка в соседнем списке `accounts.ts:120` (после коммита `5fd04f2`)**:
   - В `src/content/user/accounts.ts:120` флаг `canSeeDeleted` всё ещё проверяет `g.perms.includes('account.read')`, хотя `5fd04f2` перенёс грант `readDeleted` модели `user.auth` в отдельное право `'account.readDeleted'`. При запросе `?users.state=deleted` пользователем с `account.read` без `account.readDeleted` вызов `api().select(..., { includeDeleted: true })` упадёт с `forbidden`.

---

## 2. Целевая архитектура компонентов блокировок и синергия с существующими модулями

### 2.0. Карта синергии (что уже есть в проекте и что нужно добавить)

| Механизм | Что уже есть в коде (`img`) | Что нужно добавить / учесть |
|---|---|---|
| **Выбор пользователей из `SeedUsersList`** | В `src/content/user/ui/UserPickerSteps.svelte` и `SeedUsersList.svelte` **уже реализованы** параметрный выбор `rowAttrs` + `isSelected`, срез подтверждения `users.ids` и работа без JS через `asLink`. А в `user.block` поле `auth_id` **уже имеет фильтр `['eq', 'in']`**. | Оформить `UserPicker` как самостоятельную пару «модалка `user.picker` + роут `/users/pick`» с возвратом выбранных `ids` в родительскую модалку (стопка `#lib/modals`) и no-JS возвратом по `from`. Поддержать 2 режима: `multiple` (для фильтра `blocks.uids`) и `single` (для выбора цели при нажатии «Добавить блокировку» из общего списка без `uid`). |
| **Доступ к пикеру seed-юзеров (`canPickUsers`)** | `SeedUsersList` закрыт правом `account.read` / `admin`. | Сервер отдаёт флаг **`canPickUsers`** (`admin \|\| account.read`). В фильтрах кнопка пикера юзеров активна при `!uid && canPickUsers` (при переданном в `BlocksList` `uid` — опция отключена; при отсутствии `account.read` — не открывает список `seed`-юзеров, при этом фильтр/создание по явному `id` остаются рабочими). |
| **Заблокированное поле `id` юзера и кнопка профиля в `BlockForm`** | В каждой записи `user.block` уже лежит `auth_id` (`read: () => true`), никаких `JOIN` на `user.auth` и раскрытия `seed` не требуется! Пара `user.profile` (`modals.ts` + `/user/[id]`) и примитив `<Input>` из `#components/ui` уже готовы. | При открытии редактирования из `BlocksList` без переданного `uid`: передавать `id` целевого юзера вместе с компонентом, рендерить `<Input value={targetId} disabled readonly />` **без атрибута `name` и вне `defineForm`** (проходит `layer-guard`, в `FormData` не попадает ни с JS, ни без JS) и кнопку `asModalLink('user.profile', { id: targetId })`. |

---

### 2.1. Список блокировок (`BlocksList`) — два режима (`uid?: string | null`)

По образцу `SeedUsersList.svelte` + `ui/seed-users/source.ts`:

- **Два режима работы одного компонента `BlocksList.svelte`**:
  1. **По конкретному пользователю (`uid` передан, например `/user/[id]/blocks` или секция в профиле)**:
     - выборка жёстко зафиксирована по `auth_id = uid`;
     - в фильтрах опция выбора пользователей **отключена**;
     - при клике на запись открывается `BlockForm (edit)` с контекстом этого `uid` (без кнопки «Профиль» и без визуального поля `id` юзера).
  2. **Глобальный по всем блокировкам (`uid` НЕ передан, маршрут `/blocks` + модалка `user.blocks`)**:
     - показывает все доступные вызывающему записи блокировок (в карточке строки дополнительно виден `id` целевого аккаунта `item.authId`);
     - в фильтрах доступна кнопка открытия модалки/роута выбора целевых пользователей среди seed-юзеров (`user.picker`);
     - клик по записи передаёт `id` юзера этой записи в `BlockForm (edit)` без контекстного `uid` списка → в `BlockForm` отображаются кнопка открытия роута/модалки профиля и заблокированное визуальное поле с `id` юзера.
- **Пагинатор (`#lib/paginate` + `#components/paginator`)**:
  - Собственное адресное пространство `blocks` (`?blocks=2`, `?blocks.size=30`, `?blocks.ord=…`, `?blocks.scope=…`, `?blocks.state=…`, `?blocks.uids=…`).
  - Режим `accumulate`, одна точка данных (`load` роута → `initial` на SSR/no-JS, `preloadData` в модалке и догрузке).
  - Доработка `user.block` в `src/content/user/schema.ts`:
    - `orderable: true` на `until` и `scope`;
    - `filters: ['eq', 'in']` на `scope`.
- **Фильтры списка (`BlocksFiltersForm` — модалка `user.blocks.filters` + fallback-роут `/blocks/filters`)**:
  - **Сортировка (`blocks.ord`)**: `created-desc` (по умолчанию), `created-asc`, `until-asc`, `until-desc`, а при `canSeeDeleted` (`block.readDeleted`/`admin`) — `deleted-desc`, `deleted-asc`.
  - **Число элементов (`blocks.size`)**: `30..100` (дефолт `30`).
  - **Фильтр по ключам сфер (`blocks.scope`)**: выбор одного или нескольких ключей из `BLOCK_SCOPES` (`auth`, `profile.delete`, `account.delete`).
  - **Фильтр по состоянию (`blocks.state`)**: `all` / `active` / `expired`, плюс `deleted` при `canSeeDeleted`.
  - **Выбор пользователей среди seed-юзеров (`blocks.uids`)**:
    - кнопка в форме фильтров, открывающая пару `user.picker` (модалка поверх стопки `#lib/modals` с JS / роут `/users/pick?from=…` без JS) со счётчиком выбранных юзеров и сбросом;
    - **отключается, если в `BlocksList` передан `uid`** (а при отсутствии `canPickUsers` — не даёт открыть список `seed`).
- **Кнопка «Добавить блокировку» рядом с фильтрами**:
  - при переданном `uid`: ведёт на `user.blocks.create` для этого `uid` (если `assignableScopes.length > 0` и `uid !== actor.id`);
  - без `uid` (глобальный список): ведёт на глобальное создание блокировки, где целевой `id` выбирается через тот же `user.picker` (`single` при `canPickUsers`) или вводится в поле `subject`.

---

### 2.2. Единый компонент создания и редактирования блокировки (`BlockForm`)

Один самодостаточный компонент на создание и правку:

- **Режим создания (`blockId` не передан)**:
  - Если открыт из глобального списка (без фиксированного `uid`): выбор целевого пользователя (`subject` — через кнопку `user.picker` при `canPickUsers` или поле `UUID`).
  - **`<select>` выбора сферы (`scope`)**: строится из серверного списка `assignableScopes` — вариантов `BLOCK_SCOPES`, которые текущий пользователь может назначать.
  - Поля заполнения: `reason` (`v.required()`, `v.maxLength(200)`), `forever` (чекбокс) и срок `until` (`datetime-local` + быстрый пересчёт длительности по событию ввода без реактивных циклов, скрытые при `forever = true`).

- **Режим редактирования (`blockId` передан, открывается кликом по пункту списка)**:
  - **Контекст целевого пользователя (когда в `BlocksList` НЕ был передан `uid`)**:
    1. **Заблокированное визуальное поле с `id` юзера**: `<Input value={targetUserId} disabled readonly />` без атрибута `name` и вне `defineForm` (чисто визуал — в форму не передаётся ни с JS, ни без JS).
    2. **Кнопка открытия профиля цели**: `<Button {...asModalLink('user.profile', { id: targetUserId })} variant="outline" size="sm">Профиль</Button>` — с JS открывает модалку профиля поверх стопки, без JS ведёт на `/user/<targetUserId>`.
    *(Если `BlocksList` был открыт с конкретным `uid`, оба этих элемента не рисуются.)*
  - **Поля записи по правам модели `user.block`**:
    - `scope`: в модели `immutable: true` → отображается как заблокированный `<select>` текущей сферы;
    - `reason`: редактируется при `canEditReason` (`block.edit` / `admin`), у роли `moderator` — заблокировано (`disabled`);
    - `forever` / `until` (и быстрое снятие активной блокировки): редактируются кругом записи (`moderator`, `block.edit`, `admin`).
  - **Кнопка «Удалить» справа сверху** (на пару `user.blocks.delete`):
    - показывается при `canDelete === true`:
      - на живой записи: круг `delete` (`moderator`, `block.edit`, `admin`);
      - на уже мягко удалённой записи: только связка `canHardDelete` (`admin`, либо `(moderator | block.edit) + block.readDeleted`).

---

### 2.3. Компонент удаления блокировки (`BlockDelete`)

По образцу `ProfileDelete.svelte`:

- Пара «модалка `user.blocks.delete` + роут удаления» под гейтом `canDelete` (`<Acl>`).
- Сводка удаляемой записи + подтверждение удержанием `<HoldButton variant="destructive" seconds={holdSeconds}>`.
- **Чекбокс полного удаления (`hard`)**:
  - рендерится **только при `canHardDelete === true`** (`admin` или связка права записи + гранта `block.readDeleted`, в точном соответствии со слоем `#lib/db` из `5fd04f2`);
  - если запись уже мягко удалена (`alreadyDeleted === true`), при `canHardDelete` выполняется окончательное удаление.

---

### 2.4. Сводная таблица пар «модалка + роут»

| Назначение | Имя модалки (`modals.ts`) | Маршрут (`routes.ts`) | Компонент |
|---|---|---|---|
| Список блокировок (глобальный / по юзеру) | `user.blocks` | `/blocks` и `/user/[id=uuid]/blocks` | `BlocksList.svelte` (`uid?: string`) |
| Фильтры списка блокировок | `user.blocks.filters` | `/blocks/filters` (`?from=…&uid=…`) | `BlocksFiltersForm.svelte` |
| Выбор seed-юзеров (для фильтров и создания) | `user.picker` | `/users/pick` (`?from=…&mode=multiple\|single`) | `UserPicker.svelte` (на базе `UserPickerSteps` + `SeedUsersList`) |
| Добавление блокировки | `user.blocks.create` | `/blocks/new` и `/user/[id=uuid]/blocks/new` | `BlockForm.svelte` (`mode = create`) |
| Редактирование / просмотр записи | `user.blocks.edit` | `/blocks/[blockId=uuid]` и `/user/[id=uuid]/blocks/[blockId=uuid]` | `BlockForm.svelte` (`mode = edit`) |
| Удаление записи | `user.blocks.delete` | `/blocks/[blockId=uuid]/delete` и `/user/[id=uuid]/blocks/[blockId=uuid]/delete` | `BlockDelete.svelte` |

---

## 3. Поэтапный план реализации (`B1`–`B6`)

1. **`B1` — Модель и домен (`schema.ts`, `spec-block.ts`, `ports.ts`, `gateway.server.ts`, `blocks.ts`, `accounts.ts`)**:
   - в `user.block`: `orderable: true` на `until` и `scope`, фильтр `'in'` на `scope` (никаких `JOIN` на `user.auth` не нужно — `auth_id` уже в строке);
   - в `BlockStorePort` и `blocks.ts`: пагинированная выборка `listBlocksPage` (по `uid` или по всем + фильтр `uids`, `scopes`, `state`, `order`, `includeDeleted`), `readBlockDetail`, `assignableBlockScopes`, `saveBlock` (create/edit с правами на `reason`/`until`), `deleteBlock` (soft/hard);
   - фикс `accounts.ts:120` (`canSeeDeleted` → `'account.readDeleted'`) + тесты домена/политик.
2. **`B2` — Переиспользуемый пикер пользователей `UserPicker` (`user.picker` модалка + `/users/pick`)**:
   - выделение из прототипа `UserPickerSteps.svelte` компонента с режимами `multiple` и `single`, работающего и в стопке модалок `#lib/modals`, и без JS через `from`.
3. **`B3` — Список `BlocksList` + `BlocksFiltersForm` (`ui/blocks-list/`)**:
   - пагинатор `user-blocks` (`blocks.*`), карточка строки (с `id` цели в глобальном режиме), фильтры с кнопкой `user.picker` (отключаемой при переданном `uid`), кнопка добавления и клик в редактирование с передачей `id` юзера.
4. **`B4` — Компонент `BlockForm` (`create` / `edit`)**:
   - динамический `<select>` доступных сфер `assignableScopes`, заблокированное визуальное поле `<Input value={targetUserId} disabled readonly />` без `name` и кнопка «Профиль» в глобальном режиме редактирования, кнопка «Удалить» при `canDelete`, `hiddenFields={bound.hidden()}` и `session: userSession`.
5. **`B5` — Компонент `BlockDelete` + подключение в `Profile.svelte` (включая `notCreated`) и очистка старого `ui/profile-blocks/`**.
6. **`B6` — Полная проверка (`npm run check`, стражи, Vitest, JS + no-JS)**.

---

## 4. Принятые решения по финальным развилкам

1. **Встраивание в карточку `Profile.svelte`**: внутри профиля (в обеих ветках — `profile` и `notCreated`) рендерится компактная **кнопка «Блокировки»**, открывающая пару `user.blocks` (`/user/[id]/blocks`).
2. **Клик по строке у зрителя без прав записи (`block.read` / `block.readDeleted` / уже удалённая запись)**: открывается тот же компонент `BlockForm` **в режиме просмотра без возможности отправить** (`canSubmit = false`: все поля заблокированы, кнопки сохранения нет, но в глобальном режиме доступны заблокированное поле `id` пользователя и кнопка открытия профиля; кнопка «Удалить» рендерится отдельно строго по флагу `canDelete`).

---

## 5. Статус выполнения

- [x] `B1` (`bba2357`) — модель `user.block`, доменные операции `listBlocksPage` / `readBlockDetail` / `readBlockCreateContext` / `saveBlock` / `deleteBlock`, `blocksAdapter`, фасад `auth(event)`, фикс `accounts.ts:120` (`'account.readDeleted'`).
- [x] `B2` (`41426de`) — переиспользуемый `UserPicker.svelte` (`single` / `multiple`), `UserPickerModal.svelte`, `/users/pick`, `user.picker`.
- [x] `B3` (`5176473`) — `BlocksList.svelte`, `BlocksFiltersForm.svelte`, `BlockCard.svelte`, `/blocks`, `/user/[id=uuid]/blocks`, `/blocks/filters`, `user.blocks`, `user.blocks.filters`.
- [x] `B4` (`9abf139`) — `BlockForm.svelte` (`create` / `edit` / read-only `canSubmit = false`), маршруты и модалки создания/редактирования, фикс `ProfilePrivacy.svelte` (`hiddenFields={bound.hidden()}`, `session: userSession`).
- [x] `B5` (`d44de4f`) — `BlockDelete.svelte` (`HoldButton` + условный чекбокс `hard`), кнопка «Блокировки» в обеих ветках `Profile.svelte` (`profile` и `notCreated`), снятие лишнего `listByTarget` в `profile.ts`, удаление устаревшего `ui/profile-blocks/`.
- [x] `B6` — фиксы синхронизации чистой БД (`user-block-backfill-v2` в `src/server/db.server.ts`), `route` модалки `user.picker` и SSR-снапшота `/users/pick`, расширение PGlite/unit/SSR-тестов и полный браузерный прогон `test/browser/blocks.mjs` (JS + no-JS).

