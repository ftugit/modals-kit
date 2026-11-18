# Drive: план приведения к целевой архитектуре

Статус: **этапы 0–4 реализованы; открыт только шаг «выбранные» пикера,
браузерный gate ограничен средой** (в песочнице нет `libnspr4.so` и root, см. §9).

Этот документ — новый исполняемый план ремонта Drive. Он подготовлен по фактическому
коду, `docs/plan-drive.md`, `docs/plan-drive-ui.md`,
`docs/audit-drive-review.md`, `docs/audit-drive-plan-vs-code.md`,
`docs/design/lists.md` и рабочим образцам `seed-users`, фильтров,
`accounts-delete` и зарегистрированной потоковой загрузки.

План предназначен для младшей модели: каждый этап заканчивается проверкой. Нельзя
переходить к следующему этапу, если его gate не пройден. В этом документе слово
«сделано» означает только подтверждённое тестом или ручным сценарием.

## 0. Границы и правила исполнения

### 0.1. Что именно исправляется

Целевое состояние:

- страница Drive и модалки используют штатные `Listing`, `defineSource`,
  `definePaginator`, `createUrlAdapter`, `PaginatorState` и scoped stores;
- каждая операция имеет собственный route fallback и собственный компонент;
- один и тот же компонент операции работает и на странице, и в модалке;
- JS-submit возвращает структурированный результат на месте: модалка не закрывается
  сама и адрес не меняется;
- native POST без JS для обычных мутаций использует штатный PRG `303` на проверенный
  локальный `return_to`; единственное исключение — выдача DAV secret, см. §5.4;
- на странице списка нет inline mutation-form. Кнопка действия — это ссылка на
  route/modal операции, а не раскрытие формы на текущей странице;
- создание папки и загрузка файла — **две отдельные операции, два отдельных
  route/modal entry**, не два шага одной формы;
- все серверные действия используют component-form registry, а не коллекцию
  SvelteKit `actions` на четырёх browse-страницах;
- фильтры являются общей form-единицей с modal/sidebar применением через
  `setExtra`, а native fallback — POST/PRG;
- модуль не создаёт копий файлов `arch`, не добавляет demo payload в `arch` и не
  смешивает изменения каталога модулей с изменениями ядра.

### 0.2. Что не следует делать

Запрещены следующие «быстрые» решения:

- чинить только `return_to` в старой inline-форме и считать задачу закрытой;
- оставлять `intercept: false` для JS-операций как способ «сохранить native»;
- возвращать redirect из `execute`, `redirect(303, ...)`, success-shaped notice при
  отказе домена или переходить через `?/mkdir` из общего browse action;
- копировать `DriveBrowse` в `DriveBrowseModal`, а `DriveNodePage` в
  `DriveNodeModal` с расхождением логики;
- делать отдельный REST/JSON listing endpoint для paginator;
- передавать `DriveEntry` напрямую в `Listing`: `Listing` требует top-level `id`;
- оборачивать `createCursorAdapter` в несуществующий `createUrlAdapter({ adapter })`;
- фильтровать папки пикера после пагинации или применять ACL текущей папки к
  выбранным узлам из других папок;
- считать прямые unit-тесты action-функций достаточной проверкой HTML-форм,
  component-form middleware или modal navigation.

### 0.3. Приоритет документов

При конфликте этот документ задаёт целевой контракт, старые планы — только
сохраняемые доменные ограничения. Уже сейчас отменены их решения про intent gateway,
inline mkdir/upload/row forms, GET-submit фильтров, отсутствие отдельного access
route и достаточность cursor-only реализации для native Listing. `drive.ids` здесь
обязателен, а не опционален. Корзина остаётся отдельной `/drive/trash`: не заводить
второе конкурирующее состояние `drive.trashed`. Исторические отметки «реализовано»
не являются доказательством прохождения новых gates.

Фразу в `audit-drive-review.md` о здоровых сервисах/WebDAV считать уточнённой:
при углублённом чтении обнаружены проблемы §3. Аудит другого ИИ не переписывать.
Новый документ определяет ремонт, а не подтверждает прежний итог аудита.

### 0.4. Источник истины и порядок публикации

Авторитетный payload модуля — `modules-catalog/modules/drive/files`. Рабочая копия
`src/modules/drive`, routes и sections в `arch` должна обновляться только штатным
механизмом установки/синхронизации модулей. Не редактировать обе копии вручную и не
коммитить `arch` вместе с демо.

Для каждого этапа:

1. сначала изменить source payload модуля или ядро, которому действительно нужен
   новый контракт;
2. запустить локальные проверки;
3. установить/синхронизировать модуль обычной командой;
4. повторить проверки на собранном `arch`;
5. убедиться `git status`, что не появились случайные копии или demo-файлы.

## 1. Архитектурный контракт и таблица маршрутов

### 1.1. Разделение route, modal и form registration

Для каждой операции должны существовать три вещи:

1. **Fallback route** — страница, на которой компонент может полноценно отобразиться
   и принять native POST без JS.
