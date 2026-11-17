# Разбор аудита `drive`: план vs код

Дата: 2026-11-18.
Ветка: `arch` + модуль `drive` 1.0.0 (из `refs/tags/modules`).
Проверяемый документ: [`audit-drive-plan-vs-code.md`](./audit-drive-plan-vs-code.md).
Сверено вручную с кодом: `src/modules/drive/**`, `src/sections/drive/**`,
`src/routes/(site)/(app)/drive/**`, `src/routes/api/**`, `docs/plan-drive-ui.md`,
`docs/plan-drive.md`, `src/core/ui/listing/**`, `src/modules/user/accounts/svelte/SeedUsersList.svelte`.

## Вердикт

Переделывать модуль целиком не нужно. Ядро, схема, сервисы и WebDAV —
самая здоровая часть и соответствует плану. Чинить нужно UI-слой
и один серверный маршрут:

- **P0, функциональный дефект:** нет маршрута скачивания, `serveDriveFile`
  не вызывается ниоткуда.
- **P1, структурные дубли:** `DriveBrowse`/`DrivePicker`,
  `DriveNodePage`/`DriveNodeModal`, доступ в `DriveNodeActions` и `DriveAccess`.
- **P2, гигиена:** пустые состояния, вынесение крошек/квоты, мёртвый проп,
  серверный фильтр `kind=folder` у пикера.
- **P3, отдельное решение:** перевод списка на `Listing` + `definePaginator`
  и срез `drive.ids`. Это единственный по-настоящему крупный кусок,
  и он не равен «починить UI».

## Что подтверждено кодом

1. `serveDriveFile` (`src/modules/drive/service/download.ts:30`) реализован,
   но `src/routes/api/drive/**` отсутствует. Поиск по `src` даёт единственное
   вхождение — само объявление функции.
2. `DriveBrowse.svelte` не использует `Listing`/`ListingRow`: список,
   крошки, квота, фильтры и пагинатор собраны в одном компоненте.
3. `DrivePicker.svelte` — отдельный рендер списка, не `DriveBrowse`
   с `picked`/`onPicked`.
4. `DriveNodePage.svelte` и `DriveNodeModal.svelte` дублируют карточку,
   действия, доступ и кнопки.
5. `DriveNodeActions.svelte` держит звезду, корзину, переименование,
   перенос, копию и доступ; вложенность `<details>` — три уровня.
6. `DriveAccess.svelte` рендерится только в карточке узла; модалки
   `drive.access` нет (`src/modules/drive/modals.ts`).
7. Маршрута `driveFiltersRoute` нет; фильтры — GET-форма на том же `/drive`
   (`DriveFilters.svelte`, тесты `DriveBrowse.ssr.test.ts`).
8. `DriveDavTokensStep.svelte` объявляет `context`, но не читает его.
9. `loadDrivePicker` не передаёт `kind=folder` в `loadDriveSlice`;
   фильтрация папок происходит на клиенте (`DrivePicker.svelte:30-32`).
10. `source.ts` — не `defineSource`/`definePaginator` из плана, а ручные
    `parseDriveFilters`/`driveListHref` с курсором `drive.after`.

## Где аудит ошибся

- `/drive/trash` — полноценная страница (`src/routes/(site)/(app)/drive/trash/+page.svelte`
  → `DrivePage`), а не «только модалка».
- GET-фильтры и курсорный пагинатор — осознанный дизайн: это закреплено
  SSR-тестами и даёт рабочий путь без JS. Это не «недоделка», а решение,
  которое план не описал.
- `src/core/lib/drive` и сервисы аудит почти не проверял (сам это признал);
  их соответствие плану подтверждается тестами и структурой.

## Порядок работ

1. Маршрут `/api/drive/[nodeId=uuid]/download` + ссылка «Скачать».
2. Один компонент карточки узла на страницу и модалку; пикер поверх
   `DriveBrowse`; серверный `kind=folder`.
3. `EmptyState`/`Skeleton`, вынести `DriveQuota`/`DriveBreadcrumbs`,
   убрать мёртвый `context`, согласовать имена с планом.
4. Отдельным этапом: `Listing` + `definePaginator` + `drive.ids` либо
   честная фиксация в плане, что drive живёт на cursor-GET.

## Проверки

На момент отчёта выполнена статическая сверка по файлам. Сборка,
`svelte-check` и тесты не запускались: зависимости не установлены.
