# Аудит модульной архитектуры, библиотек, самодостаточных компонентов и реестра маршрутов `address`

Исследование текущего дерева файлов `modals-kit`, границ переносимых библиотек `src/lib/`, папочных UI-модулей `src/components/`, самодостаточности встраиваемых форм `#hooks/component-form` и единого типизированного реестра маршрутов с GET-параметрами в `#lib/address`.

> **Статус:** финальный раунд архитектурного согласования (**Раунды 1 и 2 полностью утверждены**, **Раунд 3 и сводный 6-этапный план миграции готовы к финальной отмашке**; код в `src/` пока не изменялся).

---

## Сводка всех утверждённых решений владельца (Раунды 1 + 2)

1. **Никакой папки `src/modules/` — 5 чистых алиасов в `package.json` (`#lib/*`, `#hooks/*`, `#components/*`, `#content/*`, `#server/*`):**
   - **`src/lib/<pkg>/`** — автономные переносимые библиотеки («свой `node_modules`») **вместе со своими фреймворковыми адаптерами** (`svelte/`, `sveltekit/`, `cores/sveltekit.ts`, `node.ts`), чтобы при переносе любая папка `src/lib/<pkg>/` копировалась целиком, а чистый вход `./index.ts` в Node не требовал установки фреймворков (`tooling/core-purity.mjs`).
   - **`src/hooks/`** — единая папка межбиблиотечных переходников и общепроектных реактивных/серверных связок (`cache-db.ts`, `db-form.ts`, `graphql.ts`, `task-stream.server.ts`, `component-form/`, `links/`, `js-only.svelte.ts`, `use-drawer.svelte.ts`, `app-errors.svelte.ts`); дублирующая `src/lib/hooks/` удаляется.
   - **`src/components/<name>/`** — самодостаточные папочные UI-модули кита без собственной бизнес-модели (`utils.ts`, `ui/`, `settings/`, `demo/`, `form/`, **`fields/`**, **`paginator/`**, `modals/`, `steps/`, `loader/`, `shell/`); дублирующая `src/lib/components/` удаляется.
   - **`src/content/<entity>/`** — **исключительно реальные прикладные сущности сайта** (`src/content/user/`); никаких демо-данных в `src/content/`.
   - **`src/server/`** — инстансы и bootstrap конкретного сайта (`db.server.ts`, `cache.server.ts`, `fetch.server.ts`, `form-security.server.ts`, `after-response.server.ts`, `trusted-origins.ts`); все серверные файлы вне `$lib/server` строго оканчиваются на `*.server.ts`.
   - **`src/routes/`** — тонкие маршруты-потребители со своими локальными схемами экранов + лабораторные стенды ядер (`/form`, `/steps`, `/db-demo`, `/modals`).
2. **Двухуровневый стандарт кастомизации всех папочных модулей в `src/components/<name>/`:**
   - **Уровень 1 (сборщик «под ключ»):** `<Name ... variant="..." class="..." classes={{ ... }} />` на базе `variants(...)` + `cn(...)`.
   - **Уровень 2 (составные кирпичи):** экспорт вложенных компонентов из `ui/` (каждый со своим `variant` и `class` через `cn(...)`) для нестандартной геометрии экрана.
3. **Единый самодостаточный контур форм `#hooks/component-form` (утверждено в Раунде 2):**
   - поддержка динамического `description(event)` и `source` в `ComponentFormRegistration`;
   - автоматический inline-рендер (`200`, `locals.formResult`) при `result.outcome === 'not-applied'` (конструкторы `field.fields` работают с JS и без JS на любом маршруте без ручного кода);
   - колбэк `onSuccess` в `bindComponentForm`;
   - автоматический сбор всех `*.form.server.ts` из `src/content/**` и `src/routes/**` на этапе сборки через `import.meta.glob(..., { eager: true })` без ручного списка в `src/hooks.server.ts`.
4. **Пилот №1 (`src/components/fields/` + `/fields`) утверждён:**
   - `FieldSetBuilder`, `RecordFieldsForm` + `ui/{SchemaBuilder, BuilderRow, SchemaFields, SchemaValues}` в `src/components/fields/`; роут `/fields` сокращается до 5 файлов локальной демо-схемы.
