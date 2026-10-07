# Чек-лист переноса paginator из SolidHono в modals-kit

- **Целевой репозиторий**: `/home/user/modals-kit` (ветка `feat/paginator-transfer`, база `03eaf77`)
- **Канонический источник**: `/home/user/SolidHono` (ревизия `f8079b1`, строго только для чтения)

---

## 1. Подготовка и аудит исходного состояния
- [x] Проверен начальный коммит `modals-kit` (`03eaf77`), дерево чистое.
- [x] Создана изолированная локальная ветка `feat/paginator-transfer`.
- [x] Проверен коммит `SolidHono` (`f8079b1`), репозиторий используется исключительно в режиме read-only.
- [x] Проведён полный аудит файлов в `SolidHono` (core, DOM, adapters, UI, feature, demo, browser tests).

---

## 2. Framework-neutral Core (`src/lib/paginate/`)
- [x] `types.ts` — все контракты, типы событий, состояний, адаптеров, intents.
- [x] `pure.ts` — `deriveMeta`, `pickCurrentPage`, `canGo`, `canLoadMore`, `flattenPages`, `viewState`, `pagesList` (со стабильными ссылками).
- [x] `events.ts` — `createEmitter`, типизированные события `PaginatorEvent`.
- [x] `storage.ts` — `createMemoryStorage`, `createLocalStorageStorage`, `sanitizeExtra`, `safeParseRestorable`.
- [x] `adapter-local.ts` — `createLocalAdapter`.
- [x] `adapter-cursor.ts` — `createCursorAdapter`, `CursorSource`, сериализация/декодирование состояния курсоров.
- [x] `adapter-url.ts` — `createUrlAdapter`, `readPaginatorSearch`, `paginatorSearch`, `pageSearch`, `coerceExtraValue`, `extraField`, `decodeExtraValue`, `encodeExtraValue`.
- [x] `layout.ts` — `computeColumns`, `distributeRoundRobin`, `runsOfColumn`, `pageWindow`, `pendingSide`.
- [x] `anchors.ts` — `createAnchorTracker`, `createAnchorRegistry`, `zoneRootMargin`, модели маркеров и зон.
- [x] `store.ts` — framework-neutral `createPaginatorStore`, `getClientStore`, `initialState`, `Store`.
- [x] `registry.ts` — `definePaginator`, `getPaginator`, `hasPaginator`, `resetRegistry`.
- [x] `core.ts` — `fetchReplace`, `initPaginator`, `initServerPaginator`, `goToPage`, `loadMore`, `onExternalPage`, `reportAnchor`, `retry`, `resetPaginator`, `scrollToPage`, `prefetchPage`, `setPageSize`, `setExtra`, `safePersist`.
- [x] `index.ts` — экспорт публичного API плоского core.
- [x] `README.md` — актуальная документация библиотеки `lib/paginate`.

---

## 3. SolidJS Adapter (`src/lib/paginate/solid/`)
- [x] `solid/adapter.tsx` / `solid/index.ts` — Solid-биндинги (`PaginatorHost`, `PageAnchor`, `EdgeSentinel`, `LoadMoreSlot`, `PendingIndicator`, `PaginatorScope`, `usePaginator*`).
- [x] Отделение роутера: роутер подключается опционально через `MinimalRouter` без жёсткой привязки к FastEdge.
- [x] Полная сохранность исходного поведения Solid-адаптера.

---

## 4. Svelte 5 Adapter (`src/lib/paginate/svelte/`)
- [x] `context.svelte.ts` — контекст и реактивное состояние на Svelte 5 runes (`$state`, `$derived`, `$effect`, untrack).
- [x] `PaginatorHost.svelte` — скролл-контейнер, `scrollDriver`, детекторы жестов (wheel, touch, keys, scroll), `holdAbove` для prepend, синхронизация с URL/адаптером.
- [x] `PageAnchor.svelte` — блочный якорь + нулевой маркер начала страницы.
- [x] `EdgeSentinel.svelte` — сентинел края с регистрацией в `AnchorTracker`.
- [x] `LoadMoreSlot.svelte` — headless слот подгрузки/перехода со сниппетами.
- [x] `PendingIndicator.svelte` — плавающий индикатор загрузки страницы.
- [x] `PaginatorScope.svelte` — область видимости снапшотов для SSR.
- [x] `index.ts` — экспорт Svelte-адаптера.

