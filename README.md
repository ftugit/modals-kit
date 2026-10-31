# modals-kit

Исходный репозиторий framework-neutral библиотек и эталонного приложения на **Svelte 5 (runes) + SvelteKit + Vite 8 + UnoCSS (Tailwind v4 preset) + PGlite / PostgreSQL**.

Все ключевые подсистемы построены по одному правилу: **чистое изоморфное ядро на TypeScript без зависимостей от UI-фреймворка + тонкий адаптер реактивности и роутера + полноценная работа как с JavaScript, так и при нативном HTTP без JavaScript (progressive enhancement)**. Переносимость ядер на другой стек доказана живой симуляцией на **React 19 + React Router v7** в [`sim/react-router/`](./sim/react-router/README.md).

---

## Состав репозитория (5 верхних слоёв)

### 1. Библиотеки (`src/lib/` — `#lib/*`)

| Пакет (`#lib/*`) | Назначение | Документация |
|---|---|---|
| `#lib/modals` | Адресуемая стопка модальных слоёв, переговоры о возможностях среды, области видимости реестра, инвалидация кэша загрузчиков (`invalidateLoader`), `svelte/`-хост и `cores/sveltekit.ts` | [`src/lib/modals/README.md`](./src/lib/modals/README.md) |
| `#lib/form` | Изоморфные формы без DOM: единое описание `defineForm` (`budget`, `limits`, `checks`, `invalidFrom`), валидаторы, конверт, слои сервера, `takeover` поля, `queued`-протокол и `svelte/`-связка | [`src/lib/form/README.md`](./src/lib/form/README.md) |
| `#lib/paginate` | Headless-пагинация (`single` / `accumulate`, URL / localStorage / cursor, якоря скролла, `patchItems`), подпакеты `filters` и `search` | [`src/lib/paginate/README.md`](./src/lib/paginate/README.md), [`filters`](./src/lib/paginate/filters/README.md), [`search`](./src/lib/paginate/search/README.md) |
| `#lib/db` | Серверный слой данных PostgreSQL / PGlite / Hyperdrive / Proxy: модели, пирамида прав `defineAcl` (`validateResourceAcl`, `grants`, `checkGrants`, `forOwner`), Standard Schema, keyset-курсоры, `exists`-фильтры и `defineSchema` sync | [`src/lib/db/README.md`](./src/lib/db/README.md), [`PORTING.md`](./src/lib/db/PORTING.md) |
| `#lib/address` | Единый писатель URL/history, глобальная бронь query-ключей, чтение видимого адреса и типизированный реестр маршрутов (`routes.ts`, `kitRoute`) | [`src/lib/address/README.md`](./src/lib/address/README.md) |
| `#lib/fetch` | Надёжный `fetch` к внешним API: таймауты, ретраи с `Retry-After`, скользящие лимиты `rps`/`rpm`, склейка запросов, поток хода задачи | [`src/lib/fetch/README.md`](./src/lib/fetch/README.md) |
| `#lib/cache` | Контракт ключ–значение со сроками жизни, областями (`scope`), `singleflight` и атомарными `add`/`incr` | [`src/lib/cache/README.md`](./src/lib/cache/README.md) |
| `#lib/storage` | Мультисерверное потоковое хранилище без буферизации в ОЗУ: `local` / `S3` / `WebDAV` / `memory`, нарезка `split` со склейкой `Range 206`, потоковое `AES-256-GCM`, лимитеры `rate` и `concurrency`, сильный `ETag` под авто-докачку `If-Range`, `upload()` и изолирующий `serve()` | [`src/lib/storage/README.md`](./src/lib/storage/README.md) |
| `#lib/image` | Изоморфный конвейер изображений: чтение заголовков без декодирования (`probe`), обрезка/ресайз, подбор качества под бюджет байт, серверный WASM-декодер (`node.ts`) | [`src/lib/image/README.md`](./src/lib/image/README.md) |
| `#lib/task` | Единый формат состояния ожидания и прогресса (`TaskState`) для ссылок, кнопок и верхней полосы загрузки | [`src/lib/task/README.md`](./src/lib/task/README.md) |
| `#lib/assets` | Пакет-ассеты (не код): единственный вход `favicon.svg`, объявленный в `entrypoints.json`; иконка подключается в `src/routes/+layout.svelte` | — (`entrypoints.json`) |

