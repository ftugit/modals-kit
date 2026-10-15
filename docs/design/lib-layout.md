# План: раскладка `src/lib` — библиотеки, адаптеры, UI

**Статус: ЗАПЛАНИРОВАНО** (решение владельца, ход 45; ход 47 — сюда же влит R2, очистка
фильтров). Делать после чек-листа `lib/db`
([../audit/lib-db.md](../audit/lib-db.md)). Пути импорта — публичный API: перенос начинается
только после ответов на «Решения» ниже.

## Требования владельца (ход 45)

- Связанные lib — части одного пакета (`search` и `filters` → внутрь `paginate`).
- Связь с фреймворком живёт внутри самих lib, в их адаптерах.
- UI не может быть lib. Папка `components` — как в shadcn: туда `lib/shell`,
  `lib/components` и `ui/*`.
- Цель: lib можно забрать в проект на другом фреймворке (например, React), написав только
  адаптеры.

## R2 — очистка фильтров (влита в этот план, ход 47)

R2 (ход 31–34): `lib/filters` — не библиотека (F53). По сути это генератор формы и правил из
схемы плюс UI; «лишнее» — формат адреса (префикс `filters.`), поиск `q` в связках, патчи
канала `extra` пагинатора. Отдельно R2 означал бы перенос дважды (сначала чистка, потом
раскладка), поэтому он делается шагом 3 этого плана.

Что меняет объединение: внутри пакета `paginate` префикс `filters.`, поле поиска `q` и канал
`extra` — свои договорённости пакета, а не чужие. Значит, от R2 остаётся только то, что даёт
практическую пользу:

1. ✅ ход 160. **Разрезать `catalog-filter.ts` (1029 строк) по ролям** — без изменения поведения и имён:

   | Файл `paginate/filters/` | Что туда идёт |
   |---|---|
   | `schema.ts` | типы схемы, `validateCatalogFilterSchema`, `catalogFilterSafeName`, `catalogFilterFieldNames`, `CATALOG_FILTER_OPTIONS_LIMIT`, `CATALOG_FILTER_NOJS_OPTIONS`, `capCatalogFilterOptions`, `catalogFilterOptionsAreComplete`; память схем — `schema-memory.ts` |
   | `form.ts` | помощники над `lib/form`: `catalogFilterPolicy`, `stripDefaultCatalogFilterValues`, `catalogFilterFormData` (генератор полей удалён — см. п. 3) |
   | `params.ts` | схема → параметры полей описания приложения: `formParams` |
   | `url.ts` | ключи адреса: `parseCatalogFilterPath`, `readCatalogFilterValues`, `catalogFilterValuesFromSearch`, `canonicalCatalogFilterUrl`, `catalogFilterUrlWithout` |
   | `rules.ts` | связки и серверная проверка: `catalogRuleState`, `catalogFilterValueMap`, `catalogFilterViolations`, `validateCatalogFilterValues` |
   | `view.ts` | как есть: картина панели и патчи `extra`, `activeCatalogFilters` (данные чипов) |

   Отличия от таблицы (ход 160): `modes`/`bounds` нужны трём файлам — вынесены в `internal.ts`,
   его `index.ts` не отдаёт; `ruleCondition` нужна `rules.ts`, но перенос дал бы цикл
   (`rules` → `form` ради компиляции схемы), поэтому она в `form.ts`, а `index.ts`
   отдаёт `form.ts` списком без неё. Публичный API — тот же набор имён (сверено скриптом).
2. ✅ ход 160. **Один префикс.** Литерал `'filters.'` сейчас повторён 5 раз в `catalog-filter.ts` и 5 раз в
   `lib/server` (`shikimori.ts`, `shikimori-filters.ts`, `rickmorty.ts`), а в
   `paginate/source.ts:196` уже есть `FILTER_KEY_PREFIX` с комментарием «объявлен здесь ОДИН
   раз». Все места — на эту константу.
