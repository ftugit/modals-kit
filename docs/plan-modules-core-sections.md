# План: `core` / `modules` / `sections`

**Статус:** только план. Код не перемещён, файлы не менялись.

**Цель:** разложить `src` на ядро, модули и страницы; включить модули через `manifest.json`; сделать `core` независимым от доменов, а `user/base` — от опциональных субмодулей.

**База:** shadcn-svelte registry (`files[].target`, `registryDependencies`), SvelteKit FSD-шаблон (`kit.alias` на слои) и `get_config_aliases()` в SvelteKit. Итог — модульный монолит с реестром манифестов, не npm-workspaces и не полный FSD.

---

## 1. Термины

Чтобы строки ниже не трактовались двояко:

| Термин | Значение |
|---|---|
| `modules/user` | **один обязательный top-level модуль** пользователя; `required: true` |
| `modules/user/base` | обязательная часть `user`; **не субмодуль и не отдельный модуль** |
| `modules/user/profile` | опциональный субмодуль профиля |
| `modules/user/sessions` | опциональный субмодуль списка/отзыва устройств |
| `modules/user/blocks` | опциональный субмодуль **админки** блокировок |
| `modules/user/accounts` | опциональный субмодуль удаления аккаунтов |
| `config` | **общая часть `user/base`**: модель, сервис, спека и экран настроек. Не top-level модуль и не субмодуль |
| `@user` | public entry `user/base` |
| `@user/config` | public entry общей config-части; не алиас субмодуля |
| `@user/profile`, `@user/sessions`, `@user/blocks`, `@user/accounts` | public entry соответствующего субмодуля |
| composition root | `src/composition/**`: сборка gateway и реестра; единственное место, которому можно импортировать public entries всех модулей |
| `seed` | прежнее имя обязательной базы; в новом плане заменено на `user/base` |

`user` обязателен, потому что владеет auth, сессиями, config и моделью `block`. Опциональность живёт **внутри** `user`: снять можно `user/profile`, `user/sessions`, `user/blocks`, `user/accounts`, но не `user` и не `user/base`.

---

## 2. Проверка по коду

| Что проверено | Факт | Следствие |
|---|---|---|
| Откуда `BanNotice` берёт `blocked` | `AuthWidget` получает `blocked` из результата формы; `auth.ts` в `completeLogin()` зовёт `blocksOf()` → `ports.blocks.listByTarget()` → `blocksAdapter()` → ресурс `user.block` | источник — **модель `block`**, не поле auth-строки |
| `block` в auth | `auth.ts` импортирует `longestFullBlock` из `spec-block.ts`; `guard`, `renew`, `logoutAll`, `requestDelete` читают `ports.blocks` | модель `block` и `spec-block` обязаны быть в `user/base` |
| `BanNotice` | единственный потребитель — `AuthWidget`; `RestrictionsNotice` — тот же auth-поток | оба в `user/base`, не в `user/blocks` |
| `LogoutModal` | не одиночный: `LogoutModal` → `Logout.svelte` → `SessionDelete.svelte` → `SESSIONS_NAME` из `sessions-list` | одного файла мало: переносим logout-ветку в `user/base` и разрываем связь с `sessions` |
| `base` и `profile` | `AuthWidget` импортирует `ProfileForm` и `ProfileLimits`; `auth.ts` читает `ports.profiles` и удаляет профиль в `sweepDeletions`; `gateway.server.ts` импортирует `profile.ts` | нужен необязательный профильный порт и extension-шаг профиля |
| `base` и `blocks` | `gateway.server.ts` импортирует `blocks.ts`/`blocks-admin.ts`; `index.ts` реэкспортирует `blocks.js` | gateway и public entry разрезать; админка блокировок — только `user/blocks` |
| `base` и `config` | `config.ts`/`config-api`/`config-policy`/`spec-config` — сервис `user/base`; экран настроек тоже в `base` | `@user/config` — общий вход; отдельного `modules/config` нет |
| `base` и `sessions` | `gateway.server.ts` импортирует `sessions.server.ts`; `sessions-exit.server.ts` смешивает выход и массовый отзыв | gateway разрезать; logout — `base`, список/отзыв — `sessions` |
| `base` и `accounts` | `accounts.ts` содержит `listSeedUsers` (нужен seed-пикеру) и удаление аккаунтов | `listSeedUsers` → `base`, удаление → `user/accounts` |
| `base` и `checks` | `checks.ts` импортирует `ui/profile-form/spec-fit.js` | `checks.ts` → `user/profile`, не `base` |

---

## 3. Зафиксированные решения