5. **Размещение демо-БД `posts` (решение по вопросу №4 Раунда 2):**
   - `posts.ts`, `db-list` и `live-cache` не выносятся в `src/content/`, а уходят прямо в папку стенда **`src/routes/(site)/(app)/db-demo/`** (`posts.ts`, `list.server.ts`, `live-cache.server.ts`);
   - демо `/paginator` для своего 8-го источника (`db`) **в качестве явного задокументированного исключения между двумя демками** импортирует `../db-demo/*` (закрепляется узким allow-правилом в `tooling/layer-guard.mjs`).

---

## Раунд 2 (утверждённая база). Пофайловая таблица очистки `src/lib/` и чертёж `src/components/fields/`

### 2.1. Полная пофайловая раскладка `src/lib/`

| Текущий путь в `src/lib/` | Целевое место | Обоснование |
|---|---|---|
| `address/`, `cache/`, `db/`, `fetch/`, `form/`, `image/`, `modals/`, `paginate/`, `task/` **(включая их `svelte/`, `sveltekit/`, `cores/`, `node.ts`)** | **Остаются в `src/lib/<pkg>/`** | Переносимые пакеты целиком: чистое ядро `./index.ts` + собственные фреймворковые адаптеры рядом. |
| `server/schema-admin.ts` | **`src/lib/db/sync/admin.ts`** | `0` импортов `$app/*` и сайта — штатная часть `lib/db` (`README.md §6`). |
| `hooks/js-only.svelte.ts`, `hooks/use-drawer.svelte.ts` | **`src/hooks/`** | Единая папка прикладных хуков. |
| `components/links/*` (`0` `.svelte`-файлов) | **`src/hooks/links/`** | Межбиблиотечная связка `#lib/address` × `#lib/modals` × лоадер переходов. |
| `app-errors.svelte.ts` | **`src/hooks/app-errors.svelte.ts`** | Общепроектный реактивный приёмник `onError` всех библиотек. |
| `server/graphql.ts` | **`src/hooks/graphql.ts`** | Чистая связка `#lib/fetch` × `#lib/cache`; инстанс создаётся в `src/server/fetch.server.ts`. |
| `server/task-stream.ts` | **`src/hooks/task-stream.server.ts`** | Связка `#lib/task` × `#lib/fetch` × `AsyncLocalStorage`. |
| `utils.ts` (`cn`, `variants`) | **`src/components/utils.ts`** | Общая утилита CVA-вариантов и `twMerge` (исправляется и `DemoPanel.svelte:229` на `cn(...)`). |
| `components/{ui,settings,demo,form,modals,steps,loader,shell,header,sidebar}/*`, `ErrorPage.svelte`, `Error500.svelte` | **`src/components/*`** | `filters/` входит в `paginator/`, `header/`+`sidebar/` — в `shell/`, а `nav.ts` демо-меню уходит в `src/routes/(site)/`. |
| `server/{db,cache,fetch,form-security,after-response}.ts`, `server/trusted-origins.ts`, `server/api-error.ts`, `api-error.ts` | **`src/server/*`** (`*.server.ts`) | Bootstrap и синглтоны конкретного сайта. |
| `server/{rickmorty,shikimori*}.ts` + `src/content/{items,rickmorty*,shikimori*}.ts` | **`src/routes/(site)/(app)/paginator/sources/`** | Код исключительно витрины пагинатора (с обновлением зон в `tooling/source-schema-guard.mjs`). |
| `server/{db-list,live-cache}.ts` + `src/content/posts.ts` | **`src/routes/(site)/(app)/db-demo/`** | Код стенда БД (`posts.ts`, `list.server.ts`, `live-cache.server.ts`); `/paginator` тянется к `../db-demo/*` как явное исключение демо. |

### 2.2. Утверждённый состав `src/components/fields/`
- `FieldSetBuilder.svelte` — готовая форма конструктора `field.fields(...)` «под ключ» (`variant`, `class`, `classes`, `labels`, `onSuccess`);
- `RecordFieldsForm.svelte` — готовая форма ввода/правки записи по сохранённому набору (`defineForm({ from })` + сниппеты `beforeFields`/`afterFields`);
- `ui/{SchemaBuilder, BuilderRow, SchemaFields, SchemaValues}.svelte` — составные блоки для кастомных форм и карточек просмотра;
- `variants.ts`, `types.ts`, `index.ts`.