### 2. Связки со средой и между библиотеками (`src/hooks/` — `#hooks/*`)

Переходники без визуальной разметки (подробно — [`src/hooks/README.md`](./src/hooks/README.md)):
- `cache-db.ts` (`#lib/cache` × `#lib/db` → `sharedStore` в `public.cache_kv`), `storage-db.ts` (`#lib/storage` × `#lib/db` × `#lib/cache`), `storage-schema.ts` (`STORAGE_ACL` и модель `storage_server` без серверного рантайма для клиентских проверок прав), `module-ext.ts` (контракты автоподхватываемых расширений опциональных модулей `DbModuleExtension` и `NavModuleExtension`), `db-grants.svelte.ts` (реактивный хук `createUseGrants` поверх `grants` и `checkGrants`), `cookie-vault/` (зашифрованные `HttpOnly`-куки × `#lib/form`), `db-form.ts` (`#lib/db` × `#lib/form`), `db-schema.ts` (+ `db-schema.server.ts`, `schema-route.ts`) — экран переноса схемы `/schema`, `api-error.ts`, `graphql.server.ts`, `task-stream.server.ts`;
- `links/` (`asLink`, `asModalLink`), `loader.svelte.ts`, `js-only.svelte.ts`, `use-drawer.svelte.ts`, `app-errors.svelte.ts`;
- `component-form/` — маршрутно-независимые формы компонентов через `createComponentFormsHandle` и `bindComponentForm`: маршрутизация по `x-form-id`, однопроходный контроль бюджета тела (`FORM_BODY_LIMIT` и `limits.budget`) с полноценным `Result` `413` как в JSON, так и на SSR без JS, штатный `303` на `statusUrl` для `queued`-задач без JS и потоковый конвейерный `wss://`-транспорт файлов с прогнозом времени (`upload-eta.ts`) и целостностью `HMAC-SHA-256`.

### 3. UI-примитивы и проектно-независимые компоненты (`src/components/` — `#components/*`)

- `src/components/ui/` — единая система примитивов на Ark UI + CVA (`variants`) + UnoCSS на системном стеке шрифтов без внешних запросов к Google Fonts, включая `Attachment`, `FileAttachment`, `HoldButton`, `PasswordInput`, `RadioGroup` и `Range` (правила слоя — [`src/components/ui/README.md`](./src/components/ui/README.md));
- `src/components/shell/` — каркас приложения (`AppShell`, `CollapsingHeader`) и реактивный стековый контур метаданных `useHeadSeo` / `PageHead` / `PageTitleSlot` (документация — [`src/components/shell/README.md`](./src/components/shell/README.md));
- `src/components/steps/` — хост шагов `useSteps` (`url` / `local` / `hybrid`), неадресуемые служебные шаги `addressable: false` и форм-режим `formSteps` (документация — [`src/components/steps/README.md`](./src/components/steps/README.md));
- `src/components/{modals,form,fields,paginator,settings,demo,db-schema,loader}/` — прикладные компонентные модули (включая русский словарь системных сообщений формы `src/components/form/messages.ru.ts`).

### 4. Контент и домены (`src/content/` — `#content/*`)