| Вопрос | Решение | Причина |
|---|---|---|
| `BanNotice` | `modules/user/base/svelte/BanNotice.svelte` | используется только в `AuthWidget`; это экран полного бана при входе |
| `RestrictionsNotice` | `modules/user/base/svelte/RestrictionsNotice.svelte` | тот же auth-поток |
| модель `block` | `modules/user/base/model/block.schema.ts` | auth читает её на входе, в `guard`, `renew`, `logoutAll`, `requestDelete` |
| `spec-block.ts` | `modules/user/base/model/spec-block.ts` | нужен auth и админке; админка импортирует из `@user` |
| `user/blocks` | только админка: `blocks.ts`, `blocks-admin.ts`, `bulk.ts`, UI, routes, modals | модель и auth-логика уже в `base` |
| `LogoutModal` | `modules/user/base/svelte/LogoutModal.svelte` | выход — auth-действие, доступное без субмодуля `sessions` |
| logout-ветка | `LogoutModal` + `logout/Logout.svelte` + `logout/form.ts` + `SessionDelete` в `base` | `LogoutModal` не самостоятелен; иначе `base` импортирует `sessions` |
| модель `session` | `modules/user/base/model/session.schema.ts` | вход и gateway создают сессию |
| модель `config` | `modules/user/base/model/config.schema.ts` | **общая** config-часть; нужна auth, sessions, profile, blocks |
| сервис `config` | `modules/user/base/server/{config,config-api,config-policy,spec-config}.ts` | TTL, holdSeconds, правила ключей — общая база |
| экран config | `modules/user/base/svelte/UserConfigModal.svelte`, `user-config/**` | config общий, поэтому экран всегда с `user`, не отдельный субмодуль |
| `modules/config` | **не существует** | config общий для всех модулей; отдельный модуль создал бы второй владелец |
| модель `profile` | `modules/user/profile/model/profile.schema.ts` | опциональный домен профиля |
| профиль в auth | необязательный `ports.profiles`; нет субмодуля — пустой `prof`, шаг профиля пропускается | `base` не должен импортировать `profile` |
| `user` | `required: true` | auth/session/config/block — обязательная база приложения |
| `user/profile`, `user/sessions`, `user/blocks`, `user/accounts` | `required: false` | снимаются по отдельности |
| `storage_server` | `core`: `src/core/hooks/storage-schema.ts` + `src/core/hooks/storage-db.ts` | модель читает `core/server/app-storage.server.ts`; без неё не работает `/api/storage` |
| `storageFile`, `storageReservation` | `core`: `src/core/hooks/storage-db.ts` | реестр/брони `lib/storage`, нужны ядру |
| `storage-probe.server.ts` | `core`: `src/core/server/storage-probe.server.ts` | вызывается из `app-storage.server.ts` при сохранении пула |
| `StorageServerMeta/View/Slice` | `core`: `src/core/lib/storage/pool-types.ts` | типы нужны ядру и админке |
| `storage-servers` | только админка: UI, form, route, modal, тесты | модель и probe уже в ядре |
| `BanNotice` в `user/blocks` | **нет** | иначе `base` начнёт зависеть от опционального субмодуля |

### Что это даёт

- `mod remove user/profile` — вход работает без шага профиля; `prof` пустой.
- `mod remove user/sessions` — вход и выход работают; пропадает список устройств.
- `mod remove user/blocks` — auth, `BanNotice` и `blocked` работают; пропадает админка блокировок.
- `mod remove user/accounts` — вход и блокировки работают; пропадает удаление аккаунтов.
- `mod remove user` — запрещён.
- `config` доступен всем модулям через `@user/config`; снять его нельзя.

---

## 4. Целевое дерево

```text
src/
  core/
    ui/            # Surface, Listing, Acl, формы, пагинатор, модалки, steps, shell
    lib/           # address, cache, db, fetch, form, image, modals, paginate, storage, task
    hooks/         # связки, storage-schema, storage-db, module-ext
    server/        # db.server, app-storage, storage-probe, cache, fetch, form-*
    app/           # layout, ModalSystem, nav, scope-barrier, errors
    i18n/          # сообщения
  modules/
    user/          # один обязательный модуль
      base/        # auth, session/config/block models, config UI, logout, seed UI
      profile/     # опциональный субмодуль
      sessions/    # опциональный субмодуль
      blocks/      # опциональный субмодуль (только админка)
      accounts/    # опциональный субмодуль
    storage-servers/ # только админка пула
    demo/          # опциональная витрина
  sections/        # композиция страниц
  composition/     # gateway и generated/modules.ts; импортирует public entries модулей
  routes/          # тонкие SvelteKit-адаптеры
```

Правила:

```text
routes            → sections → modules → core
routes            → composition → modules → core
routes            → core
sections          → core + public entries модулей
composition       → public entries модулей + core
modules           → core + dependsOn
modules/user/base → core + @user/config, но не опциональные субмодули
core              → только core
```

---

## 5. Алиасы и манифест

### Алиасы

```ts
import { Surface } from '~/core/ui/surface/index.js'
import { Acl } from '~/core/ui/access/index.js'
import { auth } from '@user/model'
import { getEffective } from '@user/config'
import { Profile } from '@user/profile/svelte/index.js'
import HomePage from '~/sections/home/svelte/HomePage.svelte'
```

- `~` → `src`, `~/core/*` → `src/core/*`, `~/sections/*` → `src/sections/*`.
- `@user` → `src/modules/user/base/index.ts`.
- `@user/config` → `src/modules/user/base/config/index.ts` — **общий config**.
- `@user/model` → `src/modules/user/base/model/index.ts`.
- `@user/server` → `src/modules/user/base/server/index.ts`.
- `@user/svelte` → `src/modules/user/base/svelte/index.ts`.
- `@user/profile`, `@user/sessions`, `@user/blocks`, `@user/accounts` — public entries субмодулей.
- `~/modules/<name>/*` физически существует, но снаружи модуля запрещён.
- В `vite.config.ts` алиасы кладутся в `kit.alias`.
- В `package.json#imports` — `#core/*`, `#modules/*`, `#sections/*` для Node/tooling.
- Старые `#lib/*`, `#hooks/*`, `#components/*`, `#content/*`, `#server/*` — временные шимы.

### Манифесты

`modules/user/manifest.json` — один top-level модуль:

```json
{
  "name": "user",
  "version": "1.0.0",
  "required": true,
  "entries": {
    ".": "./base/index.ts",
    "./config": "./base/config/index.ts",
    "./model": "./base/model/index.ts",
    "./server": "./base/server/index.ts",
    "./svelte": "./base/svelte/index.ts"
  },
  "submodules": ["profile", "sessions", "blocks", "accounts"]
}
```

Каждый субмодуль имеет свой `modules/user/<name>/manifest.json`:

```json
{
  "name": "user/profile",
  "parent": "user",
  "version": "1.0.0",
  "required": false,
  "dependsOn": ["user"],
  "entries": {
    ".": "./index.ts",
    "./model": "./model/index.ts",
    "./svelte": "./svelte/index.ts",
    "./server": "./server/index.ts"
  },
  "provides": {
    "models": ["./model/profile.schema.ts"],
    "authSteps": ["./svelte/AuthProfileStep.svelte"],
    "modals": ["./modals.ts"],
    "routes": ["./routes.ts"]
  },
  "install": {
    "include": ["src/modules/user/profile/**", "src/routes/(site)/(app)/profiles/**"],
    "targets": {
      "src/modules/user/profile": "modules/user/profile/files/src/modules/user/profile",
      "src/routes": "modules/user/profile/files/src/routes"
    }
  }
}
```

`modules/user/base` не имеет отдельного манифеста: он устанавливается вместе с `user`. `config` не имеет субмодульного манифеста: он часть `base`.

Public barrels `base/{model,server,svelte,config}/index.ts` — единственные входы для этих частей; глубокие импорты `@user/model/auth.schema.js` снаружи запрещены.

---

## 6. Перемещения: ядро

| Откуда | Куда |
|---|---|
| `src/lib/**` | `src/core/lib/**` |
| `src/hooks/**` кроме `storage-server-form/**` | `src/core/hooks/**` |
| `src/hooks/storage-schema.ts`, `storage-db.ts` | `src/core/hooks/**` — **остаются ядром** |
| `src/hooks/storage-server-form/**` | `src/modules/storage-servers/server/form/**` |
| `src/server/**` кроме `admin-bootstrap.server.ts`, `actor.server.ts` | `src/core/server/**` |
| `src/server/storage-probe.server.ts` | `src/core/server/storage-probe.server.ts` — **остаётся ядром** |
| `src/server/admin-bootstrap.server.ts`, `actor.server.ts` | `src/modules/user/base/server/**` |
| `src/server/app-storage.server.ts` | `src/core/server/app-storage.server.ts` |
| `src/components/ui/**` | `src/core/ui/**` |
| `src/components/listing/**` | `src/core/ui/listing/**` |
| `src/components/form/**` | `src/core/ui/form/**` |
| `src/components/fields/**` | `src/core/ui/fields/**` |
| `src/components/paginator/**` | `src/core/ui/paginator/**` |
| `src/components/modals/**` | `src/core/ui/modals/**` |
| `src/components/steps/**` | `src/core/ui/steps/**` |
| `src/components/shell/**` | `src/core/ui/shell/**` |
| `src/components/loader/**` | `src/core/ui/loader/**` |
| `src/components/settings/**` | `src/core/ui/settings/**` |
| `src/components/db-schema/**` | `src/core/ui/db-schema/**` |
| `src/components/ErrorPage.svelte`, `Error500.svelte` | `src/core/ui/errors/**` |
| `src/components/utils.ts` | `src/core/ui/utils.ts` |
| `src/content/user/ui/Acl.svelte` | `src/core/ui/access/Acl.svelte` |
| `src/content/user/ui/field-mirror.svelte.ts` | `src/core/ui/form/field-mirror.svelte.ts` |
| `src/content/user/ui/filter-messages.ts` | `src/core/ui/paginator/filter-messages.ts` |
| `src/content/user/messages.ts` | `src/core/i18n/messages.ru.ts` |
| `src/content/storage-servers/types.ts` → `StorageServerMeta/View/Slice` | `src/core/lib/storage/pool-types.ts` |
| `src/routes/(site)/+layout*`, `ModalSystem.svelte`, `nav.ts`, `scope-barrier*`, `+error.svelte` | `src/core/app/**` |
| `src/routes/+layout.svelte`, `+error.svelte` | `src/core/app/**` |
| `src/routes/api/form-upload/+server.ts` | `src/core/server/http/form-upload.ts` + тонкий route |
| `src/routes/api/storage/[...path]/+server.ts` | `src/core/server/http/storage.ts` + тонкий route |

`AuthErrorCode`/`AuthFact` вынести в `src/core/auth/errors.ts`; `user/base` реэкспортирует. Иначе `Acl` в ядре зависит от модуля.

---

## 7. Перемещения: `user/base`

