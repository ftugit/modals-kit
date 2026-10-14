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
| `definition.test.ts` | `paginator/definition.test.ts` | проверяет API настроек (`demoExtraOf`, `DEMO_*`, `ensureDemoPaginator`); импортирует только `definition.ts` — имя остаётся (уточнено на шаге 1) |
| `item-views.ts`, `types.ts` | `paginator/` | тип записей и данных загрузки этой страницы |
| `ItemRow`, `ShotTile`, `AnimeRow`, `AnimeTile`, `CharacterRow`, `CharacterTile` | `paginator/` | решение владельца: карточки роута |
| `FiltersPanel.svelte` | `src/lib/ui/filters/FiltersPanel.svelte` + экспорт из `index.ts` | общий: имя, схема, значения — о странице не знает |
| `SearchQueryForm.svelte` — логика | `src/lib/ui/paginator/search.svelte.ts` → `usePaginatorSearch` + экспорт | общий хук без разметки |
| `SearchQueryForm.svelte` — разметка и тексты | `paginator/SearchBar.svelte` | поле, кнопки, подсказка — страницы |

Не трогаем: `content/*.ts` (ими пользуется и `lib/server/*`),
`#lib/ui/demo/db-list/*` (`DbPostRow`, `cursor-mode`, тип `DbPost` — это перенос
`/db-demo`), уже общие `lib/ui/{paginator,filters,primitives,settings}`.

Хук — в `lib/ui/paginator`, а не в `#lib/paginate/search/svelte`: он склеивает `lib/form`
(форма для перехода без JS), роутер (`currentSearch`), `lib/paginate`
(`setExtra`) и `paginate/search` (`normalizeSearchQuery`). Положить его в `paginate/search`
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
  query: () => query,      // запрос из состояния пагинатора
  disabled: () => searchOff,
  reason: () => searchOffReason,
})
// → { form, field, value, disabled, reason, hydrated, hasQuery, resetHref,
//     hiddenFields, input, submit, clear }   (так реализовано на шаге 2)
//   hydrated  — страница ожила: до этого (и без JS) разметка показывает «Найти»
//               и ссылку «Сбросить»; после — только поле с крестиком (ход 116)
//   resetHref — текущий адрес без запроса и указателя страницы
```

## Шаги

Каждый шаг — отдельный коммит после зелёных проверок; без пуша, пока не попросят.

- [x] **0. Исходная точка.** Ветка `upgrade/kit3`, дерево чистое (`HEAD` впереди
  `origin` на неотправленные коммиты — пуш не просили). База после `dc1ae7a`:
  `/paginator` 194.7, всё JS 227.8; `gate.sh` → `GATE OK`.

- [x] **1. Отделить источники от настроек** (`cb5ed95`) (пока на месте, в `demo/paginator`).
  - [x] Вынести блок источников из `definition.ts` в `sources.ts`; `definition.ts`
        импортирует из `sources.ts` то, что нужно `ensureDemoPaginator`
        (`makeSource(name, select)` — выбор источника передаётся параметром,
        чтобы не было кольца импортов; `gallerySource`).
  - [x] ~~`definition.test.ts` → `sources.test.ts`~~ — тест проверяет `definition.ts`, имя оставлено.
  - [x] Поправить импорты `loader.ts`, `DemoPaginator.svelte` (`PaginatorDemo.svelte` источников не берёт).
  - [x] Проверки: `gate.sh`; размер `/paginator` 194.7 → 194.7; `paginate`.

- [x] **2. Разделить поиск.**
  - [x] `src/lib/ui/paginator/search.svelte.ts`: перенести из `SearchQueryForm`
        объявление формы, задержку, нормализацию, запись через `setExtra`,
        «набранное против эха своей отправки» (`committed`), сброс набранного при
        внешней смене запроса, выключение до оживления. Тексты (`label`,
        `placeholder`) — параметрами, в хуке своих текстов нет.
  - [x] Экспорт `usePaginatorSearch` из `src/lib/ui/paginator/index.ts`.
  - [x] `SearchBar.svelte` (пока в `demo/paginator`): `<Form>` + `SearchInput`
        из `#lib/ui/primitives` (крестик очистки), «Найти» и ссылка «Сбросить»
        только до оживления, причина выключения; тексты — нынешние, без изменений.
        Поведение уже есть в `SearchQueryForm` (ход 116) — переносится как есть.
  - [x] `DemoPaginator.svelte` → `SearchBar`; удалить `SearchQueryForm.svelte`.
  - [x] Проверки: `gate.sh` (layer-guard: поле только из примитивов/`lib/form`);
        `rickmorty.mjs`, `shikimori.mjs` (поиск); `source-switch.mjs` (поле пустеет
        при смене источника); без JS: `?page.q=...` отправляется GET-формой.
        Итог: всё зелёное; `/paginator` 194.7 → 195.0 (объект хука с геттерами).

