# modals-kit

Исходный репозиторий framework-neutral библиотек и эталонного приложения на **Svelte 5 (runes) + SvelteKit + Vite 8 + UnoCSS (Tailwind v4 preset) + PGlite / PostgreSQL**.

Все ключевые подсистемы построены по одному правилу: **чистое изоморфное ядро на TypeScript без зависимостей от UI-фреймворка + тонкий адаптер реактивности и роутера + полноценная работа как с JavaScript, так и при нативном HTTP без JavaScript (progressive enhancement)**. Переносимость ядер на другой стек доказана живой симуляцией на **React 19 + React Router v7** в [`sim/react-router/`](./sim/react-router/README.md).

---

## Состав репозитория (5 верхних слоёв)

### 1. Библиотеки (`src/lib/` — `#lib/*`)

| Пакет (`#lib/*`) | Назначение | Документация |
|---|---|---|
| `#lib/modals` | Адресуемая стопка модальных слоёв, переговоры о возможностях среды, области видимости реестра, `svelte/`-хост и `cores/sveltekit.ts` | [`src/lib/modals/README.md`](./src/lib/modals/README.md) |
| `#lib/form` | Изоморфные формы без DOM: описание, валидаторы, конверт, слои сервера, `takeover` поля, `queued`-протокол, `svelte/`-связка | [`src/lib/form/README.md`](./src/lib/form/README.md) |
| `#lib/paginate` | Headless-пагинация (`single` / `accumulate`, URL / localStorage / cursor, якоря скролла, `patchItems`), подпакеты `filters` и `search` | [`src/lib/paginate/README.md`](./src/lib/paginate/README.md), [`filters`](./src/lib/paginate/filters/README.md), [`search`](./src/lib/paginate/search/README.md) |
| `#lib/db` | Серверный слой данных PostgreSQL / PGlite / Hyperdrive / Proxy: модели, политики, Standard Schema, keyset-курсоры, `defineSchema` sync | [`src/lib/db/README.md`](./src/lib/db/README.md), [`PORTING.md`](./src/lib/db/PORTING.md) |
| `#lib/address` | Единый писатель URL/history, глобальная бронь query-ключей, чтение видимого адреса и типизированный реестр маршрутов (`routes.ts`, `kitRoute`) | [`src/lib/address/README.md`](./src/lib/address/README.md) |
| `#lib/fetch` | Надёжный `fetch` к внешним API: таймауты, ретраи с `Retry-After`, скользящие лимиты `rps`/`rpm`, склейка запросов, поток хода задачи | [`src/lib/fetch/README.md`](./src/lib/fetch/README.md) |
| `#lib/cache` | Контракт ключ–значение со сроками жизни, областями (`scope`), `singleflight` и атомарными `add`/`incr` | [`src/lib/cache/README.md`](./src/lib/cache/README.md) |
| `#lib/image` | Изоморфный конвейер изображений: чтение заголовков без декодирования (`probe`), обрезка/ресайз, подбор качества под бюджет байт, серверный WASM-декодер (`node.ts`) | [`src/lib/image/README.md`](./src/lib/image/README.md) |
| `#lib/task` | Единый формат состояния ожидания и прогресса (`TaskState`) для ссылок, кнопок и верхней полосы загрузки | [`src/lib/task/README.md`](./src/lib/task/README.md) |

### 2. Связки со средой и между библиотеками (`src/hooks/` — `#hooks/*`)

Переходники без визуальной разметки (подробно — [`src/hooks/README.md`](./src/hooks/README.md)):
- `cache-db.ts` (`#lib/cache` × `#lib/db`), `db-form.ts` (`#lib/db` × `#lib/form`), `api-error.ts`, `graphql.server.ts`, `task-stream.server.ts`;
- `links/` (`asLink`, `asModalLink`), `loader.svelte.ts`, `js-only.svelte.ts`, `use-drawer.svelte.ts`, `app-errors.svelte.ts`;
- `component-form/` — маршрутно-независимые формы компонентов через `createComponentFormsHandle` и `bindComponentForm`.

### 3. UI-примитивы и проектно-независимые компоненты (`src/components/` — `#components/*`)

