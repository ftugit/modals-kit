# Drive: поведение операций, возврата, переноса и доступа

Статус: **план закрыт по решениям и готов к исполнению; ни один этап не начат.**
Открытых вопросов «как делать» нет. Единственное ограничение среды — браузерный
gate (нет `libnspr4` и root), он вынесен в §6 и не заменяется unit-тестами.

Этот документ меняет **поведение носителей и операций** поверх
[`plan-drive-repair.md`](./plan-drive-repair.md). Домен, ACL, WebDAV, источника
списка и пятислойная структура не переписываются.

Приоритет документов: `plan-drive-repair.md` задаёт архитектуру и доменные
ограничения; этот план **отменяет** его решения §0.1 (stationary receipt),
§5.2, §5.3, §6.3 и §7.2 в части результата операции. Всё остальное в repair-плане
действует.

Правила исполнения:

- «сделано» означает только зелёный тест или воспроизведённый вручную сценарий;
- нельзя переходить к следующему этапу, пока не выполнен gate предыдущего;
- нельзя менять домен, чтобы подогнать его под UI: сначала тест, потом правка;
- payload модуля живёт в каталоге модулей и не коммитится в `arch`.

## 0. Границы

### 0.1. Что исправляется

- Один и тот же успех для JS и no-JS: закрыть/вернуться, а не остаться на
  квитанции «Готово».
- У каждой операции своя форма, своё тело и своё правило успеха; общая матрица
  полей и общий `DriveOperationForm` удаляются.
- «Назад» — реальный шаг истории; `href` остаётся рабочим без JS.
- Upload без storage — доменный отказ, не 500; purge без storage — best-effort.
- Move/copy выбирают цель пикером, а не `targetFolders()`, и ведут в target.
- Share выдаёт доступ набору получателей через native `subjects`/`user.picker`,
  атомарно, с именами в `/drive/access`.
- «Важное» — маршрут `/drive/starred`, а не скрытый boolean-фильтр.
- Область списка — явная опция `scope`, а не побочный эффект фильтра.
- У Drive появляется вход в WebDAV; `/user/config/dav` остаётся единственным
  экраном инструкции.
- Дефект фильтров/поиска (пункт 12) сначала воспроизводится тестом; правка без
  падающего теста запрещена.

### 0.2. Источник истины и публикация

1. Меняется payload модуля (`modules-catalog/modules/drive/files`) или ядро,
   которому действительно нужен новый контракт.
2. Локальные проверки: `npm run check`, `vitest run <затронутые тесты>`.
3. Штатная установка/синхронизация модуля.
4. Повтор проверок на собранном `arch`.
5. `git status` не показывает случайных копий, demo-файлов и правок обеих копий.

### 0.3. Запрещённые решения

- Оставлять `step: 'done'` как общий результат обычных операций.
- Возвращать redirect из `execute` через `redirect(303, …)` вручную.
- Чинить no-JS, подменяя `next` на текущий URL: это и есть текущий баг.
- Оставлять `<select>` из `targetFolders()` и называть это выбором папки.
- Вводить второй список для корзины или «Важного».
- Делать Drive-специфичный toast; хост уведомлений общий.
- Считать `resolveAppStorage()` безопасным: он может бросить исключение.
- Чинить фильтры «на глаз» до появления падающей регрессии.
- Коммитить `src/modules/drive` из `arch` как источник.

## 1. Проверенные факты

Все строки ниже проверены чтением кода на момент написания плана. Это не
гипотезы; при расхождении с кодом прав код, а план фиксирует целевой контракт.

| # | Факт | Где именно |
|---|---|---|
| 1 | JS-успех рисует `step: 'done'` и остаётся на форме | `ui/DriveOperationForm.svelte`: `payload.step`, `done` |
| 2 | `execute` теряет `next`: возвращает только `{ data: outcome.data }`, где `next` лежит отдельным полем исхода | `sections/drive/operations.form.server.ts`, `execute` |
| 3 | `redirectOnSuccess` читает несуществующий `result.data.next`; при `null` ядро делает `303` на URL POST | `operations.form.server.ts`; `core/hooks/component-form/server.server.ts` (`target ?? event.url.pathname + event.url.search`) |
| 4 | `done()` кладёт `step: 'done'` в `data` и отдаёт `next` рядом | `sections/drive/operations.server.ts`, `done` |
| 5 | Все операции рисует один компонент по `spec.fields`; пери-операционные компоненты только делегируют | `ui/*/Drive*.svelte` → `DriveOperationForm.svelte` |
| 6 | «Вернуться к списку» — ссылка на `data.returnTo`, без истории | `DriveOperationForm.svelte`, `{#snippet back()}` |
| 7 | Upload вызывает `resolveAppStorage()` без `try` и может отдать 500 | `operations.server.ts`, `case 'upload'` |
| 8 | Purge тоже вызывает `resolveAppStorage()` без `try` | `operations.server.ts`, `case 'purge'` |
| 9 | `targetFolders()` даёт корень, предков узла и элементы текущего среза; не всё дерево | `sections/drive/load.server.ts`, `targetFolders` |
| 10 | Move возвращает `next = returnTo` (адрес источника) | `operations.server.ts`, `case 'move'` |
| 11 | Share принимает один `uid` текстом; сервис транзакционен для одной строки | `form.ts`, `operations.server.ts`, `service/mutate.ts` (`shareDriveNode`) |
| 12 | `/drive/access` показывает `share.uid` без имени | `ui/access/DriveAccess.svelte` |
| 13 | «Важное» — только `starred` boolean + скрытый фильтр; маршрута `/drive/starred` нет | `schema.ts`, `filters-form.ts`, `routes.ts` |
| 14 | Фильтр `starred` и `q` неявно снимают `parent_id`; `type`/даты остаются в папке | `service/query.ts`, `authorizedEntries` |
| 15 | `DriveBrowse` передаёт в `Listing` новый литерал `initial={{ snapshot, fact: null }}`; `Listing` в `$effect` по `initial` делает `data = initial; asked = null` | `ui/DriveBrowse.svelte`; `core/ui/listing/Listing.svelte` |
| 16 | `filters` и `returnTo` в `DriveBrowse` выводятся из `initial.snapshot`, не из живого стора | `DriveBrowse.svelte` |
| 17 | `setExtra` принимает `{ reload?, pageSize? }`; `undefined` удаляет ключ; `parseDriveIds` различает «нет ограничения» и `none` | `core/lib/paginate`; `source.ts` |
| 18 | В корзине успех restore/purge не закрывает модалку сам: это делает `onDone` корзины | `ui/DriveTrashModal.svelte`; `ui/*/Drive*.svelte` |
| 19 | WebDAV-бэкенд есть (`/api/dav`, токены, `drive.dav-disabled`), но входа с `/drive` нет | `webdav.server.ts`, `service/tokens.ts`, `ui/DriveBrowse.svelte` |
| 20 | Toast-хоста в проекте нет; есть только Drive-баннер `?notice=` | `routes/+layout.svelte`; `ui/DriveBrowse.svelte` |
| 21 | `user.picker` + `USER_PICKER_CHANNEL_PREFIX` — рабочий native-контракт возврата выбора через `sharedData`; no-JS fallback — `/users/pick` | `modules/user/accounts/svelte/UserPicker.svelte`; `modules/user/blocks/svelte/block-form/BlockFormBody.svelte` |
| 22 | `modals.close()` уже умеет шагать по истории; отдельный `history.back()` для модалки не нужен | `core/lib/modals/create.ts`, `close` |
| 23 | `goAddress(-1)` — разрешённый примитив шага истории; `visibleHref()` — текущий адрес | `core/lib/address/sveltekit.ts` |
| 24 | `ExecuteOutput` уже поддерживает `redirect?: string`, а `Result` сохраняет его в `result.redirect` | `core/lib/form/server.ts`; `core/lib/form/result.ts` |
| 25 | `filters.form.server.ts` уже возвращает `{ data: { href } }`, и его `redirectOnSuccess` читает `result.data.href` корректно | `modules/drive/ui/filters/filters.form.server.ts` |
| 26 | `resolveAppStorage()` возвращает `{ storage, writable, activeMode }`; `storage === null` и `writable === false` — штатные состояния | `core/server/app-storage.server.ts` |
| 27 | `listSeedUsers({ ids, nickname: true, pageSize })` есть в `accounts/service` и доступен через `auth(event)`; `nickname` приходит только при `canSeeNickname`, без права поле отсутствует | `modules/user/accounts/service/accounts.ts` (`ListSeedUsersArgs`); `modules/user/base/service/gateway.server.ts` |
| 28 | Существующие тесты Drive покрывают сервис/SSR, но не жизненный цикл JS-модалки и не связку «фильтр → стор → адрес → выдача» | `src/modules/drive/**/*.test.ts` |
| 29 | `GET /api/drive/[nodeId]/download` тоже зовёт `resolveAppStorage()` без `try` (сам он при `storage: null` отдаёт `503`) | `routes/api/drive/[nodeId=uuid]/download/+server.ts` |

