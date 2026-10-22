# Правила репозитория `modals-kit`

Этот файл дополняет общие инженерные правила конкретными ограничениями и архитектурными инвариантами репозитория `modals-kit`.

---

## 1. Среда и запуск

- **Версия Node.js**: строго **`>= 22.17`** (`vite.config.ts` проверяет версию при старте). В контейнерах, где `/usr/bin/node` старше, в `PATH` первым должен стоять `/usr/local/bin` (`PATH="/usr/local/bin:$PATH"`).
- **WASM / PGlite в Vitest**: не убирать `execArgv: ['--no-liftoff']`, `testTimeout: 15_000` и ограничение воркеров в `vite.config.ts` — в песочницах с малым пулом исполняемых страниц Liftoff роняет воркеры PGlite по `SIGSEGV`, а холодная компиляция `pglite.wasm` через TurboFan занимает ~8–9 с.
- **Браузерные тесты**:
  - основные E2E-наборы (`npm run test:browser`, включая `test/browser/auth.mjs`) запускаются против собранного превью: `npx vite build` → `npx vite preview --port 5173 --strictPort`;
  - компонентный браузерный прогон вложения `test/browser/attachment.mjs` динамически импортирует `.svelte`-фикстуру и запускается против dev-сервера: `npx vite dev --host 127.0.0.1 --port 5179 --strictPort` с `ATTACHMENT_BASE="http://127.0.0.1:5179/fields"`.

---

## 2. Структура слоёв и размещение кода

1. **Чистота ядер (`src/lib/*`)**:
   - В ядрах `modals`, `form`, `paginate`, `address`, `fetch`, `cache`, `image`, `task`, `db` запрещены импорты `svelte`, `@sveltejs/kit`, `$app/*` и UI-компонентов. Реактивность и роутер живут только в подпапках `svelte/` и `sveltekit/`. Это проверяют `tooling/core-purity.mjs` и `tooling/layer-guard.mjs`.
2. **Никакого нового прикладного/доменного кода в `src/lib/components/`**:
   - Доменные компоненты, `Acl`, пользовательские формы и экраны принадлежат своему доменному модулю (`src/content/user/`), а не `src/lib/components/`.
3. **Папочная изоляция многофайловых модулей**:
   - Многофайловый хук оформляется отдельной папкой в `src/hooks/<name>/` с явным `index.ts` / `server.ts` (пример: `src/hooks/component-form/`), не засоряя корень `src/hooks/`.
   - Многофайловый UI-компонент со своей схемой формы, серверным обработчиком, вспомогательными модулями и тестами оформляется отдельной папкой с собственным `index.ts` (примеры: `src/content/user/ui/seed-form/`, `src/content/user/ui/profile-form/`).
4. **Сборочные правила (`tooling/layer-guard.mjs`)**:
   - Запись и чтение клиентского адреса — только через `#lib/address/sveltekit.js` (`writeAddress`, `visibleAddress`, `claimQuery`). Прямые `history.pushState`/`replaceState`, чтение `page.url` и `goto` в `src/lib/` запрещены.
   - Разметка форм и контролов — только через `<Form>` из `#lib/form/svelte/index.js`, `<Field>` и примитивы `#lib/components/ui/index.js` / `#lib/components/settings/index.js`. Сырые `<form>`, `<input>`, `<select>`, `<textarea>`, ручные `type="hidden"` и рукописные `name="..."` на UI-примитивах вне кита запрещены.
   - Серверный приём тела формы — только через `createFormHandler` (`#lib/form/server.js`) и `SECURITY_LAYERS` (`#lib/server/form-security.js`) либо через `#hooks/component-form/server.js`.

---

## 3. Ключевые контракты подсистем

- **Формы компонентов (`#hooks/component-form`)**:
  - Встраиваемые формы (`SeedForm`, `ProfileForm`, выход в `MenuBody`) привязываются через `bindComponentForm` и регистрируются в `src/hooks.server.ts` через `componentFormsHandle`. Прямая ошибка нативного `POST` (`422` и др.) рендерится в ответе на тот же `POST` с кодом статуса ошибки через `locals.formResult`, без промежуточного `GET` и без потери введённых данных.
- **Пользовательский `Acl` и `SeedForm`**:
  - `<Acl />` (`src/content/user/ui/Acl.svelte`) покрывает полный набор статусов `AuthErrorCode` и отказов моделей `#lib/db` (`DbFailure` / `KitErrorBody`).
  - В `<SeedForm />` проп `authorize` разводит два режима:
    - `authorize = true` (по умолчанию для `'entry' | 'register' | 'restore'`) — под защитой `<Acl allow="guest">`, открывает сессию и ставит куки;
    - `authorize = false` (срез `'confirm'`) — проверка владения `seed` через `verifySeed` **без создания сессии и без выдачи/смены кук**, доступна и гостю, и авторизованному пользователю.
- **Изображения и бинарный `File` (`#lib/image`)**:
  - По сети передаются только бинарные `File` в `multipart/form-data` (никаких `base64` в полях формы).
  - Не менять дефолтное поведение `decodeWithBrowser` в `src/lib/image/decode.ts`: вызов `image(source)` в Node без явного декодера обязан отклоняться с `EnvironmentError`. На сервере передавать `{ decoder: decodeWithNode }` из `#lib/image/node.js`.
- **Документация `#lib/db`**:
  - При любых изменениях в `src/lib/db/**` поддерживать 100% соответствие `src/lib/db/README.md`, `PORTING.md` и `docs/*.md` проверкам `tooling/db-docs.mjs`.