- `src/content/user/` — автономный модуль пользователя и авторизации по Ed25519 `seed`: пирамида прав `defineAcl` и реактивный `useGrants`, вход и сессии (`SeedForm`), профиль с аватарами по неизменяемым ссылкам `/api/storage/avatars/…` (`Profile`, `ProfileForm`, `ProfileDelete`), универсальные пользовательские и системные настройки (`UserConfig`: модалка `user.config` + `/user/config` и `/user/[id]/config`), список аккаунтов и пикер (`SeedUsersList`, `UserPicker`) и система блокировок `user.block` (`BlocksList`, `BlockForm` с одиночной и массовой выдачей, `BlockDelete`). Документация — [`src/content/user/README.md`](./src/content/user/README.md);
- `src/content/storage-servers/` — администрирование боевого пула серверов хранения в БД (`storage_server` под `STORAGE_ACL`, шифрование ключей `AUTH_SEAL_SECRET`, живая предпроверка `probe` с защитой от SSRF, модалка `storage.servers` и страница `/storage-servers`). Документация — [`src/content/storage-servers/README.md`](./src/content/storage-servers/README.md);
- опциональный модуль `demo` (устанавливается поверх чистого ядра через `npm run mod -- add demo` или переменную окружения `MODULES=demo` при сборке): добавляет `src/content/demo-catalog/` (`items`, `posts`, `rickmorty`, `shikimori` + автоподхватываемые `db.ext.ts`, `init.ext.server.ts`, `nav.ext.ts`), `src/content/storage-vault/` и интерактивные витрины `/modals`, `/paginator`, `/db-demo`, `/upload-demo`, `/form`, `/fields`, `/steps`.

### 5. Серверные синглтоны и маршруты (`src/server/` — `#server/*`, `src/routes/`)

- `src/server/` — строго серверные синглтоны `*.server.ts` (`db.server.ts`, `cache.server.ts`, `app-storage.server.ts`, `storage-probe.server.ts`, `form-budget.server.ts`, `form-security.server.ts`, `live-cache.server.ts`, `fetch.server.ts`, `ws-upgrade.server.ts`, `vite-ws.server.ts`, `after-response.server.ts`, `api-error.server.ts`) и чистый модуль `trusted-origins.ts` (единый список `csrf.trustedOrigins` + строгие директивы `kit.csp`);
- `src/routes/` — базовые маршруты стартового приложения (`/`, `/schema`, `/storage-servers`, `/users`, `/users/pick`, `/users/filters`, `/blocks`, `/blocks/new`, `/blocks/filters`, `/blocks/[blockId=uuid]`, `/user/auth`, `/user/menu`, `/user/config`, `/user/[id=uuid]`, `/api/storage/[...path]`, `/api/form-upload`). При установке модуля `demo` автоматически подключаются маршруты витрин (`/modals`, `/form`, `/fields`, `/steps`, `/paginator`, `/db-demo`, `/upload-demo`, `/cards/[id]`, `/cycle`, `/spike`, `/api/db-posts`, `/api/files/[...path]`, `/api/shikimori/*`, `/api/rickmorty/*`).

---

## Быстрый старт

Требуется **Node.js >= 22.17 и < 25** (Node 22 или 24 LTS; проверяется при старте `vite.config.ts` и ограничено сверху в `package.json#engines` для совместимости с адаптерами деплоя). База данных для разработки и тестов поднимается автоматически через WASM-движок `@electric-sql/pglite` — внешний PostgreSQL не нужен; схема моделей и стартовый администратор разворачиваются автоматически при первом обращении к БД в рантайме.

```bash
npm install
npm run dev                   # чистое стартовое приложение: http://localhost:5173
```

### Подключение `demo` и работа с модулями (`tooling/mod.mjs`)

Ветка `img` содержит чистое стартовое приложение без демо-маршрутов. Дополнительные пакеты (включая интерактивную витрину `demo`) публикуются в тег `refs/tags/modules` (без создания отдельных веток в репозитории) и управляются встроенным zero-dependency менеджером `tooling/mod.mjs` (`npm run mod`).

#### 1. Локальная работа с модулем `demo` и другими пакетами

```bash
npm run mod -- list               # показать доступные модули в источнике и отметить установленные
npm run mod -- status             # показать локально установленные модули (офлайн, мгновенно)
npm run mod -- add demo           # скачать и установить модуль demo поверх чистого ядра
npm run mod -- remove demo        # чисто удалить файлы модуля demo и пустые директории
npm run mod -- remove demo -f     # принудительно удалить даже при наличии локальных правок
npm run mod -- sync               # синхронизировать набор модулей по переменной MODULES
```

