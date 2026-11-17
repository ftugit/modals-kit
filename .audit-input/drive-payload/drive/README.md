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
  `/drive/pick`; модалки `drive.browse`, `drive.node`, `drive.trash`,
  `drive.picker`.
- **Фильтры и пагинатор**: GET-форма `drive.q`/`drive.ord`/`drive.type`/
  `drive.starred`/`drive.size`/`drive.from`/`drive.to` и курсор `drive.after`
  («Дальше»/«В начало»). Ключи, разбор и сборка ссылок — `source.ts`; даты
  режут `updated_at` в UTC (начало `from` — конец `to`). Форма не несёт курсор,
  поэтому смена фильтра начинает список заново. Экшены возвращаются в тот же
  отфильтрованный список.
- **Формы 4d–4g**: создание папки, загрузка, звезда, переименование, перенос,
  копия, корзина/восстановление/очистка, выдача и отзыв доступа, одиночный
  пикер (`?from=&param=&kind=&folder=`). Перенос и копия открывают пикер
  ссылкой «Выбрать папку…» с `kind=folder` (файлы не показываются) и принимают
  возврат `?pick=move|copy&node=<id>&target_id=<id|пусто>`; пустой `target_id` —
  корень. Файл в `target_id` отклоняет сервис (`drive.not-folder`) — это
  закреплено тестом экшена.
  Экшены — `sections/drive/actions.server.ts`, доменный отказ (и успех)
  возвращает на ту же страницу, отказ — с `?notice=<код>`.

## Чего ещё нет

Шаг «выбранные» пикера (`drive.ids`) — единственный незавершённый срез:
множественный выбор узлов через `drive.ids` и шаг «выбранные».
Экран токенов WebDAV, `DriveEntry` на главной и Class 2 с общим стором
блокировок (`drive_dav_lock`) реализованы; `LOCK`/`UNLOCK` включены.

## Проверки

```bash
vitest run src/core/lib/drive src/modules/drive src/sections/drive/actions.server.test.ts
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
