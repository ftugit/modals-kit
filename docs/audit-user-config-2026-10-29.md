# Аудит и план: универсальный компонент конфига пользователя (`user.config`)

**Дата:** 2026-10-29  
**База проверки:** ветка `img` после стягивания `origin/img` (`5fd04f2`)  
**Статус:** только аудит и план (без правок рантайм-кода)

---

## 1. Аудит текущего состояния `user.config` (с учётом коммитов второго ИИ до `5fd04f2`)

### 1.1. Что уже реализовано (этапы 8–10 + `5fd04f2`)

1. **Модель БД `user.config` (`src/content/user/schema.ts`, `src/server/db.server.ts`)**:
   - Ресурс `key: 'user.config'` (без суффикса `.v1`, как и `user.block`), таблица `public.user_config`, поля `{ id, auth_id, key, value, schema }`.
   - **Мягкого удаления у `user.config` нет** (`timestamps: { createdAt, updatedAt }` без `deletedAt` — находка `A5` из `docs/audit-delete-rights-2026-10-29.md`). Поэтому ужесточение из `5fd04f2` (`delete({ hard: true })` требует грант `readDeleted` на soft-delete ресурсах в `src/lib/db/resource.ts`) удаление строк конфига не затрагивает (хотя сам флаг `{ hard: true }` в `configAdapter().remove` избыточен).
   - `auth_id IS NULL` — глобальное умолчание ключа с полной схемой прав `{ editDefault, assign, editUser, deleteUser }` (частичный уникальный индекс `user_config_uq_global` по `(key) WHERE auth_id IS NULL`).
   - `auth_id = <uuid>` — индивидуальное переопределение пользователя с упрощённой схемой `{ editUser, deleteUser } | null` (частичный уникальный индекс `user_config_uq_user` по `(auth_id, key) WHERE auth_id IS NOT NULL`).
   - Сиды при старте (`src/server/db.server.ts`):
     - `profile.visibility` (`value: 'all'`, `assign/editUser/deleteUser: ['owner', 'admin', 'profile.edit']`, `editDefault: ['admin']`);
     - `session.ipLock` (`value: false`, все четыре правила `['admin']`).

2. **Каталог известных коду ключей — `src/content/user/spec-config.ts`**:
   - Файл описания ключей **уже существует** и экспортирует `VISIBILITY_KEY`, `CONFIG_KEYS` (`'profile.visibility'`, `'session.ipLock'`), `ConfigKey`, `ConfigKeyInfo`, `isConfigKey(key)` и `bootstrapOf(key)` (эти экспорты уже импортируются в `profile.ts` и `config-api.ts`, обратную совместимость сохраняем).
   - **Чего не хватает в `spec-config.ts` для универсального UI**:
     - сейчас в `ConfigKeyInfo` лежат только `{ title, description, bootstrap? }`;
     - нет описания UI-контрола (`select` / `radio` / `checkbox` / `number` / `text`);
     - нет вариантов выбора `options` (подписи вариантов `profile.visibility` лежат отдельно в `src/content/user/spec-profile.ts`);
     - нет правил валидации (`v.*`) и кодека приведения значения формы ↔ JSON-значение `user_config.value`;
     - нет идентификатора группы/шага (`group`) для разбивки длинного каталога ключей на шаги `#components/steps`.

3. **Доменный API — `src/content/user/config-api.ts`**:
   - По решению из `docs/audit-delete-rights-2026-10-29.md` (§4) и `docs/plan-auth-session-rights.md`, в отличие от `auth`/`session`/`block`, модель `user.config` **осознанно остаётся на системном адаптере `ports.settings` (`SYSTEM`)**, так как исключительные права хранятся в JSON-поле `schema` конкретных строк данных, чего статической политикой ресурса не выразить.
   - `ruleAllows(actor, targetId, roles)` проверяет:
     - `'admin'` — проходит всегда;
     - `'owner'` — проходит при `actor.id === targetId`;
     - остальные строки сверяются с `actor.perms`.
   - **Нюанс `validSchema` после добавления `MODERATOR_ROLE` и `5fd04f2`**:
     - `validSchema` в `config-api.ts:43` пропускает `'owner'`, `ADMIN_ROLE` и ключи `PERMISSIONS` (включая новый `'account.readDeleted'` из `5fd04f2`), но **не включает `MODERATOR_ROLE` (`'moderator'`)**, так как `MODERATOR_ROLE` в `permissions.ts` объявлен отдельной константой вне `PERMISSIONS` (как `ADMIN_ROLE`). Если в будущем потребуется выдавать модератору право на конкретный ключ конфига через `schema`, в `validSchema` стоит добавить `r === MODERATOR_ROLE`.
   - **Инвариант хранения уже реализован в `setUserKey`**: если новое значение совпадает с глобальным умолчанием (`sameValue(value, defaultValue)`), существующая юзерская строка удаляется, а новая не создаётся.
   - **Нюанс проверки цели после `5fd04f2` (`account.readDeleted`)**:
     - `ports.auths.get(userId)` читает `user.auth` от `SYSTEM` с `{ includeDeleted: true }`. После коммита `5fd04f2` право `account.read` больше не открывает мягко удалённые аккаунты (`deletedAt !== null`) — их видят только `account.readDeleted` и `admin`. Поэтому при чтении/записи чужого конфига (`subject !== actor.id`), если целевой аккаунт мягко удалён, а у вызывающего нет `admin` / `account.readDeleted`, цель не должна раскрываться наружу (единый отказ «не найдено / запрещено», как в `Profile.svelte`).
   - **Чего не хватает в `ConfigStorePort` и `config-api.ts`**:
     - В `ConfigStorePort` нет батч-чтения всех строк одного пользователя `rowsByUser(authId: string): Promise<ConfigKeyRow[]>` (есть только одиночный `row(authId, key)`).
     - Нет батч-операций `listEditableUserConfig` и `saveEditableUserConfig` для динамической формы.

