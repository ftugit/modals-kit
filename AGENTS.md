# Правила репозитория `modals-kit`

Этот файл дополняет общие инженерные правила конкретными ограничениями и архитектурными инвариантами репозитория `modals-kit`.

---

## 1. Среда и запуск

- **Версия Node.js**: строго **`>= 22.17 < 25`** (Node 22 или 24 LTS: `vite.config.ts` проверяет нижнюю границу при старте, а верхняя граница `<25` в `package.json#engines` не даёт облачным сборщикам вроде Vercel автоматически переключаться на неподдерживаемый в `@sveltejs/adapter-vercel` Node 26+). В контейнерах, где системный `node` старше, первым в `PATH` должен стоять каталог с Node 22/24 (`/opt/node22/bin` или `/usr/local/bin`).
- **WASM / PGlite и `--no-liftoff`**: не убирать `execArgv: ['--no-liftoff']`, `testTimeout: 15_000` и ограничение воркеров (`maxWorkers: 1` на малых машинах) в `vite.config.ts` и скриптах `package.json` — в песочницах с малым пулом исполняемых страниц Liftoff роняет воркеры PGlite по `SIGSEGV`, а холодная компиляция `pglite.wasm` через TurboFan занимает ~8–9 с.
- **Переменные сборки и превью**:
  - при `vite build` и `vite preview` с проверкой авторизации/хранилища передавать `AUTH_SEAL_ID` (строго буквенно-цифровой идентификатор без дефисов — требование `iron-webcrypto`, например `k1`), `AUTH_SEAL_SECRET`, `DB_CURSOR_SECRET`, `KIT_TRUSTED_ORIGINS` и `PREVIEW_PORTS`;
  - `npm run build` выполняет `vite build && node tooling/db-reset.mjs` (очистка схемы `public` внешней базы на этапе сборки только при явном `DATABASE_RESET=1`; сами модели, сиды и стартовый администратор разворачиваются в рантайме при первом обращении к БД);
  - единый список доверенных origin и директивы `kit.csp` (`cspDirectives`, `appHtmlScriptHashes`) собираются в чистом модуле `src/server/trusted-origins.ts`. Внешние шрифты Google Fonts полностью запрещены — используется системный стек `ui-sans-serif, system-ui, sans-serif`.
- **Браузерные тесты**:
  - основные E2E-наборы (`npm run test:browser` — `regressions.mjs`, `modals.mjs`, `shell.mjs`, `steps.mjs`, `forms.mjs`, `forms-a11y.mjs`, `db-demo.mjs`, `fields.mjs`, `paginate.mjs`, `capabilities.mjs`, `errors.mjs`, `a11y.mjs`, `loader.mjs`, `auth.mjs`, `blocks.mjs`, `layer-back.check.mjs`, `url-storage.check.mjs`) запускаются против собранного превью (`vite build` → `vite preview --port 5173 --strictPort`);
  - наборы, которым нужны секреты среды (`AUTH_SEAL_SECRET` для `auth.mjs` и `blocks.mjs`, `DB_CURSOR_SECRET` для курсорной части `url-storage.check.mjs` и `db-demo.mjs`), сами печатают `SKIP` с причиной — зелёный прогон без них означает «проверка не выполнялась», а не «всё хорошо»;
  - живые внешние API — отдельной командой `npm run test:browser:live` (`shikimori.mjs`, `rickmorty.mjs`);
  - компонентный браузерный прогон вложения `test/browser/attachment.mjs` запускается против живого `vite dev` с `ATTACHMENT_BASE="http://127.0.0.1:<port>/fields"`.

---

## 2. Пятислойная архитектура и subpath-алиасы (`package.json`)

Импорты между слоями идут строго сверху вниз и проверяются на этапе dev/build плагином `tooling/layer-guard.mjs`:

1. **`#lib/*` → `./src/lib/*` (независимые библиотеки + их фреймворковые адаптеры)**:
   - пакеты `address`, `assets`, `cache`, `db`, `fetch`, `form`, `image`, `modals`, `paginate`, `storage`, `task`;
   - в чистых ядрах запрещены импорты `svelte`, `@sveltejs/kit`, `$app/*`, соседних пакетов и любых верхних слоёв (`tooling/core-purity.mjs` + `tooling/layer-guard.mjs`); адаптеры реактивности и роутера живут внутри своего пакета (`svelte/`, `sveltekit/`, `cores/sveltekit.ts`, `node.ts`);
   - **публичный вход пакета объявлен**: снаружи `src/lib/<pkg>/` допустимы только спецификаторы из `src/lib/<pkg>/entrypoints.json` (нет манифеста — только `index.js`). Проверка — `node tooling/public-api.mjs` (+ `tooling/public-api.test.mjs`).
