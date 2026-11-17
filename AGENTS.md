# Правила репозитория `modals-kit`

Этот файл дополняет общие инженерные правила конкретными ограничениями и архитектурными инвариантами репозитория `modals-kit`.

---

## 1. Среда и запуск

- **Версия Node.js**: строго **`>= 22.17 < 25`** (Node 22 или 24 LTS: `vite.config.ts` проверяет нижнюю границу при старте, а верхняя граница `<25` в `package.json#engines` не даёт облачным сборщикам вроде Vercel автоматически переключаться на неподдерживаемый в `@sveltejs/adapter-vercel` Node 26+). В контейнерах, где системный `node` старше, первым в `PATH` должен стоять каталог с Node 22/24 (`/opt/node22/bin` или `/usr/local/bin`).
- **WASM / PGlite и `--no-liftoff`**: не убирать `execArgv: ['--no-liftoff']`, `testTimeout: 15_000` и ограничение воркеров (`maxWorkers: 1` на малых машинах) в `vite.config.ts` и скриптах `package.json` — в песочницах с малым пулом исполняемых страниц Liftoff роняет воркеры PGlite по `SIGSEGV`, а холодная компиляция `pglite.wasm` через TurboFan занимает ~8–9 с.
- **Переменные сборки и превью**:
  - при `vite build` и `vite preview` с проверкой авторизации/хранилища передавать `AUTH_SEAL_ID` (строго буквенно-цифровой идентификатор без дефисов — требование `iron-webcrypto`, например `k1`), `AUTH_SEAL_SECRET`, `DB_CURSOR_SECRET`, `KIT_TRUSTED_ORIGINS` и `PREVIEW_PORTS`;
  - `npm run build` — это `node tooling/platform.mjs`. Площадку задаёт только `KIT_ADAPTER=node|vercel|cloudflare`; без неё сборка и `npm run check` останавливаются (`svelte-kit sync` загружает конфигурацию Vite). Скрипт сборки синхронизирует модули, запускает `vite build` и на Node/Vercel вызывает `db-reset.mjs` (очистка схемы `public` только при явном `DATABASE_RESET=1`; на Cloudflare этот флаг запрещён). Модели, сиды и стартовый администратор разворачиваются в рантайме при первом обращении к БД;
  - единый список доверенных origin и директивы `kit.csp` (`cspDirectives`, `appHtmlScriptHashes`) собираются в чистом модуле `src/core/server/trusted-origins.ts`. Внешние шрифты Google Fonts полностью запрещены — используется системный стек `ui-sans-serif, system-ui, sans-serif`.
- **Браузерные тесты**:
  - полный набор E2E (`npm run test:browser` — `regressions.mjs`, `modals.mjs`, `shell.mjs`, `steps.mjs`, `forms.mjs`, `forms-a11y.mjs`, `db-demo.mjs`, `fields.mjs`, `paginate.mjs`, `capabilities.mjs`, `errors.mjs`, `a11y.mjs`, `loader.mjs`, `auth.mjs`, `blocks.mjs`, `layer-back.check.mjs`, `url-storage.check.mjs` и stage-пробы) запускается против собранного превью. Сам runner не собирает проект и не проверяет свежесть сборки: перед локальным запуском выполнить `KIT_ADAPTER=node npm run build`, затем `KIT_ADAPTER=node npm run test:browser`. Уже доступный внешний сервер задаётся через `MODALS_ORIGIN`; `MODALS_BASE` относится к отдельным сьютам. `KT_SKIP_BUILD` не используется. `run-all.mjs` берёт только файлы, которые реально лежат в дереве: сьюты демо появляются после `npm run mod -- add demo`, в чистом ядре их нет;
  - наборы, которым нужны секреты среды (`AUTH_SEAL_SECRET` для `auth.mjs` и `blocks.mjs`, `DB_CURSOR_SECRET` для курсорной части `url-storage.check.mjs` и `db-demo.mjs`), сами печатают `SKIP` с причиной — зелёный прогон без них означает «проверка не выполнялась», а не «всё хорошо»;
  - живые внешние API — отдельной командой `npm run test:browser:live` (`shikimori.mjs`, `rickmorty.mjs`);
  - компонентный браузерный прогон вложения `test/browser/attachment.mjs` запускается против живого `vite dev` с `ATTACHMENT_BASE="http://127.0.0.1:<port>/fields"`.

---

## 2. Слоистая архитектура и subpath-алиасы (`package.json`)

Импорты между слоями идут строго сверху вниз и проверяются на этапе dev/build плагином `tooling/layer-guard.mjs`:

1. **`#core/lib/*` → `./src/core/lib/*` (независимые библиотеки + их фреймворковые адаптеры)**:
   - пакеты `address`, `assets`, `cache`, `db`, `fetch`, `form`, `image`, `modals`, `paginate`, `storage`, `task`;
   - в чистых ядрах запрещены импорты `svelte`, `@sveltejs/kit`, `$app/*`, соседних пакетов и любых верхних слоёв (`tooling/core-purity.mjs` + `tooling/layer-guard.mjs`); адаптеры реактивности и роутера живут внутри своего пакета (`svelte/`, `sveltekit/`, `cores/sveltekit.ts`, `node.ts`);
   - **публичный вход пакета объявлен**: снаружи `src/core/lib/<pkg>/` допустимы только спецификаторы из `src/core/lib/<pkg>/entrypoints.json` (нет манифеста — только `index.js`). Проверка — `node tooling/public-api.mjs` (+ `tooling/public-api.test.mjs`).
2. **`#core/hooks/*` → `./src/core/hooks/*` (межбиблиотечные и фреймворковые связки без UI)**:
   - соединяет две библиотеки или библиотеку и среду (`cache-db.ts`, `storage-db.ts`, `storage-schema.ts`, `module-ext.ts`, `db-form.ts`, `db-grants.svelte.ts`, `db-schema.ts` + `db-schema.server.ts`, `schema-route.ts`, `api-error.ts`, `app-errors.svelte.ts`, `js-only.svelte.ts`, `loader.svelte.ts`, `use-drawer.svelte.ts`, `graphql.server.ts`, `task-stream.server.ts`, папочные `links/`, `cookie-vault/`, `storage-server-form/` и `component-form/`); см. [`src/core/hooks/README.md`](./src/core/hooks/README.md).
3. **`#core/ui/*` → `./src/core/ui/*` (переиспользуемые UI-примитивы и проектно-независимые виджеты)**:
   - `src/core/ui/` — единая система примитивов ([`src/core/ui/README.md`](./src/core/ui/README.md)), включая `shell/` ([`src/core/ui/shell/README.md`](./src/core/ui/shell/README.md)), `steps/` ([`src/core/ui/steps/README.md`](./src/core/ui/steps/README.md)), `loader/` ([`src/core/ui/loader/README.md`](./src/core/ui/loader/README.md)), `paginator/`, `settings/`, `form/` (включая `messages.ru.ts`), `fields/`, `modals/`, `db-schema/`, `listing/`, `errors/` (`ErrorPage.svelte`) и `utils.ts`;
   - компоненты не импортируют `#modules/*`, `#sections/*`, `#core/server/*` и `src/routes/*` — доменные маршруты и пункты навигации передаются через пропы и слоты.
4. **`#modules/*` → `./src/modules/*` (доменные модули ядра и подключаемые пакеты `npm run mod`)**:
   - `src/modules/user/` — автономный модуль пользователя, разделённый на `base/`, `profile/`, `sessions/`, `blocks/` и `accounts/` (`routes.ts`, `modals.ts`, `model/`, `service/`, `svelte/`; `base` владеет входом, выходом и настройками);
   - `src/modules/storage-servers/` — управление боевым пулом серверов хранения в БД (`STORAGE_ACL`, `form.ts`, `storage-server.form.server.ts`, `modals.ts`, `routes.ts`, `ui/*`);
   - опциональный пакет `demo` (`npm run mod -- add demo` / `MODULES=demo`): добавляет `src/modules/demo/` (куки-сейф серверов S3 / WebDAV, `CookieVault*`, схемы и витрины демо-каталога).
5. **`#sections/*` → `./src/sections/*` (страничные секции: загрузчики и разметка)**:
   - `src/sections/<domain>/...` — `load.server.ts` и Svelte-компоненты страниц; route-файлы остаются тонкими адаптерами.
6. **`src/composition/*`, `#core/server/*` и `src/routes/*` (композиция и серверные синглтоны)**:
   - `src/composition/index.server.ts` — композиционный корень (сборка схемы, доменные фабрики, порты);
   - все строго серверные модули вне `routes/+*.server.ts` носят суффикс `*.server.ts` (`db.server.ts`, `cache.server.ts`, `app-storage.server.ts`, `storage-probe.server.ts`, `form-budget.server.ts`, `form-security.server.ts`, `live-cache.server.ts`, `fetch.server.ts`, `ws-upgrade.server.ts`, `vite-ws.server.ts`, `after-response.server.ts`, `api-error.server.ts`) и не могут импортироваться в клиентский/изоморфный код;
   - `src/core/server/trusted-origins.ts` импортируется в `vite.config.ts` до инициализации SvelteKit и не должен тянуть `$app/*`, `$env/*` или `node:*`;
   - `src/hooks.server.ts` выступает точкой композиции (`dbHandle` + `createComponentFormsHandle(import.meta.glob('./**/*.form.server.ts'))`);
   - легаси-алиасы `#lib/*`, `#hooks/*`, `#server/*` в `package.json` пока перенаправлены в `src/core/...`; `#components/*` удалён, `#content/*` остался мёртвым (указывает на несуществующий `src/content/`) — новый код использует `#core/ui/*` и `#modules/*`/`#sections/*`.