---

## Раунд 3. Детальный чертёж Модуля №2 (`src/components/paginator/`), Реестра маршрутов `#lib/address` и Сводный план миграции

---

### 3.1. Ревизия `/paginator` (642 строки `CatalogDemo` + 124 строки `GalleryDemo`) и чертёж `src/components/paginator/`

#### Что выявило построчное чтение кода `/paginator`
1. **Забытый в роуте универсальный компонент поиска (`SearchBar.svelte`, 80 строк):**
   - `src/routes/(site)/(app)/paginator/SearchBar.svelte` не содержит ни одной строчки демо-логики: это чистая GET-форма поиска на `usePaginatorSearch` + `<SearchInput>` с крестиком очистки (JS) и кнопками `Найти`/`Сбросить` (без JS). Хардкодились только константы `LABEL` и `PLACEHOLDER`. Его законное место — **`src/components/paginator/ui/SearchBar.svelte`**.
2. **Ручная сборка из 13 внутренних деталей в каждом потребителе:**
   - Сейчас и `CatalogDemo.svelte` (строки `532–642`), и `GalleryDemo.svelte` (строки `92–123`), и `/db-demo` вынуждены вручную импортировать и расставлять в строго фиксированном порядке **13 служебных узлов**:
     `PaginatorHost` (+ `onError={report}`) → `LoadingIndicator` → `EdgeSentinel(-1)` → `LoadMoreLink(-1)` → `EmptyState` → `PageList | PageColumns` → `LiveStatus` → `ErrorRow` → `ReplaceLoadingRow` → `LoadMoreLink(+1)` → `EdgeSentinel(+1)` → `EndRow` → `PageNav`.
   - Забыл один сентинел или перепутал порядок — сломал infinite scroll, compensations при `prepend` или показ ошибок.
3. **Беспризорный `src/lib/components/filters/`:**
   - `FiltersPanel`, `ActiveFilters`, `FilterActions` и `filter-form.svelte.ts` жестко работают с `extra`-ключами пагинатора (`#lib/paginate/filters`) и являются штатной подсистемой `src/components/paginator/`.

#### Целевое устройство `src/components/paginator/` (`#components/paginator`)

```text
src/components/paginator/
├── index.ts                      # Экспорт Paginator + реэкспорт ui/*, model/*, variants, types
├── types.ts                      # Пропы Paginator, SettingsField, слоты classes
├── variants.ts                   # CVA-варианты контейнера хоста, тулбара и карточек (`card` | `plain`) через cn()
├── Paginator.svelte              # Уровень 1: готовый самодостаточный компонент-сборщик пагинатора «под ключ»
├── model/
│   ├── compile.ts                # Компиляция схемы настроек пагинатора (+ compile.test.ts)
│   ├── search.svelte.ts          # usePaginatorSearch
│   ├── action-task.svelte.ts     # Индикация задач действий
│   ├── filter-form.svelte.ts     # Логика формы фильтров каталога
│   └── event-log.ts              # Лог событий ядра
└── ui/
    ├── index.ts                  # Уровень 2: полный набор кастомизируемых составных частей (все с class через cn)
    ├── SearchBar.svelte          # Поле поиска с GET-фолбэком без JS (перенесено из роута, пропы label/placeholder/class)
    ├── FiltersPanel.svelte       # Панель фильтров по CatalogFilterSchema
    ├── ActiveFilters.svelte      # Чипы активных фильтров
    ├── FilterActions.svelte      # Действия фильтров
    ├── PaginatorSettings.svelte  # Панель настроек пагинатора и размера страницы
    ├── PageList.svelte           # Линейный список страниц с разделителями и скелетонами
    ├── PageColumns.svelte        # Адаптивные колонки round-robin (auto / 2 / 3 / 4)
    ├── PageNav.svelte            # Постраничная/стрелочная навигация
    ├── EmptyState.svelte
    ├── ErrorRow.svelte
    ├── EndRow.svelte
    ├── LiveStatus.svelte
    ├── LoadingIndicator.svelte
    ├── LoadMoreLink.svelte
    ├── ReplaceLoadingRow.svelte
    ├── ResetButton.svelte
    ├── PageDivider.svelte
    ├── PageLink.svelte
    ├── Skeleton.svelte
    ├── Spinner.svelte
    ├── StatusRow.svelte
    └── EventLog.svelte
```

