# Диск (`drive`) и WebDAV: модуль «как Google Drive, но проще» + серверная сторона WebDAV

> Исполняемый план ремонта: [plan-drive-repair.md](./plan-drive-repair.md).
> При расхождении целевая архитектура и проверки заданы там; прежние статусы ниже
> исторические и не подтверждают исправность форм, ACL и перезаписи файлов.

Статус: **этапы 0–3, 5 и 6 реализованы** (включая фильтры/пагинатор,
экран токенов WebDAV, Class 2 со стором блокировок `drive_dav_lock` и гарды);
UI 4c–4g и `DriveEntry` на главной реализованы, ремонт проведён по
[`plan-drive-repair.md`](./plan-drive-repair.md): списки на `Listing` со
страничным пагинатором (`drive`), все мутации — отдельные операции-ссылки,
срез `drive.ids` поддержан сервером (`none` — пустой набор), DAV-пароли
выдаются/отзываются операциями. Остался только шаг «выбранные» в UI пикера.
WebDAV-сервер и `DavBackend`
живут в ядре (`src/core/lib/storage/webdav/`), модуль — в `src/modules/drive`.

Заменяет [`plan-storage.md`](./plan-storage.md) §3–5 и компонентный проект «Облака»
(`design/cloud.md` остался в другой ветке; старая модель `cloud_node` с тремя уровнями
доступа и паролями). Механизмы Г/Д/Е из
`plan-storage` уже в коде и остаются как есть — см. §1.

---

## 1. Что уже сделано (проверено по коду и тестам)

| Блок | Где | Тесты |
|---|---|---|
| Включаемый `hash: true` / `expectedHash` и дедупликация по `(hash, size)` | `src/core/lib/storage/index.ts` (`put`, `findByHash`), `src/core/hooks/storage-db.ts` (колонка `hash`, частичный индекс) | `gde.test.ts`, `github-audit.test.ts` |
| Реплики внутри записи (`replicas`), `readStrategy: primary / round-robin / consistent-hash`, `affinityKey` | `index.ts` (`resolveReadCandidates`, `serve`, `cdn: true`) | `gde.test.ts`, `s1-s2.test.ts` |
| Счётчик пропаж, `suspendServer` / `resumeServer`, `storage.reconcile()`, `onServerSuspended` | `index.ts`, `ledger.ts`, `types.ts` | `gde.test.ts`, `plan-completion.test.ts` |
| **WebDAV-сервер** (`OPTIONS/PROPFIND/PROPPATCH/GET/HEAD/PUT/DELETE/MKCOL/COPY/MOVE/LOCK/UNLOCK`), общий протокол, `memoryDavBackend`, `memoryDavLockStore`, `basicAuthGuard` | `src/core/lib/storage/webdav/{protocol,client,server}.ts`; вход `webdav.js` | `webdav/server.test.ts` (14), `webdav.test.ts` (клиент) |
| Клиент WebDAV (`webdavDriver`) | `webdav/client.ts` | `webdav.test.ts` |

Проверки: `vitest run src/core/lib/storage/webdav` — 16 pass / 1 skip;
`node tooling/core-purity.mjs`, `node tooling/public-api.mjs` — pass;
`KIT_ADAPTER=node npx svelte-check --tsconfig ./tsconfig.json` — 0 errors.

Разрывы из `plan-storage` §1 (хеш, удаление общих частей, `N+1` при чтении, пропажи `404`)
закрыты. Оставшиеся 12 «устаревших» путей в живых md относятся к опциональному demo-модулю
и к шаблонным примерам — см. `audit-md-paths.md`.

---

## 2. Исследование: GitHub API, 17.11.2026

Запросы: `webdav server typescript`, `webdav cloudflare worker`, `google drive clone typescript`,
code search `PROPFIND multistatus language:TypeScript`.

### 2.1. Репозиторий, откуда приходят клиентские зависимости

`@remix-run/lazy-file`, `@remix-run/response`, `@remix-run/fs`, `@remix-run/form-data-parser`
живут в **`remix-run/remix`**, `packages/*`:

- `packages/response/src/lib/file.ts` — `createFileResponse`: слабый `ETag`
  (`W/"size-lastModified"`), `Last-Modified`, `If-Match`/`If-Unmodified-Since` (`412`),
  `If-None-Match`/`If-Modified-Since` (`304`), `Range`/`If-Range` (`206`, `416`),
  `Accept-Ranges` и `HEAD`. Мы **переиспользуем этот код как есть** в серверном `GET`/`HEAD`,
  поэтому поведение WebDAV совпадает с `/api/storage/[...path]`.
