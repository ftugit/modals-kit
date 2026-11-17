# Аудит: планы `plan-drive.md` / `plan-drive-ui.md` vs фактический код

Дата: 17.11.2026. Объект: ветка `module-drive` (пакет `modules/drive/`), ядро `src/core/lib/drive` в `arch`.
Источники: `docs/plan-drive.md`, `docs/plan-drive-ui.md`, код модуля `src/modules/drive`, `src/sections/drive`, `src/routes/.../drive`, `src/core/lib/drive`.

---

## 1. Общая оценка

Планы в целом соответствуют коду: модель, сервисы, WebDAV Class 1+2, фильтры/пагинатор,
экран токенов WebDAV, `DriveEntry` на главной, `drive.ids` как единственный
незавершённый срез — всё реализовано. Но план содержит список компонентов/маршрутов,
которых в коде нет (переименованы, заинлайнены или отброшены), и несколько
функциональных пробелов. Именно это создаёт ощущение «каши»: план описывает
идеальную декомпозицию, код — более плоскую и непоследовательную реализацию.

---

## 2. Что совпадает (проверено по файлам)

- `src/core/lib/drive/*` (names, paths, tree, quota, listing, types) + тесты — есть.
- `schema.ts` (`driveNode`, `driveShare`, `driveDavToken`, `driveDavLock`), `checks.ts`, `messages.ts` — есть, соответствуют §4.2/4.4.
- `service/{query,mutate,upload,download,access,tokens}.ts` — есть; `mutate` содержит `writableFolder/liveSiblings/…`, `upload` — `hash:true` + квота, `download` — `serve` + `Content-Disposition`.
- `webdav.server.ts` (`createDriveDav`, `DavBackend` поверх сервисов, Class 2 с общим стором `drive_dav_lock`) — есть.
- `routes.ts`: `driveRootRoute`, `driveFolderRoute`, `driveNodeRoute`, `driveTrashRoute`, `drivePickerRoute` — есть.
- `modals.ts`: зарегистрированы `drive.browse`, `drive.node`, `drive.picker`, `drive.trash` — есть.
- `source.ts`: ключи `drive.q/ord/type/starred/size/from/to/after/ids`, `parseDriveFilters`, `driveListHref`, `driveFiltersDirty` — есть.
- `DriveBrowse.svelte`, `DriveNodeCard.svelte`, `DriveNodeActions.svelte`, `DriveCreate.svelte`, `DriveFilters.svelte`, `DrivePager.svelte`, `DrivePicker.svelte`, `DriveEntry.svelte`, `DriveAccess.svelte`, `DriveDavTokens.svelte`, `DriveDavTokensStep.svelte`, `DriveBrowseModal`, `DriveNodeModal`, `DrivePickerModal`, `DriveTrashModal` — есть.
- `sections/drive/{DrivePage, DriveNodePage, load.server, actions.server, dav-tokens.server}.ts` — есть.
- `routes/(site)/(app)/drive/*` и `user/config/dav/*` и `api/dav/[...path]` — есть.
- `nav.ext.ts` (homeEntries → DriveEntry), `config.ext.ts` (шаг `dav`), `db.ext.ts` (ресурсы + индексы) — есть.
- `DriveEntry` реально рендерится на главной через `HOME_ENTRIES` (`composition/nav.ts` → `sections/home/HomePage.svelte`) — подтверждено.

---

## 3. Расхождения: план называет файлы, которых нет

| В плане (`plan-drive-ui.md` §4.1 / `plan-drive.md` §4.4) | В коде |
|---|---|
| `DriveBreadcrumbs.svelte` | нет — крошки заинлайнены в `DriveBrowse.svelte` (`<nav>` с `crumbs`) |
| `DriveQuota.svelte` | нет — квота заинлайнена в `DriveBrowse` (Badge + прогресс-бар + «Свободно …») |
| `DriveAccessForm.svelte` | нет — называется `DriveAccess.svelte` |
| `DriveFiltersForm.svelte` | нет — называется `DriveFilters.svelte` |
| `DriveTrash.svelte` (список) | нет — корзина рендерится тем же `DriveBrowse` (через `trashed`) только в модалке `DriveTrashModal` |
| `DriveAccessModal.svelte` | нет — доступ показывается только на странице `DriveNodePage` |
| `DriveFiltersModal.svelte` | нет — фильтры только инлайн-форма в `DriveBrowse` |
| `gateway.server.ts` (`plan-drive.md` §4.4) | нет — сервисы вызывают `auth(event)` напрямую в `load.server.ts`/`actions.server.ts` |