Вывод: пункты 1–8, 10–18, 20, 29 — дефекты реализации; пункты 14 и 16 — принятые
ранее неявные решения, которые этот план заменяет; пункт 15 — подозреваемая
причина дефекта фильтров, но она должна быть доказана тестом.

## 2. Целевые контракты

### 2.1. Один успех для JS и no-JS

Успех операции — это **переход**, а не экран:

- модалка с `success: 'stay'` — закрыть модалку, инвалидировать списки и
  лоадеры, показать transient notice;
- модалка с `success: 'target'` — закрыть модалку и перейти на `next` (target
  папки), показать notice;
- страница операции — `goto(next)`, notice;
- no-JS — всегда `303` на `next`, notice через `?notice=`;
- `dav-issue` — единственное исключение: секрет нельзя отдать через PRG.
  Режим `inline`: остаться на месте, показать секрет один раз, закрыть только
  явной кнопкой.

Тип успеха живёт в реестре:

```ts
export type DriveOperationSuccess = 'stay' | 'target'

export interface DriveOperationSpec {
  readonly id: DriveOperationName
  readonly formId: string
  readonly path: string
  readonly modal: string
  readonly title: string
  readonly description: string
  readonly submit: string
  readonly destructive?: boolean
  readonly success: DriveOperationSuccess
  /** Секрет нельзя вернуть через PRG: ответ рисуется на месте, без 303. */
  readonly inlineSuccess?: true
}
```

Матрица успеха:

| Операция | Модалка | Страница | no-JS `next` |
|---|---|---|---|
| `mkdir`, `rename`, `upload`, `star`, `unshare`, `dav-revoke` | `stay`: close + invalidate | `goto(return_to)` | `303 return_to` |
| `trash-action` | `stay`: close + invalidate live/trash | `goto(return_to)` | `303 return_to` |
| `restore`, `purge` | `stay`: close + invalidate live/trash | `goto(return_to)` (`/drive/trash…`) | `303 return_to` |
| `move`, `copy` | `target`: close + `goto(target)` | `goto(target)` | `303 target` |
| `share` | `stay`: close + invalidate access/node | `goto(/drive/access?node_id=…)` | `303` туда же |
| `dav-issue` | `inline`: секрет на месте | `inline`: секрет на месте | `inline` (без редиректа) |

`next` всегда проверяется `localPath` на сервере. Клиент не строит адрес
самостоятельно, а берёт `result.redirect`.

Серверный контракт (обязателен дословно):

```ts
execute: async ({ values, commit, fail }, event) => {
  const outcome = await runDriveOperation(op, event, values as Record<string, unknown>)
  if (!outcome.ok) return fail([refuse(outcome.code, outcome.field)])
  commit()
  // `redirect` — чистый адрес: его читает JS и делает goto без дубля уведомления.
  return { data: outcome.data, redirect: outcome.next }
},
redirectOnSuccess: (event, result) => {
  if (spec.inlineSuccess) return 'inline'
  const href = localPath(result.redirect ?? null)
  if (!href) return null // аварийный fallback
  // `?notice=` добавляется только для no-JS: это ветка PRG, JS идёт через notify().
  return driveNoticeHref(href)
},
```

`drive.dav-issue` возвращает `'inline'` всегда, включая успех. Для остальных
`null` допустим только как аварийный fallback, а не как штатный путь.

### 2.2. Операция владеет формой, оболочка — только раскладка

`operations.ts` остаётся реестром: имя, `formId`, `path`, `modal`, подписи,
`success`. Из него удаляются `fields` и `DriveOperationField`.

`form.ts` перестаёт быть матрицей. Вместо неё — фабрики по операции в
`src/modules/drive/forms/`:

```text
forms/index.ts        реэкспорт и driveOperationDescription(op, data?)
forms/mkdir.ts        driveMkdirForm(data?)
forms/upload.ts       driveUploadForm(data?)
forms/rename.ts       driveRenameForm(data?)
forms/move.ts         driveMoveForm(data?)
forms/copy.ts         driveCopyForm(data?)
forms/star.ts         driveStarForm(data?)
forms/trash.ts        driveTrashForm(data?)
forms/restore.ts      driveRestoreForm(data?)
forms/purge.ts        drivePurgeForm(data?)
forms/share.ts        driveShareForm(data?)
forms/unshare.ts      driveUnshareForm(data?)
forms/dav.ts          driveDavIssueForm(data?), driveDavRevokeForm(data?)
```

`filters-form.ts` остаётся отдельным: фильтры не мутация и обслуживаются своим
`filters.form.server.ts`.

Запись `filters` **удаляется** из `DriveOperationName` и `DRIVE_OPERATIONS`:
у неё свой `formId`, своя модалка и своя страница, а `DriveOperationForm` её
никогда не рисовал. `DRIVE_OPERATION_NAMES` становится 13-элементным. Теста,
который считает элементы, нет — единственное место с числом «14» это
`src/modules/drive/README.md` (§«Операции — 14 штук»). README правится на
этапе 11 (13 операций + отдельная component-form фильтров, без
`DriveOperationForm` и stationary-receipt); до этапа 11 расхождение README с
кодом допустимо и фиксируется в отчёте этапа, а не молча.