Как ведёт себя менеджер локально:
- список установленных файлов и их `SHA-256`-хэши записываются в `.modules/installed.json` (папка `.modules/` добавлена в `.gitignore`, поэтому рабочее дерево проекта легко вернуть к чистому состоянию командой `npm run mod -- remove demo`);
- перед установкой проверяются конфликты: если целевой файл уже существует и отличается по содержимому от пакета, установка прервётся до записи на диск (перезапись — только с `--force`);
- перед удалением проверяется целостность: если файл установленного модуля был изменён локально, `remove` сохранит правки и сообщит список затронутых файлов (принудительный сброс — `--force`);
- все проверки проекта (`npm run check`, `npm test`, `npm run test:guard`, `npm run build`, `npm run test:browser`) работают в обоих режимах: без модулей проверяется базовое ядро (`auth`, `blocks`), а с установленным `demo` автоматически подключаются все витринные юнит-тесты и браузерные E2E-сьюты (`modals`, `paginator`, `db-demo`, `forms`, `fields`, `steps` и др.).

#### 2. Переменные окружения и автоматическая установка при сборке (Vercel / CI)

Команда `npm run build` запускает `node tooling/mod.mjs sync` перед `vite build`. Переменные читаются с приоритетом `process.env > .env.local > .env`:

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `MODULES` | Список модулей через запятую или пробел (`demo`, `demo, extra`). Значения `none` / `""` снимают все установленные модули. Если переменная **не задана вообще**, `sync` ничего не меняет и не обращается к сети | *(не задана — no-op)* |
| `MODULES_TOKEN` | GitHub Fine-Grained PAT с правом `Contents: Read` для приватного репозитория (передаётся через `Authorization: Bearer` к `api.github.com`). Для публичного репозитория не нужен | *(пусто)* |
| `MODULES_REPO` | Репозиторий-источник в формате `owner/repo` | `${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}`, иначе `git remote origin`, иначе `ftugit/modals-kit` |
| `MODULES_REF` | Имя Git-тега или ветки с пакетами модулей | `modules` (`refs/tags/modules`) |
| `MODULES_SOURCE` | Локальная папка, локальный `.tar.gz`-архив или прямой `https://`-URL архива (для офлайн-разработки и отладки собственных модулей до публикации) | *(пусто)* |

Настройка деплоя на **Vercel**:
- **С витриной `demo`**: в *Project Settings → Environment Variables* задайте `MODULES=demo` для окружений *Production* / *Preview* (с доступностью на этапе *Build*). Если репозиторий переведён в **Private**, добавьте `MODULES_TOKEN` (Fine-Grained PAT только на этот репозиторий с правом `Repository permissions → Contents: Read-only`).
- **Чистое стартовое приложение без витрин**: оставьте `MODULES` незаданной (или укажите `MODULES=none`) — сборка пройдёт за `0` сетевых запросов к архиву модулей.

#### 3. Точки расширения ядра и создание собственных модулей

Модули подключаются **бесконфликтно** — путём добавления файлов в дерево проекта без редактирования файлов ядра. Ядро автоматически подхватывает установленные модули через контракты `src/hooks/module-ext.ts` и `import.meta.glob`:

| Файл внутри модуля | Что подключает автоматически |
|---|---|
| `src/content/<domain>/db.ext.ts` | Экспорт `dbExtension: DbModuleExtension` (`resources`, `sql`) — добавляет модели `#lib/db` и SQL-миграции/индексы в общую схему `src/server/db.server.ts` |
| `src/content/<domain>/init.ext.server.ts` | Экспорт `initDbExtension(db)` — выполняется один раз при инициализации схемы БД в рантайме (стартовые сиды и справочники модуля) |
| `src/content/<domain>/nav.ext.ts` | Экспорт `navExtension: NavModuleExtension` (`order`, `navItems`, `homeCards`) — добавляет пункты в шапку/боковое меню и карточки разделов на главную страницу `/` |
| `src/content/<domain>/modals.ts` | Регистрирует глобальные модальные окна модуля в `globalScope` (автоимпорт в `src/routes/(site)/+layout.svelte`) |
| `src/**/*.form.server.ts` | Регистрирует серверные обработчики форм по `x-form-id` через `createComponentFormsHandle` в `src/hooks.server.ts` |
| `src/routes/**` и `test/browser/*.mjs` | Добавляет страницы, раскладки и API-эндпоинты SvelteKit, а также браузерные E2E-сьюты (подхватываются `test/browser/run-all.mjs` по наличию файла) |

