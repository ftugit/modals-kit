# Мастер-план модульной архитектуры `modals-kit` (`A1`–`A5`)

Полная самодостаточная спецификация и чек-лист поэтапного рефакторинга слоёв `src/`, самодостаточных форм `#hooks/component-form`, папочных UI-модулей `src/components/{fields,paginator}/`, изоляции демо-источников `src/content/demo-catalog/` и единого типизированного реестра маршрутов в `#lib/address` (включая все пересекающиеся пункты из [`./ui-consistency.md`](./ui-consistency.md)).

> **Правило ведения документа (ОБЯЗАТЕЛЬНО ПРИ СЖАТИИ ИЛИ СМЕНЕ КОНТЕКСТА):**
> 1. Этот документ написан так, чтобы любой агент мог выполнить любой этап (`A1` → `A5`) **с полного нуля без перечитывания всего проекта**.
> 2. По завершении каждого подпункта и перед каждым stage-коммитом **обязательно переключай чекбоксы `- [ ]` → `- [x]` прямо в этом файле** и включай обновлённый `docs/audit/architecture.md` в тот же коммит этапа.
> 3. Все непересекающиеся задачи внутренней консистентности UI-контролов и форм (`U1`, `U4–U7`, `F1`, `F3–F6`) вынесены в отдельный самодостаточный план с чек-листом: **[`./ui-consistency.md`](./ui-consistency.md)** (`UI-1` → `UI-4`) и выполняются сразу после `A1`–`A5`.

---

## 0. Памятка автономного исполнения с холодного старта (Environment, Gates & Traps)

Если контекст сессии сжат или сброшен — **прочитай этот блок первым**:

### 0.1. Окружение и подготовка песочницы
- Рабочий репозиторий: `/home/user/projects/modals-kit` (ветка `img`, удалённая ветка `origin/img` — **`main` не трогать!**).
- Архив состояния и патчей: `/home/user/agent-state` (`CONTINUATION_CHECKLIST.md`, `patches/`).
- Если `node_modules` после рестарта контейнера пуст:
  ```bash
  export PATH="/usr/local/bin:$PATH"
  bash /home/user/agent-state/setup-env.sh
  bash /home/user/agent-state/ensure-playwright.sh
  ```
- **OOM-ловушка `/tmp` (`CRITICAL`):** `/tmp` смонтирован как `tmpfs` в RAM (2 GiB без swap). Браузеры Playwright обязаны лежать на диске:
  ```bash
  export PLAYWRIGHT_BROWSERS_PATH="/var/cache/pw-browsers"
  ```
- **Обязательные env-переменные сборки и preview (`CRITICAL`):** SvelteKit инлайнит `$env/static/private` (`AUTH_SEAL_SECRET`, ≥ 32 символов) **во время `npm run build`**! Без него `<Acl enabled={false} />` отключает авторизацию, и `test/browser/auth.mjs` падает на шаге 1. Никогда не коммить секреты в `.env` — всегда передавай в команду:
  ```bash
  AUTH_SEAL_SECRET="0123456789abcdef0123456789abcdef" \
  KIT_TRUSTED_ORIGINS="http://127.0.0.1:5173" \
  npm run build
  ```
- **Остановка фоновых серверов:** никогда не вызывай `pkill -f "<pattern>"` внутри `bash -c` (убьёт саму shell-сессию с `exit 143`). Смотри точный PID через `ss -tulpn` и вызывай `kill <PID>`.
- **Пуш в GitHub без утечки токена:** токен лежит в `/home/user/uploads/github-token-modals-kit.txt` (никогда не выводить его в stdout и не прописывать в `.git/config`):
  ```bash
  TOKEN=$(cat /home/user/uploads/github-token-modals-kit.txt | tr -d '[:space:]')
  git -c http.extraheader="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" push origin img
  ```

