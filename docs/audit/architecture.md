# Аудит модульной архитектуры, переиспользования примитивов, самодостаточных компонентов и реестра маршрутов `address`

Исследование текущего дерева файлов `modals-kit`, зависимостей `package.json`, внутренних примитивов `src/lib/*`, папочных UI-модулей `src/components/*`, самодостаточных форм `#hooks/component-form`, конфигов Vite/UnoCSS, стражей `tooling/*` и единого типизированного реестра маршрутов в `#lib/address`.

> **Статус:** **Раунды 1, 2 и 3 утверждены владельцем**; выполнена глубокая предреализационная ревизия кода, зависимостей и стражей (**Раунд 4 — устранение любых лишних сущностей и учёт всех скрытых связей**). Код в `src/` не изменялся — ожидается финальная отмашка перед стартом **Этапа 1**.

---

## 1. Сводка всех утверждённых решений владельца (Раунды 1–3)

1. **Никакой папки `src/modules/` — 5 чистых алиасов в `package.json` (`#lib/*`, `#hooks/*`, `#components/*`, `#content/*`, `#server/*`):**
   - **`src/lib/<pkg>/`** — автономные переносимые библиотеки («свой `node_modules`») **вместе со своими фреймворковыми адаптерами** (`svelte/`, `sveltekit/`, `cores/sveltekit.ts`, `node.ts`), чтобы любая папка `src/lib/<pkg>/` копировалась целиком, а чистый вход `./index.ts` в Node не требовал фреймворков (`tooling/core-purity.mjs`).
   - **`src/hooks/`** — единая папка межбиблиотечных переходников и общепроектных реактивных/серверных связок (`cache-db.ts`, `db-form.ts`, `graphql.ts`, `task-stream.server.ts`, `component-form/`, `links/`, `js-only.svelte.ts`, `use-drawer.svelte.ts`, `app-errors.svelte.ts`); дублирующая `src/lib/hooks/` удаляется.
   - **`src/components/<name>/`** — самодостаточные папочные UI-модули кита без собственной бизнес-модели (`utils.ts`, `ui/`, `settings/`, `demo/`, `form/`, **`fields/`**, **`paginator/`**, `modals/`, `steps/`, `loader/`, `shell/`); дублирующая `src/lib/components/` удаляется.
   - **`src/content/`** — прикладные доменные модули со своими моделями, формами, модалками и серверными шлюзами `*.server.ts` (`src/content/user/`, а для демо-источников каталога — см. находку №7 ниже).
   - **`src/server/`** — инстансы и bootstrap конкретного сайта (`db.server.ts`, `schema-admin.server.ts`, `cache.server.ts`, `live-cache.server.ts`, `fetch.server.ts`, `form-security.server.ts`, `after-response.server.ts`, `api-error.server.ts`, `trusted-origins.ts`); все серверные модули вне `$lib/server` строго оканчиваются на `*.server.ts` (кроме изоморфного `trusted-origins.ts`, импортируемого напрямую в `vite.config.ts`).
   - **`src/routes/`** — тонкие маршруты-потребители + лабораторные стенды ядер (`/form`, `/steps`, `/db-demo`, `/modals`), вся стендовая обвязка которых остаётся внутри их папок без искусственной переделки.
2. **Двухуровневый стандарт кастомизации всех папочных модулей в `src/components/<name>/`:**
   - **Уровень 1:** `<Name ... variant="..." class="..." classes={{ ... }} />` на базе `variants(...)` + `cn(...)`.
   - **Уровень 2:** экспорт вложенных составных компонентов (каждый со своим `variant` и `class` через `cn(...)`) для нестандартной геометрии экрана.
