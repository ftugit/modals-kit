# Диск (`drive`): UI, проводник и пикер файлов

Статус: **4d–4g и фильтры/пагинатор реализованы**: формы mkdir/rename/move/copy/
trash/restore/purge/star, загрузка, экран доступа, пикер `/drive/pick` (одиночный,
без шага `drive.ids`), GET-фильтры `drive.q/ord/type/starred/size/from/to` и
курсорный пагинатор (`drive.after`). Экран токенов WebDAV и `DriveEntry` на
главной реализованы. Остался срез `drive.ids` (множественный выбор) и
`drive.trashed` как ключ списка — опциональные.
Этот документ — план интерфейса поверх `docs/plan-drive.md` (модель, сервисы, WebDAV).
Коммитов не делаем до отдельной команды.

Связанные документы:

- `docs/plan-drive.md` — модель `drive_node`/`drive_share`, сервисы, WebDAV-монтирование.
- `docs/plan-storage.md` — исторический; обезличенный `storage_file` и дедупликация по хешу.
- `docs/design/lists.md` — контракт полнофункционального списка (образец seed).
- `src/modules/storage-servers/README.md` — пример короткого списка без пагинации.
- `src/modules/user/base/README.md`, `src/core/ui/README.md`, `src/core/hooks/links/README.md`.

---

## 1. Цель и границы

UI «как Google Drive, но проще»:

- проводник папок и файлов: список, хлебные крошки, поиск, фильтры, сортировка;
- загрузка файлов с дедупликацией (`hash: true`) и квотой;
- переименование, перенос, копирование, звёздочка, корзина, восстановление, очистка;
- просмотр узла, скачивание, управление доступом (владелец + `drive_share`);
- пикер файлов, который можно вызвать из других мест сайта и отметить/выбрать узлы;
- точки входа на главной/в настройках по образцу `SeedUsersEntry`.

Вне рамок v1 (как в `plan-drive.md` §7): версии, совместное редактирование, публичные ссылки, пароли на узлы, командные диски, гости, превью/миниатюры, мобильная синхронизация. Миниатюры позже подключаются через `#core/lib/image`.

---

## 2. Базовые компоненты-основа и их потребители

Берём существующие примитивы, не создаём параллельную систему.

| Базовый компонент / хук | Где живёт | Потребитель в drive | Зачем |
|---|---|---|---|
| `Surface`, `SurfaceBar` (`SurfaceControls` — тип, а не компонент) | `#core/ui/index.js` | `DriveBrowse`, `DriveNodeModal`, `DriveAccessModal`, `DriveTrash` | единая поверхность, один владелец скролла, шапка |
| `Listing`, `ListingRow` | `#core/ui/listing` | `DriveBrowse`, `DriveTrash`, `DrivePicker` | список с поиском, фильтрами, пагинацией, без модели |
| `Acl` | `#modules/user/base/svelte/Acl.svelte` | все носители (страница, модалка, пикер) | отказы прав рисует носитель, не список |
| `Form`, `Field`, `Common`, `Fieldset` | `#core/lib/form`, `#core/ui/form` (`Fieldset` — из `#core/ui/index.js`) | формы загрузки, переименования, доступа, фильтров | без сырых `<form>`/`<input>` |
| `Button` | `#core/ui/index.js` | шапка списка, действия узла | единый вид |
| `HoldButton` | `#core/ui/button/HoldButton.svelte` (в barrel не экспортируется) | окончательное удаление (`purge`) | удержание для разрушительных действий |
| `Checkbox` | `#core/ui/index.js` | только вне строки: `controls`, панель массовых действий | внутрь `<a>`-строки нельзя (`docs/design/lists.md` §8) |
| `Select`, `SelectList` | `#core/ui/index.js` | роль share (`viewer`/`editor`), сортировка | единые списки |
| `SearchField`, `SearchInput` | `#core/ui/index.js` | поиск по имени | через `Listing`/`SearchBar` |
| `Badge`, `Alert`, `Spinner`, `Stat`, `TimeAgo` | `#core/ui/index.js` | статусы (trashed, starred), квота, даты | единый вид |
| `EmptyState`, `Skeleton` | `#core/ui/paginator/ui` | пустые папки, ожидание первой порции | пустота списка — часть пагинатора, `Empty`/`Progress` в ядре нет |
| `CopyInput` | `#core/ui/index.js` | показ пароля приложения WebDAV один раз | секрет показывается один раз |
| `FileInput`, `FileAttachment` | `#core/ui/index.js` | загрузка файлов (несколько, накопление) | без base64, стриминг |
| `asLink`, `asModalLink`, `useModalLink` | `#core/hooks/links` | строки списка, точки входа, модалки | без JS остаются ссылками |
| `useHeadSeo` | `#core/ui/shell` | страницы `/drive*` | метаданные |
| `useGrants` | `#modules/user/base/svelte/grants.svelte.js` | гейт кнопок по `DRIVE_ACL` | реактивные права |
| `useSteps` / `formSteps` | `#core/ui/steps` | многошаговые сценарии (доступ, загрузка) при необходимости | единый шаговый паттерн |