### 0.2. Обязательные проверочные гейты каждого этапа
```bash
# 1. Архитектурные стражи (126+ проверок: layer-guard, core-purity, db-docs, form-size, ark-owns, load-url, source-schema)
npm run test:guard

# 2. Аудит UnoCSS-классов и отсутствия классов-маркеров
npm run test:classes

# 3. Генерация типов маршрутов SvelteKit + строгий svelte-check (0 errors, 0 warnings)
AUTH_SEAL_SECRET="0123456789abcdef0123456789abcdef" KIT_TRUSTED_ORIGINS="http://127.0.0.1:5173" npm run check

# 4. Unit/интеграционные тесты Vitest
npx vitest run

# 5. Production-сборка + проверка бюджетов веса всех чанков и маршрутов
AUTH_SEAL_SECRET="0123456789abcdef0123456789abcdef" KIT_TRUSTED_ORIGINS="http://127.0.0.1:5173" npm run build
node tooling/size-budget.mjs
```
- **Браузерные E2E (`test/browser/*.mjs`):**
  - `auth.mjs`, `modals.mjs`, `shell.mjs`, `forms.mjs`, `forms-a11y.mjs`, `fields.mjs`, `steps.mjs`, `paginate.mjs`, `shikimori.mjs`, `db-demo.mjs` — гоняются против запущенного `AUTH_SEAL_SECRET="0123456789abcdef0123456789abcdef" KIT_TRUSTED_ORIGINS="http://127.0.0.1:5173" npx vite preview --host 127.0.0.1 --port 5173 --strictPort`.
  - `attachment.mjs` — гоняется против `npx vite dev --host 127.0.0.1 --port 5179 --strictPort` с `ATTACHMENT_BASE="http://127.0.0.1:5179/fields"`.

### 0.3. Жёсткие инварианты репозитория (нарушение роняет гейты!)
1. **Бюджет веса `src/lib/form/` (`tooling/form-size.mjs`):** запас ~`100–450` байт — **в `src/lib/form/**` не добавлять ни байта!** Все прикладные расширения (`onSuccess`, авто-inline `not-applied`, автосбор `*.form.server.ts`) живут в `src/hooks/component-form/`.
2. **Неприкосновенность `src/lib/db/` и страж `tooling/db-docs.mjs`:** код внутри `src/lib/db/**` не менять вовсе; в markdown-доках `src/lib/db/{README.md,PORTING.md,docs/*.md}` страж `db-docs.mjs:341` проверяет `exists()` каждого пути в обратных кавычках `` `src/...` `` — при переносе файлов обновлять эти 14 строк синхронно в том же коммите!
3. **Запрет статического импорта форм в `vault`:** в `src/content/user/vault.ts` и `vault.svelte.ts` **никогда** не импортировать статически `#components/form/*` — только динамический `await import('#components/form/transport.js')` внутри `postRenew`, иначе общий чанк превысит лимит `tooling/size-budget.mjs`!
4. **Чистота `src/server/trusted-origins.ts`:** этот файл импортируется напрямую в `vite.config.ts:7` (в Node до инициализации плагинов SvelteKit) — в нём **запрещены** импорты `$app/*` и `$env/*`!
5. **Приоритет статусов аккаунта в `src/content/user/`:** `guard()` и `renew()` обязаны проверять статус аккаунта (`blocked`, `delete-pending`) **до** `session.revoked`, иначе отзыв сессий при удалении скроет экран восстановления `auth.delete-pending`.

---

## 1. Целевая архитектура верхнего уровня (утверждена владельцем)

### 1.1. Пять subpath-алиасов в `package.json` (`imports`)
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
А также соответствующие `paths` в `tsconfig.json` (если требуются для редактора; `moduleResolution: "bundler"` в TS 5.9 нативно резолвит `package.json#imports`, но проверяем `npm run check`).

### 1.2. Назначение каждой папки в `src/` и строгое направление зависимостей (DAG)