2. **`#hooks/*` → `./src/hooks/*` (межбиблиотечные и фреймворковые связки без UI)**:
   - соединяет две библиотеки или библиотеку и среду (`cache-db.ts`, `storage-db.ts`, `storage-schema.ts`, `module-ext.ts`, `db-form.ts`, `db-grants.svelte.ts`, `db-schema.ts` + `db-schema.server.ts`, `schema-route.ts`, `api-error.ts`, `app-errors.svelte.ts`, `js-only.svelte.ts`, `loader.svelte.ts`, `use-drawer.svelte.ts`, `graphql.server.ts`, `task-stream.server.ts`, папочные `links/`, `cookie-vault/` и `component-form/`); см. [`src/hooks/README.md`](./src/hooks/README.md).
3. **`#components/*` → `./src/components/*` (переиспользуемые UI-примитивы и проектно-независимые виджеты)**:
   - `ui/` ([`src/components/ui/README.md`](./src/components/ui/README.md)), `shell/` ([`src/components/shell/README.md`](./src/components/shell/README.md)), `steps/` ([`src/components/steps/README.md`](./src/components/steps/README.md)), `loader/` ([`src/components/loader/README.md`](./src/components/loader/README.md)), `settings/`, `demo/`, `form/` (включая `messages.ru.ts`), `fields/`, `paginator/`, `modals/`, `db-schema/`, `ErrorPage.svelte`, `Error500.svelte`, `utils.ts`;
   - компоненты не импортируют `#content/*`, `#server/*` и `src/routes/*` — доменные маршруты и пункты навигации передаются через пропы и слоты.
4. **`#content/*` → `./src/content/*` (доменные модули ядра и подключаемые пакеты `npm run mod`)**:
   - `src/content/user/` — автономный модуль пользователя (`routes.ts`, `modals.ts`, `schema.ts`, `grants.svelte.ts`, `gateway.server.ts`, ядро и `ui/*`: вход, профиль, настройки `user-config`, список аккаунтов, пикер и блокировки `user.block`);
   - `src/content/storage-servers/` — управление боевым пулом серверов хранения в БД (`STORAGE_ACL`, `form.ts`, `storage-server.form.server.ts`, `modals.ts`, `routes.ts`, `ui/*`);
   - опциональный пакет `demo` (`npm run mod -- add demo` / `MODULES=demo`): добавляет `src/content/storage-vault/` (куки-сейф серверов S3 / WebDAV для `/upload-demo`) и `src/content/demo-catalog/{items,posts,rickmorty,shikimori}/` с автоподхватываемыми `db.ext.ts`, `init.ext.server.ts` и `nav.ext.ts`.
5. **`#server/*` → `./src/server/*` и `src/routes/*` (серверные синглтоны и композиция приложения)**:
   - все строго серверные модули вне `routes/+*.server.ts` носят суффикс `*.server.ts` (`db.server.ts`, `cache.server.ts`, `app-storage.server.ts`, `storage-probe.server.ts`, `form-budget.server.ts`, `form-security.server.ts`, `live-cache.server.ts`, `fetch.server.ts`, `ws-upgrade.server.ts`, `vite-ws.server.ts`, `after-response.server.ts`, `api-error.server.ts`; при установленном `demo` — `storage.server.ts`) и не могут импортироваться в клиентский/изоморфный код;
   - `src/server/trusted-origins.ts` импортируется в `vite.config.ts` до инициализации SvelteKit и не должен тянуть `$app/*`, `$env/*` или `node:*`;
   - `src/hooks.server.ts` выступает точкой композиции (`dbHandle` + `createComponentFormsHandle(import.meta.glob('./**/*.form.server.ts'))`).

---

## 3. Ключевые контракты подсистем

- **Адрес, шаги и реестр маршрутов (`#lib/address` + `#components/steps`)**:
  - запись и чтение клиентского URL — только через `#lib/address/sveltekit.js` (`writeAddress`, `visibleAddress`, `kitRoute`) и `registerRoute` / `querySchema` (`#lib/address/routes.js`). Прямые `history.pushState`/`replaceState`, чтение `page.url` и `goto` вне разрешённых примитивов запрещены;
  - служебные шаги в `useSteps` (квитанция, подтверждение), которым не нужна перезагружаемая ссылка `?step=…`, помечаются `addressable: false`.
- **Метаданные и заголовки страниц (`#components/shell`)**:
  - заголовки `<title>`, `meta[name="description"]`, `og:*` и `robots` выставляются на всех маршрутах и в модалках исключительно через стековый `useHeadSeo` (`PageHead.svelte` монтируется один раз в корневом `+layout.svelte`, без дублирования `<svelte:head>` на страницах).
