# Ревью переноса на `core` / `modules` / `sections` (после `b3a2efe`)

**База сравнения:** `b3a2efe` (docs: final plan snapshot) → рабочее дерево ветки `img`.
**Объём:** 1053 изменённых пути, из них `src/**` — 1022.
**Цель ревью:** проверить, что при переносе менялись только пути импортов, и оценить уместность остальных правок; дать заключение о корректности переноса и замечания по коду.

---

## 1. Как проверялось

1. `git diff -M` с картой переименований (`--name-status -z`): 403 чистых переименования (`R100`), 544 «переименование + правка», 105 правок на месте, 1 удаление + 1 добавление.
2. Нормализация диффа: из `-`/`+` строк удалялись строковые литералы (спецификаторы), после чего сравнивались остатки. Это отделило правки импортов от смысловых.
3. Поиск по всему новому дереву каждой непустой не-импортной строки старых route-файлов: так проверялось, что тела страниц и экшены не потеряны при выносе в `sections`.
4. Точечная проверка схемы БД, границ слоёв (`core → modules`, `base → субмодули`, `sections → внутренности модулей`), манифестов, tooling-стражей.
5. Прогоны: `KIT_ADAPTER=node npm run check` — **0 ошибок, 0 предупреждений**; `npm run test:guard` — **214 pass, 0 fail, 13 skip**; `node tooling/public-api.mjs` — «пакетов 11, входов 41».

---

## 2. Краткое заключение

**Сам перенос файлов сделан аккуратно.** Логика не потеряна, подавляющее большинство правок — это импорты и комментарии с новыми путями. Разделение `schema.ts`/`types.ts` на `base` и `profile` выполнено по плану, владение `BanNotice`, `LogoutModal`, `session-delete`, моделями `block`/`session`/`config`, `checks`/`spec-fit`, `storage-probe`/`pool-types` — совпадает с §3 плана.

**Архитектурная миграция при этом не завершена и местами регрессировала.** Ключевая цель плана — `user/base` без опциональных субмодулей и `core` без доменов — не достигнута: `base` имеет 37 рантайм-импортов опциональных субмодулей, `core` — 14 импортов модулей. Манифесты ссылаются на несуществующие файлы, публичные барели не созданы, composition root мёртв. Три стража (`public-api`, `classes-audit`, `target-rule-guard`) после переноса перестали проверять то, ради чего написаны, а `layer-guard` не умеет канонизировать новые алиасы `#modules`/`#sections`. Плюс одна реальная функциональная регрессия в схеме БД.

Оценка: **перенос кода — 9/10, перенос ответственности и границ — 4/10.**

---

## 3. Перенос: что проверено и подтверждено

| Проверка | Результат |
|---|---|
| Потеря содержимого при `git mv` | Нет: 403 файла — байт-в-байт (`R100`), остальные отличаются импортами и комментариями |
| Смысловые правки в перенесённых файлах | 86 файлов после нормализации; из них код — ~45 (остальное README/MD и комментарии с новыми путями) |
| Тела `+page.server.ts` в `sections` | Не потеряны: каждая содержательная строка старых route-файлов находится в дереве (`sections` или `modules`), кроме сигнатур `PageServerLoad` |
| Экшены (`?/exit`, `?/local`, `?/revoke`, `?/others`, `?/rename`, `?/schema`) | Перенесены в section-файлы и подключены (`export const actions: Actions = userSessionsActions` в `src/routes/(site)/(app)/user/sessions/+page.server.ts`) |
| Тонкие route-адаптеры | 66 из 67: `<Page {data} />` + `export const load = ...`. Единственное исключение — `storage-servers/+page.svelte` (17 строк разметки, отдельной section-страницы нет) |
| Корректные решения по владению (§3 плана) | Выполнены: `BanNotice`, `RestrictionsNotice`, `LogoutModal`, `logout/**`, `SessionDelete`, модели `block`/`session`/`config`, `spec-block`, config-экран — в `base`; `checks`/`spec-avatar`/`spec-fit` — в `profile`; `storage_server`/`storageFile`/`storageReservation`/`storage-probe`/`pool-types` — в `core`; админка блокировок/аккаунтов/пула — в субмодулях |
| Импорты удалённых `#components/*`, `#content/*` из кода | Убраны (остались только в комментариях/README) |
| Docs/probes пути | `tooling/core-purity.mjs`, `db-docs.mjs`, `db-docs.test.mjs`, `ark-owns.test.mjs`, `db-reset-postgres`, `journal-path-guard`, `source-schema-guard`, `sessions-dead-actions`, `session-delete-guard` — обновлены и не вакуумны (`ark-owns` падает при пустом пути) |