3. **Самодостаточный контур форм `#hooks/component-form`:**
   - поддержка динамического `description(event)` и `source` в `ComponentFormRegistration`;
   - автоматический inline-рендер (`200`, `locals.formResult`) при `result.outcome === 'not-applied'` (конструкторы `field.fields` работают с JS и без JS без ручного серверного кода);
   - колбэк `onSuccess` в `bindComponentForm`;
   - автосбор всех `*.form.server.ts` из `src/content/**` и `src/routes/**` через `import.meta.glob(..., { eager: true })` без ручного списка в `src/hooks.server.ts`.
4. **Пилот №1 (`src/components/fields/` + `/fields`) и Модуль №2 (`src/components/paginator/` с `SearchBar.svelte` и `filters/*`)** — утверждены.
5. **Нулевая связность `#lib/address` × `#lib/modals`** — утверждена через штатный `registerModal({ route: userAuthRoute.href })` и перенос `routes.ts` + `modals.ts` внутрь `src/content/user/`.

---

## 2. Раунд 4. Ревизия кода, зависимостей, конфигов и стражей (8 находок — 0 лишнего кода)

Повторная сверка всего плана с `package.json`, `src/lib/*`, `src/hooks/*`, `src/routes/api/*`, `vite.config.ts`, `unocss.config.ts`, `tooling/*` и `test/browser/*` выявила **8 конкретных мест**, где первоначальный черновик либо дублировал уже существующие в репозитории механизмы, либо задевал скрытые ограничения сборки и стражей:

### Находка 1. Убираем самописные кодеки `queryString` / `queryNumber` / `queryBoolean` / `queryEnum` / `queryLocalPath` из `#lib/address/routes.ts`
- **Что уже есть в проекте:**
  1. В runtime-зависимостях `package.json` (`строка 74`) **уже установлен `@standard-schema/spec` (`^1.1.0`)**, который уже нативно реализован без внешних зависимостей в `#lib/db/schema.ts` (`s.*`, сверен дифференциальными тестами с `zod@^4.0.0`) и используется в `src/env.ts` (`StandardSchemaV1`).
  2. В `#lib/address/core.ts` **уже реализован и покрыт тестами `localPath(raw)`** (проверка site-local пути и защита от Open Redirect).
  3. В `#lib/address/keys.ts` **уже реализованы `nextSearch`, `readQuery`, `carryQuery`, `claimQuery`** (чтение/патч query с удалением пустых и дефолтных значений и сохранением соседних GET-ключей).
- **Решение (0 дублирования):** `#lib/address/routes.ts` (~`60` строк вместо `~300`) **не вводит пятый DSL валидации** и **не пишет второй сериализатор `URLSearchParams`**: схема поля `search` принимает любую `StandardSchemaV1` **или** простую функцию-парсер `(raw: string | undefined) => T` (включая готовый `localPath` из `./core.ts`) + `{ default?: T }`, а сборку и патч строки запроса делегирует готовому `nextSearch` из `./keys.ts`.

### Находка 2. Убираем самописный `tooling/route-registry-guard.test.mjs` — переиспользуем `$app/types` SvelteKit 3 + готовый `makeRouteResolves`
- **Что уже есть в проекте:**
  1. `@sveltejs/kit@3.0.1` **уже генерирует** строгие union-типы `RouteId` и `RouteParams<Path>` в `$app/types` по реальному дереву `src/routes/**`.
  2. В `src/lib/modals/cores/routes.ts` (`50` строк чистого кода без единой модальной зависимости) + `sveltekit.ts:52` **уже работает** `routeResolves = makeRouteResolves(Object.keys(import.meta.glob('/src/routes/**/+page.svelte')))`, на который уже опираются и `asLink`, и `asModalLink`.
- **Решение (0 новых скриптов в `tooling/`):**
  - В `#lib/address/sveltekit.ts` хелпер `kitRoute` типизирует `path` через `RouteId` и `RouteParams<Path>` из `$app/types`: любая опечатка или переименование папки в `src/routes/**` **валит `npm run check` (`svelte-check`) автоматически на этапе компиляции** без единого нового `.mjs`-скрипта в `tooling/`.
  - В рантайме `asLink` и `asModalLink` продолжают проверяться единым уже существующим `routeResolves`.