| Откуда | Куда |
|---|---|
| `src/content/user/auth.ts` | `modules/user/base/server/auth.ts` |
| `src/content/user/keys.ts` | `modules/user/base/server/keys.ts` |
| `src/content/user/acl.ts` | `modules/user/base/server/acl.ts` |
| `src/content/user/caps.ts` | `modules/user/base/server/caps.ts` |
| `src/content/user/permissions.ts` | `modules/user/base/server/permissions.ts` |
| `src/content/user/admin.ts` | `modules/user/base/server/admin.ts` |
| `src/content/user/error.ts` | `modules/user/base/model/error.ts` + реэкспорт core-контракта |
| `src/content/user/ports.ts` | `modules/user/base/server/ports.ts`; `profiles` — необязательный порт |
| `src/content/user/gateway.server.ts` | **разрезать**: `base/server/gateway.server.ts` — auth/session/config/block + необязательный profile-порт; доменные API — в gateway субмодулей |
| `src/content/user/vault.ts` | `modules/user/base/server/vault.ts` |
| `src/content/user/vault.svelte.ts` | `modules/user/base/svelte/vault.svelte.ts` |
| `src/content/user/grants.svelte.ts` | `modules/user/base/svelte/grants.svelte.ts` |
| `src/content/user/schema.ts` → `auth` | `modules/user/base/model/auth.schema.ts` |
| `src/content/user/schema.ts` → `session` | `modules/user/base/model/session.schema.ts` |
| `src/content/user/schema.ts` → `config` | `modules/user/base/model/config.schema.ts` |
| `src/content/user/schema.ts` → `block` | `modules/user/base/model/block.schema.ts` |
| `src/content/user/schema.ts` → `profile` | `modules/user/profile/model/profile.schema.ts` |
| `src/content/user/spec-block.ts` | `modules/user/base/model/spec-block.ts` |
| `src/content/user/spec-profile.ts` | `modules/user/base/model/spec-profile.ts` |
| `src/content/user/config.ts` | `modules/user/base/server/config.ts` |
| `src/content/user/config-api.ts` | `modules/user/base/server/config-api.ts` |
| `src/content/user/config-policy.ts` | `modules/user/base/server/config-policy.ts` |
| `src/content/user/spec-config.ts` | `modules/user/base/server/spec-config.ts` |
| `src/content/user/types.ts` → auth/session/config/block/Principal/Token/`LogoutRouteData`/`SessionDeleteRouteData` | `modules/user/base/model/types.ts` |
| `src/content/user/session-delete.ts` | `modules/user/base/model/session-delete.ts` |
| `src/content/user/index.ts` | `modules/user/base/index.ts` — **без** `profile`, `blocks`, `accounts` |
| `src/content/user/routes.ts` → auth/logout/menu/config/seed users/picker | `modules/user/base/routes.ts` |
| `src/content/user/modals.ts` → auth/logout/menu/config/seed users/picker | `modules/user/base/modals.ts` |
| `src/content/user/ui/AuthModal.svelte` | `modules/user/base/svelte/AuthModal.svelte` |
| `src/content/user/ui/AuthWidget.svelte` | `modules/user/base/svelte/AuthWidget.svelte`; шаг профиля — extension |
| `src/content/user/ui/BanNotice.svelte` | `modules/user/base/svelte/BanNotice.svelte` — **не blocks** |
| `src/content/user/ui/RestrictionsNotice.svelte` | `modules/user/base/svelte/RestrictionsNotice.svelte` |
| `src/content/user/ui/MenuBody.svelte` | `modules/user/base/svelte/MenuBody.svelte` |
| `src/content/user/ui/MenuModal.svelte` | `modules/user/base/svelte/MenuModal.svelte` |
| `src/content/user/ui/SeedUsers*.svelte` | `modules/user/base/svelte/SeedUsers*.svelte` |
| `src/content/user/ui/SeedUsersEntry.svelte` | `modules/user/base/svelte/SeedUsersEntry.svelte` |
| `src/content/user/ui/UserMenu.svelte` | `modules/user/base/svelte/UserMenu.svelte` |
| `src/content/user/ui/UserPicker*.svelte` | `modules/user/base/svelte/UserPicker*.svelte` |
| `src/content/user/ui/user-picker-query.ts` | `modules/user/base/svelte/user-picker-query.ts` |
| `src/content/user/ui/seed-form/**` | `modules/user/base/svelte/seed-form/**` |
| `src/content/user/ui/seed-users/**` | `modules/user/base/svelte/seed-users/**` |
| `src/content/user/ui/LogoutModal.svelte` | `modules/user/base/svelte/LogoutModal.svelte` |
| `src/content/user/ui/logout/Logout.svelte` | `modules/user/base/svelte/logout/Logout.svelte` |
| `src/content/user/ui/logout/form.ts` | `modules/user/base/svelte/logout/form.ts` |
| `src/content/user/ui/session-delete/SessionDelete.svelte` | `modules/user/base/svelte/session-delete/SessionDelete.svelte` |
| `src/content/user/ui/session-delete/form.ts` | `modules/user/base/svelte/session-delete/form.ts` |
| `src/content/user/ui/UserConfigModal.svelte` | `modules/user/base/svelte/UserConfigModal.svelte` — **config общий** |
| `src/content/user/ui/user-config/**` | `modules/user/base/svelte/user-config/**` |
| `userConfigRoute`, `userAccountConfigRoute` | `modules/user/base/routes.ts` |
| `user.config.edit` | `modules/user/base/modals.ts` |
| `src/content/user/sessions-exit.server.ts` → локальный выход | `modules/user/base/server/logout.server.ts` |
| `src/content/user/accounts.ts` → `listSeedUsers` | `modules/user/base/server/seed-users.ts` |
| `src/server/admin-bootstrap.server.ts` | `modules/user/base/server/admin-bootstrap.server.ts` |
| `src/server/actor.server.ts` | `modules/user/base/server/actor.server.ts` |
| `src/server/admin-bootstrap.test.ts` | `modules/user/base/tests/admin-bootstrap.test.ts` |
| `src/server/security-hardening.test.ts` | `modules/user/base/tests/security-hardening.test.ts` |
| `src/content/user/{auth,keys,acl,caps,permissions,gateway-*,vault*,config,spec-config}*.test.ts` | `modules/user/base/tests/**` |
| `src/content/user/spec-profile.test.ts` | `modules/user/base/tests/spec-profile.test.ts` |
| `src/content/user/ui/logout/Logout*.test.ts` | `modules/user/base/tests/logout*.test.ts` |
| `src/content/user/ui/session-delete/{form,SessionDelete.ssr}.test.ts` | `modules/user/base/tests/session-delete*.test.ts` |
| `src/content/user/ui/UserConfig.ssr.test.ts` | `modules/user/base/tests/user-config.ssr.test.ts` |

