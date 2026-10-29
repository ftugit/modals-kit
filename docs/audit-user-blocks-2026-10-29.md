# Аудит и целевая архитектура: компонент блокировок (`user.block`)

**Дата:** 2026-10-29  
**База проверки:** ветка `img` (`5fd04f2` / `b92d08a`)  
**Статус:** документ аудита и проектирования для поочерёдного редактирования (без правок рантайм-кода)

---

## 1. Аудит текущей реализации (`src/content/user/ui/profile-blocks/`)

### 1.1. Что уже есть в домене и UI

1. **Домен и модель БД (`src/content/user/schema.ts`, `blocks.ts`, `spec-block.ts`)**:
   - Ресурс `user.block` (`public.user_block`): поля `id`, `auth_id` (`immutable`), `scope` (`immutable`), `reason` (`update: ['block.edit', 'admin']`), `until` (`update: ['moderator', 'block.edit', 'admin']`), `by` (`immutable`), плюс `timestamps` с `deleted_at` (`readDeleted: ['server', 'block.readDeleted', 'admin']`).
   - Политики модели (с учётом коммита `5fd04f2`):
     - `select` (живые строки): владелец цели + `server`, `moderator`, `block.read`, `block.edit`, `admin`;
     - `selectDeleted` (чтение с удалёнными): тот же круг + `block.readDeleted`;
     - `insert` / `update` / `delete`: круг записи (`moderator`, `block.edit`, `admin`);
     - окончательное удаление `delete(id, { hard: true })`: слой `#lib/db` требует связку политики `delete` **и** гранта `readDeleted` (`admin`, либо `block.edit`/`moderator` + `block.readDeleted`).
   - Экраны факта бана при входе (`BanNotice.svelte`, `RestrictionsNotice.svelte` и плашка `fullBlock` в `Profile.svelte`) построены поверх `<Acl>` и работают корректно.

2. **Архитектурное несоответствие `ui/profile-blocks` остальным компонентам `user/ui`**:
   - **Не самодостаточный компонент**: в отличие от `Profile.svelte`, `ProfileForm.svelte`, `ProfileDelete.svelte` и `SeedUsersList.svelte`, `ProfileBlocks.svelte` не имеет собственной пары «маршрут + модалка», не умеет сам запрашивать данные (хотя `listBlocks` в `blocks.ts` уже написан, в приложении он нигде не вызывается) и не общается с носителем через `onAcl` / `<Acl>`.
   - **Потерян на аккаунтах без созданного профиля (`Profile.svelte:144`)**: `<ProfileBlocks>` вставлен только в ветку `{:else if data?.profile}`, а в ветке `{:else if data?.notCreated}` (свежий seed-аккаунт без анкеты профиля) пропущен — забанить такой аккаунт из UI невозможно.
   - **Не использует возможности модели `user.block`**: в UI нет ни пагинации, ни фильтрации/сортировки истории, ни правки `reason` / `until` существующей записи, ни мягкого и полного удаления записей.
   - **Не подключён к сессии и продолжению форм**: в `bindComponentForm` не переданы `session: userSession` и `continuation` (`form?.result`).