Структура пакета в источнике модулей (`refs/tags/modules` или локальном `MODULES_SOURCE`):

```text
modules/
  <module-name>/
    manifest.json          # { "name": "demo", "version": "1.0.0", "description": "..." }
    files/                 # файлы модуля по их точным путям относительно корня проекта
      src/content/...
      src/routes/...
      test/browser/...
```

Отладка нового модуля локально и публикация в тег `refs/tags/modules` без создания лишней ветки:

```bash
# 1. Проверить установку и удаление из локальной папки со структурой modules/<name>/...
MODULES_SOURCE=/path/to/modules-stage npm run mod -- list
MODULES_SOURCE=/path/to/modules-stage npm run mod -- add <name>

# 2. Опубликовать обновлённое дерево модулей орфан-коммитом прямо в тег refs/tags/modules
GIT_DIR_ABS="$(pwd)/.git"
TREE=$(GIT_DIR="$GIT_DIR_ABS" GIT_WORK_TREE=/path/to/modules-stage GIT_INDEX_FILE=/tmp/mod.idx \
  sh -c 'rm -f /tmp/mod.idx && git add -A && git write-tree')
rm -f /tmp/mod.idx
COMMIT=$(printf 'chore(modules): update modules snapshot\n' | git commit-tree "$TREE")
git update-ref refs/tags/modules "$COMMIT"
git push origin refs/tags/modules:refs/tags/modules --force
```

## Команды проверки

```bash
npm run test:guard   # стражи границ слоёв, чистоты ядер, публичных входов, форм и документации БД
npm run test:classes # аудит классов UnoCSS и запрет маркер-классов
npm run check        # svelte-kit sync && svelte-check (0 errors, 0 warnings)
npm test             # полный прогон vitest + стражи в tooling/
npm run build        # production-сборка (включая layer-guard, kit.csp и инициализацию БД)
npm run test:size    # проверка gzip-бюджетов всех чанков и начальной загрузки маршрутов
npm run test:browser # Playwright E2E-наборы в Chromium против production preview
```

---

## Документация проекта

- [`AGENTS.md`](./AGENTS.md) — правила репозитория, границы 5 слоёв и контракты подсистем.
- [`src/components/ui/README.md`](./src/components/ui/README.md) — правила слоя UI-примитивов (`*Variants`, `field.ts`, иконки, баррель и глубокие импорты).
- [`src/components/shell/README.md`](./src/components/shell/README.md) — каркас оболочки, слоты шапки и реактивный стек метаданных `useHeadSeo`.
- [`src/hooks/README.md`](./src/hooks/README.md) — каталог межбиблиотечных и фреймворковых связок.
- [`src/content/user/README.md`](./src/content/user/README.md) — модуль пользователя: вход по `seed`, `defineAcl` / `useGrants`, профиль, настройки `UserConfig` и блокировки `user.block`.
- [`src/content/storage-servers/README.md`](./src/content/storage-servers/README.md) — боевой пул серверов хранения в БД (`STORAGE_ACL`, шифрование ключей, `probe` и UI управления).
- [`docs/pending.md`](./docs/pending.md) — **единственный** список незакрытого: что ещё требует кода и почему.
- [`docs/design/image-transfer.md`](./docs/design/image-transfer.md) — конвейер изображений и хранение аватаров по неизменяемым ссылкам.
- [`docs/design/client-integrity.md`](./docs/design/client-integrity.md) — защита клиентского контура, отказ от сторонних шрифтов и конфигурация `kit.csp`.
- [`docs/design/errors.md`](./docs/design/errors.md) — ошибки: контракт «код + текст» и вынос словарей локали в UI-слой.
- [`docs/design/porting.md`](./docs/design/porting.md) — как ядро переносится на другой фреймворк/роутер.
- [`docs/review-test-speedup-2026-10-31.md`](./docs/review-test-speedup-2026-10-31.md) — проверка плана ускорения тестов замерами: что подтвердилось, где дешевле (60 s в `db-demo` — выжигание таймаутов).