`user/base` предоставляет модели `auth`, `session`, `config`, `block` и public entry `@user/config`.

`LogoutModal` не переносится один: он импортирует `logout/Logout.svelte`, а тот — `session-delete/SessionDelete.svelte` и `SESSIONS_NAME`. Поэтому в `base` идёт logout-ветка, а `SessionDelete` получает проп `invalidateResource`/`onInvalidated` вместо прямого импорта списка сессий. `SessionDeleteModal` остаётся в `user/sessions` и импортирует base-компонент. `session-delete.form.server.ts` остаётся в `user/sessions`: он обслуживает массовый отзыв, а не logout.

`AuthWidget` больше не импортирует `ProfileForm`, `ProfileLimits` и `BLOCKS_NAME`:

- шаг `profile` приходит из `user/profile` через `provides.authSteps`; нет субмодуля — нет шага;
- `BLOCKS_NAME` заменяется на `invalidateAll()`/событие смены principal; `user/blocks` сам инвалидирует свои списки;
- `defaults.holdSeconds` остаётся из base-конфига.

Пункты меню `user.sessions`, `user.profile`, `user.accounts.delete`, `storage.servers` приходят extension-записями манифестов; если субмодуль снят, пункт скрыт, а не ведёт в несуществующую модалку.

`checks.ts` в `base` **не** переезжает: он импортирует `ui/profile-form/spec-fit.js`. Он уходит в `user/profile` вместе с `spec-avatar.ts` и `spec-fit.ts`.

---

## 8. Перемещения: `user/profile`

| Откуда | Куда |
|---|---|
| `src/content/user/profile.ts` | `modules/user/profile/server/profile.ts` |
| `src/content/user/checks.ts` | `modules/user/profile/server/checks.ts` — **не base: тянет `spec-fit`** |
| `src/content/user/spec-avatar.ts` | `modules/user/profile/model/spec-avatar.ts` |
| `src/content/user/ui/profile-form/spec-fit.ts` | `modules/user/profile/server/spec-fit.ts` |
| `src/content/user/schema.ts` → `profile` | `modules/user/profile/model/profile.schema.ts` |
| `src/content/user/types.ts` → `Profile*`, `PublicProfile*` | `modules/user/profile/model/types.ts` |
| `src/content/user/ui/Profile.svelte` | `modules/user/profile/svelte/Profile.svelte` |
| `src/content/user/ui/ProfileCard.svelte` | `modules/user/profile/svelte/ProfileCard.svelte` |
| `src/content/user/ui/ProfileDeleteModal.svelte` | `modules/user/profile/svelte/ProfileDeleteModal.svelte` |
| `src/content/user/ui/ProfileEditModal.svelte` | `modules/user/profile/svelte/ProfileEditModal.svelte` |
| `src/content/user/ui/ProfileModal.svelte` | `modules/user/profile/svelte/ProfileModal.svelte` |
| `src/content/user/ui/ProfilesList.svelte` | `modules/user/profile/svelte/ProfilesList.svelte` |
| `src/content/user/ui/ProfilesModal.svelte` | `modules/user/profile/svelte/ProfilesModal.svelte` |
| `src/content/user/ui/profile-delete/**` | `modules/user/profile/svelte/profile-delete/**` |
| `src/content/user/ui/profile-form/**` | `modules/user/profile/svelte/profile-form/**` |
| `src/content/user/ui/profiles/source.ts` | `modules/user/profile/svelte/profiles/source.ts` |
| профильный шаг из `AuthWidget.svelte` | `modules/user/profile/svelte/AuthProfileStep.svelte` — **extension, не импорт base** |
| `userProfile*`, `profilesListRoute` из `routes.ts` | `modules/user/profile/routes.ts` |
| `user.profile*`, `user.profiles` из `modals.ts` | `modules/user/profile/modals.ts` |
| `src/content/user/{checks,spec-avatar,spec-fit,profiles-list}*.test.ts` | `modules/user/profile/tests/**` |

`dependsOn: ["user"]` — профиль использует `@user/config`, `@user` auth и `@user` block.

`provides.authSteps: ["./svelte/AuthProfileStep.svelte"]`: `base` рендерит шаг, только если субмодуль установлен. Без `profile` вход завершается сразу после `auth`, `prof` в access — `{ nickname: null, avatarUrl: null }`.

`AuthPorts.profiles` необязателен: `issueTokens`/`freshAccess` читают `ports.profiles?.get(...)`, `sweepDeletions` — `ports.profiles?.remove(...)`. Адаптер профиля регистрирует `user/profile`; без субмодуля остаётся no-op. Если субмодуль сняли после создания профилей, строки в БД не удаляются автоматически — это отдельная политика uninstall, не зависимость `base`.

---

## 9. Перемещения: `user/sessions`