Отдельно стоит отметить комментарии: в перенесённых db-документах (`src/core/lib/db/*.md`) пути `src/lib` → `src/core/lib` поправлены последовательно, включая примеры команд и таблицы фактов — это ручная, а не sed-работа, и она сделана качественно.

---

## 4. Смысловые изменения вне путей: уместность

| Изменение | Где | Вердикт |
|---|---|---|
| Разрез `schema.ts`: `profile`/`profileFields`/`PROFILE_ACL` вынесены в `modules/user/profile/model/profile.schema.ts` | `base/model/schema.ts`, `profile/model/profile.schema.ts` | **Уместно**, но с дефектом: вместе с профилем удалена связь `auth.relations.profile` и нигде не восстановлена (см. P0-1) |
| `error.ts` → `model/error.ts` как реэкспорт `#core/auth/errors.js` | `modules/user/base/model/error.ts` | Уместно по §6 плана |
| **Весь** реестр инструкций ошибок (`INSTRUCTIONS` с `profile.*`, `storage.*`) уехал в `core/auth/errors.ts` | `src/core/auth/errors.ts` | **Сверх плана.** §6 требовал вынести только контракт (`AuthErrorCode`/`AuthFact`). Теперь ядро знает доменные коды и пути полей профиля/хранилища — это ровно то, чего план избегал |
| `include: ['profile']` и `ORDER 'profile.nickname'` остались, а объявление связи удалено | `base/server/gateway.server.ts:353`, `accounts/server/accounts.ts:93-94` | **Неуместно**, ломает функцию (P0-1) |
| `security-hardening.test.ts` переехал в `core/server` и импортирует модели пользователя/профиля | `src/core/server/security-hardening.test.ts` | Спорно: security-тест ядра теперь тестирует доменные модели. Сам тест не менялся по смыслу — только пути |
| `tooling/layer-guard.mjs`: правила расширены на `src/core/**`, `allow` для `src/routes/` | `tooling/layer-guard.mjs` | Частично уместно (адаптеры перестали нуждаться в no-op импорте формы), но старые ветки `src/components|content|server` оставлены мёртвыми, а новые алиасы не канонизируются (P1-7) |
| `tooling/target-rule-guard.mjs`: `UI_DIRS = [base/svelte, profile/svelte]` | `tooling/target-rule-guard.mjs:15` | **Неуместно**: страж писался под адреса отзыва/переименования сессий, а они теперь в `sessions/svelte`; покрытие потеряно (P1-9) |
| `tooling/public-api.mjs`: `libDir = src/core/lib`, но фильтр остался `spec.startsWith('#lib/')` | `tooling/public-api.mjs:117` | **Неуместно**: в `src` теперь 0 импортов `#lib/` и 567 `#core/lib/`, страж не проверяет ни одного спецификатора (P1-8) |
| `tooling/classes-audit.mjs` не тронут: `SCOPE` из `src/components/**` фильтруется через `existsSync` | `tooling/classes-audit.mjs:116` | **Неуместно**: аудит молча проверяет 0 файлов (P0-3) |
| `sections/*/load.server.ts` с `event: any` | 33 файла, 71 `: any` в `sections` | **Неуместная потеря типов**: старые `load` были `PageServerLoad` с явными возвращаемыми типами; теперь `svelte-check` зелёный, потому что данные `any` |
| Логика блокировок (`addBlock`, `liftBlock`, `listBlocks`, `listBlocksPage`) осталась в `base/server/blocks.ts` | `modules/user/base/server/blocks.ts` | Отклонение от §10 (там `blocks.ts` → `user/blocks`). Можно оправдать: это auth-порт `ports.blocks`; но тогда `user/blocks` — только админка, и это надо зафиксировать в манифесте |
| `listSeedUsers` уехал в `user/accounts`, а не в `base/server/seed-users.ts` | `modules/user/accounts/server/accounts.ts` | Отклонение от §11; из-за него `base/server/gateway.server.ts:49` импортирует субмодуль (P1-1) |