Что не берём:

- `FiltersPanel` каталога — у него схема каталога и чипы на странице; списку нужны модалка и страница-fallback.
- вложенную `Card` внутри `Surface`: поверхность одна, рамка одна.
- ручные `<form>`, `<input>`, `name=` — блокирует `tooling/layer-guard.mjs`.

---

## 3. Модели и данные

Источник правды — `plan-drive.md` §4.2: `drive_node` (дерево), `drive_share` (`viewer`/`editor`), `storage_file` (обезличенные байты, дедупликация по `(hash, size)`). Здесь модель не переписывается, чтобы не разъехаться: UI читает её через `DriveNodeView`/`DriveEntry`/`DriveSlice` из `#core/lib/drive`.

Проекция доступа — `canRead/canWrite/canShare` из `service/access.ts` (`plan-drive.md` §4.4). UI не вычисляет права и не прячет данные: поле без права не рисуется, но и сам домен его игнорирует.

UI-состояние (не модель): текущая папка, набор отмеченных id, фильтры, режим выбора, актор. Состояние выбора хранит носитель, а не список.

---

## 4. Компоненты модуля `src/modules/drive`

### 4.1. Серверная/UI-оболочка (по образцу `user` и `storage-servers`)

| Файл | Ответственность |
|---|---|
| `src/modules/drive/index.ts` | публичный вход модуля |
| `src/modules/drive/schema.ts` | ресурсы `drive_node`, `drive_share`, `DRIVE_ACL` |
| `src/modules/drive/checks.ts` | инварианты имени, цикла, родителя, квоты, роли |
| `src/modules/drive/messages.ts` | тексты отказов/подсказок |
| `src/modules/drive/routes.ts` | типизированные маршруты (§5) |
| `src/modules/drive/modals.ts` | регистрация модалок (§5) |
| `src/modules/drive/gateway.server.ts` | серверный фасад: `?/entries` с `intent` |
| `src/modules/drive/config.ext.ts` | шаг «Диск» в настройках (токены WebDAV): глоб `src/modules/**/config.ext.ts` подхватывает его без правки реестра |
| `src/modules/drive/service/query.ts` | срез папки, крошки, поиск, курсор, trashed |
| `src/modules/drive/service/mutate.ts` | `mkdir/rename/move/copy/trash/restore/purge/star` |
| `src/modules/drive/service/upload.ts` | загрузка через `resolveAppStorage()` → `storage.put({ hash: true })`, квота, откат |
| `src/modules/drive/source.ts` | клиентский источник: `defineSource` + `definePaginator`, `ensureDrivePaginator`, ключи `extraSearch`/`reloadKeys`, снапшот `DriveRouteData`, догрузка `preloadData` того же `/drive` |
| `src/modules/drive/service/download.ts` | проверка доступа и `serveAppStoragePath(path, request)`; для скачивания — `Content-Disposition: attachment` (у картинок хелпер иначе отдаёт inline) |
| `src/modules/drive/service/access.ts` | эффективный доступ и проекция прав |
| `src/modules/drive/ui/DriveBrowse.svelte` | обёртка над `Listing`: список узлов + крошки + загрузка |
| `src/modules/drive/ui/DriveNodeCard.svelte` | тупая карточка узла (имя, тип, размер, дата, starred, trashed) |
| `src/modules/drive/ui/DriveBreadcrumbs.svelte` | хлебные крошки папок |
| `src/modules/drive/ui/DriveFiltersForm.svelte` | форма фильтров (тип, владелец, дата, starred, trashed) |
| `src/modules/drive/ui/DriveAccessForm.svelte` | управление `drive_share` (пикер пользователей + роль) |
| `src/modules/drive/ui/DriveTrash.svelte` | список корзины + восстановление/очистка |
| `src/modules/drive/ui/DrivePicker.svelte` | пикер файлов (тот же `DriveBrowse`, внешний набор) |
| `src/modules/drive/ui/DriveEntry.svelte` | точка входа на главной/в настройках |
| `src/modules/drive/ui/DriveQuota.svelte` | квота пользователя (`Stat`/`Progress`) |
| `src/modules/drive/ui/DriveNodeModal.svelte` | карточка узла в модалке |
| `src/modules/drive/ui/DriveAccessModal.svelte` | модалка доступа |
| `src/modules/drive/ui/DriveFiltersModal.svelte` | модалка фильтров |
| `src/modules/drive/ui/DrivePickerModal.svelte` | модалка пикера |