| Откуда | Куда |
|---|---|
| `src/content/user/sessions.server.ts` | `modules/user/sessions/server/sessions.server.ts` |
| `src/content/user/sessions.form.ts` | `modules/user/sessions/server/sessions.form.ts` |
| `src/content/user/sessions-exit.server.ts` | `modules/user/sessions/server/sessions-exit.server.ts` — **только массовый отзыв** |
| `src/content/user/types.ts` → `Session*`, `Sessions*` | `modules/user/sessions/model/types.ts` |
| `src/content/user/ui/Session*.svelte` кроме `SessionDelete*`/`Logout*` | `modules/user/sessions/svelte/Session*.svelte` |
| `src/content/user/ui/Sessions*.svelte` | `modules/user/sessions/svelte/Sessions*.svelte` |
| `src/content/user/ui/SessionDeleteModal.svelte` | `modules/user/sessions/svelte/SessionDeleteModal.svelte` — импортирует base-компонент |
| `src/content/user/ui/sessions-list/**` | `modules/user/sessions/svelte/sessions-list/**` |
| `userSessions*`, `sessionsJournalRoute`, `userSession*` | `modules/user/sessions/routes.ts` |
| `user.sessions*`, `user.session*` | `modules/user/sessions/modals.ts` |
| `src/content/user/{sessions.form,sessions.server,sessions-exit}*.test.ts` | `modules/user/sessions/tests/**` |

**Модель `session` остаётся в `base`.** `sessions` импортирует её из `@user`; своего `provides.models` у субмодуля нет.

**Из `sessions` уходят:** `LogoutModal`, `ui/logout/**`, `ui/session-delete/SessionDelete.svelte`, `ui/session-delete/form.ts`, `ui/session-delete/form.test.ts`, `session-delete.ts`, `userLogoutRoute`, `user.logout`, локальная часть `sessions-exit.server.ts`. Они в `base`.

`dependsOn: ["user"]`.

---

## 10. Перемещения: `user/blocks` (только админка)

| Откуда | Куда |
|---|---|
| `src/content/user/blocks.ts` | `modules/user/blocks/server/blocks.ts` |
| `src/content/user/blocks-admin.ts` | `modules/user/blocks/server/blocks-admin.ts` |
| `src/content/user/bulk.ts` | `modules/user/blocks/server/bulk.ts` |
| `src/content/user/types.ts` → админские `BlockDetailView`, `BlocksPage`, `BlocksSlice` | `modules/user/blocks/model/types.ts` |
| `src/content/user/ui/Block*.svelte` | `modules/user/blocks/svelte/Block*.svelte` |
| `src/content/user/ui/Blocks*.svelte` | `modules/user/blocks/svelte/Blocks*.svelte` |
| `src/content/user/ui/block-delete/**` | `modules/user/blocks/svelte/block-delete/**` |
| `src/content/user/ui/block-form/**` | `modules/user/blocks/svelte/block-form/**` |
| `src/content/user/ui/blocks-bulk/**` | `modules/user/blocks/svelte/blocks-bulk/**` |
| `src/content/user/ui/blocks-list/**` | `modules/user/blocks/svelte/blocks-list/**` |
| `blocks*`, `userBlocks*` из `routes.ts` | `modules/user/blocks/routes.ts` |
| `user.blocks*` из `modals.ts` | `modules/user/blocks/modals.ts` |
| `src/content/user/{blocks,blocks-admin,bulk}*.test.ts` | `modules/user/blocks/tests/**` |

**Не переезжают:** `block` model, `spec-block.ts`, типы `Blocked`/`BlockScope`/`BlockView` и `BanNotice` — они в `base`.

`dependsOn: ["user"]`; админка импортирует `block` и `spec-block` из `@user/model`.

---

## 11. Перемещения: `user/accounts`

| Откуда | Куда |
|---|---|
| `src/content/user/accounts.ts` → остальное (кроме `listSeedUsers`) | `modules/user/accounts/server/accounts.ts` |
| `src/content/user/accounts-admin.ts` | `modules/user/accounts/server/accounts-admin.ts` |
| `src/content/user/ui/UsersDeleteModal.svelte` | `modules/user/accounts/svelte/UsersDeleteModal.svelte` |
| `src/content/user/ui/accounts-delete/**` | `modules/user/accounts/svelte/accounts-delete/**` |
| `usersDeleteRoute` | `modules/user/accounts/routes.ts` |
| `user.accounts.delete` | `modules/user/accounts/modals.ts` |
| `accounts*.test.ts` | `modules/user/accounts/tests/**` |

`listSeedUsers` остаётся в `user/base/server/seed-users.ts` (см. §7), поэтому `accounts` не тянет его обратно.

`dependsOn: ["user", "user/profile"]` — удаление аккаунта затрагивает профиль. Если профиль не установлен, субмодуль `accounts` не устанавливается.

---

## 12. Перемещения: `storage-servers` (только админка)

| Откуда | Куда |
|---|---|
| `src/content/storage-servers/ui/**` | `modules/storage-servers/svelte/**` |
| `src/content/storage-servers/form.ts` | `modules/storage-servers/server/form.ts` |
| `src/content/storage-servers/storage-server.form.server.ts` | `modules/storage-servers/server/storage-server.form.server.ts` |
| `src/content/storage-servers/routes.ts` | `modules/storage-servers/routes.ts` |
| `src/content/storage-servers/modals.ts` | `modules/storage-servers/modals.ts` |
| `src/components/storage-servers/StorageServerForm.svelte` | `modules/storage-servers/svelte/StorageServerForm.svelte` |
| `src/hooks/storage-server-form/**` | `modules/storage-servers/server/form/**` |
| `storageServersRoute` | `modules/storage-servers/routes.ts` |
| `storage.servers` | `modules/storage-servers/modals.ts` |

