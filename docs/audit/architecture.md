# Аудит модульной архитектуры, библиотек, самодостаточных компонентов и реестра маршрутов `address`

Исследование текущего дерева файлов `modals-kit`, границ переносимых библиотек `src/lib/`, папочных UI-модулей `src/components/`, самодостаточности встраиваемых форм `#hooks/component-form` и единого типизированного реестра маршрутов с GET-параметрами в `#lib/address`.

> **Статус:** поэтапное архитектурное проектирование с владельцем (**Раунд 1 утверждён**, **Раунд 2 готов к согласованию**; файлы в `src/` пока не перемещались).

---

## Сводка утверждённых решений владельца (по итогам Раунда 1)

1. **Никакой папки `src/modules/` — чёткое разделение `src/components/<name>/` и `src/content/<entity>/`:**
   - **`src/components/<name>/`** — переиспользуемые папочные UI-модули кита без собственной бизнес-модели и таблиц БД: принимают снаружи декларативную **схему**, отдают готовый UI «под ключ», поддерживают кастомизацию стилей снаружи и экспортируют вложенные составные части `ui/`.
   - **`src/content/<entity>/`** — прикладные сущности сайта (эталон — `src/content/user/`), которые живут одновременно в шапке, модалках и на разных страницах.
   - **Демо-маршруты:** потребительские роуты хранят локальную схему своего экрана рядом с роутом и вызывают `src/components/*`; чистые лабораторные стенды ядер (`/form`, `/steps`, `/db-demo`, `/modals`) остаются стендами внутри своих папок роутов без искусственного вытягивания кода в `src/components/`.
2. **Порядок пилотов утверждён:**
   - **Пилот №1 (эталон малого модуля):** `/fields` → папочный модуль **`src/components/fields/`** + тонкий роут `/fields` на едином `#hooks/component-form`.
   - **Модуль №2 (главный целевой модуль):** `/paginator` → папочный модуль **`src/components/paginator/`** (поглощающий `filters/`) + перенос демо-схем `items` / `rickmorty` / `shikimori` из общих папок.
3. **Двухуровневый стандарт кастомизации папочных UI-модулей утверждён:**
   - **Уровень 1 (готовый сборщик):** `<Name schema={...} variant="..." class="..." classes={{ root: '...', ... }} />` — CVA-варианты через `variants(...)` и проброс всех слотов через `cn(...)`.
   - **Уровень 2 (составные части):** экспорт подкомпонентов из `ui/` (каждый со своим `variant` и `class` через `cn(...)`) для экранов с нестандартной раскладкой.
4. **Фреймворковые адаптеры ОСТАЮТСЯ внутри `src/lib/<pkg>/` (решение по вопросу №3 Раунда 1):**
   - Подпапки `svelte/`, `sveltekit/`, `cores/sveltekit.ts`, `node.ts` **не выносятся в `src/hooks/`**, а остаются частью своих библиотек `src/lib/<pkg>/` (как опциональные subpath-входы пакета).
   - При будущем переносе любой папки `src/lib/<pkg>/` в другой проект библиотека переезжает **целиком вместе со своими адаптерами**; в чистом Node основной вход `./index.ts` не импортирует `svelte` / `@sveltejs/kit` и не требует их установки (гарантируется `tooling/core-purity.mjs`).
   - В `src/hooks/` остаются **только межбиблиотечные переходники и общепроектные реактивные связки**, не принадлежащие ни одной отдельной библиотеке.

---

## 1. Фактическая ревизия текущего дерева `src/` и точная карта очистки

Полное построчное чтение `src/**` показало, что сейчас нарушает границы слоёв и куда именно уходит каждый файл после утверждения решений Раунда 1:

### 1.1. Выявленные обратные зависимости в текущем коде (устраняются при переезде)
1. **`src/lib/server/db-list.ts:27` → `../../routes/(site)/(app)/db-demo/definition`** — серверный файл внутри `src/lib/` напрямую импортирует внутренний файл маршрута `db-demo`!
2. **`src/lib/server/db.ts:19,43-44`** — импортирует `../../content/posts`, `#content/user/schema.js` и `#hooks/cache-db.js` изнутри `src/lib/`.
3. **`src/lib/server/cache.ts`** — импортирует `#hooks/cache-db.js` изнутри `src/lib/`.
4. **`src/routes/(site)/(app)/paginator/CatalogDemo.svelte` и `sources.ts:31`** — напрямую импортируют соседний маршрут `../db-demo/DbPostRow.svelte`, `../db-demo/cursor-mode.svelte` и `../db-demo/definition`.
5. **Две параллельные папки хуков:** `src/hooks/` и `src/lib/hooks/`.
6. **Баг слияния классов в `DemoPanel.svelte:229`:** `class={className ?? 'demo-panel rounded-xl ...'}` — передача любого `class="mt-4"` полностью сносит базовые классы карточки вместо `cn(...)`.

