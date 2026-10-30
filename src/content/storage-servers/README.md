# `src/content/storage-servers` — боевой пул серверов хранения в БД

Доменный модуль администрирования боевого файлового пула приложения (`appStorage` в `src/server/app-storage.server.ts`). В отличие от изолированного браузерного куки-сейфа демо-витрины (`src/content/storage-vault/`), серверы этого модуля хранятся в таблице PostgreSQL `public.storage_server`, защищены пирамидой прав `STORAGE_ACL` и обслуживают постоянные файлы приложения (включая аватары пользователей `/api/storage/avatars/…`).

---

## Состав модуля

| Путь | Назначение |
|---|---|
| `src/hooks/storage-schema.ts` | Изолированное объявление `STORAGE_ACL` (`defineAcl`: чтение — `admin` / `storage.read` / `storage.edit`, изменение — `admin` / `storage.edit`) и модели `storageServer` без импорта рантайма `#lib/storage`, чтобы клиентские меню и кнопки проверяли `useGrants(grants(storageServer).select)` без утяжеления бандла. |
| `src/server/app-storage.server.ts` | Серверный синглтон боевого пула: расшифровка секретных DSN под `AUTH_SEAL_SECRET` (`iron-webcrypto`), сборка `createStorage` поверх `pgStorageLedger(db)` + `sharedStore`, откат на локальную папку `data/storage` при пустом пуле в dev, горячая перезагрузка пула после правок и живая предпроверка `probeStorageDsn` с защитой от SSRF (запрет loopback, RFC1918, link-local `169.254.0.0/16` и IPv6 ULA/link-local). |
| `form.ts` | Изоморфные описания форм добавления/обновления сервера (`storageServerSaveForm`: `id`, `name`, `dsn`, `quotaBytes`, `priority`, `readOnly`, `enabled`) и удаления (`storageServerDeleteForm`). |
| `storage-server.form.server.ts` | Серверная регистрация `registerComponentForm`: проверка прав `grants(storageServer)`, предпроверка доступности хранилища `probeStorageDsn` до записи в БД, шифрование DSN и инвалидация активного пула. |
| `routes.ts` / `modals.ts` | Пара «модалка `storage.servers` + маршрут `/storage-servers`» с полноценной работой как с JS, так и нативным POST без JS. |
| `ui/StorageServersView.svelte` | Экран списка серверов пула (`variant="card"` на `/storage-servers`, `variant="plain"` внутри модалки; маскированные DSN без утечки ключей в клиент, статус активности, приоритет, квота, переключатели и форма добавления/удаления с реактивным гейтом `useGrants(grants(storageServer).insert)`). |
| `ui/StorageServersEntry.svelte` / `ui/StorageServersModal.svelte` | Точка входа в меню/настройках и модальный носитель с защитой `<Acl />`. |

---

## Ключевые инварианты безопасности

1. **Секреты облаков никогда не покидают сервер**: в таблицу `storage_server` пишется запечатанный под `AUTH_SEAL_SECRET` токен DSN, а на клиент отдаётся только маскированная строка (`maskS3Url` / `maskWebdavUrl`).
2. **Предпроверка соединения до сохранения (`probe`)**: нерабочий сервер или адрес во внутренней/метаданных сети отклоняется формой до записи в БД.
3. **Изоляция раздачи файлов**: эндпоинт `/api/storage/[...path]` делегирует отдачу `appStorage.serve()`, выставляя сильный `ETag`, поддержку `Range` / `If-Range` (`206 Partial Content`) и жёсткий заголовок `Content-Security-Policy: default-src 'none'; sandbox` + `X-Content-Type-Options: nosniff`.