**Не переезжают:** `storage_server`, `storageFile`, `storageReservation`, `storage-probe.server.ts`, `StorageServerMeta/View/Slice`. Они уже в `core`.

`dependsOn: ["user"]`; импортирует `~/core/server/app-storage`, `~/core/lib/storage/pool-types` и `@user/config`.

---

## 13. Перемещения: `demo`

| Откуда | Куда |
|---|---|
| `src/components/demo/**` | `modules/demo/svelte/**` |
| `src/content/demo-catalog/**` | `modules/demo/model/**`, `modules/demo/server/**` |
| `src/content/storage-vault/**` | `modules/demo/server/storage-vault/**` |
| `src/routes/(site)/(modals-demo)/**` | `modules/demo/routes/**` |
| demo-маршруты `(app)/{cards,db-demo,fields,form,paginator,steps,upload-demo}` | `modules/demo/routes/**` |
| demo API | `modules/demo/routes/api/**` |
| demo browser-тесты | `modules/demo/tests/browser/**` |

`dependsOn: []` или `["user"]`, если конкретная демо-страница использует auth/config.

---

## 14. Sections и routes

| Маршрут | Section / владелец |
|---|---|
| `(app)/+page.*` | `sections/home` |
| `(app)/blocks/**` | `sections/blocks` → `user/blocks` |
| `(app)/profiles/**` | `sections/profiles` → `user/profile` |
| `(app)/sessions/**` | `sections/sessions` → `user/sessions` |
| `(app)/storage-servers/**` | `sections/storage-servers` |
| `(app)/schema/**` | `sections/schema` |
| `(app)/user/**` | `sections/user` |
| `(app)/user/logout` | `user/base` → `base/svelte/logout/Logout.svelte` |
| `(app)/user/sessions/**` | `sections/sessions` → `user/sessions` |
| `(app)/user/config`, `(app)/user/[id]/config` | `user/base` → `base/svelte/user-config/**` |
| `(app)/users/**` | `sections/users` → `user/accounts` |
| `(site)/[...path]` | `core/app/not-found` |
| layout, ModalSystem, nav, errors | `core/app` |
| API form/storage | `core/server/http` + тонкий route |

Route-файл остаётся тонким:

```svelte
<script lang="ts">
  import BlocksPage from '~/sections/blocks/svelte/BlocksPage.svelte'
  let { data } = $props()
</script>

<BlocksPage {data} />
```

```ts
export { load } from '~/sections/blocks/server/load.js'
```

SvelteKit не сканирует `src/modules`; route-файлы субмодулей устанавливаются через `install.targets` манифеста.

---

## 15. Этапы

### Этап 0. Зафиксировать решения

- [ ] Утвердить термины §1 и решения §3.
- [ ] Утвердить, что `user` — один обязательный модуль, а `profile`/`sessions`/`blocks`/`accounts` — его опциональные субмодули.
- [ ] Утвердить, что `config` — общая часть `user/base`, отдельного `modules/config` нет.

### Этап 1. Алиасы без перемещений

- [ ] Добавить `~`, `~/core`, `~/modules`, `~/sections` в `kit.alias`.
- [ ] Добавить `@user`, `@user/config`, `@user/model`, `@user/server`, `@user/svelte`, `@user/profile`, `@user/sessions`, `@user/blocks`, `@user/accounts`.
- [ ] Добавить `#core/*`, `#modules/*`, `#sections/*` в `package.json#imports`.
- [ ] Оставить старые алиасы шимами.
- [ ] Проверить: `npm run check`, `npm test`, `npm run test:guard`.

### Этап 2. Ядро

- [ ] Переместить `src/lib`, `src/hooks`, `src/server`, общие `src/components/*` по §6.
- [ ] Переместить `Acl`, `field-mirror`, `filter-messages`, `messages` в `core`.
- [ ] Переместить `StorageServerMeta/View/Slice` в `core/lib/storage/pool-types.ts`.
- [ ] Оставить re-export-шимы на старых путях.
- [ ] Проверить: `npm run check`, `npm test`, `npm run test:guard`, `npm run test:public-api`.

### Этап 3. `user/base`

- [ ] Разрезать `schema.ts`: `auth`, `session`, `config`, `block` в `base`; `profile` — в `user/profile`.
- [ ] Перенести `spec-block.ts`, `spec-profile.ts`, типы `Blocked`/`BlockScope`/`BlockView`/`LogoutRouteData`/`SessionDeleteRouteData` в `base`.
- [ ] Перенести `config.ts`, `config-api.ts`, `config-policy.ts`, `spec-config.ts`, `UserConfigModal`, `user-config/**` в `base`.
- [ ] Перенести auth/ACL/keys/vault/admin.
- [ ] Разрезать `gateway.server.ts`: base-часть без profile/blocks/sessions/accounts; доменные gateway — в субмодулях; сборка — в composition root.
- [ ] Сделать `AuthPorts.profiles` необязательным; `issueTokens`, `freshAccess`, `sweepDeletions` — no-op без профиля.
- [ ] Убрать из `AuthWidget` импорты `ProfileForm`, `ProfileLimits`, `BLOCKS_NAME`; шаг профиля — extension `provides.authSteps`.
- [ ] Перенести `checks.ts`, `spec-avatar.ts`, `spec-fit.ts` в `user/profile` (заготовка), иначе base тянет profile.
- [ ] Создать public barrels `base/{model,server,svelte,config}/index.ts`.
- [ ] Перенести logout-ветку: `LogoutModal`, `logout/**`, `session-delete/SessionDelete.svelte`, `session-delete/form.ts`, `session-delete.ts`; `SessionDeleteModal` оставить в `user/sessions`; `sessions-exit.server.ts` разрезать. `/user/logout/+page.server.ts` использует base `logout.server.ts`/`logout/form.ts`, не `session-delete.form.server.ts`.
- [ ] Разрезать `index.ts`, `routes.ts`, `modals.ts`: без `profile`, `blocks`, `accounts`; config остаётся в base.
- [ ] Переключить `db.server.ts` на `user/base`.
- [ ] Проверить: `rg "@user/(profile|sessions|blocks|accounts)" src/modules/user/base` не находит импортов; вход, выход, blocked, config, storage работают.