---

## 5. Дефекты

### P0 — ломает поведение или проверки

**P0-1. Удалена связь `auth → profile` при живых потребителях.**
В `b3a2efe` (`src/content/user/schema.ts`) было:
```ts
relations: { profile: { resource: profile, localField: 'id', foreignField: 'auth_id' } }
```
Сейчас `grep -rn "relations" src/modules/user` не находит ничего, а `src/core/lib/db/query/sql.ts:98` требует `r.relations[relation]`, иначе `fail("forbidden")`. При этом:
- `src/modules/user/base/server/gateway.server.ts:353` — `include: ['profile']`;
- `src/modules/user/accounts/server/accounts.ts:93-94` — сортировка `profile.nickname`.

Следствие: колонка «никнейм» в списке seed-юзеров и сортировка по никнейму перестают работать (доменный отказ `forbidden`), тесты этого не видят — `accounts.test.ts` проверяет только сформированный массив `order` на моке портов, а join по профилю в тестах с реальной БД не покрыт.
**Лечение:** объявлять связь на этапе сборки схемы (composition), а не в `base` (иначе `base` снова начнёт импортировать `profile`); либо `defineRelation(auth, profile)` в `profile.schema.ts` с регистрацией в `db.server.ts`.

**P0-2. Сломаны npm-скрипты, указывающие на удалённые каталоги.**
`package.json:53-55`:
```json
"test:db:probes": "... src/lib/db/probes/pglite.probe.mts ...",
"probe:user:sessions-bulk": "... src/content/user/probes/sessions-bulk.probe.mts",
"test:db": "vitest run src/lib/db"
```
Реальные пути: `src/core/lib/db/probes/**`, `src/modules/user/base/probes/sessions-bulk.probe.mts`. Команды падают на «не найден файл».

**P0-3. `tooling/classes-audit.mjs` замолчал.**
`SCOPE` состоит из `src/components/**`, которых больше нет; строка 116 отбрасывает все отсутствующие файлы, `readFile` не вызывается, аудит печатает успех. `npm run test:classes` создаёт ложное чувство проверки.

**P0-4. `target-rule-guard` потерял целевой код.**
`tooling/target-rule-guard.mjs:15` — `UI_DIRS = ['src/modules/user/base/svelte', 'src/modules/user/profile/svelte']`. Правило «адрес отзыва/переименования не выбирается по `vault.principal`» относится к `sessions/svelte/sessions-list/**` и `sessions/svelte/SessionCard.svelte` — они вне списка. Страж зелёный по построению.

### P1 — архитектура и заявленные границы

**P1-1. `user/base` зависит от всех опциональных субмодулей (37 импортов).**
Примеры: `base/server/gateway.server.ts:47,49,56,65` (sessions, accounts, accounts-admin, profile), `base/modals.ts` (17 ленивых импортов модалок profile/sessions/blocks/accounts), `base/svelte/AuthWidget.svelte:21-26` (ProfileForm, BLOCKS_NAME, seed-form accounts), `base/svelte/session-delete/SessionDelete.svelte:23` (`SESSIONS_NAME`), `base/svelte/user-config/SessionsStep.svelte:10` (`SessionsList`), `base/svelte/UsersDeleteModal.svelte:12`, `base/model/types.ts:527` (реэкспорт типов профиля).
Следствие: `mod remove user/profile|sessions|blocks|accounts` физически невозможен — все четыре сценария из §17 не выполняются. Это главный незакрытый пункт плана; перенос файлов его не решил и, в случае `gateway.server.ts:49`, ухудшил (до миграции `listSeedUsers` лежал в том же `content/user`, теперь это межмодульная зависимость).

**P1-2. Манифесты нерабочие.**
`src/modules/user/manifest.json` объявляет `./base/config/index.ts`, `./base/model/index.ts`, `./base/server/index.ts`, `./base/svelte/index.ts` — **ни одного из этих файлов нет**. Аналогично у всех четырёх субмодулей отсутствуют `index.ts`, `model/index.ts`, `svelte/index.ts`, `server/index.ts`. Нет `provides` (menu, modals, routes, authSteps, models) и `install.targets`, нет `tooling/module-registry.mjs`, нет проверки «entries существуют на диске». Манифесты сейчас — декорация; `mod` по ним работать не сможет, `test:public-api` их не читает (он проверяет только `src/core/lib/*/entrypoints.json`).

