# Аудит модульной архитектуры, библиотек, самодостаточных компонентов и реестра маршрутов `address`

Исследование текущего дерева файлов `modals-kit`, современных подходов к модульной организации fullstack-приложений (2025–2026), самодостаточности форм/компонентов и расширения `#lib/address` до единого типизированного реестра маршрутов с GET-параметрами.

> **Статус:** сбор данных и архитектурное проектирование (код в `src/` не изменялся).

---

## 1. Фактическая ревизия текущего дерева `src/` (что сейчас смешано)

Полное сканирование `src/**` показало, что внутри `src/lib/` сейчас смешаны **четыре разные по природе категории кода**, а между слоями есть **обратные зависимости снизу вверх**:

### 1.1. Обратные зависимости внутри `src/lib/` (нарушение границ слоёв)
- `src/lib/server/db.ts` импортирует прикладную схему модуля пользователя `#content/user/schema.js` и хук `#hooks/cache-db.js` — то есть `src/lib/` зависит от `src/content/` и `src/hooks/`.
- `src/lib/server/cache.ts` импортирует `#hooks/cache-db.js`.
- В проекте одновременно существуют **две разные папки хуков**: `src/hooks/` и `src/lib/hooks/`.

### 1.2. Что реально лежит сейчас внутри `src/lib/`

| Категория | Текущие пути в `src/lib/` | Является ли независимой библиотекой уровня `node_modules`? |
|---|---|---|
| **1. Чистые ядра библиотек (`0` UI / `0` фреймворков)** | `address/{core,keys,layer-links}.ts`, `cache/*`, `db/*` (без `sveltekit/`), `fetch/*`, `form/*` (без `svelte/`), `image/*`, `modals/*` (без `svelte/` и `cores/sveltekit.ts`), `paginate/*` (без `svelte/` и `sveltekit/`), `task/*` | **Да — 100%.** Не знают ни про Svelte/SvelteKit, ни про домен сайта. |
| **2. Переиспользуемые чистые серверные мини-библиотеки** | `server/graphql.ts`, `server/trusted-origins.ts`, `server/after-response.ts`, `server/task-stream.ts`, `server/live-cache.ts` (если отвязать от проектного синглтона `cache.ts`) | **Да** (после отвязки от синглтона `localStore`), но сейчас спрятаны в `lib/server/` рядом с кодом демо-сайта. |
| **3. Адаптеры библиотек к Svelte / SvelteKit** | `address/svelte/watch.svelte.ts`, `address/sveltekit.ts`, `db/sveltekit/*` (7 файлов), `form/svelte/*` (5 файлов, вкл. `Form.svelte`), `modals/svelte/*` (9 файлов) + `modals/cores/sveltekit.ts`, `paginate/svelte/*` (9 файлов) + `paginate/sveltekit/router.ts`, `hooks/{js-only,use-drawer}.svelte.ts` | Зависят от `svelte` / `@sveltejs/kit` / `@ark-ui/svelte`. Не содержат бизнес-логики конкретного сайта. |
| **4. Общий UI-кит и визуальные надстройки** | `components/ui/*`, `components/form/*`, `components/modals/*`, `components/paginator/*`, `components/filters/*`, `components/steps/*`, `components/links/*`, `components/loader/*`, `components/settings/*`, `components/shell/*`, `utils.ts`, `ErrorPage.svelte`, `Error500.svelte` | Переиспользуемый UI-слой проекта (Design System + обвязка). |
| **5. Код КОНКРЕТНОГО демо-сайта и его синглтоны (вообще не `lib`!)** | `server/db.ts` (`DEMO_PRINCIPAL`, `demoPosts`), `server/db-list.ts`, `server/cache.ts`, `server/fetch.ts`, `server/form-security.ts`, `server/schema-admin.ts`, `server/rickmorty.ts`, `server/shikimori*.ts`, `components/header/nav.ts` (меню демо-страниц), `components/demo/*`, `api-error.ts`, `app-errors.svelte.ts`, `assets/favicon.svg` | **Нет!** Это чистый код конкретного сайта и его демо-витрин. |

---

## 2. Критические поправки и подводные камни при очистке `src/lib/`

### Поправка А (Безопасность сборки SvelteKit — ОЧЕНЬ ВАЖНО!)
В SvelteKit встроенная защита компилятора Vite от попадания серверного кода и секретов (`process.env`, SQL, `iron-webcrypto`) в браузерный JS-бандл работает **только** для:
1. файлов внутри `$lib/server/**`;
2. файлов с суффиксом **`*.server.ts` / `*.server.js`** в любом месте `src/**`.

