# Правила репозитория `modals-kit`

Этот файл дополняет общие инженерные правила конкретными ограничениями и архитектурными инвариантами репозитория `modals-kit`.

---

## 1. Среда и запуск

- **Версия Node.js**: строго **`>= 22.17`** (`vite.config.ts` проверяет версию при старте). В контейнерах, где `/usr/bin/node` старше, в `PATH` первым должен стоять `/usr/local/bin` (`PATH="/usr/local/bin:$PATH"`).
- **WASM / PGlite и `--no-liftoff`**: не убирать `execArgv: ['--no-liftoff']`, `testTimeout: 15_000` и ограничение воркеров (`--pool=forks --maxWorkers=1`) в `vite.config.ts` и скриптах `package.json` — в песочницах с малым пулом исполняемых страниц Liftoff роняет воркеры PGlite по `SIGSEGV`, а холодная компиляция `pglite.wasm` через TurboFan занимает ~8–9 с.
- **Переменные сборки и превью**: при `vite build` и `vite preview` передавать `AUTH_SEAL_SECRET`, `KIT_TRUSTED_ORIGINS` и `PREVIEW_PORTS` (единый список доверенных origin строится в `src/server/trusted-origins.ts`).
- **Браузерные тесты**:
  - основные E2E-наборы (`npm run test:browser` — `regressions.mjs`, `modals.mjs`, `shell.mjs`, `steps.mjs`, `forms.mjs`, `forms-a11y.mjs`, `db-demo.mjs`, `fields.mjs`, `paginate.mjs`, `capabilities.mjs`, `errors.mjs`, `a11y.mjs`, `loader.mjs`, `auth.mjs`, `layer-back.check.mjs`, `url-storage.check.mjs`) запускаются против собранного превью (`vite build` → `vite preview --port 5173 --strictPort`);
  - наборы, которым нужны секреты среды (`AUTH_SEAL_SECRET` для `auth.mjs`, `DB_CURSOR_SECRET` для курсорной части `url-storage.check.mjs` и `db-demo.mjs`), сами печатают `SKIP` с причиной — зелёный прогон без них означает «проверка не выполнялась», а не «всё хорошо»;
  - живые внешние API — отдельной командой `npm run test:browser:live` (`shikimori.mjs`, `rickmorty.mjs`): они зависят от сети и в основной набор не входят;
  - компонентный браузерный прогон вложения `test/browser/attachment.mjs` динамически импортирует `.svelte`-фикстуру `/src/components/ui/attachment/AttachmentBrowserFixture.test.svelte` и запускается против живого `vite dev` с `ATTACHMENT_BASE="http://127.0.0.1:<port>/fields"`.

---

## 2. Пятислойная архитектура и subpath-алиасы (`package.json`)

Импорты между слоями идут строго сверху вниз и проверяются на этапе dev/build плагином `tooling/layer-guard.mjs`:

1. **`#lib/*` → `./src/lib/*` (независимые библиотеки + их фреймворковые адаптеры)**:
   - пакеты `address`, `assets`, `cache`, `db`, `fetch`, `form`, `image`, `modals`, `paginate`, `task`;
   - в чистых ядрах запрещены импорты `svelte`, `@sveltejs/kit`, `$app/*`, соседних пакетов и любых верхних слоёв (`tooling/core-purity.mjs` + `tooling/layer-guard.mjs`); адаптеры реактивности и роутера живут внутри своего пакета (`svelte/`, `sveltekit/`, `cores/sveltekit.ts`, `node.ts`);
   - **публичный вход пакета объявлен**: снаружи `src/lib/<pkg>/` допустимы только спецификаторы из `src/lib/<pkg>/entrypoints.json` (нет манифеста — только `index.js`), остальное — внутреннее устройство. Проверка — `node tooling/public-api.mjs` (+ тест `tooling/public-api.test.mjs`): пакет обязан переноситься в другое приложение, а глубокий импорт привязывает чужой код к его файлам. Тот же закон для `#lib` → `#lib`: пакеты общаются входами, а не потрохами.
2. **`#hooks/*` → `./src/hooks/*` (межбиблиотечные и фреймворковые связки без UI)**:
   - соединяет две библиотеки или библиотеку и среду (`cache-db.ts`, `db-form.ts`, `db-schema.ts` + `db-schema.server.ts`, `schema-route.ts`, `api-error.ts`, `app-errors.svelte.ts`, `js-only.svelte.ts`, `loader.svelte.ts`, `use-drawer.svelte.ts`, `graphql.server.ts`, `task-stream.server.ts`, папочные `links/` и `component-form/`); см. [`src/hooks/README.md`](./src/hooks/README.md).
