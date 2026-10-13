# Перенос пагинатора из `lib/ui/demo` в роут — чеклист

Первый шаг плана «растворить `lib/ui/demo`»: компоненты страницы живут в папке
своего роута, переиспользуемые — в общих модулях `lib/ui/*` (образец — shadcn
`apps/v4`: `components/` против `app/(app)/(create)/components`; SvelteKit
игнорирует в папке роута файлы без `+`, документация прямо советует держать их
рядом с роутом — https://svelte.dev/docs/kit/routing, «Other files»).

Решения владельца (ход 114–115):

- карточки (`AnimeRow/Tile`, `CharacterRow/Tile`, `ItemRow`, `ShotTile`) — роута,
  пока данные демо; при реальном каталоге стали бы общими;
- поиск делится на **логику** (хук без разметки) и **разметку** страницы;
  вариант «составные части с подменой через сниппет» отклонён;
- переименование `lib/ui` → `components/` — не здесь, это план раскладки `src/lib`.

## Что куда

| Сейчас (`src/lib/ui/demo/paginator/`) | Куда | Почему |
|---|---|---|
| `loader.ts` (`loadPaginatorDemo`) | тело `paginator/+page.server.ts` | один вызов, серверный код страницы |
| `PaginatorDemo.svelte` | тело `paginator/+page.svelte` | сам экран страницы |
| `DemoPaginator.svelte` | `paginator/CatalogDemo.svelte` | каталог страницы: источники, тексты, панель |
| `GalleryDemo.svelte` | `paginator/GalleryDemo.svelte` | вторая лента страницы |
| `definition.ts` — настройки страницы (`DemoStore`, `DemoSrc`, `DEMO_*`, `DEFAULT_DEMO_*`, `DEMO_EXTRA_SEARCH`, `ensureDemoPaginator`, блок `GALLERY_*`) | `paginator/definition.ts` | настройки страницы |
| `definition.ts` — источники данных (стр. ~432–697: транспорты `set*ServerTransport`, `loadAnimePage`, `loadCharactersPage`, `create*Source`, `makeSource`; `loadFilterSchema`) | `paginator/sources.ts` | демо-источники, нужны только этой странице |
| `definition.test.ts` (проверяет источники) | `paginator/sources.test.ts` | идёт за источниками |
| `item-views.ts`, `types.ts` | `paginator/` | тип записей и данных загрузки этой страницы |
| `ItemRow`, `ShotTile`, `AnimeRow`, `AnimeTile`, `CharacterRow`, `CharacterTile` | `paginator/` | решение владельца: карточки роута |
| `FiltersPanel.svelte` | `src/lib/ui/filters/FiltersPanel.svelte` + экспорт из `index.ts` | общий: имя, схема, значения — о странице не знает |
| `SearchQueryForm.svelte` — логика | `src/lib/ui/paginator/search.svelte.ts` → `usePaginatorSearch` + экспорт | общий хук без разметки |
| `SearchQueryForm.svelte` — разметка и тексты | `paginator/SearchBar.svelte` | поле, кнопки, подсказка — страницы |

Не трогаем: `content/*.ts` (ими пользуется и `lib/server/*`),
`#lib/ui/demo/db-list/*` (`DbPostRow`, `cursor-mode`, тип `DbPost` — это перенос
`/db-demo`), уже общие `lib/ui/{paginator,filters,primitives,settings}`.

Хук — в `lib/ui/paginator`, а не в `#lib/search/svelte`: он склеивает `lib/form`
(форма для перехода без JS), роутер (`currentSearch`), `lib/paginate`
(`setExtra`) и `lib/search` (`normalizeSearchQuery`). Положить его в `lib/search`
— привязать независимую библиотеку к трём другим (правило «каждая lib работает
одна»). Склейка поверх библиотек — это и есть `lib/ui/paginator`.

```ts
// src/lib/ui/paginator/search.svelte.ts — набросок API
const search = usePaginatorSearch(name, {
  path: 'page.q',
  label: 'Поиск по каталогу',
  placeholder: 'Тайтл: «наруто», «naruto», «нарута»',
  maxLength: 120,          // по умолчанию 120
  debounce: 300,           // по умолчанию 300 мс
  disabled: () => searchOff,
  reason: () => searchOffReason,
})
// → { form, field, value, disabled, reason, hydrated, resetHref, clear }
//   hydrated  — страница ожила: до этого (и без JS) разметка показывает «Найти»
//               и ссылку «Сбросить»; после — только поле с крестиком (ход 116)
//   resetHref — текущий адрес без запроса и указателя страницы
```

## Шаги

Каждый шаг — отдельный коммит после зелёных проверок; без пуша, пока не попросят.

- [ ] **0. Исходная точка.** Ветка `upgrade/kit3`, дерево чистое, `HEAD` = `origin`.
  Записать базу: `node tooling/size-budget.mjs` (`/paginator` 191.6, всё JS 224.1),
  `gate.sh` → `GATE OK`.

- [ ] **1. Отделить источники от настроек** (пока на месте, в `demo/paginator`).
  - [ ] Вынести блок источников из `definition.ts` в `sources.ts`; `definition.ts`
        импортирует из `sources.ts` то, что нужно `ensureDemoPaginator`.
  - [ ] `definition.test.ts` → `sources.test.ts`.
  - [ ] Поправить импорты `loader.ts`, `DemoPaginator.svelte`, `PaginatorDemo.svelte`.
  - [ ] Проверки: `gate.sh`; размер `/paginator` не вырос.

- [ ] **2. Разделить поиск.**
  - [ ] `src/lib/ui/paginator/search.svelte.ts`: перенести из `SearchQueryForm`
        объявление формы, задержку, нормализацию, запись через `setExtra`,
        «набранное против эха своей отправки» (`committed`), сброс набранного при
        внешней смене запроса, выключение до оживления. Тексты (`label`,
        `placeholder`) — параметрами, в хуке своих текстов нет.
  - [ ] Экспорт `usePaginatorSearch` из `src/lib/ui/paginator/index.ts`.
  - [ ] `SearchBar.svelte` (пока в `demo/paginator`): `<Form>` + `SearchInput`
        из `#lib/ui/primitives` (крестик очистки), «Найти» и ссылка «Сбросить»
        только до оживления, причина выключения; тексты — нынешние, без изменений.
        Поведение уже есть в `SearchQueryForm` (ход 116) — переносится как есть.
  - [ ] `DemoPaginator.svelte` → `SearchBar`; удалить `SearchQueryForm.svelte`.
  - [ ] Проверки: `gate.sh` (layer-guard: поле только из примитивов/`lib/form`);
        `rickmorty.mjs`, `shikimori.mjs` (поиск); `source-switch.mjs` (поле пустеет
        при смене источника); без JS: `?page.q=...` отправляется GET-формой.

- [ ] **3. `FiltersPanel` в общий модуль.**
  - [ ] `git mv` → `src/lib/ui/filters/FiltersPanel.svelte`; экспорт из `index.ts`.
  - [ ] `DemoPaginator.svelte` импортирует из `#lib/ui/filters/index.js`.
  - [ ] Комментарий в `src/lib/ui/paginator/PaginatorSettingsForm.svelte:6`.
  - [ ] Проверки: `gate.sh`; `shikimori.mjs` (фильтры, чипы, шаг F5).

- [ ] **4. Перенос в папку роута** `src/routes/(site)/(app)/paginator/`.
  - [ ] `git mv`: `definition.ts`, `sources.ts`, `sources.test.ts`, `item-views.ts`,
        `types.ts`, `GalleryDemo.svelte`, `SearchBar.svelte`, шесть карточек;
        `DemoPaginator.svelte` → `CatalogDemo.svelte`.
  - [ ] Тело `PaginatorDemo.svelte` → `+page.svelte`, файл удалить.
  - [ ] Тело `loader.ts` → `+page.server.ts`, файл удалить.
  - [ ] Импорты: `./…` не меняются; `../../../../content/…` — та же глубина
        (`routes/(site)/(app)/paginator` = `lib/ui/demo/paginator`), сверить;
        `#lib/ui/demo/db-list/*` не меняются.
  - [ ] `tooling/source-schema-guard.mjs:35` `SCHEMA_READERS`: путь к
        `loader.ts` → `src/routes/(site)/(app)/paginator/+page.server.ts`
        (иначе сборка упадёт на чтении схемы — громко, не молча).
  - [ ] `tooling/source-schema-guard.test.mjs:76` — новый путь; `:36,56,74` —
        примеры путей вне зон, заменить на существующие.
  - [ ] Проверки: `gate.sh` (vitest подхватывает `src/**/*.test.ts`, в т. ч.
        `src/routes`); размер `/paginator` тот же.

- [ ] **5. Ссылки на старые пути.**
  - [ ] `src/lib/ui/demo/db-list/DbPostsList.svelte:72` (комментарий про `PaginatorDemo`).
  - [ ] Комментарий в бывшем `definition.ts:89`.
  - [ ] `docs/audit/ratings.md` — раздел `demo/paginator` (живая таблица): новые пути.
  - [ ] Исторические записи (`crutches.md`, `framework-imports.md`, `kit3-upgrade.md`)
        не правим: это журнал, пути там — на момент находки.

- [ ] **6. Убрать папку.** `src/lib/ui/demo/paginator/` пуста и удалена;
  `grep -rn "ui/demo/paginator" src tooling test` → только исторические документы.

- [ ] **7. Итоговая проверка.**
  - [ ] `gate.sh` → `GATE OK`.
  - [ ] `browser-all.sh capabilities paginate regressions`; `rickmorty.mjs`; `shikimori.mjs`.
  - [ ] `url-storage.check.mjs` — до 8 ✓ (дальше превью падает по памяти PGlite в
        песочнице, было и до переноса).
  - [ ] Ручной проход `/paginator`: каталог, галерея, смена источника, поиск,
        фильтры, `?fault=init`, без JS.
  - [ ] Консоль браузера и сборки без новых предупреждений.

## Не входит

- Перенос `/db-demo` (и `demo/db-list`) и остальных `demo/*`.
- `lib/ui` → `components/` (план раскладки `src/lib`).
- Известные находки, не связанные с переносом: устаревший `<select>` в
  `CatalogFilterForm` после снятия чипа; глобальный `demoFault` в `content/items.ts`.