Секция:

- `src/sections/drive/DrivePage.svelte`, `DriveTrashPage.svelte`, `DriveFiltersPage.svelte`, `DrivePickPage.svelte`.
- `src/sections/drive/load.server.ts` и срезы (по образцу `src/sections/users/*`).

Правило: один компонент на страницу и модалку (`isModalMode`), как в `user.sessions`.

### 4.2. Какие компоненты брать за основу для конкретных экранов

- `DriveBrowse` — обёртка над `Listing` по образцу `SeedUsersList`: те же пропы `initial`, `scope`, `url`, `onAcl`, `rowAttrs`, `isSelected`, `picked`, `onPicked`.
- `DriveNodeCard` — только рисунок; нажатие не зашивается внутрь (правило `docs/design/lists.md` §8). По умолчанию строка ведёт в `drive.node` (модалка/роут).
- `DriveFiltersForm` — одна форма на sidebar, модалку и страницу `filters?from=`.
- `DriveAccessForm` использует `UserPicker` (`user.picker`) для выбора пользователей и `Select` для роли.
- `DrivePicker` — тот же `DriveBrowse` с `url={false}`, внешним набором `picked`/`onPicked`, шагом «выбранные» через срез `drive.ids`.
- `DriveEntry` — по образцу `SeedUsersEntry`: виден по `vault.authorized`/праву, одна кнопка через `asModalLink('drive.browse')`.

---

## 5. Маршруты, модалки и адрес

### 5.1. Маршруты `src/modules/drive/routes.ts`