**Риск:** сейчас `src/content/user/gateway.ts`, `src/content/user/ui/seed-form/server.ts`, `src/content/user/ui/profile-form/server.ts` и `src/hooks/component-form/server.ts` **не имеют суффикса `.server.ts`** — от случайного бандлинга на клиент их косвенно защищает только глубокий импорт `#lib/server/db.js`.
**Решение:** при выносе проектного кода из `src/lib/server/` **все серверные файлы вне `$lib/server` обязаны именоваться `*.server.ts`** (`gateway.server.ts`, `action.server.ts`, `db.server.ts` и т. д.), плюс правило в `tooling/layer-guard.mjs` запрещает импорт любых `*.server` и `#server/*` в клиентском графе.

### Поправка Б (Развилка: где живут Svelte-адаптеры библиотек и `.svelte`-хосты протокола)
У библиотек `form`, `modals` и `paginate` есть headless `.svelte`-компоненты протокола (`Form.svelte`, `ModalHost.svelte`, `PaginatorHost.svelte`, `PageAnchor.svelte` и др.):

- **Вариант 1 (Радикальная чистота `src/lib/` = `0` импортов `svelte` / `@sveltejs/kit` во всём `src/lib/`):**
  - В `src/lib/<pkg>/` остаются **исключительно чистые JS/TS-ядра** (по 100% аналогии с framework-agnostic core пакетами).
  - Все многофайловые фреймворковые связки переезжают папками в `src/hooks/<pkg>/`:
    - `src/hooks/address/` (`watch.svelte.ts`, `sveltekit.ts`)
    - `src/hooks/db/` (7 файлов `sveltekit/*`)
    - `src/hooks/form/` (`bind.svelte.ts`, `field-set.svelte.ts`, `task.ts`, `config.ts`, `Form.svelte`)
    - `src/hooks/modals/` (`ModalHost.svelte`, `context.ts`, `state.svelte.ts`, `sveltekit.ts` и др.)
    - `src/hooks/paginate/` (`PaginatorHost.svelte`, `context.svelte.ts`, `router.ts` и др.)
    - `src/hooks/links/` (`link.svelte.ts`, `modal-link.svelte.ts`, `state.svelte.ts`, `indicator.ts`)
    - `src/hooks/steps/` (`steps.svelte.ts`, `form.svelte.ts`, `link.svelte.ts`, `keys.ts`)
    - `src/hooks/component-form/`
    - одиночные связки: `src/hooks/cache-db.ts`, `src/hooks/db-form.ts`, `src/hooks/js-only.svelte.ts`, `src/hooks/use-drawer.svelte.ts`.
  - В `src/components/` переезжают все визуальные UI-компоненты (`ui/`, `form/`, `modals/`, `paginator/`, `filters/`, `steps/`, `loader/`, `settings/`, `shell/`).
  - **Что потребуется обновить в инструментах:** синхронно поправить пути в `tooling/{db-docs,core-purity,form-size,layer-guard}.mjs` и `sim/react-router/` (проверено по коду стражей — никаких блокеров нет).

- **Вариант 2 (Пакетная модель `node_modules` с subpath exports `@pkg/name` + `@pkg/name/svelte`):**
  - Каждая папка в `src/lib/<pkg>/` оформлена ровно так, как она публиковалась бы отдельным пакетом в `npm` (чистое ядро `./index.ts` + собственный изолированный фреймворковый подпуть `./svelte` без знания о других наших библиотеках — именно этот контракт сейчас задокументирован в `src/lib/db/PORTING.md`).
  - А в `src/hooks/` живут **все межбиблиотечные и прикладные связки** (`component-form/`, `links/`, `steps/`, `cache-db.ts`, `db-form.ts`, `js-only.svelte.ts`, `use-drawer.svelte.ts`).
  - В `src/components/` переезжает весь UI-кит.

---

## 3. Модульная структура сайта: анализ подходов (FSD vs Vertical Domain Modules)

### 3.1. Почему классический 7-слойный Feature-Sliced Design (`pages / widgets / features / entities / shared`) НЕ подходит этому проекту
1. **Разрыв одного домена на 4–5 корневых папок:** модуль `user` в каноническом FSD дробится между `entities/user` (`vault`, аватар), `features/auth` (`SeedForm`), `features/edit-profile` (`ProfileForm`), `widgets/user-menu` (`UserMenu`, `AuthWidget`) и `pages/user-auth`. Модуль перестаёт быть автономной папкой, которую можно целиком перенести или удалить.
2. **Конфликт с fullstack-природой SvelteKit и самодостаточными компонентами:** FSD проектировался под чистый клиентский SPA; в fullstack-среде, где рядом с компонентом лежат схема БД, серверный обработчик формы (`*.server.ts`) и маршруты, горизонтальные слои `entities` / `features` / `widgets` создают искусственные барьеры и дублирование DTO.