#### Как работают оба уровня в реальных экранах:
- **Обычный экран (и `GalleryDemo.svelte`):** один тег `<Paginator />` со встроенным скролл-хостом, индикатором, сентинелами краёв, пустым состоянием, списком/колонками, live-статусом, строкой ошибок и навигацией:
  ```svelte
  <Paginator
    {name}
    {snapshot}
    layout="columns"
    columns={cfg.cols}
    columnWidth={160}
    stretch="25%"
    mode="single"
    topTrigger="off"
    bottomTrigger="off"
    nav={false}
    variant="card"
    class="h-[360px]"
    {renderItem}
    {renderSkeleton}
  />
  ```
  При этом внешняя `<PageNav {name} />` в шапке секции и `<PaginatorSettings {name} />` в боковой колонке `GalleryDemo` берутся из `#components/paginator` (`ui/`) — двухуровневый стандарт покрывает **и** `GalleryDemo`, **и** `CatalogDemo` без единого дубля сентинелов!
- **Папка роута `src/routes/(site)/(app)/paginator/`:**
  - `sources/items.ts` (+ `items.test.ts`), `sources/rickmorty.ts`, `sources/rickmorty-filters.ts`, `sources/rickmorty.server.ts` (+ `.test.ts`), `sources/shikimori.ts`, `sources/shikimori-filters.ts`, `sources/shikimori.server.ts`, `sources/shikimori-schema.server.ts`, `sources/shikimori-filters.server.ts` (+ `.test.ts`);
  - карточки и фильтры демо (`AnimeRow`, `AnimeTile`, `CharacterRow`, `CharacterTile`, `ItemRow`, `ShotTile`, `ShikimoriFilters`, `RickMortyFilters`, `item-views.ts`);
  - `definition.ts`, `CatalogDemo.svelte`, `GalleryDemo.svelte`, `+page.server.ts`, `+page.svelte`.
  - В `tooling/source-schema-guard.mjs` обновляются 5 констант путей (`UPSTREAM_ZONES`, `KEY_ZONES`, `SCHEMA_ZONE`, `PIPELINE_ZONE`, `SCHEMA_READERS`) с сохранением всех 13 проверок стража.

---

### 3.2. Единый реестр маршрутов в `#lib/address/routes.ts` и нулевая связность с `#lib/modals`

#### Важная находка в коде `#lib/modals/types.ts:199`
В `#lib/modals` поле `ModalDefinition.route` **уже имеет штатный тип**:
```ts
route?: string | ((params: P) => string)
```
Это даёт идеальную архитектуру **с нулевой связностью между библиотеками в `src/lib/`**:
- `#lib/modals` **не импортирует** `#lib/address`;
- `#lib/address` **не импортирует** `#lib/modals`;
- дескриптор маршрута из `#lib/address/routes.ts` имеет метод `route.href: (params?: P) => string`, который передаётся напрямую в `registerModal({ route: userAuthRoute.href })`!

#### Контракт `#lib/address/routes.ts` (`0` зависимостей от фреймворков, 100% изоморфный SSR + клиент):