**P1-3. Публичные входы не используются, composition root мёртв.**
`src/composition/index.server.ts` никто не импортирует; `core/server/db.server.ts` сам собирает ресурсы. `sections` и `routes` ходят внутрь модулей напрямую: 172 импорта `#modules/...` в `sections` и 7 в `routes`, из них массово `#modules/user/base/server/gateway.server.js` (28), `#modules/user/base/model/types.js` (15), `#modules/user/<sub>/svelte/...` (десятки). Алиасы `@user*` из §5 не созданы вовсе. Правило «снаружи модуля — только public entry» не выполняется и не проверяется.

**P1-4. `core` зависит от модулей (14 импортов).**
- `src/core/server/db.server.ts:32-33` — схемы `user/base` и `user/profile`;
- `src/core/server/app-storage.server.ts:19,25,26` — типы `storage-servers` и `user/base`;
- `src/core/ui/paginator/ui/PaginatorSettings.svelte:20`, `src/core/ui/paginator/compile.ts:27` — **рантайм-импорт `#modules/demo`** в UI ядра. Это худший случай: демо-модуль тянется в клиентский бандл ядра;
- `src/core/server/security-hardening.test.ts` — доменные модели (тест, менее критично).

Часть этих связей была и до миграции (`#content/user/schema`, `#content/storage-servers/types`, `#content/demo`), но именно миграция объявила `core` независимым — и не развязала. Нужен реестр ресурсов/расширений (как `db.ext.ts`), а не прямые импорты.

**P1-5. Межсубмодульные импорты.**
`accounts/server/accounts.ts:24` импортирует `#modules/user/profile/model/profile.schema.js` (и `grants(profileResource)` на строке 29). По §11 `accounts` должен работать через необязательный `profilePort`, не через схему профиля. То же — тесты `base/*.test.ts`, импортирующие `profile`/`accounts` (терпимо, но закрепляет связь).

**P1-6. Эрозия типов в `sections`.**
33 `load.server.ts` объявляют `event: any`; 71 вхождение `: any` в `sections`. Старые route-файлы были типизированы (`PageServerLoad`, `Promise<BlockEditRouteData>`, `BlocksFiltersPageData` и т.д.). Возвращаемые типы местами сохранены, но вход — `any`, поэтому `+page.svelte` получает `data: any`, и `svelte-check` не ловит расхождений между section и страницей. Это самая массовая содержательная потеря при переносе.

**P1-7. `layer-guard` не видит новые алиасы.**
`tooling/layer-guard.mjs:28-36` — `SUBPATH_ALIASES` содержит `#lib`, `#core`, `$lib`, `#hooks`, `#components`, `#content`, `#server`, но **не** `#modules` и **не** `#sections`. `canonSpecifier` для них возвращает `null`, поэтому ни одно правило `src/modules/...`/`src/sections/...` не может сработать на новом коде. Заодно канонизация `#lib/` → `src/core/lib/` дублирует `#core/` (в `package.json` `#lib` тоже перенаправлен в `core/lib`), а ветки `src/components/`, `src/content/`, `src/server/` мертвы.

**P1-8. `public-api` больше ничего не проверяет.**
`tooling/public-api.mjs:117` — `if (!spec.startsWith('#lib/')) return null`. В `src` 0 импортов `#lib/` и 567 `#core/lib/`. Отчёт «пакетов 11, входов 41» — это инвентаризация `entrypoints.json`, а не соблюдение входов. Проверка глубоких импортов ядра фактически отключена.

### P2 — гигиена и согласованность