### 1.2. Полная пофайловая раскладка `src/lib/` (с учётом сохранения адаптеров в `lib/<pkg>/`)

| Текущий путь в `src/lib/` | Куда переезжает (или остаётся) | Обоснование |
|---|---|---|
| `address/`, `cache/`, `db/`, `fetch/`, `form/`, `image/`, `modals/`, `paginate/`, `task/` **(включая их `svelte/`, `sveltekit/`, `cores/`, `node.ts`)** | **Остаются в `src/lib/<pkg>/`** | Самодостаточные переносимые пакеты: ядро `index.ts` без фреймворков + собственные subpath-адаптеры рядом. |
| `server/schema-admin.ts` | **`src/lib/db/sync/admin.ts`** | В файле `0` импортов `$app/*` и сайта — чистый механизм `lib/db` (описан в `src/lib/db/README.md §6`). |
| `hooks/js-only.svelte.ts`, `hooks/use-drawer.svelte.ts` | **`src/hooks/`** | Ликвидация второй папки `src/lib/hooks/` — все прикладные хуки живут в едином `src/hooks/`. |
| `components/links/*` (`0` `.svelte`-файлов) | **`src/hooks/links/`** | Межбиблиотечная связка `#lib/address` × `#lib/modals` × навигационный лоадер без UI-шаблонов. |
| `app-errors.svelte.ts` | **`src/hooks/app-errors.svelte.ts`** | Единый реактивный приёмник `onError` всех библиотек на уровне приложения. |
| `server/graphql.ts` | **`src/hooks/graphql.ts`** (чистая фабрика) | Связка `#lib/fetch` × `#lib/cache`; дефолтный инстанс с `upstream`/`localStore` поднимается в `src/server/fetch.server.ts`. |
| `server/task-stream.ts` | **`src/hooks/task-stream.server.ts`** | Связка `#lib/task` × `#lib/fetch` × `AsyncLocalStorage` (NDJSON-поток прогресса). |
| `utils.ts` (`cn`, `variants`) | **`src/components/utils.ts`** | Единая утилита CVA-вариантов и `twMerge` для всех папочных модулей `src/components/*` и `src/content/*`. |
| `components/{ui,settings,demo,form,modals,steps,loader,shell,header,sidebar}/*`, `ErrorPage.svelte`, `Error500.svelte` | **`src/components/*`** (`filters/` входит в `paginator/`, `header/`+`sidebar/` — в `shell/`) | Папка `src/lib/components/` удаляется целиком; меню демо-сайта `nav.ts` уходит из `shell` в `src/routes/(site)/`. |
| `server/{db,cache,fetch,form-security,after-response}.ts`, `server/trusted-origins.ts`, `server/api-error.ts`, `api-error.ts` | **`src/server/*.server.ts`** (и изоморфный тип ошибки API) | Bootstrap и синглтоны конкретного сайта (`db.server.ts`, `cache.server.ts`, `fetch.server.ts`, `form-security.server.ts`). |
| `server/{rickmorty,shikimori*}.ts` + `src/content/{items,rickmorty*,shikimori*}.ts` | **В демо-источники `/paginator`** (и `/api/{rickmorty,shikimori}`) | Код исключительно витрины пагинатора — не засоряет ни `src/lib/`, ни `src/server/`, ни `src/content/`. |
| `server/{db-list,live-cache}.ts` + `src/content/posts.ts` | **В общую демо-сущность `posts`** (см. Вопрос 4 Раунда 2) | Используется одновременно стендом `/db-demo`, источником `db` в `/paginator` и `/api/db-posts`. |