### 3.2. Рекомендуемый стандарт: **Autonomous Domain Modules (Vertical Slices) + Headless Kit**
Архитектура «модульного монолита с вертикальными срезами» со строгим однонаправленным графом зависимостей:

```text
routes  ──▶  server (app bootstrap)  ──▶  modules/*  ──▶  components/*  ──▶  hooks/*  ──▶  lib/*
```

```text
src/
├── lib/                 # 1. Чистые автономные библиотеки («свой node_modules», 0 знания о сайте)
├── hooks/               # 2. Реактивные адаптеры Svelte / SvelteKit и межбиблиотечные связки
├── components/          # 3. Универсальный UI-кит и каркас оболочки (0 бизнес-логики модулей)
├── modules/             # 4. Автономные бизнес-модули (вертикальные капсулы доменов)
│   └── user/            #    модуль №1 (дальше — catalog, posts, billing, comments и т.д.):
│       ├── domain/      #    чистые правила: auth.ts, profile.ts, acl.ts, checks.ts, keys.ts, config.ts
│       ├── server/      #    *.server.ts: schema.server.ts, gateway.server.ts, bootstrap.server.ts
│       ├── state/       #    vault.ts, vault.svelte.ts
│       ├── routes.ts    #    регистрация канонических маршрутов в address и модалок в modals
│       ├── ui/          #    самодостаточные компоненты (acl/, seed-form/, profile-form/, auth-widget/, user-menu/)
│       └── index.ts     #    публичный контракт модуля
├── server/              # 5. Сборка инстанса конкретного сайта: db.server.ts, cache.server.ts, env.ts, init
└── routes/              # 6. Тонкие файловые обёртки SvelteKit (5–15 строк: делегируют в modules/*)
```

**Правила изоляции модулей (закрепляются в `tooling/layer-guard.mjs`):**
1. Ни один файл в `lib/`, `hooks/`, `components/` не имеет права импортировать `#modules/*` или `#server/*`.
2. Модули в `src/modules/<A>/` и `src/modules/<B>/` не импортируют внутренние файлы друг друга в обход публичного `index.ts` (а кросс-модульная сборка живёт на уровне `server/` и `routes/`).
3. Сайдбар/шапка (`AppShell`) не хардкодят ссылки и виджеты модулей внутри `src/components/shell/` — слоты заполняет корневой layout сайта из подключённых модулей.

---

## 4. Ревизия всех форм и самодостаточности компонентов («любой компонент в любом месте»)

### 4.1. Таблица всех форм проекта и их привязки к роутам

| Компонент / Форма | Где сейчас серверный обработчик | Можно ли смонтировать на чужом URL (в модалке / в сайдбаре / на `/` — с JS и без JS)? | Что мешает прямо сейчас |
|---|---|---|---|
| `SeedForm.svelte` (`user-auth`) | `user/ui/seed-form/server.ts` (`component-form`) | POST — **да**; холодный старт `AuthWidget` — **частично** | POST независим от роута, **но** начальные `challenge`, `limits`, `enabled`, `registerSeed` собирает только `/user/auth/+page.server.ts`, а `AuthWidget:165` и `vault:43` хардкодят URL `'/user/auth'` |
| `ProfileForm.svelte` (`user-profile`) | `user/ui/profile-form/server.ts` (`component-form`) | POST — **да**; без внешних пропов — **нет** | Обязательный проп `limits` (`edge`, `maxBytes`, `formats`, `nicknameForbidden`) приходит только из `/user/auth/+page.server.ts` |
| `MenuBody.svelte` (выход) | `user/ui/seed-form/server.ts` (`component-form`) | **Да** (после перехода на чистый `vault`) | Сейчас требует `server={data.user}` при SSR |
| `db-demo`: `CreateForm`, `RemoveForm`, `RenameForm`, `SchemaPending` (4 формы) | **В РОУТЕ:** `/db-demo/+page.server.ts` (`actions`) + дубль `/db-demo/submit/+server.ts` | **Нет!** | Раздвоенный приём (`+page.server.ts` для no-JS + `+server.ts` для JS) и жёсткая привязка к роуту `/db-demo` |
| `fields`: `CollectionForm`, `RecordForm`, `ResetAction` (3 формы) | **В РОУТЕ:** `/fields/+page.server.ts` (`actions`) + дубли `/fields/save/+server.ts`, `/fields/record/+server.ts` | **Нет!** | Серверная логика и PRG-редиректы зашиты в роут `/fields/+page.server.ts` |
| `form`: `signup` | **В РОУТЕ:** `/form/+page.server.ts` (`actions.default`) + `/form/submit/+server.ts` | **Нет!** | Двойной вход (`+page.server.ts` + `+server.ts`), привязка к `/form` |
| `steps`: `fstep-form` | **В РОУТЕ:** `/steps/+page.server.ts` (`actions`) | **Нет!** | Привязка к `action="/steps?..."` |