4. **Два разных конфига в `src/content/user/`**:
   - `src/content/user/config.ts` — старый серверный кэш-конфиг параметров модуля (`accessTtlSec`, `deviceTtlSec`, `sessionRecreate`, `nicknameForbidden`, `challengeTtlSec`, `deleteGraceDays`, `holdSeconds`).
   - `src/content/user/config-api.ts` + `spec-config.ts` — модель `user.config` в БД с глобальными умолчаниями и пользовательскими переопределениями. Проектируемый UI-компонент строится именно над `user.config`.

---

## 2. Сравнение трёх подходов к динамической форме настроек

### Вариант А — Генератор полей из демо `/fields` (`FieldSpec` + `defineForm({ from })` + `<SchemaFields>`)

**Как устроен в репозитории (`src/lib/form/spec.ts`, `src/components/fields/SchemaFields.svelte`, `src/routes/(site)/(app)/fields/`):**
- Форма строится через `defineForm({ from: FieldSpec[] })` (компиляция через `compileFieldSpec` с префиксом `u_`), UI рисуется компонентом `<SchemaFields>` через `{#each form.from()}`.

**Почему для конфига создаёт лишнее трение:**
1. **Запрет точек в именах полей**: `FieldSpec.name` в `src/lib/form/spec.ts:22` требует короткое имя **без точек** (`nameProblem`), тогда как все ключи `user.config` содержат точку (`profile.visibility`, `session.ipLock`). Потребовалось бы кодирование/декодирование имён и префиксов.
2. **Урезан под недоверенный пользовательский ввод**: `FieldSpec` проектировался для конструктора анкет в браузере (запрет функций, `defaultAsString` только строкой, ограниченный набор правил). А `spec-config.ts` — **доверенный код приложения**.
3. **Плоская карточка без `Steps` и метаданных ключа**: `<SchemaFields>` рисует плоский список без разбивки по `#components/steps`, без индикатора «По умолчанию / Индивидуально» (`assigned`) и без кнопки возврата конкретного поля к глобальному умолчанию.

---

### Вариант Б — По образцу блокировок (`src/content/user/ui/profile-blocks/ProfileBlocks.svelte`)

**Как устроен в репозитории:**
- Блокировки — **журнал событий (append-only лог истории)**: `1 аккаунт → N записей` со статической формой наложения одной блокировки (`scope`, `reason`, `forever`, `until`) и отдельными микро-формами `<BlockLift>` на каждую активную строку.

**Почему не подходит для конфига:**
- Конфиг — не журнал событий, а **срез текущего состояния `key → effectiveValue`**, где у разных ключей разные типы контролов (`radio`/`select`, `checkbox`, `number`, `text`), а возврат к умолчанию стирает юзерскую строку (`setUserKey`). Заставлять выбирать ключи по одному из выпадающего списка ломает UX панели настроек и разбивку по шагам.

---

### Вариант В (рекомендуемый) — По образцу фильтров: сборка `defineForm({ fields })` из схемы `spec-config.ts` + собственный UI с `Steps`