- `driveRootRoute = kitRoute('/drive')` — корень.
- `driveFolderRoute = kitRoute('/(site)/(app)/drive/[folderId=uuid]', { dynamic: true, id: '/drive/[folderId]' })` — папка.
- `driveNodeRoute = kitRoute('/(site)/(app)/drive/node/[id=uuid]', { dynamic: true, id: '/drive/node/[id]' })` — карточка узла, страница-fallback модалки `drive.node`.
- `driveTrashRoute = kitRoute('/drive/trash')`.
- `driveFiltersRoute = kitRoute('/drive/filters', { owner: 'drive.filters', keys: ['from'], search: querySchema<{ from: string | null }, { from: string | null }>((raw) => ({ from: localPath(typeof raw.from === 'string' ? raw.from : null) })) })` — `from` локальный путь носителя; папка едет внутри `from`, отдельного `folder` нет.
- `drivePickRoute = kitRoute('/drive/pick')` — страница-fallback пикера.
- Отдельного `driveAccessRoute` в v1 нет: доступ — только модалка `drive.access` над узлом/папкой.
- У каждого адреса в `src/routes/(site)/(app)/drive/` — пара `+page.server.ts` (тонкий: зовёт `load` из `sections/drive`) и `+page.svelte` (тонкий: `Acl` + секция). Разметка — в `src/sections/drive`.

Регистрация модалок (`src/modules/drive/modals.ts`):

- `drive.browse` — `route: (p) => p?.folderId ? driveFolderRoute.href({ folderId: p.folderId }) : driveRootRoute.href()`, размер ~ `{ width: 960, height: 720 }`.
- `drive.node` — `route: (p) => p?.id ? driveNodeRoute.href({ id: p.id }) : driveRootRoute.href()`.
- `drive.access` — модалка над узлом/папкой, `route` — адрес папки-носителя (`driveFolderRoute`).
- `drive.trash` — модалка/страница корзины, `route: driveTrashRoute.href`.
- `drive.filters` — модалка фильтров, `route: driveFiltersRoute.href`.
- `drive.picker` — модалка пикера, `route: drivePickRoute.href`.

### 5.2. Адресный ключ списка

По образцу seed: свой ключ `drive` (не `page`, не `users`).

| Ключ | Смысл | В адресе по умолчанию |
|---|---|---|
| `drive` | номер порции | первая не пишется |
| `drive.size` | размер порции (30..100) | 30 не пишется |
| `drive.q` | поиск по имени | пустой не пишется |
| `drive.ord` | сортировка (`name`/`updated`/`size`) | умолчание не пишется |
| `drive.type` | фильтр типа (`file`/`folder`/`all`) | умолчание не пишется |
| `drive.starred` | только starred | false не пишется |
| `drive.trashed` | корзина | false не пишется |
| `drive.from`/`drive.to` | даты | пустые не пишутся |
| `drive.ids` | срез «только эти id» (шаг выбора) | не поле формы |

Смена актора инвалидирует пагинатор. В модалке область и префикс выделяет `useSlotPaginatorScope`. У пикера `url: false`.

### 5.3. No-JS

- страница `/drive` и `/drive/[folderId]` отдают первую порцию;
- POST фильтров на `/drive/filters?from=` с 303 назад;
- строка списка — `<a>` (модалка с JS, роут без JS);
- пикер: `/drive/pick` с GET назад на `from` с подстановкой id в `param` (имя берётся из `param`, не хардкодится).

---

## 6. Загрузка, скачивание и квота

- Загрузка: форма с `FileAttachment` (множественный выбор, накопление) + поле папки (hidden) + `intent=upload`. Серверный `execute` вызывает `service/upload.ts`: `const { storage, writable } = await resolveAppStorage()` → `storage.put({ path: driveStoragePath(ownerId, nodeId), hash: true, size, contentType })`. объекта `appStorage` в проекте нет.
- Порядок квоты: в одной транзакции проверить `sum(size)` по живым узлам → вставить `drive_node` → только потом `put`; ошибка `put` откатывает запись узла. `storage.put` резервирует ёмкость сервера в ledger, а не квоту пользователя — это разные лимиты.
- Прогресс: `formTask` показывает pending; реальный процент — только если библиотека отдаёт честный прогресс (не выдумывать).
- Дедупликация: при совпадении `(hash, size)` байты не отправляются второй раз; новый узел получает свою запись, физические части общие; квота считает логический размер.
- Скачивание: маршрут `/api/drive/[nodeId=uuid]/download` проверяет доступ в сервисе и отдаёт `serveAppStoragePath(driveStoragePath(ownerId, nodeId), request)` (Range/If-Range/304 как у `/api/storage`), при необходимости добавляя `Content-Disposition: attachment`.
- Квота: `DriveQuota` (`Stat`) показывает `used/limit` и предупреждение; превышение блокирует загрузку на сервере (`assertQuota`), UI показывает причину из `messages.ts`.
- Перетаскивание (drag-and-drop) — не в v1; `FileAttachment` уже покрывает выбор. Если понадобится, отдельное решение владельца.