UI:

```text
ui/operation/DriveOperationShell.svelte   заголовок, Common, body, submit, back
ui/operation/back.ts                      чистый выбор «история или href»
ui/operation/DriveBackLink.svelte         ссылка + JS-обработчик
ui/operation/success.ts                   чистый выбор close/goto/inline
ui/operation/use-drive-operation.svelte.ts  bind + effect успеха (один на все ops)
```

`DriveOperationShell` не знает имён полей. Он принимает `form` (результат
`bindComponentForm`), `title`, `description`, `submit`, `destructive`,
`returnTo` и `children(bound)`. Каждый `<op>/<Op>.svelte`:

1. строит свою фабрику `drive<Op>Form(data)`;
2. делает `bindComponentForm(forms, description, { action: data.action, … })`;
3. вызывает `useDriveOperation({ op, form, data, onDone })`;
4. рисует только свои поля внутри `DriveOperationShell`.

`DriveOperationForm.svelte` удаляется. Пери-операционные модалки остаются
тонкими носителями.

### 2.3. «Назад» — история, href — fallback

`ui/operation/back.ts`:

```ts
export type PageBack = 'history' | string

export function pageBackFrom(input: {
  referrer: string
  current: string
  href: string
}): PageBack {
  const ref = input.referrer.trim()
  if (!ref) return input.href
  try {
    const from = new URL(ref)
    const here = new URL(input.current)
    if (from.origin !== here.origin) return input.href
    if (from.pathname + from.search === here.pathname + here.search) return input.href
    return 'history'
  } catch {
    return input.href
  }
}
```

`DriveBackLink`:

- в модалке (`tryUseModals()` не `null`) — `modals.close()`: это уже шаг
  истории на нужную глубину, `goto` не вызывается;
- на странице — `pageBackFrom(...)`; `'history'` → `goAddress(-1)` из
  `#core/lib/address/sveltekit.js`, иначе `goto(href)`;
- модифицированный клик (Ctrl/Cmd/Shift/Alt, средняя кнопка) не перехватывается;
- `<a href>` остаётся в разметке всегда, поэтому no-JS работает.

`href` — validated `return_to`; при его отсутствии — корень `/drive`. Внешний
адрес не проходит.

Источник `referrer` — `document.referrer` только под `browser`; на SSR и при
пустом значении компонент рендерит обычную ссылку `href`. `pageBackFrom` —
чистая функция и тестируется без DOM.

### 2.4. Уведомление вместо квитанции

Добавляется общий минимальный хост:

```text
src/core/ui/notice/notice.svelte.ts   очередь, notify(), dismiss()
src/core/ui/notice/NoticeHost.svelte  aria-live="polite", автоскрытие
src/core/ui/notice/index.ts           публичный вход
```

- `NoticeHost` монтируется один раз в `src/routes/+layout.svelte` (рядом с
  `LoaderBar`), не в Drive.
- `notify(text, { tone?: 'success' | 'error', timeout?: number })`;
  по умолчанию 4 с, повторный вызов не дублирует одинаковый текст.
- `README src/core/ui/README.md` обновляется: новый пакет и контракт.
- JS-успех вызывает `notify()` после закрытия/перехода.
- no-JS получает `next` с `?notice=drive.notice-done`; `DriveBrowse` уже читает
  `notice` из `load`, но `shownNotice` отбрасывает код, которого нет в
  словаре, поэтому `DRIVE_MESSAGES` получает
  `'drive.notice-done': 'Операция выполнена'` (и, при желании, отдельные коды
  на операцию — тогда их добавляет `driveNoticeHref`). Баннер переделывается
  с `role="alert"`/destructive на нейтральный `role="status"`; текст — из
  `driveMessage`.
- Счётчики «Затронуто узлов», `payload.count`, `payload.deleted`, `payload.freed`
  из UI удаляются. Домен может их возвращать, но экран их не показывает.

Хелпер адреса:

```ts
// source.ts
export const DRIVE_NOTICE_DONE = 'drive.notice-done'
export function driveNoticeHref(href: string, code = DRIVE_NOTICE_DONE): string
```

ставит/заменяет `notice`, сохраняя остальные query-параметры. Вызывается один
раз — в `redirectOnSuccess` (§2.1); на клиент не попадает. Тестируется
отдельно.

### 2.5. Storage: доменный отказ, не 500

В `sections/drive/operations.server.ts`:

```ts
import type { Storage } from '#core/lib/storage/index.js'

type DriveStorageGate =
  | { storage: Storage; code: null }
  | { storage: Storage | null; code: 'drive.storage-unavailable' | 'drive.storage-readonly' }

async function driveStorageGate(): Promise<DriveStorageGate> {
  try {
    const { storage, writable } = await resolveAppStorage()
    if (!storage) return { storage: null, code: 'drive.storage-unavailable' }
    if (!writable) return { storage, code: 'drive.storage-readonly' }
    return { storage, code: null }
  } catch {
    return { storage: null, code: 'drive.storage-unavailable' }
  }
}
```

- `upload`:
  - проверка storage добавлена в `authorize` регистрации, до чтения байтов;
  - `execute` повторяет проверку (TOCTOU) и при отказе возвращает код домена;
  - узел в БД не создаётся;
- `purge`:
  - вызывается `driveStorageGate()`;
  - при `code !== null` удаление идёт без `del` (best-effort), успех не
    превращается в отказ;
- `loadDriveOperation('upload')` отдаёт `storageReady` и `storageReason`
  (`null | 'drive.storage-unavailable' | 'drive.storage-readonly'`);
- `DriveUpload.svelte` при `!storageReady` показывает сообщение и не рисует
  file-input; submit недоступен;
- `routes/api/drive/[nodeId=uuid]/download/+server.ts` тоже зовёт
  `resolveAppStorage()` без `try`: сюда тот же `driveStorageGate()`, при отказе
  `storage: null` → существующий путь `serveDriveFile` отдаёт
  `drive.storage-unavailable` с `503`, а не исключение с `500`;
- 500 остаётся только для неизвестного исключения.

`DriveOperationData` получает:

```ts
readonly storageReady: boolean
readonly storageReason: 'drive.storage-unavailable' | 'drive.storage-readonly' | null
```

### 2.6. Move/copy: цель через `drive.picker`

`targetFolders()` и `DriveOperationData.folders` для move/copy удаляются.
Цель выбирается пикером:

- `drive.picker` принимает `{ from, param, kind, folder }`;
- `drivePickerRoute` **не получает** `keys`/`search`: ключ `from` уже
  забронирован владельцем `user.filters` (`/drive/filters` и `/users/filters`
  делят его), и вторая бронь под другим владельцем падает при старте до любого
  адреса (`claimQuery` в `core/lib/address/keys.ts`). Вместо этого в
  `routes.ts` появляется типизированный
  `drivePickerHref(p: DrivePickerParams = {})` (строит query через
  `URLSearchParams`, `from` проверяет `localPath`), а `drive.picker` объявляет
  `route: (p?: DrivePickerParams) => drivePickerHref(p ?? {})`;