### Находка 3. Нулевое касание `src/lib/form/` ради жёсткого лимита `tooling/form-size.mjs`
- **Что вскрыла проверка:** `tooling/form-size.mjs` держит строгий потолок бандла `src/lib/form/` (`348_300` B raw / `100_800` B gzip / `20_900` B `svelte`-адаптер с запасом всего ~`100–450` байт). При этом в `src/lib/form/svelte/bind.svelte.ts:82` **уже есть** `onResult?: (result: Result<TData>) => void`.
- **Решение:** в `src/lib/form/**` не добавляется **ни одного байта**. Опция `onSuccess` (срабатывающая на `result.ok && result.outcome !== 'not-applied'` как по `fetch`-транспорту, так и по свежему `actionResult` из `page.form`) реализуется целиком в 8 строках `src/hooks/component-form/bind.svelte.ts` поверх уже существующего `onResult`.

### Находка 4. Очистка `src/components/fields/` от лишних обёрток (`3` реальных компонента вместо `6`)
- **Что оказалось лишним в черновике Раунда 2:**
  - `<RecordFieldsForm>` с выдуманными сниппетами `beforeFields`/`afterFields`, `submitLabel`, `errorTitle` просто оборачивал уже готовые и всем знакомые `<Form>` + `<Common>` + `<Field>` + `<Button>` из `#components/form` и `#components/ui`, только мешая свободной вёрстке обычных полей формы рядом с динамическими.
  - Выделение `BuilderRow.svelte` на `20` строк вне `fieldSet(form, name)` дробило 60-строчный `SchemaBuilder.svelte` без самостоятельного сценария использования.
- **Решение:** оставить в `src/components/fields/` **ровно 3 чистых переиспользуемых компонента** (`SchemaBuilder.svelte`, `SchemaFields.svelte`, `SchemaValues.svelte` + `variants.ts`, `types.ts`, `index.ts`). При этом прямо внутрь `SchemaBuilder.svelte` переносится тонкая защита нативного `Enter` без JS (`<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>` из `CollectionForm.svelte:79`), чтобы в любой форме клавиша `Enter` нажимала основную кнопку сохранения, а не «Удалить» первой строки конструктора.

### Находка 5. Полное исключение искусственного «Этапа 4» (сохранение стендовых `/form/submit` и `/db-demo/submit`)
- **Что вскрыло чтение `src/routes/(site)/(app)/{form,db-demo}/submit/+server.ts`:**
  - `/form/submit/+server.ts` **не дубликат**: он отдаёт `GET /form/submit?job=...` для тестирования опроса фоновой очереди `pollUntilDone` (`#lib/form/queued.ts`) и намеренно проверяет `jsonTransport` (`from: 'fetch'`) рядом с `from: 'action'` через единый `./handle.ts`.
  - `/db-demo/submit/+server.ts` оборачивает POST в `taskResponse(request, ..., { watch: [watchDb] })` для NDJSON-стриминга прогресса холодного запуска БД и многошаговой миграции прямо в кнопку отправки (`readTaskStream`).
- **Решение:** в полном соответствии с правилом Раунда 1 (*стендовая обвязка `form`, `db-demo`, `steps`, `modals` живёт внутри папок своих роутов*) **бывший Этап 4 исключается целиком**: мы не ломаем стенды `pollUntilDone`/`taskResponse` и не раздуваем `component-form` стендовыми фичами. План сжимается с `6` до **5 чистых этапов**.

### Находка 6. Стопроцентное переиспользование `DemoPanel` (`#components/demo`) в `src/components/paginator/`
- Чтение `PaginatorSettings.svelte` и `compile.ts` подтвердило, что вся панель настроек пагинатора уже построена на готовом `DemoPanel` (`demoSelect`, `demoToggle`, `demoDivider`) с прогрессивным улучшением, hidden-парами тумблеров и `disabledWhen`. Ничего переписывать не требуется: `src/lib/components/demo/` переезжает в `src/components/demo/` как есть (`0` лишнего кода + замена `DemoPanel.svelte:229` на общий `cn(...)`), а `<Paginator />` в `src/components/paginator/` собирает только повторяющийся каркас скролл-хоста и подкомпонентов `ui/*`.