- `packages/file-storage/src/lib/file-storage.ts` — минимальный интерфейс `FileStorage`
  (`get`, `has`, `list({ prefix, limit, cursor, includeMetadata })`, `put`, `remove`, `set`)
  и `FileMetadata` (`key`, `name`, `size`, `type`, `lastModified`). Это образец для
  контракта байтового слоя «Диска»: без фреймворка, с курсорной пагинацией и префиксом.
- `packages/file-storage-s3` — отдельный бэкенд для того же интерфейса. Наш аналог —
  `DavBackend` + будущий `driveDavBackend`.

**Вывод:** не изобретаем HTTP-семантику и не тянем Express/Node; сервер собран на тех же
пакетах, что клиент.

### 2.2. Боевые WebDAV-серверы на Workers

| Репозиторий | Метрики | Что даёт | Берём / нет |
|---|---|---|---|
| [`abersheeran/r2-webdav`](https://github.com/abersheeran/r2-webdav) | TS, 447★, обновлён 16.11.2026 | Workers + R2, WebDAV **Class 1 и 2** (`LOCK`/`UNLOCK`), мёртвые свойства, `PROPPATCH`; CI гоняет **litmus** `basic`, `copymove`, `props`, `locks` | **Берём** набор методов, коды (`207/201/204/409/412/423`), семантику lock-токенов и `Depth`. **Не берём** `@xmldom/xmldom` и хранение lock-записей в метаданных объекта: ядру запрещены лишние зависимости, а блокировки должны быть общими между инстансами |
| [`NaviaX/workers-dav`](https://github.com/NaviaX/workers-dav) | TS, 85★, 24.10.2026 | Google Drive → WebDAV на Workers; `Depth: infinity` → `403`; свойства узла Drive → `PROPFIND` | **Берём** отказ от бесконечной глубины, маппинг «узел → DAV-ресурс», минимальный `DAV: 1` | 
| [`ling-drag0n/CloudPaste`](https://github.com/ling-drag0n/CloudPaste) | 2726★, 2026 | агрегатор хранилищ + WebDAV-монтирование, S3/OneDrive/Google Drive/Telegram | Смотрим как продуктовый ориентир; код не берём (другой стек и объём) |
| [`sagan/FlareDrive`](https://github.com/sagan/FlareDrive), [`fanchenggang/Davflare`](https://github.com/fanchenggang/Davflare) | 8★ / 106★ | R2 + WebDAV, chunked upload, корзина | Подтверждают востребованность корзины и `Range`; код не берём |
| `nephele` (+ адаптеры) | 1.0.0-alpha.68, 21.10.2026 | самый живой «полный» DAV-сервер | **Нет**: alpha, Express/Node, не живёт в Workers |

### 2.3. «Google Drive, но проще»

Публичные клоны Drive (`EzeibekweEmma/google-drive-clone` 68★ и десятки подобных) — учебные
Next.js/Appwrite-приложения без модели прав и без переиспользуемого ядра; их UI-идеи полезны,
код — нет. Опираемся на семантику Google Drive API (`files.list` с `q`/`fields`,
`parents`, `trashed`, `starred`, `quotaBytesUsed`) и на интерфейс `FileStorage` из §2.1.

---

## 3. WebDAV: две стороны, один вход

```
src/core/lib/storage/webdav.ts          # публичный вход (barrel), старые импорты не меняются
src/core/lib/storage/webdav/
  protocol.ts   # DAV-пути, href, XML, Depth/Destination/Overwrite, lock-токены, weakEtag
  client.ts     # клиентский драйвер хранилища (webdavDriver) — без изменений
  server.ts     # createWebdavServer + DavBackend + memoryDavBackend + memoryDavLockStore + basicAuthGuard
  server.test.ts
```

Почему так: клиент и сервер — **разные ответственности и разные потребители**. Клиент знает
DSN, Basic-логин и `basePath` чужого облака; сервер знает только `DavBackend` и `Request`.
Общее у них — `protocol.ts` (пути/XML/ETag), а не общий файл на тысячу строк.

### 3.1. Контракт `DavBackend`

```ts
interface DavBackend {
  stat(path: string): Promise<DavResource | null>
  list(path: string): Promise<readonly DavResource[]>
  read(path: string): Promise<DavFileLike | null>
  write(path: string, input: DavWriteInput): Promise<DavResource>
  mkdir(path: string): Promise<DavResource>
  remove(path: string): Promise<boolean>
  copy(from: string, to: string, options: { deep: boolean; overwrite: boolean }): Promise<'created' | 'replaced'>
  move(from: string, to: string, options: { overwrite: boolean }): Promise<'created' | 'replaced'>
}
```

`DavResource.etag` обязан совпадать с `GET` (`weakEtag(size, lastModified)`), иначе
`If-Range`/`If-None-Match` у клиентов ломаются. Папки существуют только в бэкенде: у
файлового хранилища нет пустых директорий, поэтому «Диск» отдаёт их из БД.

### 3.2. Матрица методов

| Метод | Успех | Ошибки, которые важны клиентам |
|---|---|---|
| `OPTIONS` | `200`, `DAV: 1` (или `1, 2`), `Allow`, `MS-Author-Via: DAV` | — |
| `PROPFIND` | `207 multistatus`, `Depth: 0/1` | `400` битый `Depth`; `403` `infinity`; `404` нет ресурса |
| `PROPPATCH` | `207` с `403` в `propstat` (мёртвые свойства не храним) | `404`, `423` |
| `GET`/`HEAD` | `200`, `206`, `304` | `412`, `416`, `404` |
| `PUT` | `201` создан / `204` заменён + `ETag` | `409` нет родителя, `405` папка, `423` lock |
| `MKCOL` | `201` | `405` уже есть, `409` нет родителя, `415` тело |
| `DELETE` | `204` | `404`, `403` корень, `423` (включая блокировки детей) |
| `COPY` | `201`/`204`, `Depth: 0|infinity` | `412` `Overwrite: F`, `409` нет родителя, `423` |
| `MOVE` | `201`/`204` | `403` корень/тот же путь, `409` перенос в себя, `412`, `423` |
| `LOCK`/`UNLOCK` | `201` + `Lock-Token` / `200` refresh / `204` unlock | `400`, `404`, `409`, `423`, `501` без стора |

### 3.3. Безопасность и ограничения v1

- **Изоляция пути:** `basePath` снимается и возвращается в `href`; `..` (в том числе
  `%2e%2e`), `/`, `\`, `NUL` и управляющие символы в сегменте → `400`.
- **Аутентификация:** `authorize(request)` — хук приложения; готовый `basicAuthGuard`
  сравнивает логин/пароль за постоянное время. Пароль — **пароль приложения**, не `seed`.
- **Блокировки:** `DavLockStore` с `covering`/`within`; по умолчанию память процесса.
  Для нескольких инстансов — общий стор (этап 6). Без стора сервер честно объявляет Class 1.
- **Ограничения:** `Depth: infinity` по умолчанию запрещён (`maxDepth: 1`), мёртвые свойства
  не сохраняются, lock-null-ресурсы (LOCK на несуществующий путь) не поддерживаются —
  это осознанные отказы, а не недоделки. Полная совместимость с Office (`LOCK` до `PUT`)
  потребует отдельного решения.

---

## 4. Модуль «Диск»: модель «как Drive, но проще»

### 4.1. Что входит и что нет

| Входит | Не входит (v1) |
|---|---|
| дерево папок и файлов любого размера, хлебные крошки | версии файлов и история правок |
| загрузка с дедупликацией (`hash: true`) и квотой | Google Docs/Sheets/Slides и совместное редактирование |
| переименование, перенос, копирование, звёздочка | публичные ссылки и пароли на узлы (старая модель `visibility`/`password`) |
| корзина: мягкое удаление поддерева, восстановление, окончательная очистка | командные «общие диски», внешние гости, комментарии |
| поиск по имени и фильтры (тип, владелец, дата) | миниатюры/превью (подключаются позже через `#core/lib/image`) |
| доступ: владелец + список `drive_share` (viewer/editor) с наследованием | роли на отдельные поля, аудит-журнал каждого действия |
| монтирование по WebDAV (Basic + пароль приложения) | мобильные клиенты и офлайн-синхронизация |

### 4.2. Модель

`drive_node` (одна самореферентная таблица вместо `cloud_node`):

| Поле | Тип | Смысл |
|---|---|---|
| `id` | `uuid` | идентификатор узла |
| `owner_id` | `uuid` | владелец (аккаунт) |
| `parent_id` | `uuid null` | родительская папка (`null` — корень) |
| `kind` | `'folder' \| 'file'` | папка или файл |
| `name` | `text` | имя 1…255, без `/`, `\`, `NUL`, `.`/`..` |
| `file_id` | `text null` | логический путь в `#core/lib/storage` (`drive/<owner_id>/<node_id>`) |
| `size` | `bigint` | логический размер (для квоты; физика может быть меньше за счёт дедупликации) |
| `content_type` | `text null` | MIME |
| `hash` | `text null` | `SHA-256` открытых байтов (когда загрузка шла с `hash: true`) |
| `starred` | `boolean` | звёздочка |
| `trashed_at` | `timestamptz null` | мягкое удаление |
| `trashed_from` | `uuid null` | прежний родитель для восстановления |
| `created_at` / `updated_at` | `timestamptz` | времена |

`drive_share`: `node_id`, `uid`, `role: 'viewer' | 'editor'`, `created_at`.
Наследование — вверх по родителям (папка шарит всё поддерево), глубина ограничена
`DRIVE_MAX_DEPTH` (например `32`). Паролей и `visibility` нет — это главное упрощение.

Инварианты в БД и `checks.ts`:
1. `kind = 'folder'` ⇒ `file_id IS NULL`; `kind = 'file'` ⇒ `file_id IS NOT NULL`.
2. `parent_id` — только папка того же `owner_id`; циклов нет.
3. `lower(name)` уникально в пределах `(owner_id, parent_id)` среди живых узлов:
   `UNIQUE NULLS NOT DISTINCT (owner_id, parent_id, lower(name)) WHERE trashed_at IS NULL`.
4. `sum(size)` живых файлов ≤ `DRIVE_QUOTA_BYTES` (квота считается по логическому размеру).
5. Узел в корзине не виден в списках, но его дети не удаляются физически.

Индексы: `(owner_id, parent_id, lower(name))` для листинга; `(owner_id, updated_at DESC)`
для «недавних»; `(owner_id) WHERE trashed_at IS NOT NULL` для корзины; `(owner_id, lower(name)
text_pattern_ops)` для поиска по префиксу.

### 4.3. Чистое ядро `src/core/lib/drive`

Без `#core/lib/db`, без Svelte, без `node:*` — только доменные функции (тесты рядом):

| Файл | Содержимое |
|---|---|
| `names.ts` | `normalizeDriveName`, `assertDriveName`, `driveNameKey` (case-fold), запрещённые имена Windows |
| `paths.ts` | `driveStoragePath(ownerId, nodeId)`, `driveBreadcrumbs(nodes)`, `driveJoin(parent, name)` |
| `tree.ts` | `canMove(node, target, subtreeIds)`, `collectSubtreeIds`, `collectTrashedIds`, `restorePlan` |
| `quota.ts` | `remainingQuota`, `assertQuota`, `formatBytes` |
| `listing.ts` | ключи сортировки (`name`, `updated`, `size`), курсор `base64url({sort,last,name,id})`, `compareDriveEntries` |
| `types.ts` | `DriveNodeView`, `DriveEntry`, `DriveSlice`, `DriveShareRole` |

### 4.4. Серверный модуль `src/modules/drive`

| Файл | Ответственность |
|---|---|
| `schema.ts` | ресурсы `drive_node`, `drive_share` для `#core/lib/db`: `DRIVE_ACL` (`drive.read`, `drive.write`, `drive.share`, `admin`), уникальные индексы и `deletedAt` |
| `service/query.ts` | срез папки: дети + хлебные крошки + `starred`/`trashed`, сортировка, курсор, поиск |
| `service/mutate.ts` | `mkdir`, `rename`, `move`, `copy`, `trash`, `restore`, `purge`, `star` — все проверки в одной транзакции |
| `service/upload.ts` | `const { storage } = await resolveAppStorage()` → `storage.put({ path: driveStoragePath(...), hash: true, size, contentType })`; проверка квоты в транзакции, запись `drive_node` после `put`, откат узла при ошибке |
| `service/download.ts` | проверка доступа → `serveAppStoragePath(nodePath, request)` (Range/304 как у `/api/storage`), при необходимости `Content-Disposition: attachment` |
| `service/access.ts` | эффективный доступ: владелец → `admin`/`drive.read` → `drive_share` вверх по дереву; проекция `canRead/canWrite/canShare` |
| `checks.ts` | инварианты §4.2 (родитель-папка, цикл, имя, квота, роль) |
| `messages.ts` | тексты отказов/подсказок одним словарём |
| `gateway.server.ts` | серверный фасад SvelteKit: набор `?/entries` с `intent` (`mkdir/rename/move/copy/trash/restore/star/share`), стриминговая загрузка |
| `routes.ts` / `modals.ts` | пары «модалка + маршрут»: `drive.browse` `/drive/[folderId=uuid]`, `drive.node`, `drive.access`, `drive.trash`, `drive.filters` |
| `ui/*` | `DriveBrowse.svelte` (список + крошки + загрузка), `DriveNodeCard`, `DriveAccessForm`, `DriveTrash`, пагинатор `url: false` в слое |

Секция `src/sections/drive`: страница `/drive`, `/drive/trash`, фильтры в адресе
(`?type=&uid=&from=`), модалки — через `asModalLink('drive.browse', …)`. Один компонент на
страницу и модалку (`isModalMode`), как в `user.sessions`.

### 4.5. Байты, дедупликация и квота

- `service/upload.ts` вызывает `resolveAppStorage()` → `storage.put({ path: driveStoragePath(ownerId, nodeId), hash: true, size, contentType })`.
  При совпадении `(hash, size)` библиотека не отправляет байты в облако второй раз
  (`deduplicated: true`) — новый узел получает свою запись реестра, но физические части общие.
- `storage.put` резервирует ёмкость **сервера** в ledger, а квота пользователя — отдельный
  лимит: `sum(size)` по живым узлам проверяется в той же транзакции до `put`. Иначе один
  пользователь мог бы занять весь пул, не превысив `DRIVE_QUOTA_BYTES`.
- `size` в `drive_node` — логический размер: квота пользователя не «экономит» на дубликатах
  (иначе один файл, загруженный дважды, обходил бы лимит).
- Удаление узла в корзину **не удаляет** `storage_file`; окончательная очистка (`purge`)
  вызывает `resolveAppStorage().storage.del`, а библиотека удаляет физические части только при нуле ссылок.
- Восстановление из корзины возвращает узел на прежнего родителя; если родителя уже нет —
  в корень (правило явное, проверяется тестом).

### 4.6. WebDAV-монтирование «Диска»

- Маршрут `src/routes/api/dav/[...path]/+server.ts` → `driveDav.handle(request)`.
- `createWebdavServer({ backend: driveDavBackend, basePath: '/api/dav', authorize })`;
  `authorize` разбирает `Basic` и проверяет **пароль приложения**:
  таблица `drive_dav_token` (`id`, `auth_id`, `label`, `secret_hash`, `prefix`,
  `created_at`, `last_used_at`, `revoked_at`). Хеш — HMAC-SHA-256 от секрета с серверным
  ключом, как `subnetHash` в `user/base/service/auth.ts`: новых зависимостей (`argon2`/`scrypt`)
  нет, а перебор по дампу БД требует ключа. Пароль показывается один раз.
- `driveDavBackend` реализует `DavBackend` поверх `service/*`, а не поверх файловой системы:
  `list` — дети узла из БД, `stat` — узел + `weakEtag(size, updated_at)`, `read` — `resolveAppStorage().storage.lazy(fileId)`
  (ленивый `StreamFile`, `Range` считает `createFileResponse`), `write` — тот же `service/upload`,
  `mkdir/move/copy/remove` — те же мутации, что и в UI. Права проверяются один раз в сервисе.
- Конфликты имён: `PUT` в существующий файл разрешён (WebDAV этого ждёт), `MKCOL`/`MOVE` с
  занятым именем — `409`/`412` по `Overwrite`.
- v1 объявляет **Class 1**. `LOCK`/`UNLOCK` включаются на этапе 6 вместе с общим стором
  блокировок (`drive_dav_lock`), иначе два инстанса разойдутся в правах на запись.

---

## 5. Этапы

| Этап | Содержание | Выход (тест/проверка) |
|---|---|---|
| **0. Сделано** | WebDAV разделён на `protocol/client/server`; сервер, память-бэкенд, память-lock-store, Basic-guard; README storage обновлён | `vitest run src/core/lib/storage/webdav` (16 pass), `core-purity`, `public-api`, `svelte-check` — зелёные |
| **1. Ядро «Диска»** | `src/core/lib/drive/*` (§4.3) + unit-тесты имён, путей, циклов, квоты, курсора | `vitest run src/core/lib/drive` — зелёный; `core-purity` не видит `node:*`/`#core/lib/db` |
| **2. Модель и права (сделано)** | `drive_node`, `drive_share`, `DRIVE_ACL`, `checks.ts`, `service/access.ts`; миграция через `schemaSpec` | тест среза: закрытая папка не протекает в список; цикл и дубль имени отклоняются |
| **3. Мутации и байты (сделано)** | листинг с курсором, `mkdir/rename/move/copy/trash/restore/star`, загрузка `hash: true`, квота, `purge` | тест «загрузил два одинаковых файла → `deduplicated` на втором, квота считает два»; «удалил один → байты живы, удалил второй → `del` вызван» |
| **4. UI (4c–4g сделано)** | `drive.browse`/`drive.node`/`drive.trash`/`drive.picker`, `/drive`, `/drive/[folderId]`, `/drive/node/[id]`, `/drive/trash`, `/drive/pick`; формы mkdir/rename/move/copy/trash/restore/purge/star, загрузка, доступ, одиночный пикер | SSR-тест прав (читатель/редактор) — есть; фильтры/пагинатор и браузерный тест — следующие |
| **5. WebDAV (сделано)** | `/api/dav/[...path]`, `drive_dav_token`, `driveDavBackend`, Class 1 | unit с `Request` на реальном бэкенде: `PROPFIND` не отдаёт чужие узлы, `PUT` пишет через сервис, `Range` = `storage.serve`; ручная проверка `curl -X PROPFIND` |
| **6. Class 2 и стражи** | `drive_dav_lock` (общий стор), включение `LOCK/UNLOCK`; гарды: путь-литералы в разделе, мёртвые экшены, `test:size` | `LOCK` на двух инстансах: второй получает `423`; линт/гарды зелёные |

UI идёт вертикальными срезами поверх этих этапов (см. `plan-drive-ui.md` §10):
read-only список — сразу после этапа 2, формы и загрузка — после этапа 3,
экран токенов WebDAV — после этапа 5.

---

## 6. Инварианты и чем ловятся

| Инвариант | Проверка |
|---|---|
| имя уникально в папке без учёта регистра | unit + уникальный индекс `NULLS NOT DISTINCT` |
| перенос не создаёт цикл и не выходит за `owner_id` | unit `tree.ts` + тест сервиса |
| чужой узел не виден ни в списке, ни по прямому id | тест `service/query` с двумя аккаунтами |
| `PROPFIND` не отдаёт узлы без права чтения | unit `driveDavBackend` с фейковым `Request` |
| `PUT` не обходит квоту и `hash: true` | unit на `service/upload` |
| `DELETE` не стирает общие физические части | тест библиотеки (`orphanedParts`) + тест `purge` |
| `ETag` в `PROPFIND` = `ETag` в `GET` | unit сервера (уже есть для `memoryDavBackend`) |
| восстановление из корзины не теряет поддерево | тест `restorePlan` |
| нет литералов путей `/drive` в компонентах | гард `tooling/drive-path-guard.mjs` (этап 6) |

---

## 7. Что остаётся за рамками

Версии файлов, совместное редактирование, публичные ссылки, пароли на узлы, командные диски,
гостевые аккаунты, превью и миниатюры, мобильная синхронизация, `LOCK`-совместимость с Office
до этапа 6. Всё это — отдельные решения владельца, а не «бонус» к текущему плану.

---

## 8. Файлы, которые появятся

```
src/core/lib/drive/{names,paths,tree,quota,listing,types}.ts + *.test.ts
src/modules/drive/
  {index,schema,checks,messages,routes,modals,gateway.server,service/{query,mutate,upload,download,access},ui/*}.ts
src/sections/drive/{DrivePage.svelte,DriveTrashPage.svelte,...}
src/routes/(site)/(app)/drive/...                      # страницы и no-JS формы
src/routes/api/dav/[...path]/+server.ts                # WebDAV-точка
src/core/hooks/drive-db.ts                             # адаптеры моделей (если понадобятся вне модуля)
```