**Почему это самый чистый и нативный вариант в архитектуре `modals-kit`:**
1. **Точечные ключи легальны из коробки**: обычный `defineForm({ fields })` штатно принимает ключи с точками (`'profile.visibility'`, `'session.ipLock'`), как в `SeedUsersFiltersForm.svelte` (`'users.nick'`, `'users.ord'`) и `filter-form.svelte.ts`.
2. **Единый изоморфный билдер `buildUserConfigForm(items)`**:
   - И на клиенте, и на сервере собирает идентичный `FormDescription` строго из разрешённых сервером ключей `spec-config.ts` + `subject: field.hidden(...)`.
   - Любой ключ в БД без описания в `spec-config.ts` (`!isConfigKey(key)`) отбрасывается: **он не рисуется в UI и не принимается при POST**.
3. **Нативная серверная защита `#lib/form` при 0 правок в `#lib/form`**:
   - В `src/hooks/component-form/server.server.ts` `resolveDescription(entry, event)` вызывается синхронно при поиске `formId` в реестре — ходить в БД внутри `description` нельзя.
   - При этом в `#lib/form/server.ts` слои `namesLayer` и `checkStale` уже асинхронно вызывают `source.resolve()` **до** проверки имён полей и валидации.
   - Расширение `source` в `src/hooks/component-form/{types.ts,server.server.ts}` до `FormSource | ((event: RequestEvent, form: FormData) => FormSource | Promise<FormSource>)` (3 строки в `#hooks/component-form`, **0 байт в бюджете `#lib/form`**) позволяет поднять на POST точную схему для `(actor, subject)`:
     - недоступный/подделанный ключ автоматически отвергается слоем `namesLayer` (`400 request.unexpected-field`);
     - изменение прав на ключи при открытой форме штатно ловится протоколом `checkStale` (`fieldSetHash`) с сохранением введённых значений.
4. **Чистая разбивка на шаги (`#components/steps`)**:
   - Каждому ключу в `spec-config.ts` задаётся `group` из `CONFIG_GROUPS`.
   - Шаги с `0` доступных пользователю ключей автоматически убираются.
   - Если активна 1 группа — лишняя навигация шагов не рисуется; если групп ≥ 2 — включается `<Steps host={steps}>` (`mode: 'local'`, уникальный `key: 'user_config_step'`, чтобы не конфликтовать в глобальном `claimQuery`), а поля неактивных шагов скрываются через `class="hidden"`, сохраняя единый `<Form>` для SSR/no-JS и общего сохранения.
5. **Полноценный UX каждого ключа**:
   - Рядом со штатным `<Field of={bound.f[item.key]} />` выводятся описание из `spec-config.ts`, статус «По умолчанию / Индивидуально» (`assigned`) и кнопка «Сбросить к умолчанию» (ставит `defaultValue`, а при сохранении `setUserKey` удаляет строку переопределения).

**Рекомендация:** реализовывать **Вариант В**.

---

## 3. Учтённые доменные детали

1. **Критерий права на редактирование ключа (`canEditKey`)**:
   - Если юзерская строка **уже есть** (`own !== undefined`): проверяется `ruleAllows(actor, targetId, own.schema?.editUser ?? def?.schema?.editUser)` (даёт и смену значения, и возврат к умолчанию с удалением строки).
   - Если юзерской строки **ещё нет** (`own === undefined`): проверяется `ruleAllows(actor, targetId, def?.schema?.assign)` (смена умолчания создаст строку; оставление умолчания — `no-op`).
2. **Ключи «владельцу только чтение» (`session.ipLock`) и право `config.read`**:
   - В `spec-config.ts:30` и `config-api.ts:96` явно отмечен сценарий `session.ipLock`: *«Закрепляется администратором, владельцу — только чтение»* (плюс `config.read` для чтения чужого конфига).
   - В базовом варианте (строго по постановке задачи) в схему формы и рендер попадают **только редактируемые** ключи. Если нужно также показывать закреплённые нередактируемые ключи (например `session.ipLock = true` на своём аккаунте или все ключи под `config.read`), их легко отдать отдельным списком `readonlyItems` без включения в мутабельные поля `FormDescription`.
3. **Однократное чтение среза за POST**:
   - Срез `editableConfigSlice` кэшируется на время одного `RequestEvent` (`WeakMap`), чтобы `authorize`, `source.resolve` и `execute` не обращались к БД повторно.

---

## 4. Поэтапный план реализации

### Этап `C1` — Расширение `src/content/user/spec-config.ts`
- Добавить каталог групп `CONFIG_GROUPS` (`'profile'`, `'security'` — с заделом под расширение).
- Расширить `ConfigKeyInfo` (сохранив существующие экспорты `VISIBILITY_KEY`, `CONFIG_KEYS`, `ConfigKey`, `isConfigKey`, `bootstrapOf`):
  - `group: ConfigGroupKey`;
  - `title`, `description`, `bootstrap`;
  - фабрика поля формы `toField(value)` (`field.select` / `field.radio` / `field.checkbox` / `field.number` / `field.text` + `v.*`) и кодек значения.