## 7. Пикер файлов (вызов из других мест)

Принцип seed: один компонент списка, носитель выбирает способ (обычный / выбор id). Пикер — отдельный носитель, не режим внутри списка (`docs/design/lists.md` §2, §7).

- `DrivePicker` = `DriveBrowse` с пропами `picked` (readonly string[]) и `onPicked` (ids: string[]). При наличии `onPicked` список включает режим отметок, свои кнопки набора не рисует (как `SeedUsersList`).
- Отметка — клик по строке через `rowAttrs` и подсветка `isSelected`, как у `UserPicker`. `Checkbox` внутрь строки не ставится: `ListingRow` рендерит `<a>`, вложенный интерактив запрещён (`lists.md` §8).
- Адрес пикера повторяет контракт `/users/pick`: `from` (куда вернуться), `param` (какой query-параметр вызывающего заполнить), `mode` (`single`/`multiple`), `picked` (стартовый набор), шаг `upicks=chosen`. Предел и форма id — общие с `/drive/pick` (`parseDrivePickedIds` + `DRIVE_PICKER_IDS_MAX`), неизвестный шаг — `'pick'`.
- Шаг «выбранные» пишет `drive.ids` — срез источника, не фильтр формы; тот же список показывает только отмеченных и умеет догрузить порцию.
- С JS: подтверждение кладёт id вызывающему через доску модалок без перезагрузки его формы.
- Без JS: GET назад на `from` с подстановкой id в `param`.
- В модалке пикера `url: false`: адрес вызывающего не становится адресом выбора.
- Ключ среза id объявляется в `extraSearch` и `reloadKeys` сразу, даже если пикер появится позже.
- Точка входа из любого места: `asModalLink('drive.picker', { picked, from, param, mode, folder })` или встраивание `DrivePicker` в свою страницу с `scope`.

Режимы:

- `pick` — выбрать файлы (или папки) для другой формы.
- `folder` — выбрать папку-цель для «Переместить/Копировать в…»; тот же компонент с фильтром `drive.type=folder`, список получает от носителя `excludeIds` (текущая папка и её потомки).

Потребители пикера:

- `DriveAccessForm` — выбор пользователей? Нет, это `user.picker`. Для drive пикер нужен, когда другая форма ссылается на файл из диска (например, вставка файла в профиль/блок/комментарий). В v1 — универсальный `drive.picker`, конкретные потребители подключаются по мере появления.
- `DriveBrowse` использует режим `folder` для «переместить/копировать в…».

## 8. Доступ и корзина

- `DriveAccessForm`: список `drive_share` узла/папки, добавление через `user.picker` + `Select` роли, удаление, наследование вниз по дереву (отображается пометкой «наследуется»). Права проверяет сервер, UI только гейтит кнопки через `useGrants`.
- `DriveTrash`: тот же `Listing` с `trashed=true`, действия «Восстановить» и «Удалить навсегда» (`HoldButton` для purge). Восстановление возвращает на прежнего родителя; если родителя нет — в корень.
- Очистка (`purge`) вызывает `resolveAppStorage().storage.del`; физические части удаляются только при нуле ссылок (тест `orphanedParts`).

## 9. Потребители и места размещения