### 1.3. Обязательное правило безопасности компилятора SvelteKit (`*.server.ts`)
Вне папки `$lib/server/**` встроенный запрет Vite/SvelteKit на попадание серверного кода и секретов в клиентский JS-бандл работает **только для файлов с суффиксом `*.server.ts`**.
Поэтому фиксируем жёсткий инвариант (плюс автоматическую проверку в `tooling/layer-guard.mjs`):
- каждый серверный файл в `src/server/`, `src/hooks/`, `src/content/` и `src/routes/` (кроме зарезервированных SvelteKit `+page.server.ts`, `+layout.server.ts`, `+server.ts`, `hooks.server.ts`) **обязан оканчиваться на `.server.ts`** (`gateway.server.ts`, `index.server.ts`, `fields.form.server.ts`, `db.server.ts`).

---

## Раунд 2. Детальный чертёж Фундамента (Этап 0) и Пилота №1 (`src/components/fields/` + `/fields`)

Переходим от общей карты к пофайловому инженерному чертежу **Этапа 0 (алиасы и доработка `#hooks/component-form`)** и **Пилота №1 (`/fields` → `src/components/fields/`)**.

---

### 2.1. Целевая карта импортов `package.json` и однонаправленный граф слоёв

В `package.json` оформляются 5 симметричных приватных алиасов Node Subpath Imports (поддерживаются нативно в Node `>=22.17`, Vite, TypeScript и `svelte-check`):

```json
{
  "imports": {
    "#lib/*": "./src/lib/*",
    "#hooks/*": "./src/hooks/*",
    "#components/*": "./src/components/*",
    "#content/*": "./src/content/*",
    "#server/*": "./src/server/*"
  }
}
```

Строгий граф зависимостей сверху вниз (`0` циклов, проверяется в `tooling/layer-guard.mjs`):

```text
routes/*  ──▶  server/*  ──▶  content/*  ──▶  components/*  ──▶  hooks/*  ──▶  lib/*
```
*(При этом серверные части `content/*.server.ts` и `hooks/*.server.ts` могут использовать `#server/*` для доступа к `SECURITY_LAYERS` / `localStore` / `db`, либо получать их через порты; `lib/*` не импортирует ничего выше себя никогда.)*

---

### 2.2. Точная ревизия всех 13 файлов текущего `/fields` (почему там были ручные костыли)

Построчное чтение `src/routes/(site)/(app)/fields/*` и 387 строк `test/browser/fields.mjs` выявило **ровно 3 причины**, почему автор `/fields` раньше не смог использовать единый механизм форм и написал дублирующие `/fields/save/+server.ts`, `/fields/record/+server.ts` и `actions` в `+page.server.ts`:

1. **Динамическое описание формы от запроса и сохранённых данных (`description(event)` и `source`):**
   - `fields-builder` строит `collectionForm(undefined, limit)`, где `limit` читается из `event.url.searchParams.get('limit')`.
   - `fields-record` передаёт в `createFormHandler` динамический `source: { resolve: () => recordForm(savedSet(), savedRecord()), revision: () => savedSet()?.version ?? 1 }`.
   - В текущем `ComponentFormRegistration` (`src/hooks/component-form/types.ts`) поле `description` принимает только статический объект, а `source` не проброшен вообще!
2. **Несохраняющие намерения конструктора (`+ поле` / `Удалить`) без JavaScript (`result.outcome === 'not-applied'`):**
   - Когда JS выключен, кнопки `+ поле` и `Удалить` отправляют нативный `POST`; ядро `#lib/form` добавляет/удаляет строку черновика и возвращает `result.ok === true && result.outcome === 'not-applied'`.
   - Сейчас `componentFormsHandle` на любой `result.ok` по умолчанию делает `303 See Other`, что стерло бы несохранённый черновик строк!
   - **Глобальное решение в `#hooks/component-form/index.server.ts`:** если `result.outcome === 'not-applied'`, `componentFormsHandle` **всегда автоматически рендерит ответ inline (`200`, `locals.formResult = result`)** без `303`-редиректа. Тогда `field.fields(...)` работает с JS (`0` POST-запросов) и без JS (с сохранением всех введённых строк) **автоматически на любой странице и в любой модалке вообще без ручного кода!**
3. **Ручной `$effect` с отслеживанием `form.state.status` и замок навигации в компонентах:**
   - В `CollectionForm.svelte` и `RecordForm.svelte` продублирован один и тот же `$effect` для перехода на следующий шаг (`if (now === 'success' && form.state.outcome !== 'not-applied') void goto(nextHref)`) и дублирующая запись `fieldsNavLocked` в `writeAddress`.
   - Добавление штатного колбэка `onSuccess?: (result: Result) => void | Promise<void>` прямо в `bindComponentForm` (вызывается **только** на реальное применение формы, игнорируя `outcome === 'not-applied'`) полностью убирает хрупкие `$effect` на сравнении статусов.