```text
src/
├── lib/                    # Автономные переносимые пакеты («свой node_modules»):
│   ├── address/            #   ядро ./index.ts (0 фреймворков) + свои адаптеры svelte/, sveltekit/, cores/, node.ts
│   ├── cache/              #   Импортируют ТОЛЬКО внутри своего пакета (и допустимых базовых #lib/*).
│   ├── db/                 #   ЗАПРЕЩЕНО импортировать #hooks/*, #components/*, #content/*, #server/*, routes/*.
│   ├── fetch/
│   ├── form/
│   ├── image/
│   ├── modals/
│   ├── paginate/
│   └── task/
│
├── hooks/                  # Единый слой межбиблиотечных переходников и общепроектных реактивных/серверных связок:
│   ├── app-errors.svelte.ts
│   ├── cache-db.ts
│   ├── db-form.ts
│   ├── graphql.ts
│   ├── js-only.svelte.ts
│   ├── task-stream.server.ts
│   ├── use-drawer.svelte.ts
│   ├── links/              #   asLink, indicator.ts, state.svelte.ts, focus.ts
│   └── component-form/     #   реестр, серверный middleware, bindComponentForm, client.ts, extend.ts
│
├── components/             # Самодостаточные папочные UI-модули кита (0 бизнес-сущностей):
│   ├── utils.ts            #   cn(), variants(), VariantProps
│   ├── ErrorPage.svelte
│   ├── Error500.svelte
│   ├── ui/                 #   базовые дизайн-примитивы (Input, Select, Button, Fieldset, Skeleton, CloseIcon...)
│   ├── settings/           #   контролы панелей настроек (Field, Select на NativeSelect, Toggle)
│   ├── demo/               #   универсальная прогрессивная GET/JS-панель настроек DemoPanel
│   ├── form/               #   полевые обёртки Field, FieldShell, Common, transport, photo...
│   ├── fields/             #   [ПИЛОТ №1] SchemaBuilder, SchemaFields, SchemaValues + variants
│   ├── paginator/          #   [МОДУЛЬ №2] Paginator + ui/{SearchBar, FiltersPanel, PageList, PageColumns...}
│   ├── modals/             #   ModalError, Skeleton, CloseAllButton, ForceClose, variants
│   ├── steps/              #   StepFlow, steps.svelte.ts
│   ├── loader/             #   GlobalLoader, loader.svelte.ts
│   └── shell/              #   AppShell, PageHead + ui/{header, sidebar} (без хардкода меню сайта!)
│
├── server/                 # Runtime-инстансы и bootstrap конкретного сайта (*.server.ts):
│   ├── after-response.server.ts
│   ├── api-error.server.ts #   (+ изоморфный кодек api-error.ts при необходимости клиенту)
│   ├── cache.server.ts
│   ├── db.server.ts
│   ├── fetch.server.ts
│   ├── form-security.server.ts
│   ├── live-cache.server.ts
│   ├── schema-admin.server.ts
│   └── trusted-origins.ts  #   БЕЗ $app/* и $env/* (импортируется в vite.config.ts!)
│
├── content/                # Прикладные доменные модули:
│   ├── user/               #   Боевой модуль пользователя (index.ts, routes.ts, modals.ts, *.server.ts, ui/*)
│   └── demo-catalog/       #   ВСЕ демо-источники каталога и демо-БД в одной папке (удаляется одним rm -rf!):
│       ├── items/          #     items.ts (+ items.test.ts), карточки ItemRow/ShotTile
│       ├── posts/          #     posts.ts, list.server.ts, cursor-mode.svelte.ts, ui/DbPostRow.svelte
│       ├── rickmorty/      #     rickmorty.ts, filters.ts, rickmorty.server.ts (+ .test.ts), карточки/фильтры
│       └── shikimori/      #     shikimori.ts, filters.ts, shikimori.server.ts, filters.server.ts, schema.server.ts (+ .test.ts), карточки/фильтры
│
└── routes/                 # Тонкие маршруты-экраны + лабораторные стенды ядер (/form, /steps, /db-demo, /modals)
```

---

## 2. Матрица пересечений с `ui-consistency.md` (что делаем прямо здесь, чтобы не трогать файлы дважды)