- **Формы и контролы (`#lib/form` + `#components/form` + `#hooks/component-form`)**:
  - разметка форм и контролов — только через `<Form>` (`#lib/form/svelte/index.js`), `<Field>` (`#components/form/`) и примитивы `#components/ui/index.js` / `#components/settings/index.js`. Сырые `<form>`, `<input>`, `<select>`, `<textarea>`, ручные `type="hidden"` и рукописные `name="..."` вне кита запрещены;
  - `defineForm` является единой точкой описания `budget`, `limits`, `checks` и `invalidFrom`; ядро `#lib/form` несёт английский словарь `en`, а русский словарь приложения подключён в `src/components/form/messages.ru.ts` (`forms.config.ts`);
  - `createComponentFormsHandle` опознаёт JS-запросы по `x-form-id` без лишней буферизации, читает нативные POST в один проход без `request.clone()`, при превышении `FORM_BODY_LIMIT` отдаёт штатный `Result` со статусом `413` как в JSON, так и на SSR без JS, а для `outcome === 'queued'` без JS по умолчанию выполняет `303 See Other` на `statusUrl`;
  - вес `src/lib/form/**` зафиксирован `tooling/form-size.mjs`.
- **Модель прав и пользовательский контур (`#lib/db` + `#hooks/db-grants.svelte.js` + `#content/user`)**:
  - роли и права не разделяются искусственно: оба вида грантов являются непустыми строковыми токенами, объявляются в моделях через `defineAcl` (проверяются `validateResourceAcl`), вычисляются на сервере через `checkGrants(actor, grants(resource), { ownerId })` и реактивно в UI через `useGrants`;
  - `<Acl />` (`src/content/user/ui/Acl.svelte`) покрывает полный набор `AuthErrorCode` и отказов `#lib/db`;
  - в `<SeedForm />` проп `authorize` разводит открытие сессии (`true`) и изолированную проверку владения `seed` через `verifySeed` без выдачи/смены кук (`false`, срез `'confirm'`).
- **Хранилище и изображения (`#lib/storage` + `#lib/image` + `app-storage.server.ts`)**:
  - по сети передаются только бинарные `File` в `multipart/form-data` или по потоковому `wss://` (`/api/form-upload`), а готовые аватары хранятся в боевом хранилище `appStorage` и раздаются неизменяемыми ссылками `/api/storage/avatars/…` с изолирующим `Content-Security-Policy: default-src 'none'; sandbox` и немедленным удалением старого файла при замене/удалении профиля; конвертация файлов целиком в `base64` запрещена `layer-guard`;
  - не менять браузерное умолчание `decodeWithBrowser` в `src/lib/image/decode.ts`; на сервере явно передавать `{ decoder: decodeWithNode }` из `#lib/image/node.js`.
- **Документация `#lib/db`**:
  - при любых изменениях в `src/lib/db/**` или переносах упомянутых файлов держать зелёным живой аудит документации — `vitest run src/lib/db/test/db-docs.test.ts` и `node --test tooling/db-docs.test.mjs`.

---

## 4. README рядом с кодом

README пакета — часть изменения, а не сопроводительный файл.

**Где они лежат.** `src/lib/*`, `src/components/{loader,shell,steps,ui}`, `src/hooks`, `src/content/{user,storage-servers}`. Отдельно — документы слоя БД: `src/lib/db/{PORTING.md,docs/*.md}` (под правило README не попадают, но устаревать не должны). Пары «папка → подпапка со своим README»: `src/hooks/` → `src/hooks/links/`, `src/lib/paginate/` → `src/lib/paginate/filters/` и `src/lib/paginate/search/`.

1. **README ищется вверх от файла:** ближайший обязателен. Подпапка без своего README — часть README выше (`src/lib/form/svelte/*` → `src/lib/form/README.md`).
2. **Область README кончается над папкой со своим README.** Правил `src/lib/paginate/search/fuzzy.ts` — отвечает `src/lib/paginate/search/README.md`; `src/lib/paginate/README.md` — только если поменялся состав папок, публичный вход (`index.ts`) или общие контракты.
3. **Прочитай README до правки:** он описывает контракт, который ты меняешь.
4. **Поменял поведение, публичный API, опции, числа бюджетов** (`tooling/form-size.mjs`, `tooling/size-budget.mjs`) **или соглашение** — правь README в том же коммите, на языке файла.
5. **Контракт не менялся** (багфикс, рефакторинг, тесты, комментарии) — текст не переписывай ради галочки; в тело коммита добавь строку `README <путь>: проверен, правок нет`.
6. **README рядом нет** (`src/routes/`, `src/server/`, `src/content/<модуль>/ui/*`) — ничего не требуется.
