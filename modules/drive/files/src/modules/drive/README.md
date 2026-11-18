# Модуль «Диск» (`drive`)

«Как Google Drive, но проще»: дерево папок и файлов, квота, корзина, доступ
`viewer`/`editor` и монтирование по WebDAV. План — [`docs/plan-drive.md`](../../../docs/plan-drive.md),
интерфейс — [`docs/plan-drive-ui.md`](../../../docs/plan-drive-ui.md).

## Что уже работает

- **Ядро** `src/core/lib/drive`: имена, пути, дерево, квота, курсор списка.
- **Модель** `schema.ts`: `drive_node` (одна самореферентная таблица),
  `drive_share` (наследование вверх по дереву считает `service/access.ts`),
  `drive_dav_token` (HMAC пароля приложения, открытый токен — один раз).
- **Срез** `service/query.ts`: дети, крошки, сортировка/курсор, поиск,
  звёздочка, корзина, квота по логическим байтам.
- **Мутации** `service/mutate.ts`: mkdir/rename/move/copy/trash/restore/purge/star
  и выдача доступа — всё в транзакциях. Копия делит `file_id`; `purge` удаляет
  объект только при нуле ссылок на него.
- **Байты** `service/upload.ts` (`storage.put({ hash: true })`, квота под
  advisory-замком владельца) и `service/download.ts` (Range/304 через `serve`).
- **WebDAV** `/api/dav`: `createDriveDav` → `DavBackend` поверх сервисов,
  Class 1, `Depth: 1`.
- **UI** `/drive`, `/drive/[folderId]`, `/drive/node/[id]`, `/drive/trash`,
  `/drive/access`, `/drive/filters`, `/drive/pick`; модалки `drive.browse`,
  `drive.node`, `drive.trash`, `drive.access`, `drive.filters`, `drive.picker`.
  Списки — один `<Listing>` на `DriveBrowse.svelte`
  (source/paginator/url-adapter), каждая строка — `DriveNodeCard` внутри
  `ListingRow`, действия — ссылки операций.
- **Списки и фильтры**: страничный пагинатор `drive` (30/50/100, «Назад /
  Дальше» вместо курсора), ключи `drive.q`, `drive.ord`, `drive.type`,
  `drive.starred`, `drive.size`, `drive.from`, `drive.to`, `drive.ids`.
  Разбор/сборка и снапшот — `source.ts`; даты режут `updated_at` в UTC.
  Смена фильтра начинает список с первой страницы, переход по крошкам и
  папкам переносит активные фильтры (`driveFilterExtras`). Фильтры — одна
  component-form (`filters-form.ts` + `ui/filters/DriveFilters.svelte`) для
  sidebar, модалки и `/drive/filters`: enhanced — `setExtra`, native — POST/PRG
  через `listHref`; поиск остаётся отдельным `SearchBar`.
- **Срез `drive.ids`** (пикер/множественный выбор): ключа нет — список без
  ограничения, `drive.ids=none` — явно пустой набор, иначе сжатый список
  UUID (`parseDriveIds`). Ограничение, ACL и `kind=folder` применяются
  сервером до totals и нарезки страницы.
- **Операции — 14 штук, все ссылками**: `mkdir`, `upload`, `rename`, `move`,
  `copy`, `star`, `trash-action`, `restore`, `purge`, `share`, `unshare`,
  `filters`, `dav-issue`, `dav-revoke`. Матрица (id формы, адрес, модалка, заголовок,
  поля) — `operations.ts`; разметка — один `DriveOperationForm.svelte` с
  вызывающими оболочками `ui/<op>/`; регистрации мутаций —
  `sections/drive/operations.form.server.ts`, dispatch — `operations.server.ts`.
  У операции свой route-носитель (`/drive/mkdir`, `/drive/node/[id]/rename`,
  `/user/config/dav/issue`, …), поэтому без JS работает обычный POST
  (PRG с `?notice=<код>`), а с JS — форма без перезагрузки и stationary
  receipt. В строке списка mutation-форм нет.
- **Выбор папки** для переноса/копии: пикер `?from=&param=&kind=&folder=`
  через тот же `DriveBrowse` (файлы в `kind=folder` не приходят с сервера), 
  пустой `target_id` — корень. Файл в `target_id` отклоняет сервис
  (`drive.not-folder`).
- **Скачивание** — `/api/drive/[nodeId]/download`: GET, `serveDriveFile` сам
  ставит `content-disposition`, `nosniff` и CSP.

## Чего ещё нет

- Шаг «выбранные» пикера (`drive.ids` уже поддержан сервером, но шага выбора в UI
  нет).

Экран токенов WebDAV, `DriveEntry` на главной и Class 2 с общим стором
блокировок (`drive_dav_lock`) реализованы; `LOCK`/`UNLOCK` включены.

## Проверки

```bash
vitest run src/core/lib/drive src/modules/drive src/sections/drive
node tooling/core-purity.mjs
node tooling/public-api.mjs
KIT_ADAPTER=node npx svelte-check --tsconfig ./tsconfig.json
```

## Границы модели

- Имя уникально в живой папке без учёта регистра (частичный индекс
  `lower(name)` с `NULLS NOT DISTINCT`, `trashed_at IS NULL`).
- `parent_id` — только папка того же владельца; циклы и перенос в себя
  отклоняет `checks.ts` до записи.
- Квота — по `sum(size)` живых файлов, даже если физические байты общие.
- Паролей и `visibility` на узлах нет: доступ — только `drive_share`.