### 4.2. Как сделать КАЖДЫЙ компонент по-настоящему самодостаточным в любом месте
Чтобы любой компонент (`<ProfileForm />`, `<AuthWidget />`, `<CreatePostForm />` и т. д.) можно было вставить **одной строкой без подготовки `+page.server.ts`**:
1. **Единый `component-form` для всех встраиваемых форм** — убирает и `export const actions` из `+page.server.ts`, и дублирующие `*/submit/+server.ts`. Транспорт по умолчанию бьёт в **текущий URL страницы** (`visibleAddress().url`), который перехватывается глобальным `componentFormsHandle` (никаких хардкодных `'/user/auth'` в `kitActionTransport`!).
2. **Самодостаточные дефолты + ленивый bootstrap компонента:**
   - у каждого компонента все конфигурационные пропы (`limits` в `ProfileForm`, `data` в `AuthWidget`) становятся **опциональными**: базовые дефолты берутся из общей константы конфига модуля;
   - если страница передала серверный `bootstrap` (например, канонический роут `/user/auth` для работы **без JS**) — компонент рендерится с полными данными уже в SSR;
   - если компонент вставили на произвольную страницу без `load` (`<AuthWidget />` под статьёй) — при маунте на клиенте он сам запрашивает свежий `challenge` / актуальные `limits` одним вызовом `intent="bootstrap"` своего же `component-form`!

---

## 5. Единый реестр маршрутов и GET-параметров в `#lib/address`

### 5.1. Диагноз проблемы в текущем коде
Маршруты и их GET-параметры сейчас склеиваются вручную строковыми шаблонами по всему проекту:
- один только `/user/auth` захардкожен в **8 местах** (`auth-modals.ts`, `UserMenu.svelte`, `MenuBody.svelte`, `Acl.svelte`, `AuthWidget.svelte`, `vault.svelte.ts`, `seed-form/server.ts`);
- в `MenuBody.svelte` и `Acl.svelte` один и тот же переход приходится описывать **дважды**:
  `asModalLink('user.auth', { stage: 'profile' }, { href: '/user/auth?stage=profile' })` — потому что `routeHref` в `#lib/modals` не знает схему GET-параметров маршрута;
- валидация `localPath(url.searchParams.get('next'))` и сохранение соседних GET-параметров (`limitTail(event.url)` в `/fields/+page.server.ts`) дублируются вручную в каждом обработчике.

### 5.2. Архитектура решения: `RouteRegistry` в `#lib/address` (симметрично `ModalRegistry`)

**Главный принцип чистоты:** сама библиотека `#lib/address` **не хранит маршруты нашего сайта** — точно так же, как `#lib/modals` не знает про `'user.auth'`. `#lib/address` даёт чистый универсальный движок объявления, валидации и сборки полных URL (путь + GET + `#hash`), а **каждый модуль регистрирует свои маршруты сам** (`modules/user/routes.ts`).

#### Контракт ядра `#lib/address/routes.ts` (`0` зависимостей от фреймворков, работает и на SSR, и в браузере):

```ts
// 1. В библиотеке #lib/address (чистое ядро):
export const defineRoute = <Name extends string, Path extends string, Search extends SearchSchema>(def: {
  name: Name
  path: Path          // например '/user/auth' или '/cards/:id'
  search?: Search     // типизированные кодеки GET-ключей с дефолтами и санитизацией (localPath, enum, number...)
}) => ...

// 2. В модуле src/modules/user/routes.ts (ЕДИНСТВЕННОЕ место, где написан путь!):
export const userAuthRoute = registerRoute({
  name: 'user.auth',
  path: '/user/auth',
  search: {
    stage: queryEnum(['entry', 'register', 'restore', 'profile', 'blocked', 'restrictions'], { default: 'entry' }),
    next: queryLocalPath(), // Open-Redirect защита localPath() встроена в сам тип параметра!
  },
})

export const userMenuRoute = registerRoute({
  name: 'user.menu',
  path: '/user/menu',
})
```