| Пункт из `ui-consistency.md` | Где выполняется | Почему именно так |
|---|---|---|
| **`U9`** (`aria-invalid:*` не генерировался в `presetWind4`) + дыра `classes-audit.mjs:168` | **Этап A1** (в этом плане) | Решается **глобально в 1 строку** `aria: { invalid: 'invalid="true"' }` в `unocss.config.ts` + общий импорт темы в `tooling/classes-audit.mjs` + починка фильтра `aria-*:`/`data-*:` на строке `168` (проверено на живом генераторе UnoCSS). Все старые и новые компоненты сразу получают рабочую подсветку без ручной замены на `aria-[invalid=true]:`. |
| **`U2` / `F2`** (мёртвый `const cls` в `form/TextareaField.svelte:9–13`) | **Этап A1** (в этом плане) | Трогаем `components/form/TextareaField.svelte` при переезде в `src/components/form/` — сразу удаляем 5 мёртвых строк. |
| **Мёртвые шорткаты `unocss.config.ts:29–33`** (`nav-pill`, `nav-pill-active`, `skeleton` — `0` использований) | **Этап A1** (в этом плане) | Всё равно правим `unocss.config.ts` в `A1` — сразу убираем мёртвые шорткаты. |
| **`F7`** (`SearchMorph.svelte` мёртв; `NativeSelect` не должен торчать в публичном `ui/index.ts`) | **Этап A1** (в этом плане) | Удаляем мёртвый `SearchMorph.svelte` (144 строки, `0` потребителей) и убираем `NativeSelect` из публичного барреля `ui/index.ts` (**сам файл `ui/native-select/NativeSelect.svelte` сохраняем** — он используется по глубокому пути в `settings/Select.svelte`, что охраняется `layer-guard.mjs`!). |
| **`F8`** (единообразие групп полей на `ui/Fieldset`) | **Этап A2** (в этом плане) | При создании `src/components/fields/` сразу верстаем группы в одном визуальном языке с `ui/Fieldset`. |
| **`U3`** (три разных `Skeleton` в `ui/`, `paginator/`, `modals/`) | **Этап A3** (в этом плане — если согласован канон) | При сборке `src/components/paginator/` переводим `paginator/ui/Skeleton.svelte` и `modals/Skeleton.svelte` в тонкие обёртки над единым `ui/skeleton/Skeleton.svelte`. |
| **`U8`** (`src/components/ui/README.md` — правила вариантов, иконок и глубоких импортов) | **Этап A5** (в этом плане) | Пишется вместе с финальной документацией новой структуры `src/components/`. |
| **`U1`, `U4`, `U5`, `U6`, `U7`, `F1`, `F3`, `F4`, `F5`, `F6`** + тест `resolve.test.ts` | **[`./ui-consistency.md`](./ui-consistency.md)** (`UI-1` → `UI-4`) | Чистая внутренняя доводка примитивов `ui/*` и обёрток `form/*` — выписана в отдельный пошаговый план с чек-листом. |

---

## 3. Точные контракты и код ключевых узлов (для безошибочной реализации без догадок)

### 3.1. `#hooks/component-form` v2 (Этап A2 — `0` байт в `src/lib/form/`!)
1. **Серверная регистрация (`src/hooks/component-form/types.ts` + `server.ts`):**
   - `ComponentFormRegistration<TSpec, TData>`:
     - `description: FormDescription | ((event: RequestEvent) => FormDescription | Promise<FormDescription>)`
     - `source?: DescriptionSource<RequestEvent>`
     - `execute: ...`
     - `idempotency?`, `throttle?`, `order?`, `checks?`
   - В `componentFormsHandle`:
     - если пришёл нативный form-POST (`from === 'action'`) и `result.outcome === 'not-applied'` (добавление/удаление строки в `field.fields(...)` без JS), middleware кладёт `event.locals.formResult = result` и рендерит `resolve(event)` со статусом `200` (без `303` и без `fail(422)`) — конструктор динамических полей работает без единой строчки в `+page.server.ts`!
   - Автоматический реестр в `src/hooks/component-form/registry.server.ts`:
     ```ts
     import.meta.glob(['/src/content/**/*.form.server.ts', '/src/routes/**/*.form.server.ts'], { eager: true })
     ```
     Каждый `*.form.server.ts` вызывает `registerComponentForm(...)` на верхнем уровне — ручной импорт форм в `src/hooks.server.ts` полностью исчезает.