---

## 5. UI-компоненты (`src/lib/ui/paginator/`)
- [x] `PageList.svelte` — вертикальный список с разделителями, элементами и скелетонами.
- [x] `PageColumns.svelte` — round-robin колонки с `ResizeObserver`, ранами и авто-шириной.
- [x] `PageLink.svelte` — ссылки `<a href>` (no-JS) / кнопки (SPA) навигации.
- [x] `PageNav.svelte` — панель навигации со стрелками, номерами страниц, многоточиями и счетчиком.
- [x] `ResetButton.svelte` — кнопка сброса пагинатора.
- [x] `LoadingIndicator.svelte` & `Spinner.svelte` — индикаторы загрузки.
- [x] `LoadMoreLink.svelte` — ссылка/кнопка «показать еще».
- [x] `EventLog.svelte` — журнал событий.
- [x] `StatusRow.svelte`, `Skeleton.svelte`, `EmptyState.svelte`, `ErrorRow.svelte`, `EndRow.svelte`, `ReplaceLoadingRow.svelte`, `PageDivider.svelte`.
- [x] `fields/` (`Field.svelte`, `Select.svelte`, `Toggle.svelte`) — примитивы настроек.
- [x] `PaginatorSettings.svelte` — панель настроек пагинатора (поддержка `extra`, `pageSizes`, `store`, fallback без JS).
- [x] `index.ts` — экспорт UI-компонентов.

---

## 6. Демо и источники данных
- [x] `src/content/items.ts` & демо-источники данных (товары `Product`, фото `Photo`, `queryItemsPage`, `getItemsPage`).
- [x] `src/features/paginator/definition.ts` — регистрация demo-пагинаторов (`demo-url`, `demo-local-ls`, `demo-local-mem`, `demo-gallery`).
- [x] `src/features/paginator/loader.ts` — SSR-загрузчик данных и снапшотов.
- [x] `src/features/paginator/item-views.ts` — отображение карточек (`ItemRow`, `ShotTile`, `shotHeight`).
- [x] `src/features/paginator/DemoPaginator.svelte` — основной хост с панелью настроек, переключателем раскладок, триггеров и зон.
- [x] `src/features/paginator/GalleryDemo.svelte` — второй изолированный URL-пагинатор `?gallery.*`.
- [x] `src/features/paginator/PaginatorDemo.svelte` — страница демо.
- [x] `src/routes/paginator/+page.svelte` и `+page.server.ts` — маршрут в приложении SvelteKit.
- [x] Добавление ссылки на `/paginator` в навигацию сайта и главную страницу.

---

## 7. Тестирование и верификация
- [x] Unit-тесты ядра и pure-функций (`vitest run src/lib/paginate/`).
- [x] Unit-тесты Solid-адаптера и Svelte-адаптера.
- [x] Проверка чистоты ядра через `tooling/` (core purity, absence of framework imports).
- [x] Browser-тесты в Playwright:
  - Исходный сценарий (`SolidHono/test/browser/paginate.mjs` parity).
  - Регрессионные тесты зон `40%` top/bottom до достижения края.
  - Регрессионные тесты `edge` триггера.
  - Сохранение `window.scrollY = 0` при всех действиях.
  - Prepend retention: сохранение позиции контента при `scrollTop > 0` и `scrollTop === 0`.
  - Columns layout & dynamic item heights.
  - Независимость второго пагинатора (`?gallery.*`).
- [x] `npm run check` (0 errors).
- [x] `npm test` (все unit-тесты и tooling guards проходят, 477 + 64 = 541 тестов).
- [x] `npm run build` (production build успешен, клиент и сервер собраны).