---

## 4. Расхождения: план называет маршруты, которых нет

| В плане (`plan-drive-ui.md` §5.1) | В коде |
|---|---|
| `driveFiltersRoute = kitRoute('/drive/filters', { owner: 'drive.filters', keys: ['from'], … })` | отсутствует в `routes.ts`; фильтры — GET-форма на том же `/drive` |
| `drive.access` модалка (`modals.ts`) | не зарегистрирована; доступ только на `/drive/node/[id]` |
| `/api/drive/[nodeId=uuid]/download` (`plan-drive.md` §4.6 / `plan-ui` §6) | маршрут отсутствует; `serveDriveFile` в `service/download.ts` реализован, но **нигде не вызывается** → скачать файл нельзя |

---

## 5. План обещает паттерны, которые не соблюдены

- **`plan-ui` §2/§4.2:** «`DriveBrowse` — обёртка над `Listing` по образцу `SeedUsersList`». Фактически `DriveBrowse.svelte` **не использует `Listing`/`ListingRow`** — список рендерится вручную (`{#each initial.items}` → `DriveNodeCard`), фильтры — отдельная форма, пагинатор — отдельный `DrivePager`. Это главное расхождение с `docs/design/lists.md`.
- **`plan-ui` §4.2:** «`DrivePicker` = `DriveBrowse` с пропами `picked`/`onPicked`». Фактически `DrivePicker.svelte` — **отдельный компонент** со своим рендером списка, крошками, кнопками «Выбрать». Дублирование логики.
- **`plan-ui` §4.1:** «`DriveNodeModal` — тонкий носитель». Фактически `DriveNodeModal.svelte` дублирует разметку `DriveNodePage` (карточка + actions + access + кнопки), а не переиспользует один компонент. Нарушено правило «один компонент на страницу и модалку (`isModalMode`)».
- **`plan-ui` §2:** «`EmptyState`, `Skeleton` из пагинатора для пустых папок». Фактически пустота — обычный `<p>` с dashed-рамкой.
- **`plan-drive.md` §4.3:** чистое ядро `src/core/lib/drive` — соблюдено (нет `#core/lib/db`/`node:*`). ✓

---

## 6. Статусы в планах завышены

- `plan-drive.md` шапка: «этапы 0–3, 5 и 6 реализованы (включая фильтры/пагинатор, экран токенов WebDAV, Class 2 со стором блокировок `drive_dav_lock` и гарды)». По коду: Class 2 стор есть, `LOCK`/`UNLOCK` wired через `webdav.server.ts`, гарды: `tooling/drive-path-guard.mjs` есть. Соответствует.
- `plan-drive-ui.md` шапка: «4d–4g и фильтры/пагинатор реализованы». По коду: 4d–4g в основном да, но `drive.ids` (множественный выбор) не реализован (README подтверждает), и «шаг выбранные» отсутствует. Честно помечено в обоих планах.
- `plan-drive-ui.md` §9: «Меню (`MenuBody.svelte`): пункт `drive.browse` рядом с `storage.servers` — отдельным решением, не в v1.» Фактически `nav.ext.ts` добавляет `DriveEntry` на главную, но в меню пункта нет — соответствует «не в v1».

---

## 7. UI: конкретные проблемы «каши»

1. **`DriveBrowse.svelte` — монолит** (~130 строк): крошки + квота-бар + фильтры + создание + список + пагинатор + readonly-заметка в одном компоненте. План хотел `Surface` + `Listing`; получилось всё в одном. Нет переиспользования `Listing`/`ListingRow`/`EmptyState`/`Skeleton`.

2. **Дублирование рендера списка**: `DriveBrowse` и `DrivePicker` независимо рисуют строки. `DrivePicker` не переиспользует `DriveNodeCard`/`DriveBrowse`. Любое изменение стиля строки нужно делать в двух местах.

3. **`DriveNodeCard` mixing concerns**: и `row`, и `detail` в одном компоненте через `variant`. При этом `detail`-ветка дублирует часть разметки `DriveNodePage`. План хотел отдельные `DriveNodeCard` (тупая карточка) — он есть, но `detail`-ветка разрослась.