2. **Клиентская привязка (`src/hooks/component-form/bind.svelte.ts`):**
   - Добавляется `onSuccess?: (result: Result<TData>) => void`, реализованный **поверх уже существующего `onResult`** из `#lib/form/svelte/bind.svelte.ts:82` + реакции на свежий `page.form?.result` при `result.ok && result.outcome !== 'not-applied'`.

### 3.2. Модуль №1 `src/components/fields/` (Этап A2 — 3 чистых компонента без обёрток)
- **`SchemaBuilder.svelte`**:
  - пропы: `{ form, name = 'props', variant = 'default', class: className, classes, labels }`
  - **ВАЖНО:** первой строкой внутри корневого контейнера стоит `<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>`, чтобы нажатие `Enter` в текстовом поле без JS отправляло основную кнопку сохранения родительской `<Form>`, а не первую кнопку «Удалить» строки набора (`CollectionForm.svelte:79`).
  - сохраняет все существующие `data-testid` (`add-field`, `remove-${row.key}`, имена `props.${row.key}.*`), чтобы весь набор браузерных проверок `test/browser/fields.mjs` прошёл 1-в-1!
- **`SchemaFields.svelte`**: рендер динамических полей `form.from()` через `<Field />` с `class` и `classes`.
- **`SchemaValues.svelte`**: отображение сохранённых значений `{ [key]: value }` по актуальному `FieldSetItem[]` (переименованные подписи берутся из набора, удалённые из набора ключи скрываются — проверяется `test/browser/fields.mjs:222`).

### 3.3. Модуль №2 `src/components/paginator/` (Этап A3)
- Переносится `SearchBar.svelte` из `routes/(site)/(app)/paginator/SearchBar.svelte` в `src/components/paginator/ui/SearchBar.svelte` с пропами `label = 'Поиск'`, `placeholder = 'Найти…'`, `class`, `inputClass`.
- Переносится вся папка `src/lib/components/filters/*` внутрь `src/components/paginator/` (`ui/{FiltersPanel,ActiveFilters,FilterActions}.svelte`, `model/filter-form.svelte.ts`).
- Создаётся сборщик Уровня 1 **`src/components/paginator/Paginator.svelte`**, объединяющий `PaginatorHost` (`onError={report}`) + `LoadingIndicator` + `EdgeSentinel(-1)` + `LoadMoreLink(-1)` + `EmptyState` + (`PageColumns` | `PageList`) + `LiveStatus` + `ErrorRow` + `ReplaceLoadingRow` + `LoadMoreLink(+1)` + `EdgeSentinel(+1)` + `EndRow` + опциональные `PageNav` и `EventLog` + сниппеты `toolbar`, `renderItem`, `renderSkeleton`, `navChildren`.
- Все вложенные части в `ui/*` экспортируются для кастомных экранов (`DbPostsList.svelte`, внешняя шапка `GalleryDemo.svelte`).

### 3.4. Реестр маршрутов `#lib/address` × `#lib/modals` (Этап A4 — 100% переиспользование примитивов)
- **`src/lib/address/routes.ts`** (~`60` строк, `0` фреймворков, `0` самописных валидаторов):
  - принимает `path` и `search`-схему, где каждое поле — либо `StandardSchemaV1` (`@standard-schema/spec`, уже стоит в `dependencies`), либо функция `(raw: string | undefined) => T` (включая `localPath` из `./core.ts`) + `{ default?: T }`;
  - методы дескриптора:
    - `route.href(params?)` — собирает чистый путь + строку запроса через `nextSearch` из `./keys.ts` (значения `=== default` или `undefined` опускаются);
    - `route.parse(url)` — читает и валидирует `URL | URLSearchParams | string`, возвращая типизированный объект с применёнными `default`;
    - `route.patch(currentUrl, patch)` — обновляет только ключи схемы маршрута на `currentUrl` через `nextSearch`, сохраняя все соседние GET-ключи (`?limit=4`, `?page=2` и т.д.).