2. **Modal registration** — modal name и `route(params)`, ведущий на тот же fallback
   route с теми же параметрами.
3. **Shared operation component** — единственная форма и единственная клиентская
   логика; route и modal являются тонкими носителями.

Серверная регистрация `*.form.server.ts` диспетчеризуется по `formId`, поэтому
route fallback не обязан содержать `actions`. Авторизация остаётся в registration
и domain service, а не в том, на какой URL указывает форма.

Для component form всегда указывать явный `action` на выделенный route URL:

```ts
bindComponentForm(forms, description, {
  action: dedicatedOperationRoute,
  session: userSession,
  onSuccess(result) { /* receipt + invalidation */ },
})
```

Не полагаться на default action: по умолчанию он равен видимому адресу host. Это
особенно важно для модалки.

### 1.2. Обязательная матрица операций

| Операция | Form ID | Fallback route | Modal name | Результат JS |
|---|---|---|---|---|
| Создать папку | `drive-mkdir` | `/drive/mkdir` | `drive.mkdir` | receipt, список обновлён |
| Загрузить файл | `drive-upload` | `/drive/upload` | `drive.upload` | receipt/ошибка, список обновлён |
| Переименовать | `drive-rename` | `/drive/rename` | `drive.rename` | receipt, node/list refresh |
| Переместить | `drive-move` | `/drive/move` | `drive.move` | receipt, source/target refresh |
| Копировать | `drive-copy` | `/drive/copy` | `drive.copy` | receipt, target refresh |
| Звезда | `drive-star` | `/drive/star` | `drive.star` | receipt, row refresh |
| В корзину | `drive-trash` | `/drive/trash-action` | `drive.trash-action` | receipt, live/trash refresh |
| Восстановить | `drive-restore` | `/drive/restore` | `drive.restore` | receipt, live/trash refresh |
| Удалить навсегда | `drive-purge` | `/drive/purge` | `drive.purge` | receipt, trash refresh |
| Выдать доступ | `drive-share` | `/drive/share` | `drive.share` | receipt, node/access refresh |
| Отозвать доступ | `drive-unshare` | `/drive/unshare` | `drive.unshare` | receipt, node/access refresh |
| Применить фильтры | `drive-filters` | `/drive/filters` | `drive.filters` | setExtra в owning scope |
| Выдать DAV token | `drive-dav-issue` | `/user/config/dav/issue` | `drive.dav-issue` | одноразовый secret в receipt |
| Отозвать DAV token | `drive-dav-revoke` | `/user/config/dav/revoke` | `drive.dav-revoke` | список token refresh |

Таблица фиксирует имена и разделение для исполнения. Если обнаружен реальный
конфликт маршрутов — остановиться и предложить минимальную поправку плана, а не
объединять операции. Trash/restore/purge получают отдельные IDs из таблицы: нельзя
регистрировать `drive-trash` трижды и нельзя сохранять старый выбор операции по
named URL action.

Дополнительные экраны (без inline mutation forms):

| Экран | Route | Modal | Назначение |
|---|---|---|---|
| Корень/папка | `/drive`, `/drive/[folderId=uuid]` | `drive.browse` | общий список |
| Узел | `/drive/node/[id=uuid]` | `drive.node` | общая metadata + links операций |
| Корзина | `/drive/trash` | `drive.trash` | тот же list wrapper |
| Доступ | `/drive/access` | `drive.access` | список shares + links share/unshare |
| Пикер | `/drive/pick` | `drive.picker` | общий список + selection contract |
| DAV tokens | `/user/config/dav` | существующий settings carrier | список + links issue/revoke |

В `routes.ts` зарегистрировать typed query schemas: mkdir/upload — `parent_id`
(nullable UUID), node operations/access — `node_id` (UUID), unshare дополнительно
`uid`, revoke — `token_id`; для форм — validated local `return_to`. Load проверяет
доступ и выдаёт initial values/caps; POST повторяет проверку независимо от load.
URL filters регистрировать отдельно от domain form fields. Metadata/SEO всех новых
носителей — через `useHeadSeo`, ошибки доступа — штатный `Acl`/fact.

Скачивание не является mutation-form: добавить отдельный GET route
`/api/drive/[nodeId=uuid]/download`, вызвать `serveDriveFile` со служебным
`fileId` узла и добавить обычную ссылку в карточку. Не реконструировать путь файла:
копии могут разделять `file_id`.

### 1.3. Карта файлов и образцы, которые читать перед этапом

Все module-owned пути ниже — относительно `modules/drive/files/` в каталоге.
Сохранять существующий `ui/`, не вводить параллельное дерево `svelte/` без причины.