4. **`DriveNodeActions.svelte` — перегружен**: один компонент содержит звезду, корзину, переименование, перенос, копию, доступ, восстановление, очистку. Вложенные `<details>` 3 уровней. `canShare`-ветка (только доступ) дублирует форму. План (`plan-ui` §4.1) предполагал `DriveAccessForm` отдельно — его нет, доступ зашит в `DriveNodeActions` + `DriveAccess`.

5. **Нет скачивания**: `serveDriveFile` реализован, но маршрут `/api/drive/[nodeId]/download` отсутствует, и в UI нет кнопки/ссылки «Скачать». Пользователь не может скачать файл. Это функциональный баг, а не косметика.

6. **Доступ только на странице узла**: `DriveAccess` рендерится только в `DriveNodePage`/`DriveNodeModal`. План обещал `drive.access` модалку — её нет. Нельзя выдать доступ из списка/из папки без перехода на карточку.

7. **`DriveDavTokensStep`** принимает проп `context?: 'page' | 'modal'`, но игнорирует его (использует только `uid`, причём тоже не использует). Мёртвый проп.

8. **Несогласованность имён**: план говорит `DriveAccessForm`/`DriveFiltersForm`/`DriveTrash`/`DriveQuota`/`DriveBreadcrumbs`; код — `DriveAccess`/`DriveFilters`/`DriveTrashModal`/инлайн. Читателю плана трудно найти компонент.

9. **Пустые состояния**: вместо `EmptyState`/`Skeleton` — `<p>` с dashed-рамкой. Мелочь, но не по контракту `design/lists.md`.

10. **`DrivePicker` не фильтрует на сервере**: `kind === 'folder'` фильтрует `initial.items` на клиенте, но сервер всё равно отдаёт файлы (лишний трафик). При больших папках — лишние данные.

11. **`DriveNodeActions` использует `Field of={…}` для `target_id` (select) и `name` (text) без явной валидации на клиенте** — полагается на сервер. ОК, но UX: при ошибке формы перезагружается вся страница (`intercept: false`). План обещал «без JS работает» — да, работает, но с JS тоже нет AJAX-улучшения для мутаций. Сознательно, но это часть «каши» (формы выглядят как из 2010).

12. **`DriveCreate`** совмещает «создать папку» и «загрузить файл» в одной сетке `sm:grid-cols-2` — на узких экранах выглядит как две колонки без разделения. Мелочь.

---

## 8. Рекомендации (по приоритету)

1. **Срочно (функциональный баг):** добавить маршрут `/api/drive/[nodeId=uuid]/download` → `serveDriveFile`, и кнопку «Скачать» в `DriveNodeCard`/`DriveNodeActions`. Иначе файлы нельзя скачать.
2. **Структурно:** вернуть `Listing`-контракт в `DriveBrowse` (или честно убрать из плана упоминание `Listing`), вынести `DrivePicker` на `DriveBrowse` + пропы `picked`/`onPicked`, вынести пустое состояние в `EmptyState`.
3. **Имена:** привести имена компонентов к плану (`DriveAccessForm`/`DriveAccess`, `DriveFiltersForm`/`DriveFilters`, `DriveTrash`/`DriveTrashModal`) либо поправить план. Одно из двух.
4. **Модалки:** добавить `drive.access` (или убрать из плана) и `drive.filters` (или убрать), чтобы план соответствовал.
5. **Инлайн-компоненты:** либо вынести `DriveBreadcrumbs`/`DriveQuota`, либо убрать из плана.
6. **Мёртвый код:** убрать проп `context` из `DriveDavTokensStep`.
7. **gateway.server.ts:** либо создать фасад (как в плане), либо убрать из плана §4.4.

---

## 9. Что не проверял

- Запуск/сборку модуля (не ставил зависимости, не запускал vitest/svelte-check на `module-drive`). Проверка визуальная/статическая по файлам.
- Реальное поведение UI в браузере (не открывал preview). Оценка по коду.
- `service/mutate.ts` целиком (прочитал начало), `service/query.ts` целиком (прочитал начало), `webdav.server.ts` (прочитал начало) — детали мутаций/lock-логики не сверял построчно.
- `DriveAccess.svelte`, `DrivePicker.svelte`, `DriveDavTokens.svelte` — прочитаны; `DriveBrowse.ssr.test.ts`, `DrivePicker.ssr.test.ts`, `DriveDavTokens.ssr.test.ts`, `actions.server.test.ts`, `dav-tokens.server.test.ts`, `webdav.server.test.ts`, `source.test.ts`, `query.test.ts`, `mutate.test.ts` — не читал.