- **`src/lib/address/sveltekit.ts`:**
  - экспортирует типизированный `kitRoute`, ограничивающий `path` типом `RouteId` и параметры типом `RouteParams<Path>` из `$app/types` — мёртвые пути валят `npm run check` автоматически без самописных скриптов!
- **`src/content/user/routes.ts` + `src/content/user/modals.ts`:**
  - `userAuthRoute` (`path: '/user/auth'`, `stage` с дефолтом `'entry'`, `next: localPath`) и `userMenuRoute` (`path: '/user/menu'`);
  - `registerModal({ name: 'user.auth', component: AuthModalLazy, route: userAuthRoute.href, size: { width: 420, height: 480 } })` — `0` перекрёстных импортов между `#lib/modals` и `#lib/address`!

---

## 4. Сквозной пошаговый чек-лист выполнения (`A1` → `A5`)

### Этап A1. Фундамент слоёв, очистка `src/lib/` и сборочные конфиги (`unocss` / `vite` / `guards`)
- [ ] **A1.1.** Добавить алиасы `#components/*` (`./src/components/*`) и `#server/*` (`./src/server/*`) в `package.json` (`imports`).
- [ ] **A1.2.** Перенести прикладные хуки и связки в `src/hooks/`:
  - `src/lib/hooks/{js-only.svelte.ts, use-drawer.svelte.ts}` → `src/hooks/` (удалить `src/lib/hooks/`);
  - `src/lib/components/links/*` → `src/hooks/links/`;
  - `src/lib/app-errors.svelte.ts` → `src/hooks/app-errors.svelte.ts`;
  - `src/lib/server/graphql.ts` → `src/hooks/graphql.ts`;
  - `src/lib/server/task-stream.ts` → `src/hooks/task-stream.server.ts`.
- [ ] **A1.3.** Перенести UI-слой в `src/components/`:
  - `src/lib/utils.ts` → `src/components/utils.ts` + заменить ручную склейку классов в `DemoPanel.svelte:229` на `cn(...)`;
  - `src/lib/ErrorPage.svelte`, `src/lib/Error500.svelte` → `src/components/`;
  - `src/lib/components/{ui,settings,demo,form,modals,steps,loader}/*` → `src/components/*`;
  - объединить `shell/`, `header/`, `sidebar/` в единый модуль `src/components/shell/`, а данные навигации конкретного сайта `nav.ts` вынести в `src/routes/(site)/nav.ts`;
  - попутно закрыть пересечения из `ui-consistency.md`: удалить мёртвый `const cls` в `src/components/form/TextareaField.svelte` (**`U2/F2`**), удалить мёртвый `src/components/ui/search/SearchMorph.svelte` и убрать `NativeSelect` из публичного реэкспорта `src/components/ui/index.ts` (**`F7`**, оставив файл `ui/native-select/NativeSelect.svelte` для `settings/Select.svelte`).
- [ ] **A1.4.** Перенести серверную инфраструктуру сайта в `src/server/`:
  - `db.server.ts`, `schema-admin.server.ts`, `cache.server.ts`, `live-cache.server.ts`, `fetch.server.ts`, `form-security.server.ts`, `after-response.server.ts`, `api-error.server.ts` (+ изоморфный `api-error.ts`), `trusted-origins.ts` (**строго без `$app/*` и `$env/*`!**).