#### Что умеет единая точка `address` везде (клиент + сервер + модалки):
1. **Полная сборка маршрута до конца (`address.href`):**
   - `address.href('user.auth')` → `'/user/auth'` (дефолт `stage: 'entry'` автоматически опущен, URL чистый!)
   - `address.href('user.auth', { stage: 'profile', next: '/paginator?page=2' })` → `'/user/auth?stage=profile&next=%2Fpaginator%3Fpage%3D2'`
   - `address.href('cards.item', { id: 42, slow: true })` → `'/cards/42?slow=1'`
2. **Обновление GET на текущем маршруте без потери соседних параметров (`address.patch`):**
   - `address.patch('fields', event.url, { step: 'fill' })` → меняет `step=fill`, автоматически сохраняя текущий `limit=5` (и уважая `claimQuery` / `layerKeys`, чтобы не затереть чужие ключи на странице!).
3. **Типизированное чтение GET на сервере и клиенте (`address.parse`):**
   - `const { stage, next } = address.parse('user.auth', event.url)` — больше ни одного сырого `event.url.searchParams.get(...)` и забытого `localPath(...)`!
4. **Автоматическая связка с хостом модалок (`modals` × `address`):**
   - В `registerModal({ name: 'user.auth', route: 'user.auth', ... })` модалка ссылается на **имя маршрута в `address`**, а не на сырую строку `'/user/auth'`.
   - Вызов `asModalLink('user.auth', { stage: 'profile' })` **без третьего аргумента `{ href }`** автоматически строит fallback-ссылку через `address.href('user.auth', { stage: 'profile' })` → `'/user/auth?stage=profile'`! Дублирование исчезает полностью.
5. **Защита от рассинхрона с файловым роутингом SvelteKit:**
   - В SvelteKit сам приём HTTP GET страницы требует наличия файла `+page.svelte` в папке `src/routes/...`.
   - Чтобы при смене `path` в `routes.ts` никто не забыл переименовать тонкую папку-пустышку в `src/routes/`, страж в `tooling/` (плюс уже встроенный `resolves()` на клиенте) автоматически сверяет все зарегистрированные пути `address` с реальным деревом `src/routes/` на этапе `test:guard` и `build`!

---

## Раунд 1. Корректировка владельца: никаких `src/modules/` — папочные модули-компоненты в `src/components/`, тонкие роуты со своими схемами и прикладные сборки в `src/content/`

> **Решение владельца по итогам чтения базового аудита:**
> 1. **Не вводить отдельную папку `src/modules/`.** Для прикладных бизнес-фич сайта (которые переиспользуются сразу в шапке, в модалке, в своём роуте и на чужих страницах) уже есть папка **`src/content/`** и живой эталон в ней — **`src/content/user/`**.
> 2. **Движемся «издалека» (сначала полная карта раундами — и только потом перенос).**
> 3. **Главный объект перестройки — превращение разрозненных демо-страниц и полуфабрикатов кита в полноценные папочные компоненты `src/components/<name>/`**, которые роут подключает одной точкой, передавая декларативную схему и стили (`variant` / `class` через `cn(...)`, по образцу `Acl`).
> 4. **Граница между переиспользуемым компонентом и чистым демо:**
>    - если роут демонстрирует **готовый UI-механизм для реальных страниц** (например, пагинатор, форма, конструктор полей, модалки) — сам механизм живёт как законченный папочный модуль в `src/components/<name>/` (со своими подпапками и экспортом `ui`), **а схема конкретного демо-стенда живёт прямо рядом с роутом** (так как показывать это демо в другом месте сайта не требуется);
>    - если роут является **чистым лабораторным стендом ядра** (`steps`, `db-demo`, `cycle`, `spike`), где нет единого UI-виджета для переиспользования — ничего искусственно вытягивать оттуда в `src/components/` не нужно, вся стендовая логика локализуется внутри самого роута;
>    - если же на сайте появляется **прикладная сущность**, нужная одновременно на страницах, в модалках и в шапке — она собирается в `src/content/<name>/` по образцу `src/content/user/` поверх готовых `src/components/*`.

---

### 1.1. Целевая 5-слойная структура проекта (с учётом Раунда 1)

