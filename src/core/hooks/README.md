# `src/hooks` — связки между библиотеками и средой

Библиотеки в `src/lib` не знают друг о друге: у каждой своё чистое ядро без чужих импортов (`tooling/core-purity.mjs`). Когда двум библиотекам или библиотеке и серверному конвейеру SvelteKit нужно работать вместе, переходник пишется **здесь**, а не внутри одной из них — оба ядра остаются переносимыми по отдельности.

---

## Состав папки

| Модуль | Что соединяет | Роль |
|---|---|---|
| `api-error.ts` | клиент / SSR × формат ошибок API | Изоморфный разбор и человекочитаемое представление ошибок API без затягивания серверных секретов в клиентский бандл. |
| `app-errors.svelte.ts` | UI-оболочка × ошибки приложения | Реактивное хранилище глобальных уведомлений об ошибках. |
| `cache-db.ts` | `#core/lib/cache` × `#core/lib/db` | Общее между инстансами KV-хранилище в PostgreSQL (`pgStore`, ресурс `cacheKv` → таблица `public.cache_kv`), часы базы (`clock_timestamp()`), атомарные `add`/`incr` и оппортунистическая вычистка просроченных строк. В приложении экземпляр экспортируется как `sharedStore` из `src/core/server/cache.server.ts`. |
| `cookie-vault/` | зашифрованные HttpOnly-куки × `#core/lib/form` | Универсальный браузерный куки-сейф (`AES-256-GCM` со связкой `AUTH_SEAL_SECRET` и `AAD`) для динамического подключения пользовательских секретов/облаков на лету (`0` env-ключей и `0` записей в общей БД). |
| `storage-db.ts` | `#core/lib/storage` × `#core/lib/db` × `#core/lib/cache` | Реестр учёта места, броней и манифестов файлов в PostgreSQL (`pgStorageLedger`, ресурсы `storageFile` → `public.storage_file` и `storageReservation` → `public.storage_reservation`, часы базы `clock_timestamp()`) и адаптер `cacheStorageStore` поверх `#core/lib/cache` (`localStore` / `sharedStore`). |
| `storage-schema.ts` | `#core/lib/db` × клиентские гранты пула серверов | Изолированное описание `STORAGE_ACL` и модели `storageServer` (`public.storage_server`) без импорта `#core/lib/storage` — чтобы `MenuBody.svelte` и `StorageServersEntry.svelte` проверяли `grants(storageServer)` без затягивания движка хранилища в клиентский бандл. |
| `storage-server-form/` | `#core/lib/form` × `#core/lib/storage` | Одно определение полей сервера S3 / WebDAV для пула и куки-сейфа. Не пишет в БД и куки: транспорт остаётся у вызывающего. |
| `component-form/` | `#core/lib/form` × SvelteKit `Handle` / `$app/state` | Маршрутно-независимые формы компонентов: компонент со своей формой (`SeedForm`, `ProfileForm`, `MenuBody`, `/fields`) монтируется на любой странице или в модалке без `actions` в `+page.server.ts`. |
| `db-form.ts` | `#core/lib/db` × `#core/lib/form` | Вывод параметров и валидаторов полей формы из дескриптора ресурса БД (`formParams(resource)`), включая доказательство полноты правил `rulesFrom` для `pick`. |
| `db-grants.svelte.ts` | `#core/lib/db` (`grants`, `checkGrants`) × Svelte 5 `$derived` | Универсальная фабрика реактивного хука `createUseGrants(getDefaultActor)` для синхронной проверки прав модели и полей БД в SSR и браузере (`0` запросов в БД, мгновенный пересчёт при смене сессии или владельца). |
| `db-schema.ts` | `#core/lib/db` (`/sync`) × `#core/lib/form` | Изоморфный экран переноса схемы: отчёт `SchemaReport` → слова для человека (`StepView`) → описание формы решений (`defineForm`). Читают `#core/hooks/db-schema.server.ts`, `#core/ui/db-schema/SchemaPending.svelte` и страница `/schema`. |
| `db-schema.server.ts` | `#core/lib/db` (`/sync`, `createSchemaAdmin`) × `#core/server/db.server.js` × `#core/lib/form/server` | Серверная половина `/schema`: сборка отчёта, приём решений под `DB_ADMIN_TOKEN`, инвалидация живого кэша и разбор ошибок формы. |
| `graphql.server.ts` | `#core/lib/fetch` × GraphQL | Серверный адаптер запросов к внешним GraphQL-источникам с нормализацией ошибок и очередей. |
| `js-only.svelte.ts` | гидратация Svelte 5 | Реактивный флаг оживления клиента после гидратации (` hydrated()`). |
| `mobile.svelte.ts` | CSS `--mobile` × `matchMedia` | Узкий экран приложения. Запрос живёт в `src/app.css` и совпадает с Uno `max-lg`. До эффекта `matches` = false. Модалка флаг не читает: `ModalHost` получает `isNarrow`. |
| `links/` | `#core/lib/modals` × SvelteKit `<a>` | Перехват переходов по ссылкам (`asLink`) для бесшовного открытия модальных маршрутов поверх текущей страницы с graceful degradation без JS. |
| `loader.svelte.ts` | `$app/state` navigating × UI | Отложенный индикатор навигации без мелькания на быстрых переходах. |
| `modal-paginator.svelte.ts` | `#core/lib/modals` × `#core/lib/paginate` × `#core/lib/address` | Привязка `ScopedStore` пагинатора к жизни слота в `modals.chain` (`useSlotPaginatorScope`), поиск стора модалки-владельца для экранов фильтров (`useOwnerPaginatorStore`) и регистрация поуровневых слоевых ключей `m<k>.*` в `claimLayerKeys`. |
| `module-ext.ts` | `#core/lib/db` × опциональные модули в `src/modules/*` | Контракты автоподхватываемых расширений модулей (`db.ext.ts`, `nav.ext.ts`) для бесконфликтной установки модулей поверх чистого ядра. |
| `schema-route.ts` | `#core/lib/address` × страница ошибок | Один адрес экрана переноса схемы (`SCHEMA_PATH = '/schema'`, `schemaHref(from)`) без зависимостей — чтобы `ErrorPage.svelte` не тянул в клиент `#core/lib/db/sync` ради строки адреса. |
| `task-stream.server.ts` | `#core/lib/task` × HTTP NDJSON | Серверный ответ `taskResponse(request, run, { watch })` с потоковой отдачей шагов задачи. |
| `use-drawer.svelte.ts` | `matchMedia` × UI-шторки | Реактивное переключение мобильной шторки / десктопной панели. |