- Описать `'profile.visibility'` (варианты из `spec-profile.ts`) и `'session.ipLock'` (`field.checkbox`).
- Зафиксировать инвариант: ключ из БД вне `CONFIG_KEYS` (`!isConfigKey(key)`) не рендерится и не попадает в форму.

### Этап `C2` — Батч-чтение и срез прав в `ports.ts`, `gateway.server.ts`, `config-api.ts`
- Добавить в `ConfigStorePort` метод `rowsByUser(authId: string): Promise<ConfigKeyRow[]>` (реализация в `gateway.server.ts` одним `select` по `auth_id = authId` + стаб в `config-api.test.ts`).
- В `config-api.ts` добавить:
  - `listEditableUserConfig(ports, token, subject?)` — разрешение цели (`subject?.trim() || actor.id`), проверка существования и видимости удалённого аккаунта (с учётом `account.readDeleted` из `5fd04f2`), расчёт редактируемых ключей из `CONFIG_KEYS` по `defaultsOf` + `rowsByUser`;
  - `saveEditableUserConfig(ports, token, subject, values)` — повторная серверная проверка прав по каждому ключу, пропуск неизменившихся значений и сохранение с удалением юзерской строки при совпадении с умолчанием.
- Покрыть юнит-тестами в `config-api.test.ts` (свой конфиг, чужой под `profile.edit`, чужой под `admin`, мягко удалённая цель без `account.readDeleted`, игнор ключа вне `spec-config.ts`, удаление строки при возврате к умолчанию).

### Этап `C3` — Контекстный `source` в `#hooks/component-form` и изоморфная форма `user-config`
- В `src/hooks/component-form/{types.ts,server.server.ts}` разрешить `source?: FormSource | ((event: RequestEvent, form: FormData) => FormSource | Promise<FormSource>)`.
- Создать `src/content/user/ui/user-config/form.ts` (`buildUserConfigForm`, группировка по `CONFIG_GROUPS` с отсевом пустых шагов).
- Создать `src/content/user/ui/user-config/config.form.server.ts` и зарегистрировать форму в `src/hooks.server.ts`.

### Этап `C4` — Самодостаточный компонент `UserConfig.svelte` и тонкие носители
- Создать `src/content/user/ui/user-config/UserConfig.svelte` по эталонам `Profile.svelte` и `ProfileForm.svelte`:
  - работает на текущего пользователя (`subject` не передан) и на целевого (`subject = uuid`);
  - при наличии `initial` от серверного `load` рендерится сразу в SSR и работает без JS; без `initial` (в модалке или при встраивании) сам запрашивает срез через `preloadData` единого маршрута конфига и отдаёт отказ носителю через `onAcl`;
  - поддерживает шаги `<Steps>` (`mode: 'local'`, `key: 'user_config_step'`) при 2+ непустых группах, статус ключа и кнопку «По умолчанию».
- Подключить тонкие носители (маршруты `/user/config` и `/user/[id=uuid]/config` + модалка в реестре модалок), которые отвечают только за `<Acl>`.

### Этап `C5` — Верификация
- Прогон `npm run check`, `node tooling/core-purity.mjs`, `node tooling/public-api.mjs`, `layer-guard`, unit-тестов `config-api.test.ts` и интеграционных тестов формы `user-config` (JS + no-JS).

---

## 5. Решения владельца (зафиксированы 2026-10-29 — план готов к работе, Шаг №2 после `defineForm`)

1. **`ProfilePrivacy.svelte` на карточке профиля**: заменяем отдельный виджет приватности кнопкой «Настройки» (одна точка входа — пара «модалка + страница» через `CONFIG_ACL` и `useGrants`, плюс пункт в меню пользователя).
2. **Ключи «только чтение» (`session.ipLock` для владельца / `config.read` для чужого)**: показываем в `UserConfig` информационными заблокированными (`read-only`) строками с пометкой источника («задано администратором / по умолчанию»), чтобы пользователь видел действующие правила своего аккаунта.
3. **Токены прав/ролей в `user_config.schema`**: роль и право технически идентичны — `validSchema` принимает любые валидные строковые идентификаторы токенов (`owner`, `admin`, `config.edit`, `moderator`, `a.b.c`), проверяемые единообразно через `checkGrants`.
4. **Адреса носителей и контракт ошибок**: маршруты `/user/config` (свои настройки) + `/user/[id=uuid]/config` (целевой пользователь) и модалка `user.config.edit`; серверная форма сразу работает на контракте машинных кодов ошибок с расшифровкой в UI.