3. **`#components/*` → `./src/components/*` (переиспользуемые UI-примитивы и проектно-независимые виджеты)**:
   - `ui/` (правила слоя — [`src/components/ui/README.md`](./src/components/ui/README.md)), `settings/`, `demo/`, `form/`, `fields/`, `paginator/`, `modals/`, `steps/`, `db-schema/`, `loader/`, `shell/` (`ui/{header,sidebar}/`), `ErrorPage.svelte`, `Error500.svelte`, `utils.ts`;
   - компоненты не импортируют `#content/*`, `#server/*` и `src/routes/*` — доменные маршруты и пункты навигации передаются через пропы и слоты.
4. **`#content/*` → `./src/content/*` (доменные модули и изолированный демо-каталог)**:
   - `src/content/user/` — автономный модуль пользователя (`routes.ts`, `modals.ts`, `gateway.server.ts`, ядро и `ui/*`);
   - `src/content/demo-catalog/{items,posts,rickmorty,shikimori}/` — все учебные источники витрин, схемы фильтров и карточки строк/плиток.
5. **`#server/*` → `./src/server/*` и `src/routes/*` (серверные синглтоны и композиция приложения)**:
   - все строго серверные модули вне `routes/+*.server.ts` носят суффикс `*.server.ts` (`db.server.ts`, `cache.server.ts`, `live-cache.server.ts`, `fetch.server.ts`, `form-security.server.ts`, `after-response.server.ts`, `api-error.server.ts`) и не могут импортироваться в клиентский/изоморфный код;
   - `src/server/trusted-origins.ts` импортируется в `vite.config.ts` до инициализации SvelteKit и не должен тянуть `$app/*` / `$env/*`;
   - `src/hooks.server.ts` выступает точкой композиции (`dbHandle` + `createComponentFormsHandle(import.meta.glob('./**/*.form.server.ts'))`).

---

## 3. Ключевые контракты подсистем

- **Адрес и реестр маршрутов (`#lib/address`)**:
  - запись и чтение клиентского URL — только через `#lib/address/sveltekit.js` (`writeAddress`, `visibleAddress`, `kitRoute`) и `registerRoute` / `querySchema` (`#lib/address/routes.js`). Прямые `history.pushState`/`replaceState`, чтение `page.url` и `goto` вне разрешённых примитивов запрещены.
- **Формы и контролы (`#lib/form` + `#components/form` + `#hooks/component-form`)**:
  - разметка форм и контролов — только через `<Form>` (`#lib/form/svelte/index.js`), `<Field>` (`#components/form/`) и примитивы `#components/ui/index.js` / `#components/settings/index.js`. Сырые `<form>`, `<input>`, `<select>`, `<textarea>`, ручные `type="hidden"` и рукописные `name="..."` вне кита запрещены;
  - встраиваемые формы (`SeedForm`, `ProfileForm`, `MenuBody`, конструктор `/fields`) работают через `bindComponentForm` и `registerComponentForm`: с JS отвечают JSON со статусом и `Set-Cookie`, без JS сохраняют HTTP-статус ошибки (`422` и др.) и введённые значения прямо в ответе на `POST` через `locals.formResult`;
  - вес `src/lib/form/**` зафиксирован `tooling/form-size.mjs`, а клиентский бандл всех маршрутов — `tooling/size-budget.mjs`.
- **Пользовательский `Acl` и `SeedForm` (`src/content/user/`)**:
  - `<Acl />` (`src/content/user/ui/Acl.svelte`) покрывает полный набор статусов `AuthErrorCode` и отказов `#lib/db`;
  - в `<SeedForm />` проп `authorize` разводит открытие сессии (`true`) и изолированную проверку владения `seed` через `verifySeed` без выдачи/смены кук (`false`, срез `'confirm'`).
- **Изображения и бинарный `File` (`#lib/image`)**:
  - по сети передаются только бинарные `File` в `multipart/form-data` (никаких `base64` в полях формы);
  - не менять браузерное умолчание `decodeWithBrowser` в `src/lib/image/decode.ts` (`EnvironmentError` в Node без явного декодера); на сервере передавать `{ decoder: decodeWithNode }` из `#lib/image/node.js`.
- **Документация `#lib/db`**:
  - при любых изменениях в `src/lib/db/**` или переносах упомянутых файлов держать зелёным живой аудит документации — `vitest run src/lib/db/test/db-docs.test.ts`. Он инжектит `existsSync` в `tooling/db-docs.mjs::auditDocs` и требует существования каждого упомянутого в этих документах пути вида `src|tooling|migrations/…` с расширением файла (пути-каталоги и таблицы происхождения под проверку не попадают). **`node tooling/db-docs.mjs` — не команда**: это модуль без CLI, запуск печатает ничего и не проверяет ничего; тест в `tooling/db-docs.test.mjs` покрывает только чистые функции.