---

## Папочный модуль `component-form/`

Многофайловые хуки оформляются отдельной папкой с чётким разделением клиентской и серверной точек входа:

- `index.ts` — публичный клиентский вход (`bindComponentForm`, `cancelComponentFormUpload`, типы `ComponentFormOptions`, `FormSessionGuard`).
- `client.svelte.ts` — привязывает `<Form>` и `kitActionTransport` к текущему видимому адресу (`visibleAddress().url`), подхватывает одноразовый `page.data.formResult` своего `formId` после нативного `POST` без JS (включая `lockStateKey` и `onSuccess`) и при переданном `session: FormSessionGuard` прозрачно обновляет мёртвый временный снимок и повторяет запрос 1 раз при `auth.expired`.
- `server.server.ts` — `registerComponentForm(reg)`, `componentFormsHandle` и фабрика `createComponentFormsHandle(modules)` для композиции в `src/hooks.server.ts` (`import.meta.glob('./**/*.form.server.ts')`) с дедупликацией `Set-Cookie`:
  - `GET` (кроме опроса задачи `?__form_task=…&__form_id=…`) и чужие `POST` без зарегистрированного `__form_id` проходят в `resolve(event)` с нетронутым телом (поддерживая обычные SvelteKit `actions`, например `/schema`);
  - запросы с JS передают заголовок `x-form-id` (`FORM_ID_HEADER`), поэтому сервер распознаёт регистрацию до чтения тела и направляет поток напрямую в конвейер формы (`bodyLayer`) без промежуточного буфера и без `request.clone()`;
  - нативные HTML `POST` без `x-form-id` читаются в один проход: при превышении `FORM_BODY_LIMIT` сканируются только первые 32 КиБ для извлечения `__form_id`, остаток потока немедленно отменяется, а `createFormHandler` формирует штатный `Result` со статусом `413` (`body.too-large`, `body.too-many-keys`, `request.too-many`) как по JSON, так и на SSR-странице без JS (`locals.formResult`);
  - без JS при успехе выполняет `303 See Other` (для `outcome === 'queued'` по умолчанию уводит на `statusUrl`, если регистрация не переопределила `redirectOnSuccess`, либо рендерит ответ в том же запросе при `'inline'` / `outcome === 'not-applied'`).
- `transport.ts`, `ws-transport.ts`, `ws-protocol.ts`, `ws-integrity.ts`, `ws-session.server.ts`, `upload-eta.ts`, `upload-progress.svelte.ts`, `authorize.server.ts` — клиентский и серверный транспорты отправки формы:
  - формы без файлов уходят штатным HTTP `fetch` (`transport.ts`) с заголовком `x-form-id`;
  - `kitActionTransport` отправляет форму на **страничный экшен SvelteKit** (`?/имя`): ответ-обёртку `{ type: 'redirect', location }` он применяет переходом `goto(location, { invalidateAll: true })` и отдаёт форме успех. Без этого редирект экшена читался как «неизвестный ответ»: действие на сервере уже выполнено, а форма показывала «сервер ответил HTTP 200». Внешний адрес и `//хост` переходом не становятся — это подмена, а не маршрут. Адрес самого действия (`action`) обязан быть **абсолютным** (корневой путь `/…`): компонент-форма монтируется поверх любого адреса-носителя, и относительный `./?/…` ушёл бы на носитель, где нужного экшена нет. `kitActionTarget` проверяет это в момент отправки (геттер адреса тоже) и при относительном/внешнем адресе транспорт отказывает **до** `fetch` — исход `not-applied`, код `transport.action-relative` (P2-1);
  - при наличии выбранных файлов `bindComponentForm` автоматически переключается на потоковый транспорт `wss://` (`/api/form-upload`, скользящее окно сегментов `W=4`, размер сегмента из `WS_UPLOAD_CHUNK_SIZE`, ранний гейт `authorize` и проверка полей на Кадре 0 до чтения байтов файла, `ping`/`pong` keepalive, позиционно-привязанный `HMAC-SHA-256` на сегментах, реактивный прогноз времени и скорости `predictUploadEta`, авто-догрузка с `resumeToken` и прозрачный откат на HTTP `multipart/form-data` без JS).