```ts
// 1. Ядро в src/lib/address/routes.ts:
// Кодеки GET-параметров с дефолтами, валидацией и защитой от Open Redirect:
export const queryString = (opts?: { default?: string; maxLength?: number }) => ...
export const queryNumber = (opts?: { default?: number; min?: number; max?: number; integer?: boolean }) => ...
export const queryBoolean = (opts?: { default?: boolean }) => ...
export const queryEnum = <const T extends readonly string[]>(values: T, opts?: { default?: T[number] }) => ...
export const queryLocalPath = () => ... // встроенный localPath() — режет //evil.com и схемы!

// 2. Объявление маршрутов в прикладном модуле src/content/user/routes.ts:
export const userAuthRoute = registerRoute({
  name: 'user.auth',
  path: '/user/auth',
  search: {
    stage: queryEnum(['entry', 'register', 'restore', 'profile', 'blocked', 'restrictions'], { default: 'entry' }),
    next: queryLocalPath(),
  },
})

export const userMenuRoute = registerRoute({
  name: 'user.menu',
  path: '/user/menu',
})

// 3. Связка с модалкой в src/content/user/modals.ts (бывший src/routes/(site)/auth-modals.ts):
registerModal({
  name: 'user.auth',
  component: AuthModalLazy,
  route: userAuthRoute.href, // <-- чистая функция (params) => string! 0 дублирования href!
  size: { width: 420, height: 480 },
})
```

#### Что даёт `RouteDescriptor` на сервере и клиенте:
1. **`route.href(params?)`** — полная сборка чистого URL (`path` с подстановкой `:param` + отфильтрованный `?search`, где значения, равные `default`, автоматически опущены, а `next` очищен через `localPath`):
   - `userAuthRoute.href()` → `'/user/auth'`
   - `userAuthRoute.href({ stage: 'profile' })` → `'/user/auth?stage=profile'`
   - `asModalLink('user.auth', { stage: 'profile' })` **автоматически** получает fallback `href="/user/auth?stage=profile"` — ручной третий аргумент `{ href: '/user/auth?stage=profile' }` в `MenuBody.svelte` и `Acl.svelte` уходит навсегда!
2. **`route.parse(url)`** — типизированный deny-safe разбор `event.url` на сервере и `visibleAddress().url` на клиенте (возвращает уже типизированный `{ stage, next }` с применёнными дефолтами).
3. **`route.patch(currentUrl, patch)`** — обновляет только ключи схемы маршрута на текущем адресе, **не затирая соседние GET-параметры** (например, `?limit=4` на `/fields` или `?page=2` на странице — уходит ручной `limitTail(event.url)`!).
4. **Автоматический страж синхронности с файловым роутингом (`tooling/`):**
   - на этапе `npm run test:guard` все зарегистрированные в реестре пути проверяются через `makeRouteResolves` по реальным файлам `src/routes/**/+page.svelte` — переименовал или удалил папку роута, забыв обновить `routes.ts`, и сборка мгновенно укажет точную строку!

#### Доводка полной самодостаточности `src/content/user/`
- Перенос `src/routes/(site)/auth-modals.ts` внутрь модуля `src/content/user/modals.ts` + объявление `src/content/user/routes.ts` (больше ни одного хардкодного `'/user/auth'` в 8 файлах!).
- Переименование серверных файлов модуля в `*.server.ts` (`gateway.server.ts`, `ui/seed-form/seed.form.server.ts`, `ui/profile-form/profile.form.server.ts`).
- Опциональные дефолты пропов из конфига модуля (`limits = DEFAULT_PROFILE_LIMITS` в `ProfileForm.svelte`, самодостаточные дефолты в `AuthWidget.svelte`), чтобы `<ProfileForm />` и `<AuthWidget />` монтировались в любом месте одной строкой без подготовки `+page.server.ts`.

---

## 4. Сводный поэтапный план реализации (6 атомарных коммитов)

Каждый этап завершается полным набором проверок (`npm run test:guard`, `npm run check`, `npx vitest run`, `npm run build && node tooling/size-budget.mjs`, профильные `test/browser/*.mjs`), отдельным локальным коммитом и отправкой в `origin/img`.