- `src/components/ui/` — единая система примитивов на Ark UI + CVA (`variants`) + UnoCSS, включая `Attachment`, `FileAttachment`, `RadioGroup` и `Range` (правила слоя — [`src/components/ui/README.md`](./src/components/ui/README.md));
- `src/components/{shell,modals,form,fields,paginator,steps,settings,demo,loader}/` — прикладные компонентные модули без зашитых маршрутов конкретного сайта.

### 4. Контент и домены (`src/content/` — `#content/*`)

- `src/content/user/` — автономный модуль пользователя и авторизации по Ed25519 `seed`: маршруты и модалки (`routes.ts`, `modals.ts`), ядро (`auth.ts`, `profile.ts`, `acl.ts`, `keys.ts`, `vault.ts`), серверный фасад `gateway.server.ts` и UI под защитой `<Acl />` (`AuthWidget`, `MenuBody`, `ui/seed-form/`, `ui/profile-form/`). Документация — [`src/content/user/README.md`](./src/content/user/README.md);
- `src/content/demo-catalog/{items,posts,rickmorty,shikimori}/` — изолированные учебные источники витрин, схемы фильтров и карточки строк/плиток.

### 5. Серверные синглтоны и маршруты (`src/server/` — `#server/*`, `src/routes/`)

- `src/server/` — строго серверные синглтоны `*.server.ts` (`db.server.ts`, `cache.server.ts`, `live-cache.server.ts`, `fetch.server.ts`, `form-security.server.ts`, `schema-admin.server.ts`, `after-response.server.ts`, `api-error.server.ts`) и `trusted-origins.ts`;
- `src/routes/` — тонкие маршруты витрин и API (`/modals`, `/form`, `/fields`, `/steps`, `/paginator`, `/db-demo`, `/user/auth`, `/user/menu`, `/cards/[id]`, `/cycle`, `/spike`).

---

## Быстрый старт

Требуется **Node.js >= 22.17** (проверяется при старте `vite.config.ts`). База данных для разработки и тестов поднимается автоматически в памяти через WASM-движок `@electric-sql/pglite` — внешний PostgreSQL не нужен.

```bash
npm install
npm run dev          # http://localhost:5173
```

## Команды проверки

```bash
npm run test:guard   # стражи границ слоёв, чистоты ядер, схем источников, форм и документации БД
npm run test:classes # аудит классов UnoCSS и запрет маркер-классов
npm run check        # svelte-kit sync && svelte-check (0 errors, 0 warnings)
npm test             # полный прогон vitest + стражи в tooling/
npm run build        # production-сборка (включая проверку layer-guard)
npm run test:size    # проверка gzip-бюджетов всех чанков и начальной загрузки маршрутов
npm run test:browser # Playwright E2E-наборы в Chromium против production preview
```

---

## Документация проекта

- [`AGENTS.md`](./AGENTS.md) — правила репозитория, границы 5 слоёв и контракты подсистем.
- [`src/components/ui/README.md`](./src/components/ui/README.md) — правила слоя UI-примитивов (`*Variants`, `field.ts`, иконки, баррель и глубокие импорты).
- [`src/hooks/README.md`](./src/hooks/README.md) — каталог межбиблиотечных и фреймворковых связок.
- [`docs/plan.md`](./docs/plan.md) — сводный план проекта, завершённые вехи и открытые этапы развития.
- [`docs/audit/`](./docs/audit/README.md) — материалы аудита, [мастер-план `S1`–`S6` (`architecture.md`)](./docs/audit/architecture.md), [аудит UI (`ui-consistency.md`)](./docs/audit/ui-consistency.md) и [реестр задач (`testing-backlog.md`)](./docs/audit/testing-backlog.md).
- [`docs/design/port-plan.md`](./docs/design/port-plan.md) — план переноса на другой фреймворк/роутер.
- [`docs/design/image-transfer.md`](./docs/design/image-transfer.md) — архитектура бинарного конвейера изображений и оставшиеся этапы (`R4`–`R7`).
- [`docs/design/client-integrity.md`](./docs/design/client-integrity.md) — защита клиентского контура и конфигурация `kit.csp`.