- `folder` — ключ адреса, `DrivePickerData.folderId` — проп экрана; переименование
  не нужно, это разные слои;
- для move/copy: `kind=folder`, `param=target_id`, `from` — адрес самой
  операции с параметрами. `data.action` — это голый путь без query, поэтому
  `from` строится как
  `driveOperationHref(op, { nodeId: data.node?.id, returnTo: data.returnTo })`
  (или добавляется `selfHref` в `DriveOperationData`; одно из двух, не оба);
- в модалке пикер открывается поверх операции через `useModalLink('drive.picker', …)`;
- выбор возвращается нативным каналом `sharedData`:

```ts
// ui/DrivePicker.svelte (module)
export const DRIVE_PICKER_CHANNEL_PREFIX = 'drive-picker:'
export interface DrivePickerPayload {
  seq: number
  id: string | null
  label: string
}
```

`DrivePickerModal` на «Выбрать» пишет
`sharedData[`${DRIVE_PICKER_CHANNEL_PREFIX}${param}`]`, закрывает пикер и
инвалидирует его лоадер. `DriveMove`/`DriveCopy` в `$effect` читают тот же ключ,
сравнивают `seq`, вызывают `bound.f.target_id.onInput(id)` и показывают `label`.
Поле `target_id` остаётся hidden: сервер по-прежнему получает его из формы.

Чтобы тот же `DriveBrowse` работал в обоих носителях, у него появляется
`onPick?: (node: DriveListItem) => void` и `onCancel?: () => void`:

- страница пикера (`/drive/pick`) их не передаёт — кнопки остаются `<a href={pickHref}>`
  и «Отмена» ведёт на `picker.from`, поэтому no-JS работает;
- модалка передаёт `onPick` (запись в `sharedData` + `modals.close()`) и
  `onCancel` (`modals.close()`), и кнопки рисуются как `type="button"`.
- `DrivePickerModal` больше не вызывает `invalidateAll()` при выборе: это
  перезагрузило бы форму операции под пикером. Инвалидируется только лоадер
  `drive.picker`.

Без JS: ссылка на `/drive/pick?kind=folder&param=target_id&from=<operation URL>`
открывает страницу пикера; «Выбрать» возвращает на `from` с `target_id` в query,
`loadDriveOperation` читает его через `optionalUuid(event, 'target_id')`
(иначе — `node.parentId`) и кладёт в `values.targetId`.

`next`:

- `target_id === null` → `driveRootRoute.href()`;
- иначе → `driveFolderRoute.href({ folderId: target_id })`;
- для `copy` — то же самое: пользователь видит созданную копию в target.

`driveOperationHref` получает `targetId`, чтобы модалка и страница одинаково
восстанавливались по ссылке.

### 2.7. Share: набор получателей, атомарно

Форма `share`:

- вместо текстового `uid` — `subjects: field.multiselect`;
- опции — выбранные получатели: `value = uid`, `label = nickname || uid`
  (как в `BlockFormBody.svelte`, но с именем). Подписи собирает
  `sections/drive/load.server.ts` одним хелпером:

  ```ts
  async function driveUserLabels(
    event: RequestEvent,
    uids: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (uids.length === 0) return out
    const r = await auth(event).listSeedUsers({
      ids: [...uids],
      nickname: true,
      page: 1,
      pageSize: Math.min(100, uids.length), // дефолт 10 — иначе подписи обрежутся
    })
    if (!r.ok) return out // нет auth.select → остаются uid-подписи
    for (const u of r.value.items) out.set(u.id, u.nickname ?? u.id)
    return out
  }
  ```

  Отсутствие права или неизвестный uid — не ошибка экрана: `label = uid`.
  Сервис Drive не импортирует user-сервис;
- кнопка «Выбрать получателей» использует native `user.picker`:
  - модалка: `{ mode: 'multiple', channel: 'drive.share.subjects', picked }`;
  - no-JS: `/users/pick?mode=multiple&param=subjects&from=<clean operation URL>&picked=…`;
  - результат читается из `sharedData['picker:drive.share.subjects']`, как в
    `BlockFormBody.svelte` (сравнение `seq`, `normalizeSubjects`, обновление
    `bound.f.subjects`);
- ручной UUID остаётся только fallback'ом, когда у актора нет `auth.select`:
  тогда `subjects` — обычный multiselect с подсказкой «введите UUID», без
  кнопки пикера. Это фиксируется в `DriveShare.svelte`, а не имитируется
  неработающим пикером.

Сервер:

- `runDriveOperation('share')` передаёт `uids` из `values.subjects`;
- `DriveOperationFailure` получает `params?: Record<string, unknown>`, чтобы
  отказ мог назвать получателя;
- `service/mutate.ts` получает `shareDriveNodeMany(db, actor, { nodeId, uids, role })`:
  - нормализует и дедуплицирует `uids`, отбрасывает пустые;
  - отказ на себя — `drive.share-self`;
  - проверяет существование каждого получателя; при отсутствии возвращает
    `drive.share-target-missing` с `params: { uid }`;
  - пишет все строки в одной транзакции; любой отказ откатывает всё;
  - существующая `shareDriveNode` остаётся обёрткой над batch для одного uid,
    чтобы не ломать доменные тесты;
- `unshare` по-прежнему один uid;
- `messages.ts` получает
  `'drive.share-target-missing': 'Получатель <uid> не найден'`, а `refuse()`
  передаёт `template: driveMessage(code)` и `params` в `FormError` — форма
  интерполирует их сама (контракт `FormError.template + params`). Текст фразы
  не собирается в UI.

`/drive/access`:

- `DriveShareView` получает `label: string`;
- подписи резолвятся в `sections/drive/load.server.ts` тем же
  `driveUserLabels(event, uids)` (§2.7) после `readDriveShares` — в
  `loadDriveNode`, `loadDriveOperation` и `loadDriveAccess`; отказ или
  отсутствие права даёт `label = uid`, а не ошибку экрана. В
  `service/mutate.ts` `readDriveShares` остаётся про права и строки, без
  доступа к user-портам;
- `DriveAccess.svelte` показывает `label`, uid — вторичной строкой.

### 2.8. Корзина

Корзина остаётся тем же `DriveBrowse` с `initial.trashed`; второй список не
заводится. Меняется только успех:

- `restore`, `purge`, `trash-action` используют §2.1;
- модалка закрывается и инвалидирует `drive.trash`, `drive.browse`, `drive.node`;
- страница и no-JS возвращаются на `return_to` (для корзины это
  `/drive/trash` + текущие фильтры);
- строка исчезает из корзины, live-список обновлён;
- отдельного экрана «Готово» нет.

### 2.9. «Важное» — маршрут

- `driveStarredRoute = kitRoute('/drive/starred')`;
- `DriveListIdentity` получает `{ kind: 'starred' }`;
- `parseDriveIdentity('starred')`, `driveIdentityExtra → 'starred'`,
  `driveIdentityPath → driveStarredRoute.href()`;