### Этап 4. Sections

- [ ] Вынести тела страниц в `sections/*`.
- [ ] Сделать route-файлы тонкими.
- [ ] Вынести `site-entries` в `sections/home`.
- [ ] Проверить SSR и no-JS.

### Этап 5. Субмодули

Порядок:

- [ ] `user/profile` — модель + UI + `AuthProfileStep`; без него вход не требует профиля.
- [ ] `user/sessions` — список/отзыв устройств; `SessionDeleteModal` импортирует base-компонент, logout не возвращается.
- [ ] `user/blocks` — только админка; модель `block` и `BanNotice` остаются в base.
- [ ] `user/accounts` — удаление аккаунтов; `listSeedUsers` остаётся в base.
- [ ] `storage-servers` — только админка, модель/probe в core.
- [ ] `demo` — витрина.

После каждого субмодуля: `npm run check`, `npm test`, `npm run test:guard`; отдельно `mod remove user/<submodule>` и повторная проверка входа.

### Этап 6. Манифесты и упаковка

- [ ] Добавить `modules/user/manifest.json` с `submodules`.
- [ ] Добавить `manifest.json` каждому субмодулю с `name: "user/<name>"`, `parent: "user"`.
- [ ] Добавить `provides.authSteps` для `user/profile`.
- [ ] Добавить `tooling/module-registry.mjs` + JSON Schema.
- [ ] Научить `mod.mjs` `dependsOn`, `install.targets`, `alias`, `submodules`.
- [ ] Генерировать `src/generated/modules.ts`.
- [ ] Обновить `module-guard`, `.gitignore`, CI.
- [ ] Собрать тег `modules` из новых путей.

### Этап 7. Удалить шимы

- [ ] Удалить `#lib/*`, `#hooks/*`, `#components/*`, `#content/*`, `#server/*`.
- [ ] Удалить пустые `src/content`, `src/components`, `src/lib`, `src/hooks`, `src/server`.
- [ ] `layer-guard` запрещает старые пути.

---

## 16. Проверки и стражи

- `layer-guard`: `core` не импортирует `modules/sections/routes`; модуль не импортирует чужой модуль глубже public entry; `sections` не импортирует внутренности модуля.
- `user-base-boundary`: `modules/user/base/**` не импортирует `@user/profile`, `@user/sessions`, `@user/blocks`, `@user/accounts`; `@user/config` разрешён.
- `config-common`: в проекте нет `modules/config` и алиаса `@config`; config-код есть только в `modules/user/base/{model,server,svelte}` и доступен как `@user/config`.
- `submodule-boundary`: субмодуль не импортирует внутренности другого субмодуля; только `@user` и свой public entry.
- `composition-boundary`: `src/composition/**` импортирует только public entries модулей и `core`; доменных правил и UI там нет.
- `public-api`: публичные входы — только `manifest.entries`.
- `module-guard`: payload модуля не попал в `core`/`sections`; `install.include` совпадает с файлами.
- `module-registry`: уникальные `name`/`alias`, существующие `dependsOn`, нет циклов, все `provides` пути существуют, `parent` существует.
- `core-purity`: пути `CORE_MODULES` → `src/core/lib/*`.
- CI: `node tooling/module-registry.mjs --check`, `node tooling/module-guard.mjs --tracked`, `npm run check`, `node --test tooling/*.test.mjs`, `rg "@user/(profile|sessions|blocks|accounts)" src/modules/user/base`.

---

## 17. Критерии готовности

- [ ] `mod remove user/profile` — вход работает без шага профиля, `prof` пустой.
- [ ] `mod remove user/sessions` — вход и выход работают, экран устройств исчез.
- [ ] `mod remove user/blocks` — auth, `BanNotice` и `blocked` работают: модель `block` в base.
- [ ] `mod remove user/accounts` — вход и блокировки работают.
- [ ] `mod remove user` — запрещён.
- [ ] `mod remove config` — неприменимо: config общий, отдельного модуля нет.
- [ ] `@user/config` доступен всем субмодулям и `storage-servers`/`demo`.
- [ ] `user/base` не импортирует `@user/profile`, `@user/sessions`, `@user/blocks`, `@user/accounts`.
- [ ] `user/profile` не импортирует `user/blocks`/`user/sessions`/`user/accounts`.
- [ ] `user/sessions` не импортирует `user/profile`/`user/blocks`/`user/accounts`.
- [ ] `user/blocks` не импортирует `user/profile`/`user/sessions`/`user/accounts`.
- [ ] `LogoutModal` доступен без `user/sessions`.
- [ ] `mod add user/profile` тянет `user` и добавляет шаг профиля.
- [ ] `core` не содержит импортов `modules/*`.
- [ ] `sections` не импортируют внутренности модулей.
- [ ] `npm run check`, `npm test`, `npm run test:guard`, `npm run test:public-api` зелёные на каждом этапе.