3. ✅ **Подписи фильтров — в описании приложения.** Генератор полей
   (`compileCatalogFilterSchema`) и словари подписей режимов/границ удалены: форму под каждую
   схему описывает приложение (`shikimoriFilterForm`, `rickMortyFilterForm`), а `formParams`
   даёт полям варианты, границы, связки и межполевые правила. Компонент фильтров — свой у
   каждой схемы, поля расставлены руками. Решение 4 больше не нужно.

Не входит (нет практической пользы сейчас, ход 32): переименование `CatalogFilter*`,
параметр вместо префикса, отделение схемы фильтров в спеку источника (R3 — записан).
R4/R5 (Select + `paginate/search`, no-JS) — отдельно, после этого плана.

## Почему `lib/router` нельзя просто разложить по адаптерам

В `router` три разные вещи:

1. **Общий писатель адреса** (`address.ts`, `createAddressWriter`). Ядро без фреймворка,
   ОДНО на приложение: модалки, пагинатор и мобильная панель пишут адрес через одну очередь.
   Если у каждой lib будет свой писатель, записи снова затирают друг друга (F41). Поэтому
   писатель становится отдельной маленькой lib — `lib/address` со своими адаптерами.
2. **Привязки SvelteKit для чужих lib**: роутер пагинатора (`svelteKitRouter`,
   `currentSearch`, `currentPathname`), предзагрузка (`preloadOutcome`). Переезжают в адаптеры
   своих lib.
3. **`LoadLink.svelte`** — ✅ ход 141: удалён; с хода 149 — `asLink` в `components/links`.

Под React: `address/core.ts` без изменений; пишется `address/react-router.ts` — четыре
функции `AddressWriterDeps` (`read`, `commit`, `hash`, `traverse`); затем
`modals/cores/react-router.ts`, `paginate/react/`, `form/react/`. `components` не переносятся —
в React свой UI.

## Целевая раскладка