- `loadDriveList` для starred вызывает
  `loadDrivePage({ starred: true, folderId: null, scope: 'global' })`;
- вход — кнопка «Важное» в `controls` рядом с «Корзина»; активное состояние —
  по identity;
- `filters`/`starred` из формы фильтров удаляются: один mental model —
  отдельный список, а отметка доступна на карточке узла;
- старые ссылки `?drive.starred=1` перенаправляются `307` на `/drive/starred`
  внутри `loadDriveList` — `redirect(307, driveStarredRoute.href())` из
  `@sveltejs/kit`, выброшенным до разбора фильтров (в sections это обычный
  паттерн: `src/sections/user/logout/load.server.ts`); для JS-перехода
  SvelteKit разворачивает его на клиенте так же;
- главная (`DriveEntry`) не меняется: ярлык «Важное» на главной — отдельное
  решение после того, как маршрут принят.

### 2.10. Область списка (`scope`)

- `DriveListFilters` получает `scope: 'folder' | 'global'`, по умолчанию
  `'folder'`;
- URL-ключ — `drive.scope`; в адрес пишется только `global`;
- `DRIVE_EXTRA_SEARCH.scope` — `text` с проверкой `v === 'folder' || v === 'global'`;
- `DRIVE_EXTRA_DEFAULTS.scope = 'folder'`;
- `parseDriveFilters`, `driveFilterExtras`, `driveListHref`,
  `driveFilterValues`, `filters-form.ts` и `DriveFilters.svelte` учат `scope`;
- `loadDriveList` передаёт `scope` в `loadDrivePage`;
- `DriveSliceArgs`/`DrivePageArgs` получают `scope?: 'folder' | 'global'`;
- `authorizedEntries`:
  - `global` **не** добавляет `parent_id` для своего живого диска;
  - `folder` добавляет `parent_id` (корень — `isNull`) как сейчас;
  - чужая папка по ссылке в `global` не расширяется: остаётся `parent_id = folder.id`;
  - корзина (`trashed`) остаётся плоской в обоих режимах;
  - `q`, `type` и даты подчиняются `scope` одинаково; исключений «этот
    фильтр сам делает глобально» больше нет;
  - `starred` в фильтрах не остаётся (§2.9): `/drive/starred` сам задаёт
    `scope: 'global'`, поэтому отдельной ветки `starred` в `authorizedEntries`
    не нужно — остаётся только предикат отметки;
- UI:
  - `DriveFilters` показывает «Область: текущая папка / весь диск»;
  - `global` доступен только на своём живом диске (`folder === null` или
    `folder.ownerId === actor.id`, `!trashed`); в чужой папке и корзине select
    disabled с пояснением;
  - `type=folder` в `global` — результат, а не навигация: клик открывает
    карточку узла, а не меняет папку списка;
- `ord`/`size`/поиск режим не меняют.

### 2.11. WebDAV как возможность диска

- В `controls` у `DriveBrowse` (когда `!trashed && !picker`) появляется
  `<Button {...asLink('/user/config/dav')} variant="outline" size="sm">Подключить по WebDAV</Button>`;
  без JS это обычная ссылка.
- `/user/config/dav` остаётся единственным экраном инструкции; модалка
  `drive.dav-issue` не превращается в инструкцию.
- `DriveDavTokens.svelte` добавляет блок подключения:
  - endpoint `<code>/api/dav/</code>` (относительный адрес работает и на SSR);
  - «Логин — любой; пароль — созданный ниже»;
  - список токенов и кнопки issue/revoke остаются;
- `DriveOperationData` получает `davEnabled: boolean`
  (`AUTH_SEAL_SECRET` задан и не короче 32 символов); при `false`
  `DriveDavTokens` показывает `drive.dav-disabled` вместо кнопки создания;
- `config.ext.ts` (`security` / `dav`, `ownOnly`) остаётся вторым путём.

## 3. Карта кода

| Файл | Символы | Изменение |
|---|---|---|
| `src/modules/drive/operations.ts` | `DriveOperationSpec`, `DRIVE_OPERATIONS`, `DriveOperationParams`, `driveOperationHref` | убрать `fields`; добавить `success`, `inlineSuccess`; `targetId` — в `DriveOperationParams` (адрес), не в `Spec`; подписи не менять без нужды |
| `src/modules/drive/form.ts` | `driveOperationDescription` | оставить только диспетчер по фабрикам; общие `field.*`-хелперы — здесь |
| `src/modules/drive/forms/*` | `drive<Op>Form` | новые фабрики, по одной на операцию |
| `src/sections/drive/operations.server.ts` | `done`, `runDriveOperation`, `driveStorageGate` | убрать `step`; `next` для move/copy/share; guard storage |
| `src/sections/drive/operations.form.server.ts` | `execute`, `redirectOnSuccess` | `{ data, redirect: outcome.next }`; читать `result.redirect`; `inline` для dav-issue; `?notice=` добавляет только `redirectOnSuccess` (§2.4) |
| `src/sections/drive/load.server.ts` | `loadDriveList`, `loadDriveOperation`, `targetFolders`, `loadDrivePicker`, `driveUserLabels` | starred, scope, storage/dav flags, picker params, подписи получателей через `auth()`; удалить `targetFolders` |
| `src/modules/drive/source.ts` | `DriveListFilters`, `DRIVE_KEYS`, `parseDriveFilters`, `driveFilterExtras`, `driveListHref`, `DRIVE_EXTRA_*`, `DRIVE_EXTRAS`, `parseDriveIdentity` | `scope`, `starred` identity, `driveNoticeHref`, убрать `starred` из фильтров |
| `src/modules/drive/routes.ts` | `driveStarredRoute`, `drivePickerRoute` | новый маршрут; хелпер адреса пикера |
| `src/modules/drive/modals.ts` | `drive.picker`, `OPERATION_MODALS` | params пикера; ничего не менять в именах операций |
| `src/modules/drive/messages.ts` | `DRIVE_MESSAGES` | `drive.share-target-missing` с `<uid>` (интерполяция через `FormError.template`) и `drive.notice-done` для `?notice=` |
| `src/modules/drive/types.ts` | `DriveOperationData`, `DriveShareView`, `DriveListRouteData` | `storageReady`, `storageReason`, `davEnabled`, `label`, без `folders` для move/copy |
| `src/modules/drive/service/query.ts` | `DriveSliceArgs`, `DrivePageArgs`, `authorizedEntries` | явный `scope` вместо неявных исключений |
| `src/modules/drive/service/mutate.ts` | `shareDriveNode`, `shareDriveNodeMany`, `readDriveShares` | batch атомарно; подписи остаются в `load.server.ts`, сервис их не резолвит |
| `src/modules/drive/ui/operation/*` | shell, back, success, hook | новое |
| `src/modules/drive/ui/*/Drive*.svelte` | пери-операционные компоненты | своё тело + `useDriveOperation` |
| `src/modules/drive/ui/DriveBrowse.svelte` | `initial`, `filters`, `returnTo`, `controls` | стабильный initial (по тесту), live-фильтры, входы «Важное»/WebDAV |
| `src/modules/drive/ui/filters/DriveFilters.svelte` | форма фильтров | `scope`, убрать `starred` |
| `src/modules/drive/ui/access/DriveAccess.svelte` | список shares | `label` вместо uid |
| `src/modules/drive/ui/DriveDavTokens.svelte` | экран токенов | endpoint, логин, disabled |
| `src/core/ui/notice/*` | `notify`, `NoticeHost` | новый общий хост |
| `src/routes/+layout.svelte` | разметка layout | смонтировать `NoticeHost` |
| `src/core/ui/README.md` | раздел пакетов | описать `notice` |
| `src/modules/drive/README.md` | поведение операций | success/back/notice/scope/share |