```text
src/
├── lib/                 # Чистые переносимые библиотеки («свой node_modules», без знания о сайте)
├── hooks/               # Связки со Svelte / SvelteKit и межбиблиотечные переходники (по папкам >1 файла)
├── components/          # Самодостаточные папочные UI-модули кита (каждый со своим index.ts, подпапками и cn/variant)
│   ├── ui/              # Атомарные контролы (button/, input/, select/, card/, alert/, attachment/, file-attachment/...)
│   ├── paginator/       # Готовый папочный модуль пагинатора «под ключ» по схеме + вложенные ui/
│   ├── form/            # Папочный модуль форм и полей по схеме + вложенные ui/
│   ├── fields/          # Папочный модуль динамического конструктора/рендера набора полей (если выделяем из /fields)
│   ├── modals/          # UI-оболочки модальных окон, скелетоны, ошибки, кнопки закрытия
│   ├── shell/           # Оболочка сайта (AppShell, CollapsingHeader, Sidebar, Header — без хардкода демо-меню)
│   ├── loader/          # Глобальный индикатор переходов
│   └── settings/        # Примитивы панелей настроек
├── content/             # Прикладные модули сайта (переиспользуемые в модалках, шапке и разных роутах)
│   └── user/            # Эталонный прикладной модуль (авторизация, сессии, vault, профиль, Acl)
└── routes/              # Маршруты SvelteKit:
                         #   - роуты-потребители: хранят локальную схему своего экрана + вызывают src/components/* или src/content/*
                         #   - чистые демо-стенды ядер (/steps, /db-demo): вся стендовая обвязка живёт прямо внутри папки роута
```

---

### 1.2. Анатомия папочного модуля в `src/components/<name>/` (на примере `paginator`)

Сейчас код пагинатора разорван на **4 разных конца проекта**:
1. `src/lib/components/paginator/` — 18 мелких разрозненных файлов без общего сборщика;
2. `src/lib/components/filters/` — отдельно лежащая панель фильтров;
3. `src/routes/(site)/(app)/paginator/` — 15 файлов «клея всего подряд» (`CatalogDemo.svelte`, `GalleryDemo.svelte`, `SearchBar.svelte`, `sources.ts`, `definition.ts`, `item-views.ts`);
4. `src/content/{rickmorty,shikimori,items,posts}.ts` и `src/lib/server/{rickmorty,shikimori}*.ts` — схемы и серверные адаптеры демо-источников, сваленные в общие папки проекта, хотя нигде кроме `/paginator` они не используются!

**Как это будет устроено по новой модели Раунда 1:**
- **Папочный модуль `src/components/paginator/`:**
  - `Paginator.svelte` — главный самодостаточный компонент-сборщик: принимает **схему источника** (`definition` / `source`), начальный SSR-снимок, сниппеты рендера строки/плитки (`row` / `tile`), `variant` и `class` (прокидываемые через `cn(...)` на обёртку и слоты, как в `Acl`);
  - `ui/` — все переиспользуемые составные части (`PageList`, `PageColumns`, `PageNav`, `SearchBar`, `FiltersPanel`, `ActiveFilters`, `PaginatorSettings`, `EmptyState`, `ErrorRow`, `Skeleton`), чтобы роут мог как вызвать готовый `<Paginator schema={...} />`, так и собрать кастомную раскладку из `paginator/ui`;
  - `model/` — компиляция конфига, типы, привязка задач и поиска;
  - `index.ts` — единая точка входа компонента.
- **Папка роута `src/routes/(site)/(app)/paginator/`:**
  - `schemas/` (или подпапки `rickmorty/`, `shikimori/`, `local/`) — схемы, фильтры, серверные загрузчики и карточки `AnimeRow`/`CharacterTile` **конкретно этого демо**, перенесённые сюда из `src/content/*` и `src/lib/server/*` (ни `src/content/`, ни `src/lib/` больше не замусорены Шикимори и Риком и Морти!);
  - `+page.server.ts` и `+page.svelte` — тонкая сборка, которая берёт выбранную схему и передаёт её в `<Paginator>` из `#components/paginator`.

---

### 1.3. Полная карта всех 7 текущих роутов после построчной проверки кода

Чтобы выбрать **действительно самую простую потребительскую демку** и не перепутать её с лабораторным стендом ядра, ниже проверены **внутренности всех 7 текущих демо-маршрутов**:

