# Сводный план разработки `modals-kit`

Единый список завершённых вех, открытых этапов и отложенных решений по всему репозиторию. Найденные в коде баги, дыры и старые хвосты вынесены в отдельный реестр на тестирование: **[`docs/audit/testing-backlog.md`](./audit/testing-backlog.md)**.

---

## 1. Выполненные этапы

### Ядра библиотек и инфраструктура
- [x] **Чистые ядра и стражи слоёв** (`modals`, `form`, `paginate`, `address`, `fetch`, `cache`, `image`, `task`, `db`): ноль импортов UI-фреймворка в ядрах, проверка `tooling/core-purity.mjs`, `tooling/layer-guard.mjs`, `tooling/classes-audit.mjs`, `tooling/load-url-guard.mjs`, `tooling/source-schema-guard.mjs`, `tooling/db-docs.mjs`.
- [x] **Симуляция переноса на React 19 + React Router v7** (`sim/react-router/`): доказана переносимость ядер `#lib/address`, `#lib/modals`, `#lib/form`, `#lib/paginate` без правок в `src/lib/`.
- [x] **Общее хранилище `#lib/cache` в PostgreSQL** (`src/hooks/cache-db.ts`, `src/lib/server/cache.ts`): модель `cacheKv`, `pgStore` с часами БД (`clock_timestamp()`), областями и атомарными `add`/`incr`.
- [x] **Живое обновление списков `/db-demo`** (`src/routes/(site)/(app)/db-demo/{live.svelte.ts,fresh.ts}`, `src/lib/server/live-cache.ts`): раздельный опрос новых, изменённых и удалённых записей с `ETag`/`304`, `backoffDelay` и удержанием позиции скролла.
- [x] **Среда Node >= 22.17 и стабильность WASM PGlite**: явный гард версии Node в `vite.config.ts` и флаг `--no-liftoff` для воркеров Vitest.

### Формы, вложения, шаги и изображения
- [x] **Примитивы вложений `Attachment` и `FileAttachment`** (`src/lib/components/ui/attachment/`, `src/lib/components/form/FileField.svelte`): раскладки `row` и `tile`, 6 категорий медиа, шкала прогресса, нормальный поток контролов без перехвата клика оверлеем.
- [x] **Клиентский перехват поля (`Field` `takeover`)** (`src/lib/form/takeover.ts`, `src/lib/components/form/Field.svelte`, правило в `tooling/layer-guard.mjs`): `FieldHandle` с `f.pending` и `f.error`, прогрессивное улучшение поверх базового нативного контрола без JS.
- [x] **Штамп `Result.intent` и пошаговые формы (`formSteps` + `FormSteps`)** (`src/lib/components/steps/`): автономный режим и работа кустом на шаге хоста (`at` + `host`), маппинг действий `actionOf`, цепочки ключей `auth.*`, разбор ошибок по шагам с `<details>`.
- [x] **Серверный WASM-декодер `#lib/image/node.js`**: `ensureNodeImageCodecs()` и `decodeWithNode(source)` поверх `@jsquash/{jpeg,png,webp,avif}` для серверной подготовки изображений без нарушения браузерного контракта `decode.ts`.
- [x] **Маршрутно-независимые формы компонентов (`src/hooks/component-form/`)**: `bindComponentForm` + `registerComponentForm` + `componentFormsHandle` (работа в модалках и на любых страницах, сохранение статуса ошибки `422` и введённых значений на прямом `POST` без промежуточного `GET`).

### Модуль пользователя (`src/content/user/`)
- [x] **Доменное ядро `user`**: Ed25519 `seed` + одноразовый `challenge`, ротация/усыновление сессий, список и отзыв устройств, `restoreDeleted`, `verifySeed` (проверка владения `seed` без создания сессии), `sweepDeletions`.
- [x] **Полный UI `Acl`** (`src/content/user/{acl.ts,ui/Acl.svelte}`): покрытие всех статусов авторизации/аккаунта (`AuthErrorCode`, бан, ограничения) и всех отказов моделей `#lib/db` (`DbFailure` / `KitErrorBody`).
- [x] **Декомпозиция UI на самостоятельные папочные компоненты**:
  - `src/content/user/ui/seed-form/` (`SeedForm` с `authorize = true | false`, `form.ts`, `server.ts`, `envelope.ts`);
  - `src/content/user/ui/profile-form/` (`ProfileForm`, `AvatarTakeover`, `avatar.ts`, `form.ts`, `server.ts` — чистый бинарный `File`, компактный `FileAttachment`, `decodeWithNode` на сервере, ноль `base64` в полях формы);
  - `BanNotice.svelte`, `RestrictionsNotice.svelte`, тонкий координатор шагов `AuthWidget.svelte` и единое `MenuBody.svelte`.