### Находка 7. Критическая находка графа импортов для демо-источников (`src/routes/api/*` + `src/server/db.server.ts`)
- **Что вскрыла трассировка всех 5 API-эндпоинтов в `src/routes/api/**` и `src/lib/server/db.ts`:**
  - `posts` импортируется **сразу из 4 разных веток дерева**:
    1) `src/server/db.server.ts` (`defineDb({ models: [...authModels, postsModel] })`),
    2) `src/routes/api/db-posts/+server.ts`,
    3) `src/routes/(site)/(app)/db-demo/*`,
    4) `src/routes/(site)/(app)/paginator/*` (`DbPostRow.svelte` + `useCursorMode`);
  - `shikimori*` импортируется из `src/routes/api/shikimori/{animes,filters,terms}/+server.ts` **и** из `src/routes/(site)/(app)/paginator/*` (+ проверяется `tooling/source-schema-guard.mjs`);
  - `rickmorty*` импортируется из `src/routes/api/rickmorty/characters/+server.ts` **и** из `src/routes/(site)/(app)/paginator/*`.
- **Почему нельзя класть их внутрь `src/routes/(site)/(app)/{db-demo,paginator}/`:**
  - `src/server/db.server.ts` пришлось бы импортировать модель **вверх из папки роута** (`#server → routes`, прямая инверсия слоёв!);
  - все роуты в `src/routes/api/**` получили бы 4-этажные относительные импорты `../../../../(site)/(app)/...`, а в `layer-guard.mjs` пришлось бы пробивать **4 разных исключения** между слоями и роутами.
- **Чистое решение без единого исключения в `layer-guard.mjs`:**
  Собрать все 4 витринных источника в одну изолированную подпапку **`src/content/catalog/{items,posts,rickmorty,shikimori}/`** (где рядом лежат клиентские модели, карточки и серверные адаптеры `*.server.ts`, ровно как в `src/content/user/`):
  - в корне `src/content/` — ровно две чёткие папки: **`user/`** (боевой модуль сайта) и **`catalog/`** (все демо-источники витрин — при старте нового проекта сносятся одной командой `rm -rf src/content/catalog`);
  - `src/server/db.server.ts` единообразно собирает `models: [...authModels, postsModel]` из `#content/user/db.server.js` и `#content/catalog/posts/posts.js`;
  - и `/api/*`, и `/db-demo`, и `/paginator` чисто импортируют `#content/catalog/...` с **нулём инверсий и нулём исключений в `layer-guard.mjs`**, а `src/routes/(site)/(app)/paginator/` ужимается с 17 до тонких файлов витрины.