| Ранг | Роут | Файлов / строк | Что реально внутри кода | Куда идёт по модели владельца | Подходит ли как стартовый эталон №1? |
|---|---|---|---|---|---|
| **1 (ЛУЧШИЙ СТАРТОВЫЙ ЭТАЛОН №1)** | **`/fields`** | `12` файлов (`SchemaBuilder` `66` стр., `SchemaFields` `17` стр., `CollectionForm` `91` стр., `RecordForm` `78` стр.) | Настоящий потребительский UI-конструктор набора полей и динамический рендерер формы `form.from()`, сейчас запертый в папке роута без `cn`/`variant` и со старыми ручными `/save/+server.ts` и `/record/+server.ts` | В **`src/components/fields/`** уезжает самодостаточный папочный модуль (`SchemaBuilder`, `SchemaFields`, `ui/`, `index.ts`, `variant`/`class`/`classes`), а в папке роута **`/fields/`** остаётся только локальная схема демо-каталога + `component-form` без дублирующих `+server.ts` | **ДА — КАНДИДАТ №1!** Маленький (~250 строк UI), на 100% ложится на схему «папочный модуль в `src/components/fields/` ← локальная схема в роуте `/fields/`». |
| **2 (ГЛАВНЫЙ ЦЕЛЕВОЙ МОДУЛЬ №2)** | **`/paginator`** | `15` файлов в роуте (`GalleryDemo` `124` стр., `CatalogDemo` `642` стр.) + `6` файлов в `content/` + `6` в `lib/server/` | Внутри живут два показательных потребителя: крошечный `GalleryDemo` (чистый пагинатор по схеме) и раздутый `CatalogDemo` (642 строки, где перемешана универсальная обвязка поиска/фильтров/`list`/`columns`, беспризорная `lib/components/filters/` и кросс-роутовый импорт `../db-demo/DbPostRow.svelte`) | Сборка папочного модуля **`src/components/paginator/`** (`Paginator.svelte` + `ui/` включая бывший `filters/` + `model/` + `index.ts`), а все демо-схемы `rickmorty` / `shikimori` / `items` уезжают из `src/content/` и `src/lib/server/` в папку роута `/paginator/` | **ШАГ №2 сразу после `/fields`:** даёт максимальный выигрыш всей перестройки и полностью вычищает `src/content/` от демо-мусора. |
| **3 (ИСКЛЮЧЕНИЕ — СТЕНД ЯДРА)** | **`/form`** | `7` файлов, но **`+page.svelte` = `544` строки!** | **Поправка к первичной оценке:** чтение всех 544 строк показало, что `/form` — **не «простая форма заявки»**, а глубокий лабораторный стенд ядра `#lib/form`: `4` одновременных инстанса `bind()` (`default/custom × first/all`), живая поломка `createRegistry()` с таблицей `attrsOf()`/`constraintsOf()`, 3-колоночный нормализатор ошибок `PSP` и очередь `pollUntilDone` | В `src/components/form/` оформляется чистый папочный модуль базовых кирпичей форм (`Field`, `Common`, `fields/`, `photo.ts`, `extend.ts`, `index.ts`), а сам 544-строчный стенд `/form` остаётся чистым демо-роутом ядра (только убирается дубль `/form/submit/+server.ts`) | **Нет** (после чтения кода переведён в группу лабораторных стендов ядра). |
| **4 (ИСКЛЮЧЕНИЕ — СТЕНД ЯДРА)** | **`/steps`** | `5` файлов | Лабораторный стенд 4 режимов `useSteps` (`url`, `local`, `hybrid`, `formSteps`) | Базовый UI-примитив шагов минимален, а вся стендовая страница остаётся внутри папки роута `/steps/`. | Чистый стенд. |
| **5 (ИСКЛЮЧЕНИЕ — СТЕНД ЯДРА)** | **`/db-demo`** | `18` файлов | Лабораторный стенд возможностей `#lib/db` (live cursor, optimistic UI, миграция схемы) | Остаётся стендом в папке роута; убираются обратные зависимости (`demoPosts` уезжает из глобального `server/db`, устраняется кросс-импорт из `/paginator` и дубль `submit/+server.ts`). | Чистый стенд. |
| **6 (ИСКЛЮЧЕНИЕ — СТЕНД ЯДРА)** | **`/modals` + `/cards/[id]`** | `12` + `2` файла | Лабораторный стенд режимов стека модалок (`CardModal`, `FlowProbe`, `LockedModal`) | Общие оболочки окон живут в `src/components/modals/`, демонстрационные пробы — внутри папки роута. | Чистый стенд. |
| **7 (ЭТАЛОН `src/content/`)** | **`src/content/user` (`/user/auth`, `/user/menu`)** | `22` файла | Единственный настоящий прикладной модуль сайта (живёт и в шапке, и в модалках, и на роутах) | **Уже лежит в `src/content/user/`** — очищается от костылей сессии (`docs/audit/auth-session.md`), получает `*.server.ts`, самодостаточные дефолты и регистрацию маршрутов в `address`. | Живой эталон прикладного модуля `src/content/<entity>/`. |