---

## 2. Первоочередная очередь: тестирование и закрытие багов

Перед следующими крупными фичами прогнать и закрыть пункты из **[`docs/audit/testing-backlog.md`](./audit/testing-backlog.md)**:
- [ ] **`TB-01` (P0)** — вынести байты аватара из куки `auth_tmp` (этап `R6` [`docs/design/image-transfer.md`](./design/image-transfer.md)), чтобы реальные JPEG-фото не упирались в лимит `4096 B` на куку и `431`.
- [ ] **`TB-02` (P0)** — обновлять одноразовый `nonce` при ошибке `auth.signature` в `AuthWidget` и в автономном `<SeedForm />` (без жёсткой привязки к `/user/auth`).
- [ ] **`TB-03` .. `TB-05` (P0)** — закрыть дыры в `src/content/user/gateway.ts`: проверка `guard()` в `readVault()`, атомарный `challenge.consume()` в `sharedStore`, отзыв сессии по `auth_sid` при протухшем `auth_tmp` в `logout()` и `secure` по протоколу HTTPS.
- [ ] **`TB-06` .. `TB-09`, `TB-13` (P1–P2)** — доработать `src/hooks/component-form/` (определение формы при `413`, живой `target` URL, сохранение прототипа `RequestEvent`) и UX отмены `remove_avatar` / приоритет `vault.profile` в `ProfileForm`.
- [ ] **`TB-15` (P3)** — выполнить полный прогон `npm run check`, `npm test`, `npm run build` и всех 12 браузерных сценариев Playwright.

---

## 3. Открытые задачи развития

### Конвейер изображений и файлов ([`docs/design/image-transfer.md`](./design/image-transfer.md))
- [ ] **Этап R4**: поддержка отложенного исхода `outcome: 'queued'` (`pollUrl` + `statusUrl` из `#lib/form/queued.js`) в `#hooks/component-form` и хранение заявок в `sharedStore`.
- [ ] **Этап R5**: перевод `/fields` (`src/routes/(site)/(app)/fields/{forms.ts,handle.ts}`) с ручных `sniff()` / `base64()` на `#lib/components/form/photo.js` (`probeImageHeader`, проверка размеров от декомпрессионных бомб).
- [ ] **Этап R7**: брендированный тип `PreparedFile` на границе записи и правило `tooling/layer-guard.mjs` против чтения сырых байтов `File` в маршрутах мимо `#lib/image`.

### Шаги и пользовательский модуль
- [ ] **Планировщик удаления аккаунтов**: подключить периодический/фоновый вызов `sweepDeletions(ports)` (`src/content/user/auth.ts`) для зачистки `profile` и `seed` по истечении `deleteGraceDays` (`TB-14`).
- [ ] **Расширения `useSteps` (по потребности)**:
  - явный признак неадресуемого служебного шага в описании `steps` хоста (`addressable: false`), если служебному шагу нужна собственная подпись в `Steps`;
  - универсальный аддон вложенных `Steps` глубже одного уровня поверх полной цепочки `host.fullKey` (`segmentOf` / `suffixOf`), когда появится страница с многоуровневой не-форменной навигацией.
- [ ] **UI управления устройствами и удалением аккаунта**: подключить готовые функции ядра `listSessions`, `revokeSession`, `logoutAll`, `requestDelete` к пользовательскому интерфейсу профиля/меню.

### Безопасность клиента и переносимость
- [ ] **Включение `kit.csp`** ([`docs/design/client-integrity.md`](./design/client-integrity.md)): добавить `csp` в `vite.config.ts` (хэш/внешний скрипт для ранней темы в `src/app.html`, self-host шрифта `Manrope`, учёт iframe-превью в dev).
- [ ] **Вынос UI-строк из `src/lib/`** (шаг 1 [`docs/design/port-plan.md`](./design/port-plan.md)): перенести оставшиеся русские строки в словари/опции по образцу `#lib/form/messages.js`.

### Отложенные треки `#lib/db`
- [ ] **ACL-схема коллекций и generic REST-слой** — проект и приёмочная матрица зафиксированы в [`src/lib/db/docs/ACL-DESIGN.md`](../src/lib/db/docs/ACL-DESIGN.md) (реализация отложена владельцем).
- [ ] **Таблица истории ручных миграций и виртуальные вычисляемые поля** — отложены до запуска ACL-трека (см. [`src/lib/db/PORTING.md`](../src/lib/db/PORTING.md) §3.1).