---

## 3. Ключевые контракты подсистем

- **Адрес, шаги и реестр маршрутов (`#core/lib/address` + `#core/ui/steps`)**:
  - запись и чтение клиентского URL — только через `#core/lib/address/sveltekit.js` (`writeAddress`, `visibleAddress`, `kitRoute`) и `registerRoute` / `querySchema` (`#core/lib/address/routes.js`). Прямые `history.pushState`/`replaceState`, чтение `page.url` и `goto` вне разрешённых примитивов запрещены;
  - служебные шаги в `useSteps` (квитанция, подтверждение), которым не нужна перезагружаемая ссылка `?step=…`, помечаются `addressable: false`.
- **Метаданные и заголовки страниц (`#core/ui/shell`)**:
  - заголовки `<title>`, `meta[name="description"]`, `og:*` и `robots` выставляются на всех маршрутах и в модалках исключительно через стековый `useHeadSeo` (`PageHead.svelte` монтируется один раз в корневом `+layout.svelte`, без дублирования `<svelte:head>` на страницах).
- **Формы и контролы (`#core/lib/form` + `#core/ui/form` + `#core/hooks/component-form`)**:
  - разметка форм и контролов — только через `<Form>` (`#core/lib/form/svelte/index.js`), `<Field>` (`#core/ui/form/`) и примитивы `#core/ui/index.js` / `#core/ui/settings/index.js`. Сырые `<form>`, `<input>`, `<select>`, `<textarea>`, ручные `type="hidden"` и рукописные `name="..."` вне кита запрещены;
  - `defineForm` является единой точкой описания `budget`, `limits`, `checks` и `invalidFrom`; ядро `#core/lib/form` несёт английский словарь `en`, а русский словарь приложения подключён в `src/core/ui/form/messages.ru.ts` (`forms.config.ts`);
  - `createComponentFormsHandle` опознаёт JS-запросы по `x-form-id` без лишней буферизации, читает нативные POST в один проход без `request.clone()`, при превышении `FORM_BODY_LIMIT` отдаёт штатный `Result` со статусом `413` как в JSON, так и на SSR без JS, а для `outcome === 'queued'` без JS по умолчанию выполняет `303 See Other` на `statusUrl`;
  - вес `src/core/lib/form/**` зафиксирован `tooling/form-size.mjs`.
- **Модель прав и пользовательский контур (`#core/lib/db` + `#core/hooks/db-grants.svelte.js` + `#modules/user`)**:
  - роли и права не разделяются искусственно: оба вида грантов являются непустыми строковыми токенами, объявляются в моделях через `defineAcl` (проверяются `validateResourceAcl`), вычисляются на сервере через `checkGrants(actor, grants(resource), { ownerId })` и реактивно в UI через `useGrants`;
  - `<Acl />` (`src/modules/user/base/svelte/Acl.svelte`) покрывает полный набор `AuthErrorCode` и отказов `#core/lib/db`;
  - в `<SeedForm />` проп `authorize` разводит открытие сессии (`true`) и изолированную проверку владения `seed` через `verifySeed` без выдачи/смены кук (`false`, срез `'confirm'`).
- **Хранилище и изображения (`#lib/storage` + `#lib/image` + `app-storage.server.ts`)**:
  - по сети передаются только бинарные `File` в `multipart/form-data` или по потоковому `wss://` (`/api/form-upload`), а готовые аватары хранятся в боевом хранилище `appStorage` и раздаются неизменяемыми ссылками `/api/storage/avatars/…` с изолирующим `Content-Security-Policy: default-src 'none'; sandbox` и немедленным удалением старого файла при замене/удалении профиля; конвертация файлов целиком в `base64` запрещена `layer-guard`;
  - не менять браузерное умолчание `decodeWithBrowser` в `src/core/lib/image/decode.ts`; на сервере явно передавать `{ decoder: decodeWithNode }` из `#core/lib/image/node.js`.
- **Документация `#lib/db`**:
  - при любых изменениях в `src/core/lib/db/**` или переносах упомянутых файлов держать зелёным живой аудит документации — `vitest run src/core/lib/db/test/db-docs.test.ts` и `node --test tooling/db-docs.test.mjs`.

---

## 4. README рядом с кодом

README пакета — часть изменения, а не сопроводительный файл.