## 4. Этапы

Статус:

| Этап | Тема | Статус |
|---|---|---|
| 0 | Регрессии до правок | `[ ]` |
| 1 | Redirect и матрица успеха (без удаления формы) | `[ ]` |
| 2 | Оболочка, «Назад», корзина | `[ ]` |
| 3 | Notice host | `[ ]` |
| 4 | `/drive/starred` | `[ ]` |
| 5 | Дефект фильтров/поиска (п. 12) | `[ ]` |
| 6 | `scope` | `[ ]` |
| 7 | Move/copy через пикер | `[ ]` |
| 8 | Share/access | `[ ]` |
| 9 | Storage guards | `[ ]` |
| 10 | WebDAV entry | `[ ]` |
| 11 | Документация и гарды | `[ ]` |

Порядок обязателен: этапы 0–2 создают контракт, на который опираются остальные;
этап 5 идёт до 6, чтобы не смешивать починку с новой опцией.

### Этап 0. Регрессии до правок

**Цель:** зафиксировать текущие дефекты падающими тестами.

**Файлы:**

- `src/modules/drive/ui/operation/back.test.ts` — `pageBackFrom`;
- `src/modules/drive/ui/operation/success.test.ts` — `driveSuccessAction`;
- `src/modules/drive/ui/DriveBrowse.filters.test.ts` — happy-dom, монтирование
  `DriveBrowse` по образцу `src/core/hooks/links/modal-link.svelte.test.ts`;
- `src/sections/drive/operations.form.server.test.ts` — `redirectOnSuccess`
  через экспортированный чистый хелпер;
- `src/sections/drive/operations.server.test.ts` — mock
  `#core/server/app-storage.server.js`;
- `src/modules/drive/service/query.test.ts` — кейсы `scope`;
- `src/modules/drive/service/mutate.test.ts` — batch share;
- `src/modules/drive/ui/DriveShare.test.ts` — поле `subjects` и канал пикера.

**Обязательные кейсы:**

1. `execute`-подобный хелпер возвращает `redirect = next`; `redirectOnSuccess`
   возвращает именно его, а не `null`.
2. `pageBackFrom`: same-origin referrer → `'history'`; пустой/внешний/тот же
   адрес → `href`.
3. `driveSuccessAction({ inModal: true, success: 'stay' })` → `close`;
   `{ inModal: true, success: 'target' }` → `close + goto`;
   `{ inModal: false }` → `goto`; `dav-issue` → `inline`.
4. Upload без storage: код `drive.storage-unavailable`, не исключение.
5. Purge без storage: успех, `del` не вызывается.
6. Move: `next` — target; copy: `next` — target.
7. Share: `subjects` в форме; `shareDriveNodeMany` откатывает всё при одном
   плохом uid.
8. Starred: `parseDriveIdentity('starred')`, маршрут, `loadDrivePage` с
   `starred: true`.
9. Scope: `folder` + `type=file` не выходит из папки; `global` + `type=file`
   находит вложенный файл; чужое поддерево не расширяется; `trashed` остаётся
   плоским.
10. Фильтры: sidebar submit пишет `drive.ord`/`drive.type`/`drive.from`/`drive.to`
    в стор и адрес, страница сбрасывается на 1; `SearchBar` пишет `drive.q`.

**Gate:** тесты 1–10 красные по ожидаемой причине (или явно `todo` с ссылкой
на этап). Зелёный тест до правки означает, что дефект не воспроизведён —
остановиться и перечитать код, а не «укреплять» тест под текущее поведение.

### Этап 1. Redirect и матрица успеха (без удаления формы)

**Файлы:** `operations.ts`, `operations.form.server.ts`,
`operations.server.ts`, `types.ts`.

**Шаги:**

1. Добавить в `DriveOperationSpec` только `success`/`inlineSuccess` по
   таблице §2.1. `fields`/`DriveOperationField` **пока остаются**: их удаляет
   этап 2 вместе с `DriveOperationForm`.
2. `execute` возвращает `{ data: outcome.data, redirect: outcome.next }`.
3. `redirectOnSuccess` читает `localPath(result.redirect ?? null)`; для
   `inlineSuccess` — `'inline'`. `?notice=` здесь **не добавляется** — его
   приносит этап 3 (`driveNoticeHref`).
4. `move`/`copy` считают `next` по target (`target_id` уже есть в форме);
   `share` — `/drive/access?node_id=…`; остальные — `return_to`.
5. `done()` и `step: 'done'` **не трогать**: JS-поведение меняет этап 2.
   `count`/`deleted`/`freed` тоже остаются до этапа 3, где UI перестаёт их
   читать.

**Проверка:** тест 1 этапа 0; SSR-тест: native POST `/drive/mkdir` отвечает
`303` на `return_to`, а не на `/drive/mkdir…`; JS-сценарий визуально не
изменился (это ожидаемо до этапа 2).

**Стоп:** если `Result.redirect` не доходит до `redirectOnSuccess`, не
обходить это через `data.next`: сначала исправить контракт в
`component-form`, затем повторить. Если после шага 1 не собирается
`DriveOperationForm` — значит, `fields` удалены преждевременно; вернуть их до
этапа 2.

### Этап 2. Оболочка, «Назад», корзина

**Файлы:** `ui/operation/*`, все `ui/*/Drive*.svelte`, `ui/DriveOperationForm.svelte`.

**Шаги:**

1. Добавить `DriveOperationShell`, `DriveBackLink`, `pageBackFrom`,
   `useDriveOperation`.
2. Разнести `form.ts` по `forms/*`; в `form.ts` оставить диспетчер.
3. Переписать `mkdir` как эталон: своя фабрика, hidden `parent_id`/`return_to`,
   только `name`, `success: 'stay'`.
4. Переписать остальные операции по тому же шаблону; тело и подписи — из
   текущих `spec`/`form.ts`, без изменения смысла. Блок одноразового секрета
   (`payload.token`, текст «Скопируйте пароль сейчас…», `data-testid="drive-dav-token"`)
   переезжает из `DriveOperationForm.svelte` в `ui/dav-issue/DriveDavIssue.svelte`
   **до** удаления общего компонента: это единственное место, где секрет
   показывается, и потерять его нельзя.
5. Удалить `DriveOperationForm.svelte`, `spec.fields` и `DriveOperationField`
   из `operations.ts`, а также запись `filters` из `DRIVE_OPERATIONS`
   (§2.2).