#### Авторегистрация серверных форм `*.form.server.ts` (нулевая связность с `src/hooks.server.ts`)
Сейчас `src/hooks.server.ts` вручную импортирует каждую форму:
```ts
import '#content/user/ui/seed-form/server.js'
import '#content/user/ui/profile-form/server.js'
```
Вместо ручного списка в `src/hooks.server.ts`, внутри `src/hooks/component-form/index.server.ts` ставится одна статическая строка времени сборки Vite:
```ts
import.meta.glob(['/src/content/**/*.form.server.ts', '/src/routes/**/*.form.server.ts'], { eager: true })
```
- Vite на этапе сборки компилирует её в обычные статические ES-`import` (работает идентично в Node, Vercel, Cloudflare Workers, `vite dev`, `vite preview` и Vitest, `0` чтения ФС в рантайме);
- суффикс `.form.server.ts` одновременно включает встроенную защиту SvelteKit от случайного импорта на клиент;
- создание или удаление любого модуля в `src/content/*` или роута в `src/routes/*` **не требует ни одной правки `src/hooks.server.ts`**.

---

### 2.3. Архитектура папочного модуля `src/components/fields/` (`#components/fields`)

Модуль закрывает **весь жизненный цикл динамических наборов полей** (`сборка схемы → ввод записи по схеме → отображение значений записи`) и строго следует утверждённому двухуровневому стандарту кастомизации:

```text
src/components/fields/
├── index.ts                    # Публичный API: FieldSetBuilder, RecordFieldsForm, ui/*, variants, types
├── types.ts                    # Типы пропов, слотовых classes и переопределяемых подписей labels
├── variants.ts                 # CVA-варианты карточек/строк (`card` | `plain`, размеры) через variants() + cn()
├── FieldSetBuilder.svelte      # Уровень 1 (сборщик «под ключ»): готовая самодостаточная форма конструктора набора полей
├── RecordFieldsForm.svelte     # Уровень 1 (сборщик «под ключ»): готовая форма ввода/правки записи по сохранённому набору
└── ui/
    ├── index.ts
    ├── SchemaBuilder.svelte    # Уровень 2: встраиваемый редактор поля `field.fields(...)` внутри произвольной <Form>
    ├── BuilderRow.svelte       # Уровень 2: карточка одного поля в конструкторе (Поле N, Удалить, label/kind, rules, args)
    ├── SchemaFields.svelte     # Уровень 2: рендер динамических полей `form.from()` внутри произвольной <Form>
    └── SchemaValues.svelte     # Уровень 2: список «подпись → значение» по `FieldSetItem[]` (скрывает удалённые ключи)
```

#### Контракты обоих уровней:
1. **`<FieldSetBuilder />` (готовый сборщик шага «Сборка»):**
   - Принимает `description` (или уже созданный `form`), имя поля набора (`name = 'props'`), `action`, `onSuccess`, `submitLabel = 'Сохранить'`, `errorTitle`, `labels`, `variant = 'card'`, `class`, `classes?: { root, header, row, rowHeader, fieldsGrid, argsGrid, addButton, footer }` и опциональные сниппеты `before` / `after`.
   - Сам поднимает `bindComponentForm`, `<Form>`, скрытый submit-первенец для клавиши `Enter` без срабатывания `Удалить`, `<Common>`, `<SchemaBuilder>` и `<Button type="submit" task={formTask(form.state)}>`.
2. **`<RecordFieldsForm />` (готовый сборщик шага «Заполнение»):**
   - Принимает `description` (построенный через `defineForm({ from, fields })`), `action`, `onSuccess`, `submitLabel = 'Отправить'`, `errorTitle`, `variant = 'card'`, `class`, `classes?: { root, dynamicList, dynamicItem, footer }` и сниппеты `beforeFields(form)` / `afterFields(form)` для дополнительных статических полей записи (`title`, `image` с превью прошлого фото).
3. **`ui/{SchemaBuilder, BuilderRow, SchemaFields, SchemaValues}`:**
   - Доступны напрямую для экранов, где на одной гигантской кастомной `<Form>` живёт сразу несколько секций или особая вёрстка; каждый принимает `variant` и `class` через `cn(...)`.

---

### 2.4. Что остаётся в папке маршрута `src/routes/(site)/(app)/fields/` (до и после)