| Этап | Содержание коммита | Главные проверки этапа |
|---|---|---|
| **Этап 1. Фундамент слоёв и очистка `src/lib/`** | Добавление `#components/*` и `#server/*` в `package.json`; перенос `src/lib/components/*` → `src/components/*` (`utils.ts`, фикс `cn` в `DemoPanel`, `header`+`sidebar` → `shell/`, `nav.ts` → `routes/(site)/`), `src/lib/hooks/*` + `links/` + `graphql` + `task-stream.server.ts` + `app-errors.svelte.ts` → `src/hooks/*`, `schema-admin` → `src/lib/db/sync/admin.ts`, синглтонов `src/lib/server/*` → `src/server/*.server.ts`; обновление правил и запрет обратных импортов / не-`*.server.ts` в `tooling/layer-guard.mjs`. | `test:guard`, `check`, `vitest`, `build + size-budget`, `shell.mjs`, `modals.mjs` |
| **Этап 2. `#hooks/component-form` v2 + Пилот №1 `src/components/fields/`** | Доработка `#hooks/component-form` (`description(event)`, `source`, авто-inline при `outcome === 'not-applied'`, `onSuccess`, автосбор `*.form.server.ts` через `import.meta.glob`); создание папочного модуля `src/components/fields/` (`FieldSetBuilder`, `RecordFieldsForm`, `ui/*`); перевод `/fields` на 5 тонких файлов и удаление `/fields/save/+server.ts`, `/fields/record/+server.ts` и `actions`. | `test:guard`, `check`, `vitest`, `build + size-budget`, `fields.mjs`, `attachment.mjs` |
| **Этап 3. Модуль №2 `src/components/paginator/` + изоляция демо-данных** | Сборка `src/components/paginator/` (`Paginator.svelte` + `ui/SearchBar.svelte` + `ui/FiltersPanel.svelte` + все `ui/*` с `cn`/`variants`); перевод `GalleryDemo` и `CatalogDemo` на `<Paginator />`; перенос `items` / `rickmorty*` / `shikimori*` в `routes/.../paginator/sources/`, а `posts` + `db-list` + `live-cache` — в `routes/.../db-demo/` (с явным allow-исключением `paginator → db-demo` в `layer-guard.mjs` и обновлением `source-schema-guard.mjs`). | `test:guard`, `check`, `vitest`, `build + size-budget`, `paginate.mjs`, `shikimori.mjs`, `db-demo.mjs` |
| **Этап 4. Унификация форм стендов ядер** | Перевод форм стендов (`/db-demo`, `/form`, `/steps`) на `*.form.server.ts` и удаление дублирующих `submit/+server.ts` там, где они дублировали конвейер формы. | `test:guard`, `check`, `vitest`, `build + size-budget`, `forms.mjs`, `forms-a11y.mjs`, `steps.mjs`, `db-demo.mjs` |
| **Этап 5. Реестр маршрутов `#lib/address/routes.ts` + доводка `src/content/user/`** | Реализация `#lib/address/routes.ts` (`href`, `parse`, `patch`, кодеки с `queryLocalPath`) + страж сверки с `src/routes/**/+page.svelte`; оформление `src/content/user/{routes,modals}.ts`, `*.server.ts`, дефолтных `limits` в `ProfileForm`/`AuthWidget` и перевод ссылок проекта на `address`. | `test:guard`, `check`, `vitest`, `build + size-budget`, `auth.mjs`, `modals.mjs` |
| **Этап 6. Финальная приёмка и документация** | Актуализация `AGENTS.md`, `docs/audit/{architecture,README,testing-backlog}.md`, `README.md` подсистем, подтяжка бюджетов `tooling/size-budget.mjs` и сквозной прогон всех браузерных и unit-тестов. | Полный набор гейтов + все `test/browser/*.mjs` |

---

## Финальные контрольные вопросы Раунда 3 (перед стартом реализации)

1. **Модуль №2 `src/components/paginator/`:**
   Согласуем состав и двухуровневый контракт `<Paginator />` (встроенные скролл-хост, сентинелы и строки состояний + перенос `SearchBar.svelte` и `filters/*` внутрь `paginator/ui/`, а демо-источников `items` / `rickmorty*` / `shikimori*` — в `routes/(site)/(app)/paginator/sources/`)?
2. **Реестр маршрутов `#lib/address/routes.ts` × `#lib/modals`:**
   Утверждаем связку без взаимных импортов между библиотеками через штатный контракт `registerModal({ route: userAuthRoute.href })` + перенос `auth-modals.ts` и `routes.ts` внутрь `src/content/user/`?
3. **Старт поэтапной реализации (`Этапы 1 → 6`):**
   Утверждаешь сводный 6-этапный план выше — начинаем реализацию с **Этапа 1** в следующем ходе (с коммитом и отправкой каждого проверенного этапа в `origin/img`)?