6. `done()` перестаёт добавлять `step: 'done'`; `data` остаётся только для
   `dav-issue` (`token`, `label`). Ни один экран больше не проверяет `step`.
7. В модалках `onDone` больше не единственный путь: hook сам закрывает и
   инвалидирует; `onDone` остаётся для внешних носителей (корзина).
8. Restore/purge/trash-action получают тот же контракт, что mkdir.

**Проверка:**

- SSR каждого `<op>/<Op>.svelte`: форма содержит только свои поля, hidden
  `return_to`/`node_id` присутствуют;
- компонентный тест: успех в модалке вызывает `close` и не рисует «Готово»;
- компонентный тест: успех на странице вызывает `goto(next)`;
- корзина: restore/purge закрывают модалку и инвалидируют `drive.trash` и
  `drive.browse`.

**Стоп:** если операция не может отрисоваться без `spec.fields` — значит, её
фабрика неполна; дополнить фабрику, а не возвращать матрицу.

### Этап 3. Notice host

**Файлы:** `src/core/ui/notice/*`, `src/routes/+layout.svelte`,
`src/core/ui/README.md`, `ui/operation/use-drive-operation.svelte.ts`,
`sections/drive/operations.form.server.ts`, `ui/DriveBrowse.svelte`,
`source.ts`, `messages.ts`.

**Шаги:**

1. Реализовать очередь, `notify`, `NoticeHost`, автоскрытие, `aria-live`.
2. Смонтировать хост один раз в layout.
3. `useDriveOperation` после успеха вызывает `notify` с коротким текстом
   операции; для `dav-issue` — не вызывает.
4. `driveNoticeHref` добавляет `notice=drive.notice-done` **только** в
   `redirectOnSuccess` (ветка PRG без JS); `DRIVE_MESSAGES` получает код
   `drive.notice-done` (иначе `shownNotice` его отбрасывает). `execute`
   возвращает чистый `result.redirect`, его читает `useDriveOperation` для
   `goto` и `notify()` — иначе пришлось бы отклеивать query от адреса.
5. Удалить счётчики из UI.

**Проверка:** юнит-тест очереди (дубликат не дублируется, автоскрытие);
SSR: `?notice=drive.notice-done` даёт `role="status"`, не destructive;
`?notice=absent` — баннера нет; no-JS POST содержит `notice=drive.notice-done`
в `Location`.

**Стоп:** не добавлять toast-вызовы в домен или в `operations.server.ts`;
уведомление — клиентское следствие успеха.

### Этап 4. `/drive/starred`

**Файлы:** `routes.ts`, `source.ts`, `load.server.ts`, `ui/DriveBrowse.svelte`,
`filters-form.ts`, `ui/filters/DriveFilters.svelte`, `types.ts`.

**Шаги:**

1. Маршрут и identity `starred`: пара
   `src/routes/(site)/(app)/drive/starred/+page.{svelte,server.ts}` по образцу
   `drive/trash` + `driveStarredRoute` в `routes.ts`.
2. `loadDriveList` для starred — глобальная выборка `starred: true`.
3. Кнопка «Важное» в controls; активное состояние.
4. Убрать `starred` из формы фильтров, `DRIVE_FILTER_KEYS`,
   `DriveListFilters`, `parseDriveFilters`, `driveFilterExtras`,
   `filters-form.ts` и `DriveFilters.svelte`; убрать чтение `filters.starred`
   в `load.server.ts` (`loadDriveList`, `loadDriveOperation`, `loadDriveFilters`
   и список ключей сброса). `DRIVE_KEYS.starred` остаётся **только** как ключ
   распознавания старых ссылок в шаге 5; он больше нигде не пишется и не
   читается как фильтр. `source.test.ts` (ожидает `starred` в разборе) и
   `DriveBrowse.ssr.test.ts` обновляются вместе с кодом.
5. `307` со старых `?drive.starred=1` на `/drive/starred`.
6. Тесты: маршрут рендерится, список содержит только `starred`, вход виден в
   HTML и после гидратации.

**Стоп:** не делать одновременно ярлык на главной; это отдельное решение.

### Этап 5. Дефект фильтров/поиска (пункт 12)

**Правило:** сначала тест, потом правка. Ни одна строка `DriveBrowse`/
`Listing` не меняется до красного теста.

**Тест** `DriveBrowse.filters.test.ts`:

1. `ensureDrivePaginator()`; смонтировать `DriveBrowse` с валидным
   `DriveListRouteData`, внутри хоста с `getClientStore()` (образец —
   `src/core/hooks/links/modal-link.svelte.test.ts`).
2. Найти `drive-filters-sidebar`, изменить `ord`/`type`/`from`/`to`, submit.
3. Утверждать:
   - `getState(store, DRIVE_NAME).extra` содержит новые ключи;
   - `visibleAddress().url.search` содержит `drive.ord…`;
   - страница сброшена на 1;
   - `driveSource.data` получил новый extra (mock `preloadData`).
4. `SearchBar`: ввод + Enter пишет `drive.q` и перезапрашивает выдачу.
5. Отдельный тест: повторный рендер родителя с тем же `snapshot` не откатывает
   `Listing` к старому снимку.
6. SSR/no-JS: POST `/drive/filters` отвечает `303` на список с теми же
   `drive.*`-ключами.

**Гипотезы (проверять по порядку, не все сразу):**

- `initial={{ snapshot, fact: null }}` создаёт новый объект на каждый рендер →
  `Listing.$effect` сбрасывает `data`/`asked`. Кандидат: мемоизировать
  `initial` по ссылке `snapshot` (`const initialState = $derived(snapshot ? { snapshot, fact: null } : null)`),
  затем сравнить с `SeedUsersList`, где `initial` стабилен.
- `filters`/`returnTo` берутся из `initial.snapshot`; после `setExtra` они
  старые. Кандидат: выводить их из живого `extra`/`appliedValues`.
- `SearchBar` и sidebar пишут в разные сторы. Кандидат: один
  `getClientStore()`; проверить `PaginatorScope`/`useScopeStore`.

**Gate:** красный тест воспроизводит именно «Применить не меняет выдачу».
Правка допускается только та, что делает тест зелёным, и не более.

**Стоп:** если тест зелёный на текущем коде, дефект описан неверно. Тогда
зафиксировать фактическое поведение, вернуться к пользователю и не менять
фильтры.

### Этап 6. `scope`

**Файлы:** `source.ts`, `filters-form.ts`, `ui/filters/DriveFilters.svelte`,
`load.server.ts`, `service/query.ts`, `types.ts`.

**Шаги:**

1. Добавить `scope` в extra/адрес/форму/`parseDriveFilters`.
2. `authorizedEntries` — явная ветка по `scope` (§2.10).
3. `loadDriveList` передаёт `scope`.
4. UI: select области; disabled в чужой папке/корзине.
5. `type=folder` в `global` — карточка, не навигация.
6. Тесты §2.10: локально/глобально/чужое/корзина/`ord`/`size`.
7. No-JS: `303` сохраняет `drive.scope`.