- **Удаляются полностью:**
  - `src/routes/(site)/(app)/fields/save/+server.ts` (дублирующий JSON-эндпоинт);
  - `src/routes/(site)/(app)/fields/record/+server.ts` (дублирующий JSON-эндпоинт);
  - `SchemaBuilder.svelte`, `SchemaFields.svelte`, `CollectionForm.svelte`, `RecordForm.svelte`, `RecordView.svelte` (заменены переиспользуемым модулем `#components/fields`);
  - весь блок `export const actions` и `act()` из `+page.server.ts`.
- **Остаются в `src/routes/(site)/(app)/fields/` ровно 5 тонких файлов конкретного демо-стенда:**
  1. `schema.ts` — локальная схема демо (`FIELD_LIMITS`, `collectionForm`, `recordForm` с `title` + `image`, `resetForm`, `demoPanelSchema`, `stepOf`);
  2. `fields.form.server.ts` — серверная регистрация `fields-builder`, `fields-record` и `fields-reset` в `registerComponentForm` поверх `localStore.scope('fields-demo')`;
  3. `ResetAction.svelte` — компактная кнопка-ссылка сброса демо через `bindComponentForm`;
  4. `+page.server.ts` (~15 строк) — **только `load`**, возвращающий `{ set, record, step, limit }`;
  5. `+page.svelte` (~95 строк) — чистая декларативная композиция `<DemoPanel>`, `<Steps>`, `<FieldSetBuilder>`, `<RecordFieldsForm>` и `<SchemaValues>` с полным сохранением всех 30+ проверок `test/browser/fields.mjs` (как с JS, так и с `javaScriptEnabled: false`).

---

## Открытые вопросы к владельцу по итогам Раунда 2

1. **Карта корневых папок и 5 алиасов `package.json` (`#lib/*`, `#hooks/*`, `#components/*`, `#content/*`, `#server/*`):**
   Согласуем ли пофайловую раскладку из таблицы `1.2` (где адаптеры `svelte/` и `sveltekit/` остаются внутри своих библиотек `src/lib/<pkg>/`, `src/lib/hooks/` и `src/lib/components/` ликвидируются в пользу единых `src/hooks/` и `src/components/`, а синглтоны сайта переезжают в `src/server/*.server.ts`)?
2. **Авторегистрация `*.form.server.ts` на этапе сборки в `#hooks/component-form`:**
   Утверждаем ли автоматический подхват всех `*.form.server.ts` из `src/content/**` и `src/routes/**` через статический `import.meta.glob(..., { eager: true })` (плюс авто-inline для `outcome === 'not-applied'`), чтобы встраиваемые формы работали на любом URL без правок `src/hooks.server.ts` и без `+page.server.ts` `actions`?
3. **Состав Пилота №1 (`src/components/fields/` + тонкий `/fields`):**
   Устраивает ли предложенный состав `src/components/fields/` (`FieldSetBuilder`, `RecordFieldsForm` + `ui/{SchemaBuilder, BuilderRow, SchemaFields, SchemaValues}`) и сокращение роута `/fields` до 5 файлов локальной демо-схемы?
4. **Развязка общего демо-ресурса БД `posts` перед Раундом 3 (`/paginator`):**
   Проверка кода показала, что таблица `demo_post` (`posts.ts` + `db-list.ts` + `live-cache.ts` + `DbPostRow.svelte`) используется одновременно **и** на стенде `/db-demo`, **и** как 8-й вариант источника (`db`) внутри `/paginator` (из-за чего сейчас `lib/server/db-list.ts` импортирует `routes/.../db-demo/definition`, а `paginator` импортирует `../db-demo/*`). Как чище поступить:
   - **Вариант А:** оформить `src/content/posts/` как аккуратную общую демо-сущность БД (по аналогии с `src/content/user/`: со своей `schema.ts`, `list.server.ts`, `live-cache.server.ts` и `ui/PostRow.svelte`), чтобы и `/db-demo`, и `/paginator` импортировали `#content/posts` сверху вниз без единой обратной или кросс-роутовой связи;
   - **Вариант Б:** оставить `demo_post` строго внутри стенда `/db-demo` (и `/api/db-posts`), а в `/paginator` оставить только его собственные каталожные источники (`products`, `photos`, `Shikimori`, `Rick & Morty`), чтобы `src/content/` содержал исключительно реальные сущности сайта (`user`)?