### Находка 8. Полный реестр зашитых путей в конфигах, доках БД, стражах и браузерных тестах
Ревизия заранее выявила все 8 мест за пределами TypeScript-импортов `src/`, которые обязательно обновляются синхронно, чтобы ни один гейт или Playwright-тест не упал:
1. **`vite.config.ts:7, 74–82`** — путь `./src/server/trusted-origins.ts` (файл обязан оставаться чистым без `$app/*`, т.к. исполняется в Node до старта плагинов SvelteKit) + 8 путей прогрева в `server.warmup.clientFiles` (`./src/components/...`).
2. **`unocss.config.ts:2`** — путь `./src/hooks/links/indicator` для `LINK_INDICATOR_CSS`.
3. **`tooling/layer-guard.mjs` + `tooling/layer-guard.test.mjs`** — расширение `canonSpecifier()` на **все 5 алиасов** (`#lib/`, `$lib/`, `#components/`, `#hooks/`, `#content/`, `#server/`), иначе запреты импортов в `src/lib/*` молча перестали бы видеть `#components/*` и `#hooks/*`.
4. **`src/lib/db/{README.md,PORTING.md,docs/LIVE-APPEND.md,docs/TRANSPORTS.md}`** — `schema-admin` переезжает в `src/server/schema-admin.server.ts` (**код `src/lib/db/` остаётся нетронутым на 100%**, не сдвигая таблицы `ENTRIES` и счётчики тест-групп в `tooling/db-docs.mjs`), а 14 путей в обратных кавычках в markdown-доках `src/lib/db/**` обновляются синхронно под проверку `exists()` в `tooling/db-docs.mjs:341`.
5. **`tooling/classes-audit.mjs:79–111`** — обновление 20 путей `src/components/...` + добавление `src/components/fields/*` и `src/components/paginator/*`.
6. **`tooling/source-schema-guard.mjs` + `tooling/source-schema-guard.test.mjs`** — обновление констант зон под `src/content/catalog/shikimori/`.
7. **`test/browser/attachment.mjs:56, 70`** — динамический браузерный `import('/src/components/ui/attachment/AttachmentBrowserFixture.test.svelte')`.
8. **`test/browser/fields.mjs:230, 244`** — перехват `pg.route('**/fields?/__component_form=*', ...)` вместо удаляемого `**/fields/save`.

---

## 3. Итоговые чертежи целевой архитектуры (очищенные от лишних сущностей)

### 3.1. Пофайловая раскладка слоёв

| Текущее расположение | Целевое расположение | Примечание |
|---|---|---|
| `src/lib/{address,cache,db,fetch,form,image,modals,paginate,task}/` | **Без изменений в `src/lib/<pkg>/`** | Чистые ядра + собственные фреймворковые адаптеры (`svelte/`, `sveltekit/`, `cores/`, `node.ts`). `src/lib/db/` и `src/lib/form/` не трогаются кодом вовсе (`0` байт прироста). |
| `src/lib/hooks/*`, `src/lib/components/links/*`, `src/lib/app-errors.svelte.ts`, `src/lib/server/graphql.ts`, `src/lib/server/task-stream.ts` | **`src/hooks/*`** | Единый слой прикладных связок (`#hooks/*`); `src/lib/hooks/` удаляется. |
| `src/lib/utils.ts`, `src/lib/components/*` | **`src/components/*`** | Единый слой папочных UI-модулей (`#components/*`): `utils.ts`, `ui/`, `settings/`, `demo/`, `form/`, **`fields/`**, **`paginator/`** (включая `filters/`), `modals/`, `steps/`, `loader/`, `shell/` (включая `header/` и `sidebar/`, а `nav.ts` — в `src/routes/(site)/`); `src/lib/components/` удаляется. |
| `src/lib/server/{db,schema-admin,cache,live-cache,fetch,form-security,after-response,api-error}.ts`, `src/lib/api-error.ts`, `src/lib/server/trusted-origins.ts` | **`src/server/*`** | Инфраструктура конкретного сайта (`#server/*`, все серверные модули — `*.server.ts`); `src/lib/server/` удаляется. |
| `src/content/user/*` + `src/routes/(site)/auth-modals.ts` | **`src/content/user/*`** | Полностью самодостаточный доменный модуль пользователя (`index.ts`, `routes.ts`, `modals.ts`, `*.server.ts`, `ui/*`). |
| `src/content/{items,posts,rickmorty*,shikimori*}.ts` + `src/lib/server/{db-list,rickmorty,shikimori*}.ts` + общие карточки витрин | **`src/content/catalog/{items,posts,rickmorty,shikimori}/`** | Изолированный пакет всех витринных источников каталога (`0` инверсий слоёв, удаляется целиком одной папкой `catalog/`). |