```
src/lib/
├── utils.ts                     ← ui/cn.ts (cn — как в shadcn)
├── hooks/                       ← реактивные .svelte.ts приложения (shadcn: aliases.hooks)
│   ├── js-only.svelte.ts        ← ui/js-only.svelte.ts
│   └── use-drawer.svelte.ts     ← shell/use-drawer.svelte.ts
├── app-errors.svelte.ts         без изменений
├── assets/                      без изменений
│
│  ── БИБЛИОТЕКИ: ядро без фреймворка + адаптеры внутри ──
├── address/                     НОВАЯ lib (из router): один писатель адреса
│   ├── index.ts, core.ts        ← router/address.ts (+ address.test.ts)
│   └── sveltekit.ts             ← из router/sveltekit.ts: visibleAddress, writeAddress,
│                                  addressTraversing, goAddress, shallowFlag, onHashLinkClick
│                                  (+ sveltekit.test.ts)
├── modals/                      как есть, плюс:
│   ├── cores/sveltekit.ts       + preloadOutcome ← router/sveltekit.ts
│   └── svelte/                  ссылка на модалку — `asModalLink` в components/links (ход 149)
├── paginate/
│   ├── (ядро без изменений)
│   ├── search/                  ← lib/search/*.ts ✅ (accumulator, core, dictionary, fuzzy,
│   │                              registry, stats, types, index, тесты, README)
│   ├── filters/                 ← lib/filters/*, разрезан по ролям (см. R2): schema, form,
│   │                              url, rules, view, index, тесты
│   ├── svelte/                  как есть
│   │   └── search/              ← lib/search/svelte/* ✅ (correction, stats)
│   └── sveltekit/               НОВЫЙ адаптер
│       └── router.ts            ← из router/sveltekit.ts: svelteKitRouter,
│                                  currentSearch, currentPathname
├── form/                        без изменений (ядро + svelte/)
├── db/                          без изменений (ядро + sveltekit/ + adapters/)
│
│  ── UI: не lib ──
├── components/
│   ├── ui/                      ← ui/primitives, папка на компонент (как в shadcn)
│   │   ├── alert/  badge/  checkbox/  fieldset/  label/  native-select/
│   │   ├── button/              Button, ButtonGroup
│   │   ├── card/                Card, CardContent, CardDescription, CardFooter,
│   │   │                        CardHeader, CardTitle
│   │   ├── input/               Input (autoWidth), InputAffix, InputShell, AffixSwap
│   │   ├── textarea/            Textarea, AutoTextarea
│   │   ├── select/              Select, SelectList, select-model.ts, select-trace.ts
│   │   ├── search/              SearchField, SearchInput, SearchMorph
│   │   ├── password/            PasswordInput, PasswordStrength
│   │   ├── number-field/  phone-input/  otp-input/  warning-icon/
│   │   ├── separator/  skeleton/  spinner/  stat/  switch/
│   │   └── field/               field.ts
│   ├── settings/                ← ui/settings (Field, Select, Toggle)
│   ├── links/                   ✅ ход 149: asLink + asModalLink (атрибуты на свою <a>/Button), один index
│   ├── modals/                  ← ui/modals
│   ├── paginator/               ← ui/paginator (вместе с compile.ts, event-log.ts)
│   ├── filters/                 ← ui/filters (FiltersPanel, ActiveFilters, FilterActions, bindFilters)
│   ├── shell/                   ← lib/shell (AppShell, CollapsingHeader, HeaderRowView,
│   │                              HeaderSlot, PageHead, shell.svelte.ts, page.svelte.ts, prefs.ts)
│   ├── header/  sidebar/        без изменений
│   └── ErrorPage.svelte, Error500.svelte   без изменений
│
│  ── ПРИЛОЖЕНИЕ ──
├── demo/                        ← ui/demo/* (решение 3) — ход 186: папка убрана, куски разнесены
│                                  по папкам роутов и components/form (dissolve-demo.md); было: в демо есть серверные обработчики
│                                  (handle.ts), определения и загрузчики — не только компоненты
└── server/                      без изменений (в Kit 3 серверной считается любая папка /server/)
```

Удаляются: `lib/router`, `lib/search` ✅, `lib/filters`, `lib/shell`, `lib/ui`,
пустая заготовка `lib/index.ts`.

## Правила зависимостей (закрепить стражем)

- Lib (`address`, `modals`, `paginate`, `form`, `db`) не импортируют `components`, `hooks`,
  `demo`, `server`.
- `$app/*` — только в адаптерах `sveltekit`: `address/sveltekit.ts`, `paginate/sveltekit/`,
  `modals/cores/sveltekit.ts`, `db/sveltekit/`.
- Адаптер `svelte/` не знает про SvelteKit. Сейчас `PaginatorHost.svelte` сам берёт роутер
  SvelteKit — после переезда получает его из `paginate/sveltekit`.
- `paginate/filters` зависит от `lib/form` (схема → форма) — единственная связь между пакетами,
  записать в README.

## Нарушения, которые снимает перенос

| Сейчас | После |
|---|---|
| `modals/svelte/ModalTrigger.svelte` → `ui/modals` (lib импортирует UI) | ✅ ход 141 → 149: `asModalLink` в `components/links`, вид — `Button` |
| `modals/cores/sveltekit.ts` → `router/sveltekit.ts` | → `address/sveltekit.ts` (lib → lib) |
| `paginate/svelte/PaginatorHost.svelte` → `router/sveltekit.ts` | роутер приходит из `paginate/sveltekit` |
| `router/LoadLink.svelte` → `modals/cores` и `ui/modals` (цикл router ↔ modals) | ✅ ход 141 → 149: удалён, `asLink` в `components/links` |
| `filters`: префикс `filters.`, поле `q`, `extra` пагинатора — чужие договорённости | внутренние договорённости пакета `paginate` |

## Решения (нужны до начала)

