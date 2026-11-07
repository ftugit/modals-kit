# `storage-server-form` — одна форма сервера хранилища

Общее определение полей S3 / WebDAV для пула БД и куки-сейфа. Хук не пишет ни в PostgreSQL, ни в куки: пул вызывает `saveStorageServer`, сейф — `saveVaultEntry` / `removeVaultEntry` / `resetVaultKey`. Транспорт остаётся у вызывающего.

`priority` и `clear_encryption_key` есть только у пула (`withPriority: true`). В сейфе слот перезаписывается по имени, отдельного `server_id` нет.

Идентификаторы разные, иначе реестр форм падает:

| Кто | `id` |
|---|---|
| Пул `/storage-servers` | `storage-server-admin` |
| Куки-сейф | `storage-server-vault` |

## Вход

`#hooks/storage-server-form/index.js`

| Имя | Назначение |
|---|---|
| `defineStorageServerForm({ id, withPriority, allowEditExisting?, messages? })` | `defineForm`: действия `save`, `delete` (`validate: 'none'`), `reset-key` (`validate: 'none'`). |
| `storageServerFields({ withPriority, allowEditExisting })` | Поля с одинаковыми именами. |
| `parseStorageServerEntry(values, options?)` | Разбор в `{ id, entry }` или список `IssueLike`. Схемы `s3://` и `webdav://` проверяет `#lib/storage`. |
| `maskStorageServerEntry(id, entry)` | Публичная карточка без секретов. |
| `STORAGE_SERVER_ADMIN_FORM_ID` / `STORAGE_SERVER_VAULT_FORM_ID` | Канонические id. |
| `STORAGE_SERVER_RESERVED_SLOTS` | Имена, которые нельзя занять слотом. |

`messages` передаёт вызывающий. Этот хук не импортирует `#content/*`.

Кнопка отправки остаётся в теле `StorageServerForm`. Сброс ключа сейфа — отдельная кнопка `form={formId}` и `bound.intent('reset-key')`, без своего `<Form>` и без `confirm_scope`.