3. **Критические баги текущей реализации `ProfileBlocks.svelte` и `BlockLift.svelte`**:
   - **100% отказ при отправке «Заблокировать» и «Снять» (и с JS, и без JS)**: вызван `mirrorToField(bound, 'subject', ...)`, но в DOM внутри `<Form>` отсутствуют `<div hidden aria-hidden="true"><Field of={bound.f.subject} /></div>` и `block_id`. `new FormData(el, submitter)` отправляет пустой `subject` → сервер всегда отвечает `auth.identity-unknown`.
   - **Сломан режим без JS и падает `assertEnvelope` в DEV**: в `<Form>` не передан `hiddenFields={bound.hidden()}` (кстати, тот же пропуск есть в `ProfilePrivacy.svelte:35`). Без JS POST уходит без `__form_id` и получает `405 Method Not Allowed`.
   - **Бесконечный реактивный цикл (`effect_update_depth_exceeded`) на длительности**: `$effect` в `ProfileBlocks.svelte:41-48` читает `bound.f.dur_n.value` / `bound.f.dur_unit.value` из `$state.raw` снимка и тут же вызывает `bound.f.until.onInput(...)`, заменяющий тот же снимок новым объектом.
   - **Список не обновляется после действия с JS**: после успешного ответа ни `ProfileBlocks`, ни `BlockLift` не триггерят перезапрос данных и не очищают форму.
   - **Пустая причина даёт `auth.forbidden` вместо ошибки поля**: в `form.ts:30` у `reason` стоит `v.minLength(1)` без `v.required()`; в `#lib/form` `minLength` пропускает пустую строку, запрос уходит на сервер и падает с «Доступ запрещён», а `specBlocks.reasonRequired` остаётся мёртвым кодом.
   - **Огрехи UX**: ручной `name="intent"` вместо `{...bound.intent('lift')}` (нет `formnovalidate`), поля даты/длительности не скрываются при включённом «Навсегда», форма бана рендерится у модератора даже в собственном профиле (`isOwn`), `by` выводится сырым UUID.

4. **Попутная находка в соседнем списке `accounts.ts:120` (после коммита `5fd04f2`)**:
   - В `src/content/user/accounts.ts:120` флаг `canSeeDeleted` всё ещё проверяет `g.perms.includes('account.read')`, хотя `5fd04f2` перенёс грант `readDeleted` модели `user.auth` в отдельное право `'account.readDeleted'`. При запросе `?users.state=deleted` пользователем с `account.read` без `account.readDeleted` вызов `api().select(..., { includeDeleted: true })` упадёт с `forbidden`. (Исправим отдельно или первым подшагом.)

---

## 2. Целевая архитектура компонентов блокировок (по новой постановке)

Система блокировок приводится к единому канону `user/ui` по образцу связки **`SeedUsersList` + `SeedUsersFiltersForm` + `ProfileForm` + `ProfileDelete`**: четыре самодостаточных строительных блока, у каждого своя пара «модалка + роут», полная работа с JS и без JS, а носители отвечают только за `<Acl>`.

### 2.1. Список блокировок с пагинатором и фильтрами (`BlocksList`)

По образцу `SeedUsersList.svelte` + `ui/seed-users/source.ts`:

- **Вход и самодостаточность**:
  - Принимает `uid: string` (аккаунт-цель, чьи блокировки смотрим) и опциональный `initial` от серверного `load` маршрута `/user/[id]/blocks` (при рендере в модалке или встроенной секции без `initial` — сам подтягивает первую порцию через `preloadData` того же роута; отказ отдаёт наверх через `onAcl`).
  - *(Опциональное расширение для обсуждения в §4: если `uid` сделать необязательным, тот же компонент на маршруте `/blocks` сможет показывать общий журнал всех блокировок по системе.)*
- **Пагинатор (`#lib/paginate` + `#components/paginator`)**:
  - Собственное адресное пространство `blocks` (`?blocks=2`, `?blocks.size=30`, `?blocks.ord=…`, `?blocks.scope=…`, `?blocks.state=…`), не конфликтующее с `?users` и `?modal`.
  - Режим `accumulate`, догрузка порций через `preloadData` того же `load` (одна точка доступа к данным, без отдельного REST-эндпоинта).
  - Доработка схемы `user.block` в `src/content/user/schema.ts`:
    - добавить `orderable: true` на `until` и `scope` (`id`, `created_at`, `updated_at`, `deleted_at` уже `orderable`);
    - расширить `scope.filters` до `['eq', 'in']` для фильтрации по одному или нескольким ключам сфер.