1. `package.json:7-8` — `#components/*` и `#content/*` указывают на удалённые каталоги; шимы `#lib/#hooks/#server` перенаправлены (это допустимо до этапа 7), а два — просто битые.
2. `vite.config.ts` — `kit.alias` (`~`, `~/core`, `~/modules`, `~/sections`) не используется ни разу (0 импортов `~/`), при этом SvelteKit выдаёт предупреждение `config.alias is deprecated`; код живёт на `#core/#modules/#sections` из `package.json#imports`. Комментарий на строке 45 всё ещё говорит «новые пути добавляются без перемещения кода», а `src/server/trusted-origins.ts` переехал.
3. `vite.config.ts:109,128` — `warmup` ссылается на `src/routes/(site)/ModalSystem.svelte`; файл переехал в `src/core/app/`, поэтому `existsSync` его молча выбрасывает и прогрев ModalSystem потерян.
4. `src/sections/storage-servers/` содержит только `load.server.ts`; страница осталась в route (единственный не-тонкий адаптер).
5. Три «сессионных» дерева section: `sections/sessions` (журнал), `sections/user/sessions`, `sections/user/user-sessions` — по §14 ожидался один `sections/sessions`.
6. `base/svelte/SessionDeleteModal.svelte` и `base/svelte/UsersDeleteModal.svelte` остались в `base`, хотя по §9/§11 это UI `sessions`/`accounts`; в `base/svelte` также лежат SSR-тесты переехавших компонентов профиля (`ProfileCard.ssr.test.ts`, `ProfileModal.svelte.test.ts`, `ProfilesList.ssr.test.ts`) — они импортируют `#modules/user/profile/...` из `base`.
7. `src/core/i18n/index.ts` — один реэкспорт `../ui/form/messages.ru.js`; никакого «общего словаря» там нет, `Acl`/пагинатор берут тексты из UI-модулей.
8. `.github/workflows/module-guard.yml` (новый, не в индексе) запускает только `module-guard --tracked`, которому нужен тег `modules`; `check`/`test:guard` в CI не добавлены.
9. `src/modules/user/base/model/error.ts` — единственный английский комментарий в русскоязычном файле; мелочь, но стиль проекта другой.

---

## 6. Соответствие критериям §17 плана

| Критерий | Статус |
|---|---|
| `mod remove user/profile` — вход работает без шага профиля | ✗ `AuthWidget` импортирует `ProfileForm`, `base/model/types.ts` — типы профиля |
| `mod remove user/sessions` — вход/выход работают | ✗ `SessionDelete` → `SESSIONS_NAME`, `gateway` → `sessions.server` |
| `mod remove user/blocks` — auth и `BanNotice` работают | ~ `BanNotice` в `base`, но `AuthWidget` импортирует `BLOCKS_NAME` |
| `mod remove user/accounts` — вход и блокировки работают | ✗ `gateway.server.ts:49` импортирует `accounts`, `AuthWidget` — seed-form |
| `mod remove user` запрещён | ~ манифест есть, но нерабочий (entries отсутствуют) |
| `@user/config` доступен всем | ✗ алиаса нет; используется `#modules/user/base/...` |
| `user/base` не импортирует субмодули | ✗ 37 импортов |
| `user/profile` не импортирует blocks/sessions/accounts | ✓ |
| `user/sessions` не импортирует profile/blocks/accounts | ✓ |
| `user/blocks` не импортирует profile/sessions/accounts | ✓ |
| `LogoutModal` без `user/sessions` | ~ файл в `base`, но тянет `SESSIONS_NAME`/`sessions-exit` |
| `core` не содержит импортов `modules/*` | ✗ 14 |
| `sections` не импортируют внутренности модулей | ✗ 172 |
| `check`, `test`, `test:guard`, `test:public-api` зелёные | ✓ (но `test:public-api` вакуумный — P1-8) |

---

## 7. Что делать (по приоритету)