- Бюджет тела формы приходит из env (`src/env.ts` → `#core/server/form-budget.server.ts`, `Limits.budget`) и уезжает в разметку атрибутом `data-budget`; объявленный в `defineForm({ budget })` лимит может быть только меньше потолка окружения. Поля файлов без `v.maxSize` при известном бюджете — ошибка сборки формы (`#core/lib/form`).
- `types.ts` — контракты регистрации (`authorize`, `integrity`, `task`, `watch`) и опций.

---

## Реактивная проверка прав модели — `db-grants.svelte.ts` (`createUseGrants`)

Ядро `#core/lib/db` остаётся чистым от Svelte (`core-purity`), а слой `src/core/hooks/` не импортирует предметную область `src/modules/` (`layer-guard`). Поэтому реактивная склейка `checkGrants` с рунами Svelte 5 живёт в `src/core/hooks/db-grants.svelte.ts` как фабрика `createUseGrants(getDefaultActor)`, а конкретный домен (`src/modules/user/base/svelte/grants.svelte.ts`) передаёт в неё свой стор сессии:

```ts
// src/modules/user/base/svelte/grants.svelte.ts
import { createUseGrants } from '#core/hooks/db-grants.svelte.js'
import { vault } from './vault.svelte.js'

export const useGrants = createUseGrants(() =>
  vault.principal ? { id: vault.principal, permissions: vault.permissions } : null,
)
```

Хук поддерживает две перегрузки и геттерные опции:

1. **Одиночный грант или массив грантов (`AND`)** — возвращает `{ readonly current: boolean }`:
   ```ts
   const canCreate = useGrants(grants(block).insert)
   const canPick = useGrants([grants(auth).select, grants(block).insert])
   // в шаблоне: {#if canCreate.current} ... {/if}
   ```
2. **Именованная карта возможностей** — возвращает объект с ленивыми реактивными геттерами по каждому ключу:
   ```ts
   const caps = useGrants(
     {
       canUpdate: grants(block).update,
       canEditReason: grants(block).fields.reason.update,
       canSoftDelete: grants(block).delete,
       canHardDelete: grants(block).hardDelete,
     },
     { ownerId: () => detail?.block.authId ?? null },
   )
   // в шаблоне: {#if caps.canEditReason} ... {/if}
   ```

Опции `UseGrantsOptions`:
- `ownerId?: string | null | (() => string | null | undefined)` — владелец целевой записи (если передана функция, читается внутри `$derived` и пересчитывает права при переключении карточки или маршрута);
- `actor?: GrantActor | null | (() => GrantActor | null | undefined)` — явная подмена субъекта вместо `getDefaultActor()` (например, для изолированных тестов или предпросмотра от имени другой роли);
- `onUnknown?: 'false' | 'true' | 'throw'` — политика для произвольных предикатов `PolicyFn`, зависящих от данных строки (по умолчанию `'false'`).

Поскольку и в SSR (`page.data.user`), и после гидратации в браузере `getDefaultActor()` читается синхронно из памяти без сетевых запросов, разметка на сервере и первом клиентском кадре совпадает бит-в-бит, а при смене прав в другой вкладке (`BroadcastChannel`) кнопки и поля перестраиваются мгновенно.

---

## Правило добавления новых связок

- Одиночный компактный переходник без внутренних подмодулей — один файл `src/core/hooks/<имя>.ts` (и `<имя>.test.ts` рядом); строго серверные связки носят суффикс `*.server.ts`.
- Связка из нескольких файлов (раздельные `client` / `server.server` / `types`) — отдельная папка `src/core/hooks/<имя>/` с явными точками входа.
- Внутри `src/core/hooks/` нет визуальной разметки и доменных текстов: разметка и домен живут в `src/modules/<модуль>/` и `src/core/ui/`.

`form-portal.ts` связывает контролы перенесённого блока с формой по `form`: сохраняет явно заданные атрибуты и отслеживает новые узлы. `cleanup` снимает только собственные атрибуты, `nextFrame` повторяет привязку на следующем кадре.