| Область | Что менять/создать |
|---|---|
| List/source | `src/modules/drive/source.ts`, `types.ts`, `ui/DriveBrowse.svelte`, `ui/DriveNodeCard.svelte` |
| Shared views | `ui/DriveNode.svelte` (из page/modal duplication), `ui/DrivePicker.svelte`, `ui/DriveAccess.svelte` |
| Operations | `ui/<operation>/Drive<Operation>.svelte`, `form.ts`, `<operation>.form.server.ts` — одна папка на строку mutation matrix |
| Registry | `src/modules/drive/routes.ts`, `modals.ts`, public exports |
| Loads/pages | `src/sections/drive/<operation>/load.server.ts`, page carrier; thin `src/routes/(site)/(app)/drive/<operation>/+page.svelte` и `+page.server.ts` |
| Tokens | соответствующие carriers в `user/config/dav/issue`, `revoke`; registrations остаются module-owned |
| Services | `service/query.ts`, `access.ts`, `mutate.ts`, `upload.ts`, `download.ts`, `tokens.ts`, `webdav.server.ts` |
| Legacy removal | общий `src/sections/drive/actions.server.ts`, его exports из browse routes, старые inline bindings |

Старые `DriveCreate`/`DriveNodeActions` удалить только после переноса всех callers;
если нужны панели ссылок, переименовать по роли. Не держать два активных пути записи.

Обязательные reference files в `arch` (читать, не копировать весь модуль):

- `src/modules/user/accounts/svelte/seed-users/source.ts` — extras, source,
  paginator, snapshot и `preloadData`;
- `src/modules/user/accounts/svelte/SeedUsersList.svelte` — Listing wrapper/row;
- `src/modules/user/accounts/svelte/SeedUsersFiltersForm.svelte`,
  `SeedUsersFiltersModal.svelte`, `seed-users/filters.form.server.ts` — filters;
- `src/modules/user/accounts/svelte/accounts-delete/AccountsDelete.svelte` и
  `accounts-delete.form.server.ts` — stationary receipt + no-JS redirect;
- `src/core/hooks/component-form/types.ts`, `server.server.ts` — actual registration
  signatures и early gates; не выдумывать опцию `preAuthorize`, если текущий API
  предоставляет `authorize`/другой публичный hook;
- `src/core/hooks/modal-paginator.svelte.ts`, `src/core/ui/listing/types.ts`,
  `src/core/lib/paginate/README.md` — scope и поддержанные props;
- demo payload `src/routes/(site)/(app)/upload-demo/upload.form.server.ts` —
  `StreamFile`/registered upload. Demo читать в отдельном module-demo worktree,
  не устанавливать его ради runtime зависимости Drive.

## 2. Этап 0 — зафиксировать baseline и инвентаризацию

### Изменения

Перед реализацией младшая модель должна выписать в рабочем PR:

- текущие route/load/action файлы из `src/routes/(site)/(app)/drive/**`;
- текущие UI и modal registry из `src/modules/drive/**` и `src/sections/drive/**`;
- все формы и их domain fields из `src/modules/drive/form.ts`;
- все места, где встречаются `intercept: false`, `?/mkdir`, `?/upload`,
  `DriveNodeActions`, `DriveCreate`, `DriveFilters`;
- текущие tests и тесты native `component-form`/`seed-users`.

Зафиксировать baseline, не исправляя код:

- `mkdir` сейчас не содержит в разметке `parent_id` и `return_to`; `mkdir.hidden()`
  даёт только envelope;
- аналогичная проблема есть у большинства node/access forms;
- upload не имеет `*.form.server.ts`, поэтому global component-form middleware
  не пропускает multipart file part как зарегистрированную форму;
- native named actions и redirect объясняют уход модалки на страницу;
- текущие four browse routes экспортируют один общий набор 11 actions;
- текущий list не является native `Listing` source;
- current picker применяет `kind=folder` после получения страницы и не реализует
  настоящий `ids` slice;
- `serveDriveFile` не имеет route/caller.

### Gate 0

- Есть список файлов и форм с фактическими строками/символами.
- Есть отдельный baseline test report.
- Ни один Drive-файл ещё не изменён.
- В отчёте явно разделены доказанные дефекты и риски, требующие runtime test.

## 3. Этап 1 — domain/service correctness до UI

UI не должен маскировать ошибки домена. Сначала исправить и покрыть сервисы.

### 3.1. Upload и quota

В `service/upload.ts` реализовать безопасный порядок:

- ранний `preAuthorize` до чтения/публикации байтов;
- writable parent проверяет, что папка не trashed и принадлежит допустимому
  пространству доступа;
- ранний quota precheck уменьшает заведомо лишнюю загрузку, но не заменяет
  окончательную проверку;
- новая версия bytes создаётся в bounded staging/immutable path вне долгой DB
  transaction; staging ещё не является live reference Drive;
- затем короткая DB transaction берёт владельческий advisory lock, заново читает
  parent/ACL/имя/existing revision и logical used bytes, считает delta и проверяет
  quota; только после этого публикует новую ссылку;
- если competing writer сменил existing revision/name, вернуть conflict, а не
  затереть его устаревшими данными. Не держать DB lock на всё время сети;
- staging ограничен upload budget, rate limits и cleanup; незавершённая операция
  после аварии процесса должна иметь bounded TTL/orphan cleanup, не только catch;