- Главная: `DriveEntry` (по образцу `SeedUsersEntry`) добавляется в `src/sections/home/HomePage.svelte` — виден при `vault.authorized` и праве `drive.read`; кнопка `asModalLink('drive.browse')`.
- Меню (`MenuBody.svelte`): пункт `drive.browse` рядом с `storage.servers` — отдельным решением, не в v1.
- Настройки пользователя: ссылка/модалка `drive.browse` + `DriveQuota`.
- Другие модули: могут открывать `drive.picker` для выбора файла; компонент `DrivePicker` можно встроить в любую страницу с `scope` и `url={false}`.
- Storage-servers: не потребитель (другой домен), но `DriveEntry` может жить рядом в меню.
- WebDAV: шаг «Диск» в настройках через `src/modules/drive/config.ext.ts` (глоб `src/modules/**/config.ext.ts`); пароль приложения показывается один раз через `CopyInput`, список/отзыв токенов — там же.

## 10. Этапы (UI-часть)

Порядок — вертикальными срезами; в скобках — этап `plan-drive.md`.

| Шаг | Содержание | Выход |
|---|---|---|
| 4a | Ядро (этап 1): `src/core/lib/drive/*` | `vitest run src/core/lib/drive` |
| 4b | Модель, права, срез папки и `DriveRouteData` (этап 2) | тесты среза и доступа |
| 4c | **Тонкий read-only срез:** `source.ts`, `/drive`, `/drive/[folderId]`, модалка `drive.browse`, `DriveBrowse` + `DriveNodeCard` + крошки, формы нет | SSR-тест прав reader/editor на одном срезе |
| 4d | Мутации и байты (этап 3) | тесты загрузки/квоты/дедупликации |
| 4e | Формы mkdir/rename/move/copy/trash/star, загрузка/скачивание/квота, корзина | no-JS сценарии |
| 4f | `DriveAccessForm` + `user.picker` | тест наследования доступа |
| 4g | `DrivePicker` + `/drive/pick` + `drive.ids` — сделано без шага `drive.ids`: move/copy используют `pick=move|copy&node=&target_id=&kind=folder`; файл как target отклоняется сервисом | тест памяти/утечки в URL |
| 4h-фильтры | `DriveFilters` (GET `drive.q/ord/type/starred/size/from/to`) + `DrivePager` (`drive.after`), ключи/ссылки — `source.ts` | SSR-тест GET без конверта/курсора, тесты `source.ts`, `kind` и дат в срезе |
| 4h | WebDAV: `/api/dav`, `drive_dav_token`, `driveDavBackend` (этап 5); экран `/user/config/dav` (`DriveDavTokens`: выдача с одноразовым секретом, список, отзыв) и шаг `dav` в `config.ext.ts` | SSR-тест экрана, тест токенов, `curl -X PROPFIND` |
| 4i | Class 2 и стражи: `drive_dav_lock`, литералы `/drive`, `test:size` | `tooling/*` зелёные |

## 11. Инварианты и тесты

- Чужой узел не виден ни в списке, ни по прямому id (тест двух аккаунтов).
- `PROPFIND` не отдаёт узлы без права чтения (unit `driveDavBackend`).
- Отметка в пикере — клик по строке, а не чекбокс внутри `<a>`.
- «Переместить в…» не предлагает текущую папку и её потомков (`excludeIds`).
- `PUT` не обходит квоту и `hash: true` (unit `service/upload`).
- `ETag` в `PROPFIND` = `ETag` в `GET`.
- Пикер не утекает в адрес вызывающего (`url: false`).
- Смена актора сбрасывает ленту.
- Без JS: страница, POST фильтров, ссылки строк работают.
- SSR-тест прав: читатель/редактор видят разные действия.

## 12. Риски и решения владельца

- Папка как сегмент пути vs query: выбран сегмент (`/drive/[folderId]`) для глубоких ссылок; модалка использует функцию route.
- Один список на страницу: ключ `drive`; два списка на одной странице не планируются.
- Миниатюры, версии, публичные ссылки — отдельные решения, не «бонус».
- `LOCK`/Office-совместимость — этап 6 плана drive, не часть UI v1.
