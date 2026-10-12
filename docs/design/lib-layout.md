# План: раскладка `src/lib` — библиотеки, адаптеры, UI

**Статус: ЗАПЛАНИРОВАНО** (решение владельца, ход 45). Делать после чек-листа `lib/db`
([../audit/lib-db.md](../audit/lib-db.md)). Пути импорта — публичный API: перенос начинается
только после ответов на «Решения» ниже.

## Требования владельца (ход 45)

- Связанные lib — части одного пакета (`search` и `filters` → внутрь `paginate`).
- Связь с фреймворком живёт внутри самих lib, в их адаптерах.
- UI не может быть lib. Папка `components` — как в shadcn: туда `lib/shell`,
  `lib/components` и `ui/*`.
- Цель: lib можно забрать в проект на другом фреймворке (например, React), написав только
  адаптеры.

## Почему `lib/router` нельзя просто разложить по адаптерам

В `router` три разные вещи:

1. **Общий писатель адреса** (`address.ts`, `createAddressWriter`). Ядро без фреймворка,
   ОДНО на приложение: модалки, пагинатор и мобильная панель пишут адрес через одну очередь.
   Если у каждой lib будет свой писатель, записи снова затирают друг друга (F41). Поэтому
   писатель становится отдельной маленькой lib — `lib/address` со своими адаптерами.
2. **Привязки SvelteKit для чужих lib**: роутер пагинатора (`svelteKitRouter`,
   `currentSearch`, `currentPathname`), предзагрузка (`preloadOutcome`). Переезжают в адаптеры
   своих lib.
3. **`LoadLink.svelte`** — UI → `components/modals`.

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
│   └── svelte/ModalTrigger.svelte  без импорта из components (решение 2)
├── paginate/
│   ├── (ядро без изменений)
│   ├── search/                  ← lib/search/*.ts (accumulator, core, dictionary, fuzzy,
│   │                              registry, stats, types, index, тесты, README)
│   ├── filters/                 ← lib/filters/* (catalog-filter, view, index, тесты)
│   ├── svelte/                  как есть
│   │   └── search/              ← lib/search/svelte/* (correction, stats)
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
│   │   ├── input/               Input, InputAffix, InputShell, AffixSwap, AutoWidthInput
│   │   ├── textarea/            Textarea, AutoTextarea
│   │   ├── select/              Select, SelectList, select-model.ts, select-trace.ts
│   │   ├── search/              SearchField, SearchInput, SearchMorph
│   │   ├── password/            PasswordInput, PasswordStrength
│   │   ├── number-field/  phone-field/  otp-input/
│   │   ├── separator/  skeleton/  spinner/  stat/  switch/
│   │   └── field/               field.ts
│   ├── settings/                ← ui/settings (Field, Select, Toggle)
│   ├── modals/                  ← ui/modals + router/LoadLink.svelte
│   ├── paginator/               ← ui/paginator (вместе с compile.ts, event-log.ts)
│   ├── filters/                 ← ui/filters (CatalogFilterForm, ActiveFilters)
│   ├── shell/                   ← lib/shell (AppShell, CollapsingHeader, HeaderRowView,
│   │                              HeaderSlot, PageHead, shell.svelte.ts, page.svelte.ts, prefs.ts)
│   ├── header/  sidebar/        без изменений
│   └── ErrorPage.svelte, Error500.svelte   без изменений
│
│  ── ПРИЛОЖЕНИЕ ──
├── demo/                        ← ui/demo/* (решение 3): в демо есть серверные обработчики
│                                  (handle.ts), определения и загрузчики — не только компоненты
└── server/                      без изменений (в Kit 3 серверной считается любая папка /server/)
```

Удаляются: `lib/router`, `lib/search`, `lib/filters`, `lib/shell`, `lib/ui`,
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
| `modals/svelte/ModalTrigger.svelte` → `ui/modals` (lib импортирует UI) | lib без оформления, кнопка в `components/modals` (решение 2) |
| `modals/cores/sveltekit.ts` → `router/sveltekit.ts` | → `address/sveltekit.ts` (lib → lib) |
| `paginate/svelte/PaginatorHost.svelte` → `router/sveltekit.ts` | роутер приходит из `paginate/sveltekit` |
| `router/LoadLink.svelte` → `modals/cores` и `ui/modals` (цикл router ↔ modals) | `components/modals/LoadLink.svelte` |
| `filters`: префикс `filters.`, поле `q`, `extra` пагинатора — чужие договорённости | внутренние договорённости пакета `paginate` |

## Решения (нужны до начала)

1. `lib/address` — отдельная lib (рекомендую) или писатель передаётся в каждый адаптер извне.
2. `ModalTrigger`: поведение без оформления в lib + кнопка с оформлением в
   `components/modals` (меняет API). `ModalHost`, `Layers`, `Tails` остаются в адаптере:
   механика стопки (фокус, история, слои) со структурными классами, а не оформление.
3. Демо: `src/lib/demo/` или рядом с маршрутами в `src/routes/...`.

## Порядок (каждый шаг — отдельный коммит с гейтом)

1. `router` → `lib/address` + `paginate/sveltekit/router.ts` + `preloadOutcome` в
   `modals/cores/sveltekit.ts` + `LoadLink` в `components/modals`.
2. `search` → `paginate/search` и `paginate/svelte/search`.
3. `filters` → `paginate/filters` (перенос без изменения поведения).
4. `ui/*`, `shell`, `cn`, `js-only`, `use-drawer` → `components`, `hooks`, `utils.ts`.
5. `ui/demo` → `demo` (по решению 3).
6. «Причёсывание» `filters` — отдельный шаг, с согласованием API.

В каждом шаге: пути в стражах (`tooling/core-purity.mjs` `CORE_MODULES`, `layer-guard`,
`size-budget`, `form-size`, `classes-audit`, `source-schema-guard`), README библиотек,
`docs/audit/*` (ссылки), `tsconfig`/`package.json#imports` при необходимости; браузерные наборы
после шагов 1, 4, 5.
