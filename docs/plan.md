# Сводный план разработки `modals-kit`

Единый список завершённых вех, открытых этапов и отложенных решений по всему репозиторию. Детальный статус проверенных и открытых пунктов: **[`docs/audit/testing-backlog.md`](./audit/testing-backlog.md)**.

---

## 1. Выполненные этапы

### Пятислойная архитектура, ядра библиотек и инфраструктура (`S1` → `S6`)
- [x] **Чистые ядра и пятислойная иерархия (`#lib/*` → `#hooks/*` → `#components/*` → `#content/*` → `#server/*` / `routes`)** ([`AGENTS.md`](../AGENTS.md) §1–§2): ноль импортов UI-фреймворка в ядрах, строгая граница `*.server.ts`, изоляция учебных источников в `src/content/demo-catalog/`, типизированный реестр маршрутов `routes.ts` / `kitRoute` в `#lib/address`, автоматический контроль в `tooling/{layer-guard,core-purity,classes-audit,load-url-guard,source-schema-guard,db-docs,ark-owns,form-size,size-budget}.mjs`.
- [x] **Единый источник истины UI-слоя (`U1`–`U9`, `F1`–`F9`)** ([`src/components/ui/README.md`](../src/components/ui/README.md)): `fieldBase`, `affixButtonClass`, `controlBase` в `ui/field/field.ts`, `CloseIcon`, `RadioGroup` и `Range` по эталонам `shadcn` v4, единый `FieldShell` (`labelPlacement`), `Skeleton`, закон `class` / `wrapperClass` и глобальный `aria-invalid:`.
- [x] **Симуляция переноса на React 19 + React Router v7** (`sim/react-router/`): доказана переносимость ядер `#lib/address`, `#lib/modals`, `#lib/form`, `#lib/paginate` без правок в `src/lib/`.
- [x] **Общее хранилище `#lib/cache` в PostgreSQL** (`src/hooks/cache-db.ts`, `src/server/cache.server.ts`): модель `cacheKv`, `pgStore` с часами БД (`clock_timestamp()`), областями и атомарными `add`/`incr`.
- [x] **Живое обновление списков `/db-demo`** (`src/routes/(site)/(app)/db-demo/{live.svelte.ts,fresh.ts}`, `src/server/live-cache.server.ts`): раздельный опрос новых, изменённых и удалённых записей с `ETag`/`304`, `backoffDelay` и удержанием позиции скролла.
- [x] **Среда Node >= 22.17 и стабильность WASM PGlite**: явный гард версии Node в `vite.config.ts` и флаг `--no-liftoff` для воркеров Vitest и скриптов запуска.

### Формы, вложения, пагинатор, шаги и изображения
- [x] **Примитивы вложений `Attachment` и `FileAttachment`** (`src/components/ui/attachment/`, `src/components/form/FileField.svelte`): раскладки `row` и `tile`, 6 категорий медиа, шкала прогресса, нормальный поток контролов без перехвата клика оверлеем.
- [x] **Самодостаточные папочные модули `fields/` и `paginator/`** (`src/components/fields/`, `src/components/paginator/`): `SchemaBuilder`, `SchemaFields`, `SchemaValues`, единый `<Paginator />` с `ui/*` и `filters/*`.
- [x] **Клиентский перехват поля (`Field` `takeover`)** (`src/lib/form/takeover.ts`, `src/components/form/Field.svelte`, правило в `tooling/layer-guard.mjs`): `FieldHandle` с `f.pending` и `f.error`, прогрессивное улучшение поверх базового нативного контрола без JS.
- [x] **Штамп `Result.intent` и пошаговые формы (`formSteps` + `FormSteps`)** (`src/components/steps/`): автономный режим и работа кустом на шаге хоста (`at` + `host`), маппинг действий `actionOf`, цепочки ключей `auth.*`, разбор ошибок по шагам с `<details>`.
- [x] **Серверный WASM-декодер `#lib/image/node.js`**: `ensureNodeImageCodecs()` и `decodeWithNode(source)` поверх `@jsquash/{jpeg,png,webp,avif}` для серверной подготовки изображений без нарушения браузерного контракта `decode.ts`.
- [x] **Маршрутно-независимые формы компонентов (`src/hooks/component-form/`)**: `bindComponentForm` + `registerComponentForm` + `createComponentFormsHandle` (автообнаружение `*.form.server.ts` в `src/hooks.server.ts`, живой целевой URL, inline-ответ `200` при `outcome: 'not-applied'`, сохранение статуса ошибки `422` и введённых значений без промежуточного `GET`).

### Модуль пользователя (`src/content/user/`)
- [x] **Доменное ядро и жизненный цикл сессии (`AS-01` .. `AS-09`)**: Ed25519 `seed` + одноразовый `challenge` с автообновлением при отказе, ротация/сериализация `renew` по `jti`, Lamport-синхронизация `vault` между вкладками, SSR-проверка через `guard()` и восстановление по `auth_sid`, отзыв в БД при истёкшей `auth_tmp`, `restoreDeleted`, `verifySeed`, `sweepDeletions`.
- [x] **Полный UI `Acl`, маршруты и модалки** (`src/content/user/{routes.ts,modals.ts,acl.ts,ui/Acl.svelte}`, `ui/seed-form/`, `ui/profile-form/`).
- [x] **Полная сквозная верификация (`TB-15`)** *(числа — текущий прогон)*: зелёные `test:guard` (`144/144`), `test:public-api` (10 пакетов / 35 входов), `test:classes`, `svelte-check` (`0 errors, 0 warnings`), `vitest` (`114/114` файлов, `1394/1394` теста), `test:db:probes`, `vite build`, `test:size` и браузерные наборы `test/browser/*` (16 сценариев в `test:browser`, включая `attachment` и живые `shikimori`/`rickmorty`).