- **Фильтры списка (`BlocksFiltersForm` — модалка `user.blocks.filters` + fallback-страница без JS)**:
  - **Сортировка (`blocks.ord`)**:
    - `created-desc` (по умолчанию — сначала новые), `created-asc`;
    - `until-asc`, `until-desc` (по сроку окончания);
    - `deleted-desc`, `deleted-asc` — доступны только при `canSeeDeleted` (`block.readDeleted` / `admin`).
  - **Число элементов на страницу (`blocks.size`)**: целое `30..100` (по умолчанию `30`, как в `SeedUsersList`).
  - **Фильтр по ключам сфер (`blocks.scope`)**: выбор ключей из каталога `BLOCK_SCOPES` (`auth`, `profile.delete`, `account.delete` — один или несколько ключей).
  - **Фильтр по состоянию (`blocks.state`)**:
    - `all` (все живые — и активные, и истёкшие/снятые) / `active` (только действующие сейчас) / `expired` (только истёкшие и снятые);
    - `deleted` (мягко удалённые) — опция появляется только при `canSeeDeleted` (`block.readDeleted` / `admin`).
- **Верхняя панель списка и действия строк**:
  - Счётчик «всего: N», кнопка **«Фильтры (k)»** (с числом активных отличий от дефолта).
  - Рядом — кнопка **«Добавить блокировку»** (пара «модалка + роут» `user.blocks.create`), видимая только когда `assignableScopes.length > 0` и цель — не сам вызывающий (`uid !== actor.id`).
  - **Нажатие на элемент списка**: каждая карточка обёрнута ссылкой (`asModalLink` / `rowAttrs`), открывающей **тот же компонент `BlockForm`, но в режиме редактирования** этой записи (`blockId = item.id`), если у пользователя есть право редактирования/удаления записи (иначе — просмотр / неактивная ссылка, уточним в §4).

---

### 2.2. Единый компонент создания и редактирования блокировки (`BlockForm`)

По образцу `ProfileForm.svelte` — один самодостаточный компонент формы на оба режима:

- **Режим создания (`blockId` не передан, маршрут `/user/[id]/blocks/new` + модалка `user.blocks.create`)**:
  - **`<select>` выбора ключа сферы (`scope`)**: опции приходят с сервера — **строго только те варианты из `BLOCK_SCOPES`, которые текущий пользователь имеет право назначать** (`assignableScopes`). Если список пуст (или цель `id === actor.id`) — носитель показывает `<Acl>` («недостаточно прав»).
  - **Поля для заполнения**:
    - `reason` — обязательная строка (`v.required()`, `v.maxLength(200)`, с текстом `specBlocks.reasonRequired`);
    - `forever` — чекбокс «Навсегда»;
    - при выключенном `forever`: поле даты/времени `until` (`datetime-local`) + удобный пересчёт длительности в JS по явному событию ввода (без `$effect`-циклов).
  - Скрытые поля формы рендерятся в DOM (`<div hidden aria-hidden="true"><Field ... /></div>`) + передаётся `hiddenFields={bound.hidden()}` и `session: userSession`.

- **Режим редактирования (`blockId` передан, маршрут `/user/[id]/blocks/[blockId]/edit` + модалка `user.blocks.edit`, открывается кликом по пункту списка)**:
  - Сервер загружает конкретную запись `blockId` (с учётом `includeDeleted` для держателей `block.readDeleted`/`admin`) и вычисляет флаги возможностей текущего актора по правилам модели `user.block`:
    - **`scope`**: в модели `user.block` поле `scope` помечено `immutable: true` — в режиме редактирования `<select>` показывает текущую сферу в `disabled` виде (подменить сферу задним числом нельзя).
    - **`reason`**: редактируемо при `canEditReason` (`block.edit` или `admin`); для роли `moderator` (которой модель запрещает `update` поля `reason`) поле отображается `disabled` / только для чтения.
    - **Срок (`forever` / `until`) + действие досрочного снятия**: редактируемы всем кругом записи (`moderator`, `block.edit`, `admin`) на живой записи (включая возможность снять активную блокировку сразу или изменить срок `until`).
  - **Кнопка «Удалить» справа сверху** (по эталону `deleteId` в `ProfileForm.svelte`):
    - ведёт на пару «модалка + роут» удаления `user.blocks.delete` (`/user/[id]/blocks/[blockId]/delete`);
    - рендерится **только если `canDelete === true`**:
      - на **живой** записи (`deletedAt === null`): у круга записи (`moderator`, `block.edit`, `admin`);
      - на **уже мягко удалённой** записи (`deletedAt !== null`): только у обладателей связки полного удаления `canHardDelete` (`admin`, либо `(moderator | block.edit) + block.readDeleted`). Пользователь с одним только `block.readDeleted` видит удалённую запись, но кнопки «Удалить» не получает.

