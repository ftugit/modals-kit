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
- [ ] `types.ts` — все контракты, типы событий, состояний, адаптеров, intents.
- [ ] `pure.ts` — `deriveMeta`, `pickCurrentPage`, `canGo`, `canLoadMore`, `flattenPages`, `viewState`, `pagesList` (со стабильными ссылками).
- [ ] `events.ts` — `createEmitter`, типизированные события `PaginatorEvent`.
- [ ] `storage.ts` — `createMemoryStorage`, `createLocalStorageStorage`, `sanitizeExtra`, `safeParseRestorable`.
- [ ] `adapter-local.ts` — `createLocalAdapter`.
- [ ] `adapter-cursor.ts` — `createCursorAdapter`, `CursorSource`, сериализация/декодирование состояния курсоров.
- [ ] `adapter-url.ts` — `createUrlAdapter`, `readPaginatorSearch`, `paginatorSearch`, `pageSearch`, `coerceExtraValue`, `extraField`, `decodeExtraValue`, `encodeExtraValue`.
- [ ] `layout.ts` — `computeColumns`, `distributeRoundRobin`, `runsOfColumn`, `pageWindow`, `pendingSide`.
- [ ] `anchors.ts` — `createAnchorTracker`, `createAnchorRegistry`, `zoneRootMargin`, модели маркеров и зон.
- [ ] `store.ts` — framework-neutral `createPaginatorStore`, `getClientStore`, `initialState`, `Store`.
- [ ] `registry.ts` — `definePaginator`, `getPaginator`, `hasPaginator`, `resetRegistry`.
- [ ] `core.ts` — `fetchReplace`, `initPaginator`, `initServerPaginator`, `goToPage`, `loadMore`, `onExternalPage`, `reportAnchor`, `retry`, `resetPaginator`, `scrollToPage`, `prefetchPage`, `setPageSize`, `setExtra`, `safePersist`.
- [ ] `index.ts` — экспорт публичного API плоского core.
- [ ] `README.md` — актуальная документация библиотеки `lib/paginate`.

---

## 3. SolidJS Adapter (`src/lib/paginate/solid/`)
- [ ] `solid/host.tsx` / `solid/index.ts` — Solid-биндинги (`PaginatorHost`, `PageAnchor`, `EdgeSentinel`, `LoadMoreSlot`, `PendingIndicator`, `PaginatorScope`, `usePaginator*`).
- [ ] Отделение роутера: роутер подключается опционально через `MinimalRouter` без жёсткой привязки к FastEdge.
- [ ] Полная сохранность исходного поведения Solid-адаптера.

---

## 4. Svelte 5 Adapter (`src/lib/paginate/svelte/`)
- [ ] `context.svelte.ts` — контекст и реактивное состояние на Svelte 5 runes (`$state`, `$derived`, `$effect`, untrack).
- [ ] `PaginatorHost.svelte` — скролл-контейнер, `scrollDriver`, детекторы жестов (wheel, touch, keys, scroll), `holdAbove` для prepend, синхронизация с URL/адаптером.
- [ ] `PageAnchor.svelte` — блочный якорь + нулевой маркер начала страницы.
- [ ] `EdgeSentinel.svelte` — сентинел края с регистрацией в `AnchorTracker`.
- [ ] `LoadMoreSlot.svelte` — headless слот подгрузки/перехода со сниппетами.
- [ ] `PendingIndicator.svelte` — плавающий индикатор загрузки страницы.
- [ ] `PaginatorScope.svelte` (или хелпер) — область видимости снапшотов для SSR.
- [ ] `index.ts` — экспорт Svelte-адаптера.

---

## 5. UI-компоненты (`src/lib/ui/paginator/`)
- [ ] `PageList.svelte` — вертикальный список с разделителями, элементами и скелетонами.
- [ ] `PageColumns.svelte` — round-robin колонки с `ResizeObserver`, ранами и авто-шириной.
- [ ] `PageLink.svelte` — ссылки `<a href>` (no-JS) / кнопки (SPA) навигации.
- [ ] `PageNav.svelte` — панель навигации со стрелками, номерами страниц, многоточиями и счетчиком.
- [ ] `ResetButton.svelte` — кнопка сброса пагинатора.
- [ ] `LoadingIndicator.svelte` & `Spinner.svelte` — индикаторы загрузки.
- [ ] `LoadMoreLink.svelte` — ссылка/кнопка «показать еще».
- [ ] `EventLog.svelte` — журнал событий.
- [ ] `StatusRow.svelte`, `Skeleton.svelte`, `EmptyState.svelte`, `ErrorRow.svelte`, `EndRow.svelte`, `ReplaceLoadingRow.svelte`, `PageDivider.svelte`.
- [ ] `fields/` (`Field.svelte`, `Select.svelte`, `Toggle.svelte`) — примитивы настроек.
- [ ] `PaginatorSettings.svelte` — панель настроек пагинатора (поддержка `extra`, `pageSizes`, `store`, fallback без JS).
- [ ] `index.ts` — экспорт UI-компонентов.

---

## 6. Демо и источники данных
- [ ] `src/content/items.ts` & демо-источники данных (товары `Product`, фото `Photo`, `queryItemsPage`, `serveItems`).
- [ ] `src/features/paginator/definition.ts` — регистрация demo-пагинаторов (`demo-url`, `demo-local-ls`, `demo-local-mem`, `demo-gallery`).
- [ ] `src/features/paginator/loader.ts` — SSR-загрузчик данных и снапшотов.
- [ ] `src/features/paginator/item-views.svelte` — отображение карточек (`ItemRow`, `ShotTile`, `shotHeight`).
- [ ] `src/features/paginator/DemoPaginator.svelte` — основной хост с панелью настроек, переключателем раскладок, триггеров и зон.
- [ ] `src/features/paginator/GalleryDemo.svelte` — второй изолированный URL-пагинатор `?gallery.*`.
- [ ] `src/features/paginator/PaginatorDemo.svelte` — страница демо.
- [ ] `src/routes/paginator/+page.svelte` и `+page.server.ts` — маршрут в приложении SvelteKit.
- [ ] Добавление ссылки на `/paginator` в навигацию сайта и главную страницу.

---

## 7. Тестирование и верификация
- [ ] Unit-тесты ядра и pure-функций (`vitest run src/lib/paginate/`).
- [ ] Unit-тесты Solid-адаптера и Svelte-адаптера.
- [ ] Проверка чистоты ядра через `tooling/` (core purity, absence of framework imports).
- [ ] Browser-тесты в Playwright:
  - Исходный сценарий (`SolidHono/test/browser/paginate.mjs` parity).
  - Регрессионные тесты зон `40%` top/bottom до достижения края.
  - Регрессионные тесты `edge` триггера.
  - Сохранение `window.scrollY = 0` при всех действиях.
  - Prepend retention: сохранение позиции контента при `scrollTop > 0` и `scrollTop === 0`.
  - Columns layout & dynamic item heights.
  - Независимость второго пагинатора (`?gallery.*`).
- [ ] `npm run check` (0 errors, 0 warnings).
- [ ] `npm test` (все unit-тесты и tooling guards проходят).
- [ ] `npm run build` (production build успешен, бюджеты веса соблюдены).