---

## 2. Очередь ближайших точечных доработок ([`docs/audit/testing-backlog.md`](./audit/testing-backlog.md))

- [ ] **`TB-01` (`R6`, P0)** — вынести байты аватара из куки `auth_tmp` в отдельный кэшируемый ресурс/маршрут, чтобы реальные цветные фотографии не упирались в лимит `4096 B` на куку и `431`.
- [ ] **`TB-04` + `TB-05b` (P1)** — перевести `challenge.consume()` в `src/content/user/gateway.server.ts` на атомарную операцию в `sharedStore` (`cache_kv`) и выводить флаг `secure` у кук из HTTPS-протокола запроса.
- [ ] **`TB-08` + `TB-11` + `TB-12` (P2)** — обратимая плашка `remove_avatar`, очистка `nickname` в `null` и единый список `avatarFormats` из `userConfig` в `ProfileForm`.
- [ ] **`TB-06b` + `TB-13` (P2)** — сохранение прототипа `RequestEvent` при inline-рендере и ранний лимит байт по конкретному `__form_id` в `src/hooks/component-form/server.server.ts`.

---

## 3. Открытые задачи развития

> Развёрнутое описание каждого открытого пункта (состояние по коду, замеры, варианты,
> рекомендация) и таблица спорных решений — [`docs/audit/open-issues.md`](./audit/open-issues.md).

### Конвейер изображений и файлов ([`docs/design/image-transfer.md`](./design/image-transfer.md))
- [ ] **Этап R4 — механизм готов, хранение нет**: отложенный исход `outcome: 'queued'` (`pollUrl`/`statusUrl` из `#lib/form/queued.js`) уже проходит через `#hooks/component-form` (опрос — GET на адрес формы с `__form_task`, ответ `202`; демо — `src/routes/(site)/(app)/form/queue.server.ts` на `localStore`). Осталось: держать заявки в `sharedStore` (`cache_kv`), чтобы опрос переживал перезапуск инстанса.
- [ ] **Этап R5**: полный перевод поля изображения `/fields` (`src/routes/(site)/(app)/fields/{forms.ts,fields.form.server.ts}`) на `field.photo(...)` из `#components/form/photo.js` с проверкой потолка пикселей (`maxPixels` / `maxSide`).
- [ ] **Этап R7**: брендированный тип `PreparedFile` на границе записи и правило `tooling/layer-guard.mjs` против чтения сырых байтов `File` в маршрутах мимо `#lib/image`.

### Шаги и пользовательский модуль
- [ ] **Планировщик удаления аккаунтов**: подключить периодический/фоновый вызов `sweepDeletions(ports)` (`src/content/user/auth.ts`) для зачистки `profile` и `seed` по истечении `deleteGraceDays` (`TB-14`).
- [ ] **Расширения `useSteps` (по потребности)**:
  - явный признак неадресуемого служебного шага в описании `steps` хоста (`addressable: false`);
  - универсальный аддон вложенных `Steps` глубже одного уровня поверх полной цепочки `host.fullKey`.
- [ ] **UI управления устройствами и удалением аккаунта**: подключить готовые функции ядра `listSessions`, `revokeSession`, `logoutAll`, `requestDelete` к пользовательскому интерфейсу профиля/меню.

### Безопасность клиента и переносимость
- [ ] **Включение `kit.csp`** ([`docs/design/client-integrity.md`](./design/client-integrity.md)): добавить `csp` в `vite.config.ts` (хэш/внешний скрипт для ранней темы в `src/app.html`, self-host шрифта `Manrope`, учёт iframe-превью в dev).
- [ ] **Вынос UI-строк из `src/lib/`** (шаг 1 [`docs/design/port-plan.md`](./design/port-plan.md)): перенести оставшиеся русские строки в словари/опции по образцу `#lib/form/messages.js`.

### Известные ограничения (не баги, но и не сделано)
- **SEO-поля `PageHead`** (`useHeadSeo` в `src/components/shell/page.svelte.ts`) нигде не вызываются: `description`/OG/canonical не заполняются, а подпись функции обещает реактивность, которой при SSR нет. Маршруты ставят `<title>` своим `<svelte:head>`; механизм остаётся незадействованным до появления реальных метаданных.
- **Один инстанс процесса:** часть состояния живёт в памяти (`localStore`), поэтому multi-instance деплой требует `sharedStore` — это `TB-04`, `TB-06b` и `TB-13` в реестре.
- **Безопасность клиентского контура:** `kit.csp` не включён ([`docs/design/client-integrity.md`](./design/client-integrity.md)) — хэш/внешний скрипт ранней темы и self-host шрифта ещё не сделаны.

### Отложенные треки `#lib/db`
- [ ] **ACL-схема коллекций и generic REST-слой** — проект и приёмочная матрица зафиксированы в [`src/lib/db/docs/ACL-DESIGN.md`](../src/lib/db/docs/ACL-DESIGN.md) (реализация отложена владельцем).
- [ ] **Таблица истории ручных миграций и виртуальные вычисляемые поля** — отложены до запуска ACL-трека (см. [`src/lib/db/PORTING.md`](../src/lib/db/PORTING.md) §3.1).