1. `lib/address` — отдельная lib (рекомендую) или писатель передаётся в каждый адаптер извне.
2. ~~`ModalTrigger`: поведение в lib + кнопка в `components/modals`~~ — решено в ходе 141
   иначе: ссылка на модалку — UI над модалками и фреймворком, лежит в `components/links`.
   С хода 149 это не компонент, а атрибуты `asModalLink(...)` на свою `<a>` или `Button`
   (рядом `asLink`), импорт из одного `index`.
3. Демо: `src/lib/demo/` или рядом с маршрутами в `src/routes/...`. Ход 161 — `src/lib/demo/`
   (промежуточно); ход 186 — рядом с маршрутами, общее в `components/` ([dissolve-demo.md](dissolve-demo.md)).
4. ✅ Подписи режимов/границ фильтров: сняты вместе с генератором полей — подписи пишет
   описание формы приложения (см. п. 3 выше).

## Порядок (каждый шаг — отдельный коммит с гейтом)

1. ✅ 14.10.2026: `router` → `lib/address` (`core.ts`, `layer-links.ts`, `svelte/watch.svelte.ts`,
   `sveltekit.ts` — писатель, `visibleAddress`/`writeAddress`/`goAddress`/`shallowFlag`/
   `claimLayerKeys`, а также `visibleHref`/`resolveHref`/`linkTask`) + `paginate/sveltekit/router.ts`
   (`svelteKitRouter`, `currentSearch`, `currentPathname`) + `preloadOutcome` в
   `modals/cores/sveltekit.ts`. Страж `core-purity`: `address` в списке ядер, зона
   `sveltekit/` / `sveltekit.ts` рядом с `cores/<фреймворк>.ts`.
2. ✅ ход 160: `search` → `paginate/search` и `paginate/svelte/search` (UI на месте; подписи «lib/search» в демо стали «paginate/search»).
3. ✅ ход 160: `filters` → `paginate/filters` вместе с R2 (подписи — решение 4 не принято, оставлены как есть): разрез по ролям, один префикс, подписи (по
   решению 4). Поведение не меняется — тесты фильтров и `shikimori.mjs` зелёные до и после.
4. ✅ 14.10.2026: `ui/primitives` → `components/ui/<компонент>/` (папка на компонент, общий
   `components/ui/index.ts`; папки названы по компоненту: `phone-input/` вместо `phone-field/`,
   плюс `warning-icon/` для `WarningIcon`), `ui/{settings,modals,paginator,filters}` →
   `components/…`, `lib/shell` → `components/shell`, `ui/cn.ts` → `utils.ts` (примитивы берут
   `#lib/utils.js`, как в shadcn), `ui/js-only.svelte.ts` и `shell/use-drawer.svelte.ts` →
   `hooks/`. Удалены `lib/ui/index.ts` (дубль барреля примитивов) и пустая `lib/index.ts`.
   Стражи: `layer-guard` (FORM_KEEPERS, разрешения `<NativeSelect>`, запрет UI в `lib/form` —
   теперь `#lib/components/(ui|settings)/`), `classes-audit`, `vite.config.ts` (прогрев).
5. ✅ 14.10.2026: `ui/demo` → `src/lib/demo` (решение 3: в `src/lib`, потому что в демо есть серверные
   обработчики, определения и загрузчики). Папки `lib/ui` больше нет. Страж `layer-guard`: экшен
   демо-формы узнаётся по `#lib/demo/form/` (ход 186: по обёртке `./handle` рядом с маршрутом —
   папки `src/lib/demo` больше нет, см. [dissolve-demo.md](dissolve-demo.md)).

В каждом шаге: пути в стражах (`tooling/core-purity.mjs` `CORE_MODULES`, `layer-guard`,
`size-budget`, `form-size`, `classes-audit`, `source-schema-guard`), README библиотек,
`docs/audit/*` (ссылки), `tsconfig`/`package.json#imports` при необходимости; браузерные наборы
после шагов 1, 3, 4, 5.