---

### 2.3. Компонент удаления блокировки (`BlockDelete`)

По образцу `ProfileDelete.svelte` + `ProfileDeleteModal.svelte`:

- **Носители**: маршрут `/user/[id]/blocks/[blockId]/delete` + модалка `user.blocks.delete` (гейтят доступ по `canDelete` через `<Acl>`).
- **Внутри компонента `BlockDelete.svelte`**:
  - Краткая сводка удаляемой записи (сфера, причина, статус) и предупреждение о последствиях.
  - **Чекбокс «Удалить полностью (без возможности восстановления)» (`hard`)**:
    - показывается **только если `canHardDelete === true`** (у актора есть и право `delete` модели, и грант `block.readDeleted`, либо роль `admin` — строго по правилу слоя `#lib/db` из `5fd04f2`);
    - если запись уже находится в мягко удалённом состоянии (`alreadyDeleted === true`) и открыта с `canHardDelete === true`, удаление сразу выполняется как окончательное (`hard = true`), чекбокс либо зафиксирован включённым, либо заменён прямым предупреждением об окончательном удалении.
  - Подтверждение удержанием `<HoldButton variant="destructive" seconds={holdSeconds}>` + `hiddenFields={bound.hidden()}` + `session: userSession` (одинаково работает с JS и без JS).

---

### 2.4. Сводная таблица пар «модалка + роут»

| Назначение | Имя модалки (`modals.ts`) | Маршрут (`routes.ts`) | Внутренний компонент |
|---|---|---|---|
| Список блокировок | `user.blocks` | `/user/[id=uuid]/blocks` | `BlocksList.svelte` |
| Фильтры списка (no-JS fallback) | `user.blocks.filters` | `/user/[id=uuid]/blocks/filters` *(или общий `/blocks/filters?from=…`)* | `BlocksFiltersForm.svelte` |
| Добавление блокировки | `user.blocks.create` | `/user/[id=uuid]/blocks/new` | `BlockForm.svelte` (`mode = create`) |
| Редактирование записи (клик по строке) | `user.blocks.edit` | `/user/[id=uuid]/blocks/[blockId=uuid]/edit` | `BlockForm.svelte` (`mode = edit`, кнопка «Удалить» при `canDelete`) |
| Удаление записи | `user.blocks.delete` | `/user/[id=uuid]/blocks/[blockId=uuid]/delete` | `BlockDelete.svelte` (чекбокс полного удаления при `canHardDelete`) |

---

## 3. Предварительный поэтапный план реализации (`B1`–`B5`)

1. **`B1` — Модель и домен блокировок (`schema.ts`, `spec-block.ts`, `ports.ts`, `gateway.server.ts`, `blocks.ts`)**:
   - добавить `orderable: true` на `until` и `scope`, фильтр `'in'` на `scope`;
   - расширить `BlockStorePort` методами пагинированной выборки `listPage(ctx, { authId?, page, pageSize, filter, order, includeDeleted })`, чтения одной записи `getById(ctx, id, { includeDeleted })`, правки `update(ctx, id, patch)` (`reason` / `until`) и удаления `remove(ctx, id, { hard })`;
   - реализовать в `blocks.ts`: `assignableBlockScopes(perms)`, `listBlocksPage(...)`, `readBlockForEdit(...)`, `saveBlock(...)` (создание + редактирование с проверкой прав на `reason`/`until`), `deleteBlock(...)` (мягкое и `hard` удаление) + unit/PGlite-тесты;
   - *(попутно поправить `accounts.ts:120` `canSeeDeleted` на `'account.readDeleted'`).*
