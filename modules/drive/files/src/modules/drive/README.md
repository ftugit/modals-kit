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
- **UI** `/drive`, `/drive/[folderId]`, `/drive/starred`, `/drive/node/[id]`,
  `/drive/trash`, `/drive/access`, `/drive/filters`, `/drive/pick`; модалки
  `drive.browse`, `drive.node`, `drive.trash`, `drive.access`, `drive.filters`,
  `drive.picker`.
  Списки — один `<Listing>` на `DriveBrowse.svelte`
  (source/paginator/url-adapter), каждая строка — `DriveNodeCard` внутри
  `ListingRow`, действия — ссылки операций.
- **Списки и фильтры**: страничный пагинатор `drive` (30/50/100, «Назад /
  Дальше» вместо курсора), ключи `drive.q`, `drive.ord`, `drive.type`,
  `drive.scope`, `drive.size`, `drive.from`, `drive.to`, `drive.ids`.
  `drive.scope=folder|global` явно выбирает папку или весь свой живой диск;
  `drive.starred=1` остаётся только распознаванием старых ссылок и редиректит
  на `/drive/starred`.
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
- **Операции — 13 штук, все ссылками**: `mkdir`, `upload`, `rename`, `move`,
  `copy`, `star`, `trash-action`, `restore`, `purge`, `share`, `unshare`,
  `dav-issue`, `dav-revoke`. Реестр (id формы, адрес, модалка, заголовок,
  `success`) — `operations.ts`; фабрики полей — `forms/<op>.ts`; разметка —
  `ui/<op>/<Op>.svelte` поверх `DriveOperationShell`; общий успех —
  `ui/operation/use-drive-operation.svelte.ts`; регистрации мутаций —
  `sections/drive/operations.form.server.ts`, dispatch — `operations.server.ts`.
  У операции свой route-носитель (`/drive/mkdir`, `/drive/node/[id]/rename`,
  `/user/config/dav/issue`, …), поэтому без JS работает обычный POST
  (PRG без квитанции, кроме inline `dav-issue`), а с JS —
  закрытие модалки или переход на `next` без квитанции и счётчиков. Фильтры —
  отдельная component-form, в реестр операций не входят.
- **Пикер** (`/drive/pick`, модалка `drive.picker`) поверх того же `DriveBrowse`.
  Адрес: `from` (валидированный локальный возврат), `param` (имя целевого поля),
  `kind`, `folder`, `mode`, `upicks`, `picked`, `filter_owner`; ссылки пикера
  собирает один `pickerHref` (`picker-url.ts`), выход в `from` — один
  `applyHref` (`picker.ts`).
  - `single` атомарен: «Выбрать», «Выбрать эту папку», «Выбрать корень» — GET в
    `from`; `picked`/`upicks`/`drive.ids`/`filter_owner` не пишутся и снимаются
    из прямого URL. В модалке результат уходит через
    `sharedData['picker:drive.target']` (`mode: 'single'`, только UUID или
    явный `null`), move/copy принимают только такой payload.
  - `multiple`: шаг `pick` копит `picked` (до 100 в адресе), шаг `chosen`
    показывает срез `drive.ids` (`none` при пустом наборе); `Apply` доступен
    ровно при `canApplyChosen` (непустой набор, известный `totalItems`,
    `hiddenCount === 0`). Скрытые выбранные дают предупреждение и блокируют
    `Apply`; пустой `chosen` — `Empty`.
  - `picked`/`upicks`/`mode`/`from`/`param`/`filter_owner` — контекст пикера и в
    адрес `from` не добавляются. Предел `picked` в URL — 100, строка — 4000;
    предел везде один — 100: URL, сервис и SQL `IN`; больше — 400, не 500.
- **Доступ**: share принимает набор `subjects` (multiselect + `user.picker`,
  ручной UUID как fallback), batch атомарен; `/drive/access` показывает имена
  получателей из `DriveShareView.label`.
- **WebDAV**: `/user/config/dav` показывает endpoint `/api/dav/`, логин
  «любой» и пароли приложений; при выключенном серверном ключе —
  `drive.dav-disabled` вместо кнопки.
- **Скачивание** — `/api/drive/[nodeId]/download`: GET, `serveDriveFile` сам
  ставит `content-disposition`, `nosniff` и CSP.

## Чего ещё нет

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