### 3.2. Модуль №1: `src/components/fields/` (`#components/fields`)
Без искусственных обёрток вокруг `<Form>`:
```text
src/components/fields/
├── index.ts                  # SchemaBuilder, SchemaFields, SchemaValues, fieldsVariants, типы
├── types.ts                  # BuilderLabels, слоты classes
├── variants.ts               # CVA-варианты (`default` | `plain`) через cn()
├── SchemaBuilder.svelte      # Редактор field.fields() для любой <Form> (+ hidden default submit для Enter без JS)
├── SchemaFields.svelte       # Авто-рендер всех полей form.from() в любой <Form>
└── SchemaValues.svelte       # Вывод сохранённых значений ключ → подпись по FieldSetItem[]
```
На обычном маршруте (и в обновлённом `/fields` из 5 файлов) обе формы собираются стандартно и прозрачно на `<Form>` + `bindComponentForm` без единого ручного endpoint-а `+server.ts`.

### 3.3. Модуль №2: `src/components/paginator/` (`#components/paginator`)
Строится поверх уже готового `#components/demo` (`DemoPanel`) без переписывания компилятора настроек:
- **Уровень 1 (`Paginator.svelte`):** готовый скролл-хост со встроенными `LoadingIndicator`, верхними/нижними `EdgeSentinel` + `LoadMoreLink`, `EmptyState`, переключением `PageList` / `PageColumns`, `LiveStatus`, `ErrorRow`, `ReplaceLoadingRow`, `EndRow`, `PageNav` и CVA-вариантами (`variant`, `class`, `classes`).
- **Уровень 2 (`ui/*`):** все кастомизируемые составные блоки для экранов с собственной табличной/оптимистичной разметкой (`DbPostsList.svelte` в `/db-demo`, внешняя навигация в `GalleryDemo.svelte`), включая перенесённые сюда `SearchBar.svelte` и `FiltersPanel` / `ActiveFilters` / `FilterActions`.

### 3.4. Единый реестр маршрутов в `#lib/address` и связка с `#lib/modals`
- **`src/lib/address/routes.ts`** (~`60` строк, `0` фреймворковых импортов):
  - принимает `path` и опциональную схему `search` на базе **уже установленного `@standard-schema/spec`** или простых парсеров (`localPath` из `./core.ts`) с `default`;
  - даёт `route.href(params?)` (чистый URL без дефолтных параметров), `route.parse(url)` (deny-safe чтение на SSR и клиенте) и `route.patch(currentUrl, patch)` (обновление своих ключей через готовый `nextSearch` из `./keys.ts` без затирания чужих GET-ключей).
- **`src/lib/address/sveltekit.ts`:**
  - обёртка `kitRoute`, типизирующая `path` через сгенерированные самим SvelteKit 3 типы `RouteId` / `RouteParams<Path>` из `$app/types` — мёртвые и опечатанные пути отлавливаются `npm run check` на этапе компиляции без дополнительных скриптов.
- **`src/content/user/routes.ts` + `src/content/user/modals.ts`:**
  - `userAuthRoute` (`stage`, `next: localPath`) и `userMenuRoute`;
  - `registerModal({ name: 'user.auth', component: AuthModalLazy, route: userAuthRoute.href, ... })` — `#lib/modals` и `#lib/address` остаются на 100% независимыми друг от друга.

---

## 4. Сводный поэтапный план реализации (5 атомарных коммитов)

Каждый этап завершается полным прогоном гейтов (`npm run test:guard`, `npm run check`, `npx vitest run`, `npm run build && node tooling/size-budget.mjs` + профильные `test/browser/*.mjs`), отдельным коммитом и отправкой в `origin/img`.

