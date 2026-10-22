# modals-kit

Исходный репозиторий framework-neutral библиотек и эталонного приложения на **Svelte 5 (runes) + SvelteKit 2 + Vite + UnoCSS (Tailwind v4 preset) + PGlite / PostgreSQL**.

Все ключевые подсистемы построены по одному правилу: **чистое изоморфное ядро на TypeScript без зависимостей от UI-фреймворка + тонкий адаптер реактивности и роутера + работа как с JavaScript, так и при нативном HTTP без JavaScript (progressive enhancement)**. Переносимость ядер на другой стек проверена живой симуляцией на **React 19 + React Router v7** в [`sim/react-router/`](./sim/react-router/README.md).

---

## Состав репозитория

### 1. Библиотеки (`src/lib/`)

| Пакет (`#lib/*`) | Назначение | Документация |
|---|---|---|
| `#lib/modals` | Адресуемая стопка модальных слоёв, переговоры о возможностях среды, области видимости реестра, `svelte/`-хост | [`src/lib/modals/README.md`](./src/lib/modals/README.md) |
| `#lib/form` | Изоморфные формы без DOM: описание, валидаторы, конверт, слои сервера, `takeover` поля, `queued`-протокол, `svelte/`-связка | [`src/lib/form/README.md`](./src/lib/form/README.md) |
| `#lib/paginate` | Headless-пагинация (`single` / `accumulate`, URL / localStorage / cursor, якоря скролла, `patchItems`), подпакеты `filters` и `search` | [`src/lib/paginate/README.md`](./src/lib/paginate/README.md), [`filters`](./src/lib/paginate/filters/README.md), [`search`](./src/lib/paginate/search/README.md) |
| `#lib/db` | Серверный слой данных PostgreSQL / PGlite / Hyperdrive / Proxy: модели, политики, Standard Schema, keyset-курсоры, `defineSchema` sync | [`src/lib/db/README.md`](./src/lib/db/README.md), [`PORTING.md`](./src/lib/db/PORTING.md) |
| `#lib/address` | Единый писатель URL/history, глобальная бронь query-ключей и чтение видимого адреса поверх shallow-слоёв | [`src/lib/address/README.md`](./src/lib/address/README.md) |
| `#lib/fetch` | Надёжный `fetch` к внешним API: таймауты, ретраи с `Retry-After`, скользящие лимиты `rps`/`rpm`, склейка запросов, поток хода задачи | [`src/lib/fetch/README.md`](./src/lib/fetch/README.md) |
| `#lib/cache` | Контракт ключ–значение со сроками жизни, областями (`scope`), `singleflight` и атомарными `add`/`incr` | [`src/lib/cache/README.md`](./src/lib/cache/README.md) |
| `#lib/image` | Изоморфный конвейер изображений: чтение заголовков без декодирования (`probe`), обрезка/ресайз, подбор качества под бюджет байт, серверный WASM-декодер (`node.ts`) | [`src/lib/image/README.md`](./src/lib/image/README.md) |
| `#lib/task` | Единый формат состояния ожидания и прогресса (`TaskState`) для ссылок, кнопок и верхней полосы загрузки | [`src/lib/task/README.md`](./src/lib/task/README.md) |

### 2. Межбиблиотечные связки (`src/hooks/`)

Модули, соединяющие две независимые библиотеки без прямых импортов между их ядрами (подробно — [`src/hooks/README.md`](./src/hooks/README.md)):
- `src/hooks/cache-db.ts` — хранилище `#lib/cache` поверх таблицы `cache_kv` в `#lib/db` (`pgStore`).
- `src/hooks/db-form.ts` — вывод правил полей `#lib/form` из модели ресурса `#lib/db` (`formParams`).
- `src/hooks/component-form/` — маршрутно-независимый приём `POST` встраиваемых форм компонентов через SvelteKit `Handle` (`registerComponentForm`, `componentFormsHandle`, `bindComponentForm`).

### 3. Прикладные компоненты и домен пользователя

- `src/lib/components/` — UI-примитивы на Ark UI + CVA (`ui/`, включая `Attachment` и `FileAttachment`) и прикладные обвязки (`shell`, `header`, `sidebar`, `links`, `loader`, `modals`, `form` + `photo.ts`, `paginator`, `filters`, `steps`, `settings`, `demo`).
- `src/content/user/` — автономный модуль пользователя и авторизации по Ed25519 `seed`: доменное ядро (`auth.ts`, `profile.ts`, `acl.ts`, `keys.ts`, `gateway.ts`) и UI-компоненты под защитой `<Acl />` (`AuthWidget`, `MenuBody`, папочные модули `ui/seed-form/` и `ui/profile-form/` на бинарном `File`). Документация — [`src/content/user/README.md`](./src/content/user/README.md).
- `src/routes/` — витрины и интерактивные демо всех подсистем (`/modals`, `/form`, `/fields`, `/steps`, `/paginator`, `/db-demo`, `/user/auth`, `/user/menu`).

---

## Быстрый старт

Требуется **Node.js >= 22.17** (проверяется при старте `vite.config.ts`). База данных для разработки и тестов поднимается автоматически в памяти через WASM-движок `@electric-sql/pglite` — внешний PostgreSQL не нужен.

```bash
npm install
npm run dev          # http://localhost:5173
```

## Команды проверки

```bash
npm run check        # svelte-kit sync && svelte-check
npm test             # vitest (все юнит/интеграционные тесты) + стражи в tooling/
npm run build        # production-сборка (включая проверку layer-guard)
npm run test:browser # Playwright E2E-наборы в Chromium против production preview
```

---

## Документация проекта

- [`AGENTS.md`](./AGENTS.md) — правила репозитория, границы слоёв и соглашения для разработки.
- [`docs/plan.md`](./docs/plan.md) — сводный план проекта, закрытые вехи и открытые задачи.
- [`docs/audit/`](./docs/audit/README.md) — аудит кодовой базы, [реестр на тестирование (`testing-backlog.md`)](./docs/audit/testing-backlog.md), оценки и история устранения костылей.
- [`docs/design/port-plan.md`](./docs/design/port-plan.md) — план переноса на другой фреймворк/роутер.
- [`docs/design/image-transfer.md`](./docs/design/image-transfer.md) — архитектура бинарного конвейера изображений и оставшиеся этапы (`R4`–`R7`).
- [`docs/design/client-integrity.md`](./docs/design/client-integrity.md) — защита клиентского контура и настройка `kit.csp`.