- [ ] **A1.5.** Синхронно обновить все внешние конфиги, стражи, доки БД и браузерные тесты:
  - `vite.config.ts`: импорт `./src/server/trusted-origins.ts` + 8 путей прогрева `server.warmup.clientFiles` (`./src/components/...`);
  - `unocss.config.ts`: импорт `./src/hooks/links/indicator` + добавить `aria: { invalid: 'invalid="true"' }` в `theme` (**глобальное закрытие `U9`**) + удалить 3 мёртвых шортката (`nav-pill`, `nav-pill-active`, `skeleton` — **`U3`**);
  - `tooling/classes-audit.mjs`: импортировать единую тему из конфига вместо копии, починить строку `168` (`^(--|(?:aria|data)-[a-z-]+$)` — проверять все `aria-*:` и `data-*:` варианты!), обновить `SCOPE` под `src/components/...`;
  - `tooling/layer-guard.mjs` + `tooling/layer-guard.test.mjs`: научить `canonSpecifier()` всем 5 алиасам (`#lib/`, `$lib/`, `#components/`, `#hooks/`, `#content/`, `#server/`), запретить обратные импорты вниз и обязать серверные модули вне `$lib/server` иметь суффикс `*.server.ts` (кроме `src/server/trusted-origins.ts`);
  - `src/lib/db/{README.md,PORTING.md,docs/LIVE-APPEND.md,docs/TRANSPORTS.md}`: обновить 14 обратных кавычек с путями переехавших файлов под `tooling/db-docs.mjs:341` (код `src/lib/db/**` не трогать!);
  - `test/browser/attachment.mjs:56,70`: обновить динамический `import('/src/components/ui/attachment/AttachmentBrowserFixture.test.svelte')`.
- [ ] **A1.6.** Прогнать все гейты + браузерные `shell.mjs`, `modals.mjs`, `attachment.mjs`, отметить `[x]` по `A1.1–A1.6`, закоммитить и запушить в `origin/img`.

---

### Этап A2. `#hooks/component-form` v2 + Пилот №1 `src/components/fields/` + очистка `/fields`
- [ ] **A2.1.** Расширить `#hooks/component-form` (`0` байт в `src/lib/form/`!):
  - динамический `description(event)` и `source` в `ComponentFormRegistration`;
  - автоматический inline-рендер (`200`, `locals.formResult`) при `result.outcome === 'not-applied'`;
  - колбэк `onSuccess` в `src/hooks/component-form/bind.svelte.ts` поверх `onResult`;
  - автосбор `import.meta.glob(['/src/content/**/*.form.server.ts', '/src/routes/**/*.form.server.ts'], { eager: true })` и перевод `user` seed/profile форм на `*.form.server.ts` (удаление ручного списка в `src/hooks.server.ts`).
- [ ] **A2.2.** Создать папочный модуль `src/components/fields/` (`index.ts`, `types.ts`, `variants.ts`, `SchemaBuilder.svelte` со скрытым default-submit для `Enter` без JS и единой типографикой групп **`F8`**, `SchemaFields.svelte`, `SchemaValues.svelte`) и добавить его в `SCOPE` `tooling/classes-audit.mjs`.
- [ ] **A2.3.** Перевести `src/routes/(site)/(app)/fields/` на `#components/fields` и `*.form.server.ts`, удалив ручные `/fields/save/+server.ts`, `/fields/record/+server.ts` и `actions` из `+page.server.ts`.
- [ ] **A2.4.** Обновить `test/browser/fields.mjs:230,244` (`pg.route('**/fields?/__component_form=*', ...)`), прогнать все гейты + `test/browser/fields.mjs` и `attachment.mjs`, отметить `[x]`, закоммитить и запушить в `origin/img`.

---

### Этап A3. Модуль №2 `src/components/paginator/` + сборка `src/content/demo-catalog/`
- [ ] **A3.1.** Собрать все 4 витринных источника и демо-БД в изолированную папку **`src/content/demo-catalog/`**:
  - `src/content/demo-catalog/items/` (`items.ts`, `items.test.ts`, карточки `ItemRow.svelte`, `ShotTile.svelte`);
  - `src/content/demo-catalog/posts/` (`posts.ts`, `list.server.ts`, `cursor-mode.svelte.ts`, `ui/DbPostRow.svelte` — общий источник для `src/server/db.server.ts`, `/api/db-posts`, `/db-demo` и `/paginator`, **`0` кросс-импортов между роутами и `0` исключений в `layer-guard.mjs`**);
  - `src/content/demo-catalog/rickmorty/` (`rickmorty.ts`, `filters.ts`, `rickmorty.server.ts`, `rickmorty.server.test.ts`, карточки и форма фильтров);
  - `src/content/demo-catalog/shikimori/` (`shikimori.ts`, `filters.ts`, `shikimori.server.ts`, `filters.server.ts`, `schema.server.ts`, тесты, карточки и форма фильтров);
  - удалить полностью опустевший `src/lib/server/`.