**Стоп:** не менять семантику `q`/`starred` «на месте»: `starred` уже вынесен
в маршрут, `q` подчиняется `scope` как все.

### Этап 7. Move/copy через пикер

**Файлы:** `routes.ts`, `modals.ts`, `load.server.ts`, `ui/DrivePicker*.svelte`,
`ui/move/DriveMove.svelte`, `ui/copy/DriveCopy.svelte`, `forms/move.ts`,
`forms/copy.ts`, `operations.server.ts`.

**Шаги:**

1. `drivePickerHref` и params модалки `drive.picker`.
2. Канал `DRIVE_PICKER_CHANNEL_PREFIX` + payload; `DriveBrowse` получает
   `onPick`/`onCancel`, `DrivePickerModal` пишет `sharedData` и закрывается
   без `invalidateAll`.
3. `DriveMove`/`DriveCopy`: hidden `target_id`, кнопка выбора, отображение
   `label`, effect на канал.
4. Удалить `targetFolders()` и `folders` для move/copy.
5. `next` — target; modal `target`, page `goto`, no-JS `303`.
6. Тесты: picker page + no-JS; modal handoff; `next` для copy = target;
   исключение поддерева остаётся в домене (`drive.move-cycle`) и проверяется
   существующими тестами.

**Стоп:** если выбор в модалке требует перезагрузки страницы — канал
`sharedData` подключён неверно; чинить канал, а не возвращать `<select>`.

### Этап 8. Share/access

**Файлы:** `forms/share.ts`, `ui/share/DriveShare.svelte`, `load.server.ts`,
`service/mutate.ts`, `types.ts`, `ui/access/DriveAccess.svelte`,
`ui/access/DriveAccessModal.svelte`.

**Шаги:**

1. `subjects: field.multiselect`; опции и подписи собирает
   `loadDriveOperation('share')` (§2.7), не сервис Drive.
2. Кнопка `user.picker` (`channel: 'drive.share.subjects'`, `mode: 'multiple'`)
   + no-JS `/users/pick`.
3. Effect чтения `sharedData['picker:drive.share.subjects']`.
4. Fallback ручного UUID без `auth.select`.
5. `shareDriveNodeMany`: batch, атомарность, `drive.share-target-missing`
   с uid, `drive.share-self`.
6. `DriveShareView.label`; `DriveAccess` показывает имя.
7. Тесты: набор из 2 получателей создаёт 2 строки; один плохой uid → 0 строк;
   имя в access; no-JS POST с `subjects`.

**Стоп:** не делать частичный успех «молча». Либо всё, либо отказ с uid.

### Этап 9. Storage guards

**Файлы:** `operations.server.ts`, `operations.form.server.ts`,
`load.server.ts`, `types.ts`, `ui/upload/DriveUpload.svelte`.

**Шаги:** §2.5. Отдельно: upload `authorize` проверяет storage до чтения тела;
`execute` повторяет; purge — best-effort; download-маршрут оборачивает
`resolveAppStorage()` и отдаёт `503 drive.storage-unavailable`.

**Проверка:** тесты 4–5 этапа 0; SSR upload без storage показывает сообщение,
не 500; после отказа в `drive_node` нет orphan-строки; `GET download` при
бросающем `resolveAppStorage()` отвечает `503` с текстом сообщения.

**Стоп:** не превращать `storage === null` в `auth.forbidden`; код должен быть
`drive.storage-unavailable`/`drive.storage-readonly`.

### Этап 10. WebDAV entry

**Файлы:** `ui/DriveBrowse.svelte`, `ui/DriveDavTokens.svelte`,
`load.server.ts`, `types.ts`.

**Шаги:** §2.11. Ссылка в controls, endpoint и логин на экране паролей,
`davEnabled`, сообщение `drive.dav-disabled` вместо кнопки.

**Проверка:** SSR `/drive` содержит ссылку `/user/config/dav`; SSR
`/user/config/dav` содержит `/api/dav/`; при выключенном секрете — сообщение;
существующие `webdav.server.test.ts` и токен-тесты зелёные.

**Стоп:** не выдавать токен на чужой диск; `ownOnly` не снимать.

### Этап 11. Документация и гарды

**Шаги:**

1. `README src/modules/drive/README.md`: success/back/notice/scope/share/
   picker/WebDAV; без описания `DriveOperationForm`.
2. `README src/core/ui/README.md`: пакет `notice`.
3. `docs/plan-drive-repair.md` §9: отметить, что §0.1/§5.2/§5.3/§6.3/§7.2
   заменены этим планом (ссылка уже есть — уточнить статус).
4. `docs/pending.md`: обновить запись Drive fixes по факту готовности этапов.
5. Прогнать `npm run check`, все тесты Drive, `drive-path-guard`,
   `public-api`, `module-guard`, `form-size`.
6. `git status`: нет копий payload и demo-файлов.

**Gate:** все проверки зелёные; браузерный gate — только на машине с
`libnspr4`/root (см. §6).

## 5. Финальные ворота

- [ ] JS и no-JS mkdir/rename/restore/purge дают один результат:
      закрытие/возврат, без «Готово».
- [ ] Native POST любой обычной операции отвечает `303` на `next`, а не на URL
      операции.
- [ ] `dav-issue` остаётся inline в JS и no-JS; секрет не попадает в URL.
- [ ] «Назад» в модалке закрывает слой; на странице использует историю, а при
      прямой ссылке ведёт по `href`.
- [ ] Успех показывает transient notice; счётчики узлов не выводятся.
- [ ] «Важное» — `/drive/starred`; `?drive.starred=1` перенаправляется.
- [ ] `scope=folder` — текущая папка; `scope=global` — весь доступный диск,
      кроме чужого поддерева и корзины; `ord`/`size` режим не меняют.
- [ ] Upload без storage — сообщение и доменный код, не 500; purge не падает.
- [ ] Move/copy выбирают цель пикером (JS и no-JS) и ведут в target.
- [ ] Share принимает набор `subjects`; batch атомарен; `/drive/access`
      показывает имена.
- [ ] С `/drive` есть вход «Подключить по WebDAV»; экран паролей показывает
      `/api/dav/`, логин и одноразовый пароль; выключенный WebDAV объяснён.
- [ ] `DriveOperationForm` и матрица полей удалены; каждая операция имеет своё
      тело и своё правило успеха.
- [ ] Дефект фильтров/поиска закрыт тестом, который падал до правки.
- [ ] `plan-drive-repair.md` не выдаёт заменённые решения за действующие.

## 6. Вне плана и ограничения среды

- Браузерные сценарии (модалки, история, toast, фокус) требуют машины с
  `libnspr4.so` и root. В текущей песочнице они не выполняются; unit/SSR-тесты
  не являются их заменой. Это ограничение фиксируется в отчёте, а не
  маскируется зелёным прогоном.
- Ярлык «Важное» на главной, сортировка/группировка в `/drive/starred`,
  рекурсивный поиск по содержимому файлов и совместное редактирование — не
  входят в этот план.
- Перенос структуры плана в `docs/agent/<topic>/` не заказан; план остаётся
  здесь, на русском.