**Где они лежат.** `src/core/lib/*`, `src/core/ui/{loader,shell,steps,ui,listing,paginator}`, `src/core/hooks`, `src/modules/{user,storage-servers}`. Отдельно — документы слоя БД: `src/core/lib/db/{PORTING.md,docs/*.md}` (под правило README не попадают, но устаревать не должны). Пары «папка → подпапка со своим README»: `src/core/hooks/` → `src/core/hooks/links/`, `src/core/lib/paginate/` → `src/core/lib/paginate/filters/` и `src/core/lib/paginate/search/`.

1. **README ищется вверх от файла:** ближайший обязателен. Подпапка без своего README — часть README выше (`src/core/lib/form/svelte/*` → `src/core/lib/form/README.md`).
2. **Область README кончается над папкой со своим README.** Правил `src/core/lib/paginate/search/fuzzy.ts` — отвечает `src/core/lib/paginate/search/README.md`; `src/core/lib/paginate/README.md` — только если поменялся состав папок, публичный вход (`index.ts`) или общие контракты.
3. **Прочитай README до правки:** он описывает контракт, который ты меняешь.
4. **Поменял поведение, публичный API, опции, числа бюджетов** (`tooling/form-size.mjs`, `tooling/size-budget.mjs`) **или соглашение** — правь README в том же коммите, на языке файла.
5. **Контракт не менялся** (багфикс, рефакторинг, тесты, комментарии) — текст не переписывай ради галочки; в тело коммита добавь строку `README <путь>: проверен, правок нет`.
6. **README рядом нет** (`src/routes/`, `src/core/server/`, `src/modules/<модуль>/ui/*`) — ничего не требуется.

---

## 5. Расхождения с общим промтом харнесса (`~/.dsh/AGENTS.md`)

Временный раздел: фиксирует, где правила харнесса и этого репозитория расходятся, чтобы расхождение не решалось молча. План экранов на `Surface` закрыт и из дерева снят. Перенос структуры состояния харнесса (`docs/agent/<topic>/plan.md` + `progress.md`, английский план) отдельной командой не заказан: пока его нет, раздел остаётся.

### 5.1. Не переносится — конфликт по существу

- **Язык плана.** Харнесс требует план по-английски (`docs/agent/<topic>/plan.md`), репозиторий пишет оставшиеся `docs/plan-*.md` по-русски. Перевод не начинается без отдельной команды.
- **Формат плана.** У харнесса — чекбоксы `[x]` / `[-]` / `[ ]`, ровно один `[-]`, версия `ACTIVE PLAN vN`, блок `SUPERSEDED`. Здесь план — проза и таблица статуса. Расхождение сохраняется до миграции.
- **Расположение состояния.** У харнесса — `docs/agent/<topic>/plan.md` + `docs/agent/<topic>/progress.md`. Здесь незакрытое перечислено в `docs/pending.md`, а подробности открытого плана — в самом `docs/plan-*.md`. Второй файл состояния не заводится.

### 5.2. Действует из харнесса как есть

- **`progress.md` — единственный артефакт, переживающий компакцию.** Здесь эту роль делят `docs/pending.md` (что не сделано) и открытый `docs/plan-*.md` (как делать оставшееся). Отдельный `progress.md` не заводится без отдельной команды.
- **Отчёт из четырёх частей** (Done / Verified / Remaining / Next) и блок `<evidence_block>` после любой правки файлов. Действует без изменений.
- **План не читает пользователь; «done» без проверки не произносится.** Действует без изменений.
- **Работа начинается только по слову владельца.** Действует без изменений и совпадает с §5 плана.
- **Сеть:** прямой доступ первым, `.tools/socks-curl.sh` (`SOCKS_SECRET` из `/etc/egress.env`) — только для хостов с гео-блоком или зависшим TLS; секрет не печатать. GitHub — через REST `.tools/playwright-mcp/github.mjs`, не веб-поиском. Оба инструмента в рабочей области присутствуют. Для этого репозитория до сих пор не требовались.

### 5.3. Здесь строже, чем в харнессе

- **README рядом с кодом** (§4 выше) — обязателен и ищется вверх по дереву; харнесс такого требования не формулирует. При конфликте выигрывает репозиторий.
- **Пятислойная архитектура и subpath-алиасы** (§2) с гардами `layer-guard` / `core-purity` / `public-api`. Харнесс говорит «следуй существующим слоям», репозиторий проверяет это машиной.
- **Версия Node, `--no-liftoff`, env сборки** (§1) — жёсткие требования репозитория.
- **Коммиты:** тело на русском с перечнем файлов и строкой `README <путь>: проверен, правок нет`, префикс conventional. Харнесс про язык тела коммита молчит.

### 5.4. Общее уточнение

Ни один пункт этого раздела не отменяет жёсткие правила харнесса о VCS, проверках и честном отчёте. Расхождения касаются только языка, расположения и формата документов состояния.

