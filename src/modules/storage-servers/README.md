# `src/modules/storage-servers` — боевой пул серверов хранения в БД

Доменный модуль администрирования боевого файлового пула приложения (`appStorage` в `src/core/server/app-storage.server.ts`). В отличие от изолированного браузерного куки-сейфа демо-витрины (`src/modules/demo/`), серверы этого модуля хранятся в таблице PostgreSQL `public.storage_server`, защищены пирамидой прав `STORAGE_ACL` и обслуживают постоянные файлы приложения (включая аватары пользователей `/api/storage/avatars/…`).

---

## Состав модуля

| Путь | Назначение |
|---|---|
| `src/core/hooks/storage-schema.ts` | Изолированное объявление `STORAGE_ACL` (`defineAcl`: чтение — `admin` / `storage.read` / `storage.edit`, изменение — `admin` / `storage.edit`) и модели `storageServer` без импорта рантайма `#core/lib/storage`, чтобы клиентские меню и кнопки проверяли `useGrants(grants(storageServer).select)` без утяжеления бандла. |
| `src/core/server/app-storage.server.ts` | Серверный синглтон боевого пула: расшифровка секретных DSN под `AUTH_SEAL_SECRET` (`iron-webcrypto`), сборка `createStorage` поверх `pgStorageLedger(db)` + `sharedStore`, откат на локальную папку `data/storage` при пустом пуле в dev, горячая перезагрузка пула после правок и живая предпроверка `probeStorageDsn` с защитой от SSRF (запрет loopback, RFC1918, link-local `169.254.0.0/16` и IPv6 ULA/link-local). |
| `form.ts` | Тонкая обёртка `defineStorageServerForm` (`storage-server-admin`, с приоритетом). Поля и разбор общие с куки-сейфом, транспорт пула остаётся в `storage-server.form.server.ts`. Здесь же `STORAGE_POOL_MESSAGES`: единственный текст, отличающийся от общего словаря, — `storage.key-invalid` с уточнением про управляющие символы ASCII, потому что их отклоняет только пул (`src/core/server/app-storage.server.ts`), а общий парсер проверяет длину. |
| `storage-server.form.server.ts` | Серверная регистрация `registerComponentForm`: проверка прав `grants(storageServer)`, предпроверка доступности хранилища `probeStorageDsn` до записи в БД, шифрование DSN и инвалидация активного пула. |
| `routes.ts` / `modals.ts` | Пара «модалка `storage.servers` + маршрут `/storage-servers`» с полноценной работой как с JS, так и нативным POST без JS. |
| `ui/StorageServersView.svelte` | Экран списка серверов пула (`variant="card"` на `/storage-servers`, `variant="plain"` внутри модалки; маскированные DSN без утечки ключей в клиент, статус активности, приоритет, квота, переключатели и форма добавления/удаления с реактивным гейтом `useGrants(grants(storageServer).insert)`). |
| `ui/StorageServersEntry.svelte` / `ui/StorageServersModal.svelte` | Точка входа в меню/настройках и модальный носитель с защитой `<Acl />`. |
| `ui/storage-servers/ServerCard.svelte` | Строка пула (S20): только оформление — слот, протокол, приоритет, маскированный DSN, квоты. Кнопки приходят сниппетом `actions` от хоста, поэтому право решает не строка. |

---

## Ключевые инварианты безопасности

1. **Секреты облаков никогда не покидают сервер**: в таблицу `storage_server` пишется запечатанный под `AUTH_SEAL_SECRET` токен DSN, а на клиент отдаётся только маскированная строка (`maskS3Url` / `maskWebdavUrl`).
2. **Предпроверка соединения до сохранения (`probe`)**: нерабочий сервер или адрес во внутренней/метаданных сети отклоняется формой до записи в БД.
3. **Изоляция раздачи файлов**: эндпоинт `/api/storage/[...path]` делегирует отдачу `appStorage.serve()`, выставляя сильный `ETag`, поддержку `Range` / `If-Range` (`206 Partial Content`) и жёсткий заголовок `Content-Security-Policy: default-src 'none'; sandbox` + `X-Content-Type-Options: nosniff`.

---

## S20: что из оболочки применимо

Пул серверов — короткий ограниченный список (`storage_server` в БД, единицы строк), и
контракта порций или фильтров у модуля нет: загрузчик `/storage-servers` отдаёт срез
целиком (`StorageServersSlice.items`), в адресе нет страницы и полей фильтра, а
`STORAGE_ACL` не знает ключей чтения по условиям. Поэтому из общей оболочки здесь
применимо ровно это:

- **строка от хоста** — `ui/storage-servers/ServerCard.svelte` рисует только факты,
  действия приходят сниппетом `actions` от `StorageServersView`;
- **право решает набор действий** — у читателя (`storage.read`) строка без кнопок, у
  редактора — «Изменить» и «Удалить» в том же теге формы пула;
- **состояния носителя** — `Acl`, `Surface`, скелетон и пустой пул остаются прежними.

Порции, фильтры и наборный выбор **не применимы**: их появление означало бы новый
контракт загрузчика и ключи адреса, то есть изменение решения плана, а не перенос на
оболочку. Тест `StorageServers.ssr.test.ts` держит parity по применимым возможностям:
читатель и редактор видят одни и те же факты строки, различаются только действиями, и
в разметке нет ни пагинатора, ни фильтров.