- failed overwrite не меняет старые байты;
- overwrite shared copy не меняет байты sibling copy без явной copy-on-write;
- исключение transaction компенсирует staging object;
- лимиты формы, middleware и storage path совпадают; для UI использовать штатный
  streaming component-form transport, а не `arrayBuffer`/неограниченный buffer.

Владелец quota — owner destination folder (root — actor), не editor, который
загрузил файл. Ввести module constant `DRIVE_UPLOAD_MAX_BYTES = 64 * 1024 * 1024`
и использовать его в file limit; общий budget — лимит файла плюс явно ограниченный
размер текстовых полей и multipart overhead по штатному form API. Port staging
должен возвращать verified stored length, hash и immutable file identifier;
не доверять declared size для delta. Превышение/mismatch → отказ и cleanup.
Один delta для overwrite — `actualNewSize - previousLiveSize`; это logical quota,
не physical storage-server ledger. После commit убирать старую ссылку/объект только
при нуле references; compensation не удаляет shared deduplicated object по hash.
Перед изменением port проверить supported storage API; если immutable write или
безопасное удаление не выражается текущим API — оформить маленькую core prerequisite
с тестом, не имитировать rollback старых bytes.

Сохранить deduplication только там, где она совместима с immutable/versioned
reference. Не удалять старый объект до проверки количества ссылок.

### 3.2. ACL, traversal и quota mutation

В `service/query.ts`, `service/access.ts`, `service/mutate.ts`:

- starred-only foreign-folder query сохраняет parent/subtree restriction;
- каждая breadcrumb ancestor metadata либо проверяется отдельным access policy,
  либо явно ограничивается безопасной видимостью shared subtree;
- copy и restore проверяют logical quota под тем же lock, что upload;
- `writableFolder` отвергает trashed target;
- `allOwnerNodes` и `liveSiblings` не имеют тихого hard cap/одностраничного поиска:
  либо обходят все страницы, либо возвращают явную bounded failure;
- все mutation paths повторно проверяют ACL внутри transaction.

Mkdir — операция только БД: папка весит 0 logical bytes, не требует доступного
storage и разрешена при исчерпанной byte quota. Единое правило live sibling names
обеспечивает DB unique invariant для `(owner, parent, normalizedName)`, включая
`parent=null` (проверить NULL semantics индекса); все конкурирующие naming mutations
используют общий owner lock и переводят unique conflict в domain conflict. Не
ограничиваться предварительным `liveSiblings` check. Добавить full-quota/storage-down
mkdir test и concurrent mkdir/upload одного имени: успешна ровно одна операция.

### 3.3. Tokens и WebDAV

- до замены UI временный shared-store reveal привязать к actor/account и сделать
  атомарным; если публичный store API этого не позволяет, отключить reveal и закрыть
  gate только после переноса POST-only receipt из §5.4 в этот этап. Не оставлять
  уязвимый промежуточный вариант ради порядка этапов;
- shared-store key нельзя использовать другим authenticated actor;
- DAV lock key содержит account namespace;
- DAV overwrite/move не удаляет destination до успешной фиксации replacement;
- rename/move не оставляют partially completed state при отказе.

### Gate 1

Добавить/обновить unit/integration tests на:

- failed overwrite сохраняет старые bytes;
- shared-copy overwrite изолирован;
- transaction exception чистит staging;
- concurrent upload/quota/name conflict;
- copy/restore quota;
- starred foreign-folder isolation;
- deep-share breadcrumb policy;
- trashed target rejection;
- traversal больше первой страницы;
- token actor binding и concurrent consume;
- одинаковый DAV path у двух accounts;
- failed DAV replacement atomicity.

Все новые тесты должны вызывать реальные service boundaries. В отчёте отдельно
указать, какие concurrency claims проверены реально, а какие только статически.

## 4. Этап 2 — page projection и native Listing

### 4.1. Не менять cursor callers молча

Сохранить существующий cursor API для старых callers. Для native Listing добавить
явный page-mode projection поверх того же ACL/filter/sort pipeline:

```ts
page?: number
```

или отдельную `loadDrivePage`, но не дублировать правила доступа.

Правила:

- page mode и cursor mode взаимоисключающие;
- `page` положительный, `pageSize` нормализуется единообразно;
- фильтрация и сортировка выполняются до page slice;
- `totalItems`, `totalPages`, `hasNext`, `hasPrev` вычисляются из полного
  разрешённого набора;
- не загружать в браузер «все» записи и не подменять page mode увеличением
  cursor limit;
- URL native Listing использует `?drive=N` и `drive.size`, без `drive.after`.

### 4.2. Module-local item type

В module UI/source boundary ввести:

```ts
type DriveListItem = DriveEntry & { readonly id: string }
```

где `id === entry.node.id`. Не менять чистый `DriveEntry` ради UI-контракта.

### 4.3. Source registration

Вынести/перестроить `src/modules/drive/source.ts` по образцу
`src/modules/user/accounts/svelte/seed-users/source.ts`:

- `defineListExtras`, `extraField`, `defineSource`, `definePaginator`;
- idempotent `ensureDrivePaginator` через `hasPaginator`;
- `createUrlAdapter` с page key `drive`, page sizes, defaults и filter schema;
- отдельные extra keys: `q`, `ord`, `type`, `starred`, `from`, `to`, `ids`;
- internal list identity для root/folder/trash, участвующий в `reloadKeys` и
  snapshot; он не должен загрязнять внешний URL, если уже закодирован path;
- источник вызывает `preloadData` того же canonical list route, а не REST endpoint;
- отказ доступа становится source error/fact, а не пустым успешным списком.

`ids` имеет отдельную семантику:

- отсутствует — обычный список;
- присутствует пустым — пустой выбранный набор;
- ограничение применяется до totals/pages;
- UUID deduplicate и bounded;
- ACL считается для каждого selected ID, особенно если IDs из разных folders;
- `kind=folder` применяется сервером до пагинации;
- `ids` не считается обычным filter badge.

Выбранная сериализация: отсутствие `drive.ids` — unrestricted, `drive.ids=none` —
явно пустой набор, непустое значение — bounded comma-separated UUIDs. Внутреннее
значение extras также `undefined`/`none`/UUID-list: не нормализовать пустой набор в
пустую строку и не копировать seed loop, отбрасывающий falsy values. Parser разрешает
`none` только как одиночный sentinel и передаёт в сервис `ids: []`; `ids` отсутствует
→ не передаёт restriction. Это должно сохраняться через snapshot и preload URL.

Конкретный новый service API: `loadDrivePage(db, actor, args)` с `page`, `pageSize`,
filter keys и `ids?`; общий private authorizedEntries pipeline разделяет с
`loadDriveSlice`. Route добавляет `snapshot: PaginatorState<DriveListItem> | null`
в отдельный `DriveListRouteData`, не переименовывает молча существующий сервисный
`DriveRouteData`. Для внутренних identity использовать `root`, `folder:<UUID>`,
`trash`; source восстанавливает из них строго `/drive`, `/drive/<UUID>`,
`/drive/trash`. Sort сохраняет domain comparator и обязательный ID tie-breaker.
Page вне диапазона возвращает пустой массив с запрошенным page и корректными totals,
а не snapshot под другим page key. Серверный full-read не имеет тихого усечения:
иначе exact totals недопустимы.

### 4.4. DriveBrowse/DrivePicker

Перестроить `DriveBrowse.svelte` как доменную обёртку над `Listing`:

- `Listing` получает `name`, `pageParam`, `route`, `initial`, `identityKey`, `actor`,
  search/filters и row snippet;
- карточка остаётся Drive-specific, Listing остаётся generic;
- folder/trash/root transitions заменяют snapshot, а не смешивают stores;
- список и modal используют один initial snapshot contract.

`DrivePicker` не копирует browse list:

- использует тот же shared list wrapper с `url={false}`;
- принимает external selection/callback/rowAttrs;
- picker filters server-side;
- picker page state scoped, не попадает в caller URL;
- destination selection возвращается через штатный picker result contract,
  включая detail-page move/copy и modal use-case.

### Gate 2

- TypeScript подтверждает `DriveListItem.id` на всех Listing paths.
- Тесты page mode: page 1/2, totals, filters, root/folder/trash identity,
  no cursor+page mixing.
- SSR snapshot и subsequent `preloadData` дают одинаковый domain projection.
- Browser/SSR проверяет, что folder rows, trash rows и picker rows не дублируют
  старый hand pager.
- Проверено, что нет нового `/api/.../list` endpoint.
- Picker test содержит больше page size записей, files before folders и distant IDs.

## 5. Этап 3 — component-form registrations и shared operation units

### 5.1. Общий component contract

Для каждой операции создать рядом с module UI:

- `form.ts` или существующее описание формы;
- `<Operation>.svelte` — shared body/page/modal component;
- `<operation>.form.server.ts` — `registerComponentForm`;
- thin route `+page.server.ts` только с load/initial data;
- modal registration и thin modal carrier.

Форма должна явно рендерить каждый domain field через `<Field>`:

- envelope: `form.hidden()`;
- domain hidden values: `<Field of={bound.field('parent_id')}>`,
  `node_id`, `return_to`, `token_id` и т. п.;
- `return_to` всегда normalizes/validates with `localPath` server-side;
- hidden fields — просьба клиента, не authorization. Domain повторно решает actor,
  ownership и ACL.

### 5.2. Server execute contract

В `execute`:

- invalid intent/authorization/domain refusal → `fail(...)`, не `commit()`;
- successful mutation → `commit()` и structured `{ data: { step: 'done', ... } }`;
- никакого Kit redirect из execute;
- `redirectOnSuccess` используется только native no-JS и возвращает validated local
  fallback/list URL;
- JS receives result before redirect callback is considered;
- upload registration declares correct file budget and early authorization.

Component success state повторяет `accounts-delete`:

- stationary receipt;
- deduplicate by `submissionId`;
- `invalidatePaginator` affected names;
- `m.modals.invalidateLoader` для node/detail/quota/access payloads;
- no automatic modal close unless a separate UX decision explicitly requires it.

### 5.3. Операционные компоненты

Сделать в таком порядке:

1. `DriveMkdir`: route/modal отдельно от upload; parent and return fields rendered;
2. `DriveUpload`: registered streaming form, parent/return fields, early auth,
   stable receipt and failure continuation;
3. rename, move, copy;
4. star, trash, restore, purge;
5. share/unshare and access list refresh;
6. DAV issue/revoke;
7. download route/link (GET, not component form).

Для page and modal initial data не создавать разные domain loaders. Modal carrier
использует registered route + `useLoader`; shared component получает `initial`.

### 5.4. Одноразовый DAV secret — явное исключение

Выбранный target: убрать `?issued=UUID` и чтение secret из GET/preload. Выдающая
registration возвращает secret только в результате собственного POST, с
`Cache-Control: no-store`; не класть его в URL, logs, persistable paginator/modal
snapshot или localStorage. JS показывает его в stationary receipt. Без JS задать
`redirectOnSuccess: () => 'inline'`: штатная POST-continuation показывает тот же
receipt без PRG. Это сознательное исключение к общему PRG, а не redirect workaround.
GET выдающей страницы никогда не выдаёт и не потребляет secret. Удалить старый
bearer shared-store reveal; тесты вместо него проверяют изоляцию POST-ответа и
отсутствие раскрытия при GET/preload/повторном открытии. Нельзя обещать защиту от
повторной выдачи при refresh POST без проверки штатной idempotency/replay policy.

### Gate 3

Для каждой mutation-строки route matrix есть проверяемые (фильтры закрываются
отдельно на Gate 4):

- form ID;
- registration;
- fallback route;
- modal registration;
- shared component;
- explicit component-form action URL;
- `redirectOnSuccess` native target.

Автоматически проверить:

- registry не содержит duplicate form IDs;
- `grep` по Drive UI не находит inline `<form>`, `?/rename`, `?/mkdir` и подобные
  named page actions в row/list components;
- каждая `defineForm` domain field присутствует среди successful controls SSR;
- upload проходит global middleware и размерный budget.

## 6. Этап 4 — browse actions, links и lifecycle

### 6.1. Удалить inline mutation UI

Из `DriveCreate`, `DriveNodeActions`, `DriveAccess`, `DriveFilters` удалить
формы, встроенные в browse/detail row. Оставить только links/buttons с:

- `asLink` для обычного fallback route;
- `useModalLink` для modal presentation;
- одинаковым operation route params.

Обычная folder/breadcrumb navigation может оставаться page link, но operation
buttons должны открывать registered operation modal при наличии modal host и иметь
рабочий fallback route без JS.

### 6.2. Refresh и reactive props

Не захватывать `nodeId`, `parentId`, `returnTo`, starred, target options и share
maps один раз через `untrack`, если компонент может пережить loader invalidation.
После mutation:

- refresh all relevant paginator scopes с `invalidatePaginator(name)`;
- invalidate modal loader отдельно;
- owner filter dialog использует `useOwnerPaginatorStore`, не глобальный store;
- modal picker использует `useSlotPaginatorScope(..., { url: false })`.

### 6.3. Filters

Сделать Drive filters по seed pattern:

- shared form description + shared form component;
- sidebar/page and modal use same component;
- enhanced modal calls `setExtra(ownerStore, DRIVE_NAME, patch, { pageSize })`,
  then closes only filter dialog;
- native POST uses validated `from` and `listHref`, commits structured href, and
  PRG redirects;
- enhanced standalone page после валидации показывает stationary receipt со
  штатной `asLink(href)` «Открыть список»; href строится через тот же `listHref`.
  Автоперехода нет. Нельзя рассчитывать на `redirectOnSuccess` при JS;
- native search is separate Listing `SearchBar`, not GET fields embedded in filter
  mutation form;
- defaults omitted from URL and active filter count.

### Gate 4

- JS-on operation in modal: no document navigation, modal stack unchanged, receipt
  visible.
- JS-off operation: POST 303 to expected local fallback/list route.
- Invalid operation: field/domain error visible, no success notice, entered fields
  retained.
- Filter modal changes only its owner scope; page and modal stores do not overwrite
  one another.
- `return_to` cannot become external URL.
- Browser network/URL assertion proves no `?/action` navigation for JS submit.

## 7. Этап 5 — browser and end-to-end verification

Прямые action tests оставить как domain regression tests, но добавить tests through
actual rendering and transports.

### 7.1. Form/render contract

Для каждой operation:

- SSR locate form by form ID;
- collect successful controls;
- assert all required domain fields and expected current values;
- submit rendered form, not manually assembled body;
- assert actual global `componentFormsHandle` dispatch.

Минимум для mkdir: parent folder не root, `return_to`, name; после success folder
создан именно в выбранном parent. Это отдельно ловит исходный баг.