- [ ] **A3.2.** Обновить `tooling/source-schema-guard.mjs` + `tooling/source-schema-guard.test.mjs` и обратные кавычки в `src/lib/db/PORTING.md` под новые пути `src/content/demo-catalog/`.
- [ ] **A3.3.** Собрать папочный модуль `src/components/paginator/`:
  - перенести `filters/*` и `SearchBar.svelte` внутрь `src/components/paginator/ui/`;
  - перевести `paginator/ui/Skeleton.svelte` и `modals/Skeleton.svelte` в тонкие обёртки над единым `src/components/ui/skeleton/Skeleton.svelte` (**`U3`**);
  - реализовать `Paginator.svelte` (`variant`, `class`, `classes`, встроенные сентинелы краёв и состояния) и перевести на него `GalleryDemo.svelte` и `CatalogDemo.svelte`;
  - добавить `src/components/paginator/**` в `SCOPE` `tooling/classes-audit.mjs`.
- [ ] **A3.4.** Прогнать все гейты + браузерные `paginate.mjs`, `shikimori.mjs`, `db-demo.mjs`, отметить `[x]`, закоммитить и запушить в `origin/img`.

---

### Этап A4. Единый реестр маршрутов `#lib/address` + полная самодостаточность `src/content/user/`
- [ ] **A4.1.** Реализовать `src/lib/address/routes.ts` (на `@standard-schema/spec` + `localPath` из `./core.ts` + `nextSearch` из `./keys.ts` — `href`, `parse`, `patch`) + unit-тесты `src/lib/address/routes.test.ts` (дефолты, валидация, Open Redirect `//evil.com` и `javascript:`, сохранение чужих query-ключей).
- [ ] **A4.2.** Реализовать типизированный `kitRoute` в `src/lib/address/sveltekit.ts` на базе `RouteId` / `RouteParams<Path>` из `$app/types`.
- [ ] **A4.3.** Довести `src/content/user/` до 100% самодостаточности:
  - создать `src/content/user/routes.ts` (`userAuthRoute`, `userMenuRoute`) и перенести `auth-modals.ts` → `src/content/user/modals.ts` с `route: userAuthRoute.href`;
  - переименовать серверные файлы модуля в `*.server.ts`;
  - проставить самодостаточные дефолты пропов (`limits = DEFAULT_PROFILE_LIMITS` в `ProfileForm.svelte`, дефолты в `AuthWidget.svelte`);
  - перевести все ссылки и переходы к `/user/auth` и `/user/menu` по проекту на `userAuthRoute` / `userMenuRoute` (убрать ручные `{ href: '/user/auth?stage=...' }` и `limitTail`).
- [ ] **A4.4.** Прогнать все гейты + браузерные `auth.mjs` и `modals.mjs`, отметить `[x]`, закоммитить и запушить в `origin/img`.

---

### Этап A5. Документация канона (`U8`, `AGENTS.md`), подтяжка бюджетов и сквозная приёмка `A1`–`A5`
- [ ] **A5.1.** Записать канон UI-слоя в `src/components/ui/README.md` (**`U8`**: где живут `*Variants`, где лежат иконки, когда допустим глубокий импорт в обход барреля ради веса).
- [ ] **A5.2.** Актуализировать `AGENTS.md`, `docs/audit/README.md`, `docs/audit/testing-backlog.md` и подтянуть потолки `tooling/size-budget.mjs` по фактическому уменьшению чанков.
- [ ] **A5.3.** Выполнить полный прогон всех гейтов (`test:guard`, `test:classes`, `check`, `vitest`, `build + size-budget`) и всех браузерных сьютов `test/browser/*.mjs`, отметить `[x]`, закоммитить, запушить в `origin/img` и обновить архив в `/home/user/agent-state` перед переходом к **[`./ui-consistency.md`](./ui-consistency.md)**.