---

### 1.4. Зафиксированные комментарии и уточнения по итогам Этапа 1 (база для Этапа 2)

1. **Чёткая граница `src/components/<name>/` vs `src/content/<entity>/` (без `src/modules/`):**
   - `src/components/<name>/` — **универсальные UI-подсистемы кита без собственной доменной модели и таблиц БД**: получают снаружи декларативную **схему**, отдают готовый UI и стилизуются снаружи.
   - `src/content/<entity>/` — **прикладные бизнес-сущности самого сайта** (`user`, а в продукте — заказы, комментарии и т. п.) со своей схемой БД, `vault`, формами и модалками. Все демо-схемы (`items.ts`, `posts.ts`, `rickmorty*.ts`, `shikimori*.ts`), лежащие сейчас в корне `src/content/`, не являются модулями сайта и должны переехать в папки своих демо-маршрутов.
2. **Коррекция стартового пилота (`/fields` вместо `/form`):**
   - `/form` по факту оказался 544-строчным стендом внутренностей `#lib/form` (`4 × bind`, `createRegistry`, `PSP`), поэтому относится к стендам ядра рядом со `/steps`, `/db-demo` и `/modals`.
   - Истинно простой и чистый пилот №1 — **`/fields` → `src/components/fields/`**: компактный (~250 строк), содержит реальные переиспользуемые компоненты (`SchemaBuilder`, `SchemaFields`), убирает ручные эндпоинты `/fields/save` и `/fields/record` и проверяет весь контур перед крупным `src/components/paginator/`.
3. **Устранение кросс-роутовых и беспризорных связей в `paginator`:**
   - Беспризорная папка `src/lib/components/filters/` не является самостоятельной сущностью и входит внутрь папочного модуля `src/components/paginator/`.
   - В `src/routes/(site)/(app)/paginator/CatalogDemo.svelte` обнаружен прямой кросс-роутовый импорт соседнего маршрута (`import DbPostRow from '../db-demo/DbPostRow.svelte'` и `../db-demo/cursor-mode.svelte`) — при раскладке демо-схем такая связка между соседними роутами должна быть полностью исключена.
4. **Двухуровневый стандарт стилизации папочных модулей (`variant` + `class` + `classes` + `ui/`):**
   - Для одноблочного компонента (вроде `Acl`) достаточно `variant` + корневого `class` через `cn(...)`.
   - Для многозонного сборщика (`<Paginator>`, `<SchemaBuilder>`) предлагается единый двухуровневый стандарт:
     1. Верхнеуровневый сборщик `<Name schema={...} variant="..." class="..." classes={{ host: 'h-[360px]', toolbar: '...', item: '...', nav: '...' }} />` — каждый внутренний слот пропускается через `cn(defaultSlot, classes?.slot)`, чтобы настройка высоты скролла или отступов не требовала пересборки компонента по кускам.
     2. Одновременно из `index.ts` экспортируются составные блоки из `ui/` (каждый со своим `variant` и `class` через `cn`), когда экрану нужна полностью нестандартная геометрия (например, навигация пагинатора в шапке секции, а настройки — в отдельном сайдбаре, как в `GalleryDemo`).

---

### 1.5. Открытые вопросы ко Второму этапу обсуждения (Раунд 2)

1. Утверждаем ли связку пилотов в таком порядке: **эталон №1 — `/fields` (`src/components/fields/`) → главный модуль №2 — `/paginator` (`src/components/paginator/`, поглощающий `filters/`)**, оставляя `/form`, `/steps`, `/db-demo`, `/modals` в категории стендов ядра?
2. Подтверждаешь ли двухуровневый стандарт кастомизации папочных компонентов в `src/components/<name>/` (`variant` + корневой `class` + слотовый объект `classes?: { ... }` на готовом сборщике **плюс** экспорт подкомпонентов из `ui/`)?
3. По границе `src/lib/` vs `src/hooks/` (Поправка Б из раздела 2): выносим ли **все** Svelte/SvelteKit-связки из `src/lib/*` по папкам в `src/hooks/<pkg>/` (`0` импортов `svelte` во всём `src/lib/`), или оставляем пакетную модель `lib/<pkg>/svelte`?