### 7.2. JS-on modal matrix

Проверить для mkdir, upload, rename и одной destructive operation:

- modal opened through registered modal link;
- submit does not change document URL or replace modal with page;
- response is structured component-form result;
- receipt remains mounted;
- affected list/detail data refreshes;
- close is explicit user action.

### 7.3. JS-off/native matrix

Запустить browser/native request with JS disabled:

- valid operation returns 303 to local validated route;
- invalid operation renders failure with values/errors;
- no operation posts to browse page `?/action`;
- upload uses correct multipart budget and does not get rejected by global unmatched
  multipart guard.

### 7.4. Domain/security matrix

Включить все tests из Gates 1–4, плюс:

- download access, `Content-Disposition`, MIME sniff protection and Range/304;
- picker cross-folder ACL and absent-vs-empty IDs;
- stale props after invalidate;
- list refresh in page + modal simultaneous scopes;
- DAV protocol regression tests after storage mutation changes.

### Gate 5

Для чистого `arch` и установленного Drive payload:

Не запускать `MODULES=none` поверх единственной установленной копии, если это
удалит нужный для проверки payload. Использовать отдельные чистые fixture/worktree:
A — core без optional modules, B — штатно установленный локальный Drive candidate
(не старый remote tag). В B проверить module listing/manifest перед сборкой.

PowerShell, в каждой fixture с её module configuration:

```powershell
$env:KIT_ADAPTER = 'node'
npm run check
npm run test:unit
npm run test:guard
npm run build
npm run test:browser
```

В fixture A отдельно задать `$env:MODULES = 'none'`. В fixture B выбрать локальный
candidate штатным module installer/config, не выдумывать имя source/version в этом
плане. Drive tests должны реально попасть в Vitest/browser runner: проверить
discovery output, добавить module-owned browser suite и регистрацию в runner, если
он не обнаруживает её автоматически. Прогон без Drive tests не закрывает gate.

Команды/переменные должны соответствовать актуальному `AGENTS.md`; если команда
требует secrets, отметить `SKIP` причиной, не выдавать это за успешную проверку.
Для browser suite сначала собрать preview, затем запускать весь Drive-relevant
suite. На Windows отдельно проверить case-collision (`Steps.svelte` и
`steps.svelte.ts` и новые файлы).

## 8. Этап 6 — документация, sync и финальная проверка соответствия плану

### Изменить после реализации

- этот план — фактический changelog conformance по этапам;
- `docs/plan-drive.md` и `docs/plan-drive-ui.md` не оставлять с утверждением, что
  старые inline actions/GET filters/cursor list уже соответствуют target;
- в начале обоих legacy plans добавить ссылку на этот repair plan и пометку, какие
  противоречащие clauses superseded: shared browse actions, inline mutation forms,
  GET filter submission, отсутствие access route, cursor-only Listing claim;
- `docs/pending.md` обновить только после прохождения gates, чтобы не пометить
  `drive.ids`, filters или Listing done заранее;
- README модуля обновить, если изменились публичные module contracts, upload
  transport или route matrix.

### Финальный conformance checklist

- [ ] Папка и файл имеют разные component, route и modal units.
- [ ] Любая mutation button — link на dedicated operation route/modal.
- [ ] Ни одна mutation form не находится в browse/list row.
- [ ] JS success stationary и structured; no-JS success PRG.
- [ ] `execute` не возвращает redirect и не превращает отказ в success.
- [ ] Все domain hidden controls реально присутствуют в SSR HTML.
- [ ] Upload зарегистрирован глобальным component-form registry и безопасен при
      overwrite/copy/quota failure.
- [ ] Listing использует native source/paginator/url adapter и top-level item id.
- [ ] Page mode и cursor mode явно разделены.
- [ ] Picker filters/IDs применяются на сервере до page slicing и с реальным ACL.
- [ ] Page и modal stores refresh scoped; modal loaders invalidated отдельно.
- [ ] Download route вызывает stored `fileId`.
- [ ] ACL, quota, trash, token и DAV regressions зелёные.
- [ ] Проверены source payload и установленный `arch`; случайные module/demo copies
      отсутствуют.
- [ ] Legacy documents не утверждают superseded architecture.

До прохождения этого checklist нельзя объявлять Drive «реализованным по плану» и
нельзя сокращать scope до одного исправления mkdir.

---

## 9. Статус реализации

Выполнено по этапам (снимки модуля — `drive-payload-snapshots`, этап 1 `a923d08`,
этапы 2–3 `efb779f`):

- **Этап 0** — окружение: работа идёт на `KIT_ADAPTER=node` + PGlite; токены не
  нужны, кроме `AUTH_SEAL_SECRET`/`DB_CURSOR_SECRET` для DAV/курсорных сьютов.
- **Этап 1** — домен: полный обход с `drive.traversal-limit` (`service/paging.ts`),
  один конвейер `authorizedEntries` и `loadDriveSlice`/`loadDrivePage`
  (`service/query.ts`), отказ trashed-папке, `lockDriveOwner`, квоты copy/restore,
  copy-on-write `file_id` при перезаписи, `webdav.server.ts` с атомарной заменой
  через корзину и namespace блокировок по аккаунту.