| Этап | Содержание коммита | Синхронное обновление конфигов, стражей и тестов |
|---|---|---|
| **Этап 1. Фундамент слоёв и очистка `src/lib/`** | Алиасы `#components/*` и `#server/*` в `package.json`; перенос `src/lib/components/*` → `src/components/*` (`utils.ts`, фикс `cn` в `DemoPanel`, `header`+`sidebar` → `shell/`, `nav.ts` → `routes/(site)/`), связок → `src/hooks/*`, синглтонов (`db`, `schema-admin`, `cache`, `live-cache`, `fetch`, `form-security`, `after-response`, `api-error`, `trusted-origins`) → `src/server/*`. | `vite.config.ts`, `unocss.config.ts`, `tooling/layer-guard.mjs` (все 5 алиасов в `canonSpecifier` + правило `*.server.ts`), `tooling/classes-audit.mjs`, 14 путей в доках `src/lib/db/**/*.md`, `test/browser/attachment.mjs`, `shell.mjs`, `modals.mjs`. |
| **Этап 2. `#hooks/component-form` v2 + Пилот №1 `src/components/fields/`** | Доработка `#hooks/component-form` (`description(event)`, `source`, авто-inline `200` при `not-applied`, `onSuccess` в `bind.svelte.ts` без единого байта в `src/lib/form/`, автосбор `*.form.server.ts` через `import.meta.glob`); создание `src/components/fields/` (`SchemaBuilder`, `SchemaFields`, `SchemaValues`); перевод `/fields` на 5 тонких файлов и удаление `/fields/{save,record}/+server.ts`. | Обновление `test/browser/fields.mjs` (`pg.route('**/fields?/__component_form=*')`), прогон `fields.mjs` + `attachment.mjs` + `test:form-size`. |
| **Этап 3. Модуль №2 `src/components/paginator/` + `src/content/catalog/`** | Сборка `src/components/paginator/` (`Paginator.svelte` + `ui/SearchBar.svelte` + `ui/FiltersPanel.svelte` + `ui/*`); перевод `GalleryDemo` и `CatalogDemo` на `<Paginator />`; сборка всех 4 демо-источников в `src/content/catalog/{items,posts,rickmorty,shikimori}/`. | Обновление зон в `tooling/source-schema-guard.mjs` (+ `.test.mjs`), `tooling/classes-audit.mjs`, прогон `paginate.mjs`, `shikimori.mjs`, `db-demo.mjs`. |
| **Этап 4. Реестр маршрутов `#lib/address` + доводка `src/content/user/`** | Реализация `#lib/address/routes.ts` (на `@standard-schema/spec` + `localPath` + `nextSearch`) и `kitRoute` в `#lib/address/sveltekit.ts`; оформление `src/content/user/{routes,modals}.ts`, `*.server.ts`, дефолтных `limits` в `ProfileForm`/`AuthWidget` и перевод ссылок проекта на `address`. | Unit-тесты `routes.test.ts` (включая Open Redirect и сохранение соседних query-параметров), прогон `auth.mjs` и `modals.mjs`. |
| **Этап 5. Финальная приёмка, бюджеты и документация** | Актуализация `AGENTS.md`, `docs/audit/{architecture,README,testing-backlog}.md`, подтяжка бюджетов `tooling/size-budget.mjs` и сквозной прогон всех тестов. | Полный набор гейтов + все `test/browser/*.mjs`. |

---

## 5. Финальные контрольные вопросы перед стартом Этапа 1

1. **`src/content/catalog/{items,posts,rickmorty,shikimori}/` вместо роутов (Находка №7):**
   Согласуем сборку всех 4 общих демо-источников в `src/content/catalog/` (рядом с `src/content/user/`), чтобы не создавать инверсию `src/server/db.server.ts → src/routes/...`, не тянуть 4-этажные `../../../../(site)/(app)/...` из `src/routes/api/*`, не добавлять ни одного исключения в `layer-guard.mjs` и при этом удалять весь демо-контент одной папкой `rm -rf src/content/catalog`?
2. **Старт реализации по очищенному 5-этапному плану (`Этапы 1 → 5`):**
   Все лишние сущности убраны, все существующие примитивы и скрытые связи учтены — начинаем реализацию с **Этапа 1**?