1. **P0:** вернуть связь `auth → profile` через сборку схемы; починить `package.json` scripts; починить `classes-audit` (`SCOPE` на новые пути) и `target-rule-guard` (`UI_DIRS` + `sessions/svelte`, `blocks/svelte`, `accounts/svelte`).
2. **P1:** заменить `event: any` на `RequestEvent`/`PageServerLoad` с текущими возвращаемыми типами; добавить `#modules`/`#sections` в `SUBPATH_ALIASES` и написать правила `user-base-boundary`, `submodule-boundary`, `composition-boundary`; починить `public-api` на `#core/lib/`; создать публичные барели и привести манифесты в соответствие с диском (+ `module-registry` с проверкой `entries`/`provides`/`install`).
3. **P1:** развязать `base` и субмодули по §7: `base/server/gateway.server.ts` — только auth/session/config/block, доменные API — в субмодулях, сборка — в `composition`; `AuthWidget` — шаг профиля через registry, `BLOCKS_NAME` → `invalidateAll()`; `modals.ts` — extension-записи вместо прямых импортов.
4. **P2:** удалить `#components/#content` и мёртвые ветки стражей; убрать неиспользуемый `kit.alias` (или перевести код на `~`); поправить `warmup` и комментарии; перенести `SessionDeleteModal`/`UsersDeleteModal` и «осиротевшие» тесты в их субмодули; свести три сессионных section к одному.

---

## 8. Итог

Перенос сделан добросовестно: файлы не побились, комментарии и документация обновлены, владение обязательными частями (`base`) и ядром (`storage-probe`, `pool-types`, `Acl`, `field-mirror`, `filter-messages`) соответствует плану, route-адаптеры стали тонкими, экшены и тела страниц найдены в `sections` без потерь.

Но это перенос **файлов**, а не **ответственности**. Центральное свойство плана — «`base` живёт без опциональных субмодулей, `core` — без доменов» — не выполнено; границы не только не enforced, но и перестали проверяться тремя стражами; манифесты и публичные входы существуют номинально. Отдельно требуется исправить регрессию схемы (`relations`), иначе список аккаунтов с никнеймами сломается в рантайме при зелёных проверках.

---

## 9. Статус исправлений (после ревью)

Исправления шли этапами; ниже — что реально сделано и чем это проверено.

### Этап 1. Целостность и проверки

- Связь `auth → profile` восстановлена композиционным швом ядра: `src/core/lib/db/relations.ts` (`registerRelation`/`relationsOf`), регистрация `auth.profile` в `profile.schema.ts`, чтения связей переведены на `relationsOf` (`query/sql.ts`, `resource.ts`, `raw.ts`, `grants.ts`). Добавлен `profile.relation.test.ts`.
- Оживлены glob-расширения модулей (раньше смотрели в удалённый `src/content`): модалки, `init.ext.server`, `nav.ext`, `db.ext`.
- `package.json`: удалены мёртвые `#components/*`, `#content/*`; `test:db`, `test:db:probes`, `probe:user:sessions-bulk` указывают на новые пути.
- `classes-audit` (`SCOPE`), `target-rule-guard` (`UI_DIRS`), `layer-guard` (`SUBPATH_ALIASES`), `public-api` (`#core/lib/*`) переведены на новую раскладку и снова проверяют код.

### Этап 2. Типы

- 33 `load.server.ts`: `event: any` → `RequestEvent` (+ generic).
- 23 страницы: `data: any` → `data: Awaited<ReturnType<typeof loadX>>`; type-only импорт не считается рантайм-связью.

### Этап 3. Развязка ядра

- Панель `DemoPanel`/`define`/`schema` и `DemoVaultButton` перенесены в `src/core/ui/panel` (на панели построены настройки пагинатора ядра); `modules/demo` реэкспортирует.
- `core/server/app-storage.server.ts` использует типы из `core/lib/storage` (`pool-types.ts` объявлен входом).
- `security-hardening.test.ts` перенесён в `modules/user/base/tests`.
- `core → modules` осталось только в `db.server.ts` (сборка ресурсов схемы) и закреплено правилом `layer-guard` как единственное исключение.
- **Найдена и исправлена регрессия сборки:** SvelteKit считает серверным любой каталог `server/`, а в `modules/**/server` лежали изоморфные модули, импортируемые клиентом (14 ошибок `server_only_import`). Каталоги переименованы в `service/` (роль та же), все ссылки обновлены; `npm run build` проходит.

### Этап 4. Манифесты и публичные входы (частично)

- Созданы публичные барели: `base/{config,model,service,svelte}/index.ts`, `profile/{index,model,service,svelte}`, `sessions/svelte`, `blocks/{index,service,svelte}`, `accounts/{index,service,svelte}`.
- Манифесты приведены к диску: убраны несуществующие `./model` у сессий/блокировок/аккаунтов, входы указывают на реальные файлы.
- Добавлен `tooling/module-registry.mjs` + 3 теста: уникальность `name`, существование `parent`/`dependsOn`, отсутствие циклов, существование `entries`/`provides`/`install` путей, согласованность `submodules`.
- Гигиена: убран устаревший `kit.alias`, warmup указывает на существующие файлы, страница `/storage-servers` вынесена в `sections/storage-servers` и стала тонким route-адаптером.