2. **`B2` — Источник пагинатора и компонент списка с фильтрами (`ui/blocks-list/`, `BlocksFiltersForm.svelte`)**:
   - регистрация пагинатора `user-blocks` (`?blocks`, `?blocks.size`, `?blocks.ord`, `?blocks.scope`, `?blocks.state`);
   - `BlocksList.svelte` с кнопками «Фильтры» и «Добавить блокировку» + кликабельными строками;
   - модалки и маршруты списка и фильтров (JS + no-JS `from`).
3. **`B3` — Единый компонент создания/редактирования `BlockForm.svelte` (`ui/block-form/`)**:
   - изоморфная форма с динамическим `<select>` доступных сфер `assignableScopes`, корректными `hiddenFields={bound.hidden()}`, DOM-полями `subject`/`block_id`, `session: userSession`, `v.required()` на `reason`, чистым пересчётом срока без реактивных петель и кнопкой «Удалить» при `canDelete`;
   - маршруты и модалки `user.blocks.create` и `user.blocks.edit`.
4. **`B4` — Компонент удаления `BlockDelete.svelte` (`ui/block-delete/`) и интеграция в `Profile.svelte`**:
   - форма удаления с `HoldButton` и условным чекбоксом полного удаления при `canHardDelete`;
   - подключение в `Profile.svelte` (в обеих ветках — `data.profile` **и** `data.notCreated`!) и удаление старого сломанного `ui/profile-blocks/`.
5. **`B5` — Полная проверка**:
   - `npm run check`, `core-purity`, `public-api`, `layer-guard`, Vitest (домен + формы + SSR) и сквозная проверка с JS и без JS.

---

## 4. Вопросы для поочерёдного редактирования плана

Предлагаю пройтись по развилкам по порядку:

1. **Охват списка блокировок (по одному юзеру или также глобальный?)**:
   - Вариант 1: список всегда привязан к конкретному аккаунту `uid` (`/user/[id]/blocks` + встраивание/кнопка в профиле `Profile.svelte`).
   - Вариант 2: `uid` опционален — с `uid` список показывает баны конкретного аккаунта, а без `uid` (`/blocks`, модалка `user.blocks.all`) показывает все блокировки по системе (в строке дополнительно выводится целевой аккаунт, а при создании без `uid` можно выбрать цель или кнопка создания только внутри профиля юзера).
2. **Встраивание в карточку `Profile.svelte`**:
   - Внутри `Profile.svelte` (и для созданного профиля, и для `notCreated`) рендерим сам `<BlocksList uid={uid} />` прямо под профилем, или ставим компактную кнопку/плашку «Блокировки (активных: N)», открывающую пару `user.blocks` (модалку / роут `/user/[id]/blocks`)?
3. **Клик по строке списка у читателя без прав записи (`block.read` или сам владелец)**:
   - Если у зрителя есть только чтение (`block.read`), клик по строке:
     - а) не активен (вся информация — сфера, причина, даты, кем выдан — уже видна в карточке строки), а переход в `BlockForm (edit)` включён только при наличии прав правки/удаления;
     - б) открывает карточку/форму в полностью `read-only` виде?
4. **Гранулярность назначения сфер (`assignableScopes`)**:
   - Сейчас в модели все три сферы (`auth`, `profile.delete`, `account.delete`) доступны всему кругу `BLOCK_WRITERS` (`moderator`, `block.edit`, `admin`). Оставляем пока единый круг с серверной функцией `assignableBlockScopes(actor)` (чтобы `<select>` уже строился от ответа сервера и легко сужался по сферам в будущем), или сразу разводим какие-то сферы по разным правам (например, запреты удаления — только `block.edit`/`admin`, а `moderator` — только `auth`)?