- **Этап 2** — списки: `source.ts` на `defineSource`/`definePaginator`/
  `createUrlAdapter`, page key `drive`, extras `q/ord/type/starred/from/to/ids`,
  внутренняя identity `root`/`folder:<uuid>`/`trash` в `_list`, снапшот несёт
  активные ключи, ошибка доступа — fact/notice, а не пустой успех.
- **Этап 3** — операции: матрица 14 операций (`operations.ts`), один
  `DriveOperationForm.svelte`, оболочки `ui/<op>/`, route-пары на каждую
  операцию, `operations.form.server.ts` (регистрации) и `operations.server.ts`
  (dispatch). Upload — глобальная регистрация с бюджетом байтов и ранней
  проверкой ACL/квоты; скачивание — `/api/drive/[nodeId]/download` по stored
  `fileId`. `/user/config/dav` переведён на операции `dav-issue`/`dav-revoke`:
  GET не выдаёт секрет, POST-ответ показывает его один раз, shared-store
  `issuedStore` удалён вместе с `dav-tokens.server.ts`. Добавлен экран
  `/drive/access` + модалка `drive.access`: список shares и ссылки
  share/unshare, без inline-форм.
- **Этап 4** — пикер: `DrivePicker.svelte` — тот же `DriveBrowse` с
  `url={false}`, отдельной identity не заводится; `kind=folder` применяется
  сервером до totals и нарезки, `drive.ids` (`none`/UUID-list) — тоже.
  Набор ограничен `DRIVE_IDS_MAX = 200`: лишние UUID за границей не читаются,
  повтор не тратит место в потолке (`parseDriveIds`).
- **Этап 4 (фильтры)** — `filters-form.ts` + `ui/filters/DriveFilters.svelte`,
  модалка `drive.filters`, страница `/drive/filters`, sidebar и кнопка
  `Listing`; enhanced-применение — `setExtra(ownerStore, DRIVE_NAME, patch)`,
  native — POST/PRG через `listHref`; поиск вынесен в штатный `SearchBar`.
- **Этап 5 (браузерные gate)** — невозможен в этом окружении: нет
  `libnspr4.so` и root. Вместо него SSR-тесты страниц, списка, пикера и DAV.

Отклонения от плана:

- **Курсор заменён страницами** (`drive=<n>`), `drive.after` больше не
  используется: страничный пагинатор даёт корректные totals и «Назад/Дальше».
- **`/drive/pick` остался отдельным маршрутом**, но рендерит общий `DriveBrowse`;
  ссылки модалок пикера строятся от него, чтобы не терять `from/param`.
- **Шаг «выбранные» в UI пикера не добавлен**: серверный срез `drive.ids`
  (`none`/UUID-list) готов и покрыт тестами, но отдельного шага набора в
  пикере нет — это единственный незакрытый UI-пункт legacy-плана.

Чек-лист conformance:

- [x] Папка и файл имеют разные component, route и modal units.
- [x] Любая mutation button — link на dedicated operation route/modal.
- [x] Ни одна mutation form не находится в browse/list row (SSR-тест это ловит).
- [x] JS success stationary и structured; no-JS success PRG (`?notice=<код>`).
- [x] `execute` не возвращает redirect и не превращает отказ в success.
- [x] Все domain hidden controls реально присутствуют в SSR HTML (тесты форм).
- [x] Upload зарегистрирован глобальным component-form registry и безопасен при
      overwrite/copy/quota failure (тесты `service/upload`, `query`).
- [x] Listing использует native source/paginator/url adapter и top-level item id.
- [x] Page mode и cursor mode явно разделены (курсора больше нет).
- [x] Picker filters/IDs применяются на сервере до page slicing и с реальным ACL.
- [x] Фильтры — одна форма на sidebar/модалку/страницу, enhanced `setExtra`,
      native POST/PRG; поиск — отдельный `SearchBar`; умолчания не в адресе.
- [x] Экран доступов `/drive/access` + `drive.access` со списком shares и
      ссылками share/unshare.
- [x] Page и modal stores refresh scoped; modal loaders invalidated отдельно
      (`invalidatePaginator` + `invalidateLoader`); браузерный прогон недоступен.
- [x] Download route вызывает stored `fileId`.
- [x] ACL, quota, trash, token и DAV regressions зелёные (35 тестов drive).
- [x] Проверены source payload и установленный `arch`; случайных module/demo
      copies нет (pre-commit module-guard).
- [x] Legacy documents не утверждают superseded architecture.

Не проверено (нужен браузер/JS): поведение модалок, stationary receipt после
клиентского submit, фильтры в модалке/sidebar, экран доступов, upload прогресс и
`?notice` после PRG. В этом окружении браузерный runner не запускается
(`libnspr4.so`, нет root); вместо него прогнаны unit/SSR-тесты (35 drive).