### Проверено

- `KIT_ADAPTER=node npm run check` — 0 ошибок, 0 предупреждений.
- `npm run test:guard` — 230 тестов: 217 pass, 0 fail, 13 skip.
- `node tooling/module-registry.mjs` — реестр согласован.
- `node tooling/public-api.mjs` — 11 пакетов, 42 входа.
- `node tooling/classes-audit.mjs` — 54 файла, 0 маркеров; `target-rule-guard` — ok.
- `DATABASE_RESET= KIT_ADAPTER=node npm run build` — exit 0. Без сброса флага сборка падает на пост-шаге `db-reset` из-за боевого `DATABASE_URL` в окружении, а не на коде.

### Этап 5. Инверсия `base ↔ субмодули`

- **Импортов `base → {profile,sessions,blocks,accounts}` в рантайме больше нет (0).** Тесты `base`, использующие домен как фикстуру (14 файлов), остаются на месте — это следующий шаг «тесты по владельцам».
- `base/modals.ts` содержит только auth/menu/logout/config; модалки профиля, сессий, блокировок и аккаунтов переехали в `modules/user/*/modals.ts` и подхватываются тем же glob'ом.
- `SessionDeleteModal` и серверная форма закрытия — в `sessions`; `UsersDeleteModal` — в `accounts`; `SessionDelete` остался в `base` и получает `invalidateResource` пропом (без пропа — `invalidateAll`), `SESSIONS_NAME` в базе больше нет.
- `seed-form` целиком в `base/svelte/seed-form` (по плану §7); `AuthWidget` больше не тянет `BLOCKS_NAME`/`SEED_USERS_NAME` — после входа инвалидируется всё, домены обновляют свои списки сами.
- Шаг профиля во входе и шаг сессий в настройках — расширения: `profile/svelte/auth.ext.ts` и `sessions/svelte/config.ext.ts` регистрируются glob'ами в layout; `base` рендерит зарегистрированный компонент и не импортирует домен. Без субмодуля шаг профиля завершает вход, шаг сессий просто отсутствует.
- `gateway.server.ts` разделён: база владеет входом/выходом/продлением/настройками и объявляет пустой `UserDomains` + `UserDomainContext`; каждый субмодуль экспортирует свою фабрику (`sessionsDomain`, `profileDomain`, `blocksDomain`, `accountsDomain`) и дополняет `UserDomains` объявлением модуля. `composition/index.server.ts` регистрирует фабрики и порт профиля; `hooks.server.ts` импортирует composition до первого запроса.
- Порт `profiles` стал необязательным по владельцу: без субмодуля профиля база использует no-op порт (токен несёт `prof: null`).
- Профильные DTO (`ProfileView`, `VisibilityLevel` и т. д.) объявлены в `base/model/types.ts` — это контракт токена/порта; `profile/model/types.ts` их реэкспортирует. Направление зависимости теперь `profile → base`.

### Проверено после инверсии

- `KIT_ADAPTER=node npm run check` — 0 ошибок, 0 предупреждений.
- `npm run test:guard` — 217 pass, 0 fail, 13 skip (230 тестов).
- `node tooling/module-registry.mjs` — реестр согласован; `public-api` — 11 пакетов, 42 входа.
- `DATABASE_RESET= KIT_ADAPTER=node npm run build` — exit 0 (SSR + client, адаптер node).
- `base → субмодули`: 0 (рантайм); `core → modules`: только `db.server.ts`.

### Осталось (следующие этапы плана)

- `accounts → profile` — 4 импорта (тестовая фикстура `accounts.test.ts`); тесты `base` о доменных фикстурах разложить по владельцам.
- `provides` (`authSteps`, `menu`, `modals`, `routes`) и `install` в манифестах; правило `public-api` «только `manifest.entries`» (сейчас глубокие импорты из `sections`).
- Свести три сессионных section к одному.