- [x] **3. `FiltersPanel` в общий модуль.**
  - [x] `git mv` → `src/lib/ui/filters/FiltersPanel.svelte`; экспорт из `index.ts`.
        `$app/state` → `currentPathname()` слоя роутера (то же `page.url.pathname`):
        в общих `lib/ui/*` фреймворк-импорты только через `#lib/router/sveltekit.js`.
  - [x] `DemoPaginator.svelte` импортирует из `#lib/ui/filters/index.js`.
  - [x] Комментарий в `src/lib/ui/paginator/PaginatorSettingsForm.svelte:6`.
  - [x] Проверки: `gate.sh`; `shikimori.mjs` (52 ok), `rickmorty.mjs`; `/paginator` 194.9.

- [x] **4. Перенос в папку роута** `src/routes/(site)/(app)/paginator/`.
  - [x] `git mv`: `definition.ts`, `sources.ts`, `definition.test.ts`, `item-views.ts`,
        `types.ts`, `GalleryDemo.svelte`, `SearchBar.svelte`, шесть карточек;
        `DemoPaginator.svelte` → `CatalogDemo.svelte`.
  - [x] Тело `PaginatorDemo.svelte` → `+page.svelte`, файл удалить.
  - [x] Тело `loader.ts` → `+page.server.ts`, файл удалить. Мёртвое не перенесено:
        ветки `ctx.pathname`/`ctx.search` (вызов был один, с `url`) и неиспользуемый
        тип `PaginatorSearch`.
  - [x] Импорты: `./…` не меняются; `../../../../content/…` — та же глубина
        (`routes/(site)/(app)/paginator` = `lib/ui/demo/paginator`), сверить;
        `#lib/ui/demo/db-list/*` не меняются.
  - [x] `tooling/source-schema-guard.mjs:35` `SCHEMA_READERS`: путь к
        `loader.ts` → `src/routes/(site)/(app)/paginator/+page.server.ts`
        (иначе сборка упадёт на чтении схемы — громко, не молча).
  - [x] `tooling/source-schema-guard.test.mjs:76` — новый путь (плюс проверка: `+page.svelte` той же папки схему читать не может); `:36,56,74` —
        примеры путей вне зон, заменить на существующие.
  - [x] Проверки: `gate.sh` (vitest подхватывает `src/**/*.test.ts`, в т. ч.
        `src/routes` — подхватил); размер `/paginator` 194.9; `paginate`, `capabilities`.

- [x] **5. Ссылки на старые пути.**
  - [x] `src/lib/ui/demo/db-list/DbPostsList.svelte:72` (комментарий про `PaginatorDemo`).
  - [x] Комментарий в бывшем `definition.ts:89` — ссылается на `#lib/ui/demo/db-list`, который
        не переезжает: верен, без правки. Заодно `content/shikimori.ts` («см. loader.ts»).
  - [x] `docs/audit/ratings.md` — раздел `demo/paginator` убран, строки — в разделах роута,
        `lib/ui/filters`, `lib/ui/paginator`; у `+page.*` оценка снята до перечтения;
        счётчик прогресса пересчитан по таблицам (197 / 404).
  - [x] README: `paginate/search` и `lib/paginate` упоминают `usePaginatorSearch`.
  - [x] Исторические записи (`crutches.md`, `framework-imports.md`, `kit3-upgrade.md`)
        не правим: это журнал, пути там — на момент находки.

- [x] **6. Убрать папку.** `src/lib/ui/demo/paginator/` пуста и удалена;
  `grep -rn "ui/demo/paginator" src tooling test` → пусто (папка ушла вместе с шагом 4).

- [x] **7. Итоговая проверка.**
  - [x] `gate.sh` → `GATE OK` (vitest 916/916, tooling 107/107; один повтор после OOM песочницы).
  - [x] `browser-all.sh` capabilities, paginate, regressions, errors, shell, forms, forms-a11y,
        db-demo — все rc=0; `rickmorty.mjs` (с повтора: живой GraphQL-сервис один раз отдал
        пустую выдачу, тот же адрес по SSR — 5 строк), `shikimori.mjs`, `source-switch.mjs`.
  - [x] `url-storage.check.mjs` — 19 ✓, rc=0 (дальше 8 — превью в этот раз не упало по памяти).
  - [x] Проход `/paginator` скриптом: каталог и галерея (2 хоста), смена источника,
        поиск (JS: задержка и ×; без JS: GET, «Сбросить»), фильтры и чипы Rick and Morty,
        `?fault=init`, без JS (запрос в поле, форма фильтров в разметке).
  - [x] Консоль браузера чистая; в сборке предупреждений нет (только `PLUGIN_TIMINGS`).
  - Размер: `/paginator` 194.7 → 194.9 KiB, весь JS 227.8 → 228.0 KiB.

## Не входит

- Перенос `/db-demo` (и `demo/db-list`) и остальных `demo/*`.
- `lib/ui` → `components/` (план раскладки `src/lib`).
- Известные находки, не связанные с переносом: устаревший `<select>` в
  `CatalogFilterForm` после снятия чипа; глобальный `demoFault` в `content/items.ts`.
