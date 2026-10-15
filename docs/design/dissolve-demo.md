# Убрать `src/lib/demo`: куски страниц — в папки роутов, общее — в `components/`

**Статус: В РАБОТЕ** (ход 186; состояние проверено на `284ec16`; решения 1–3 приняты владельцем).

Правило (решения владельца, ходы 114–115 и постоянное): кусок, нужный одной странице, лежит в
папке её роута (SvelteKit не трогает файлы без `+`, документация советует держать их рядом —
https://svelte.dev/docs/kit/routing, «Other files»); переиспользуемое — в
`src/lib/components/<модуль>/`, как в shadcn `apps/v4`. Пагинатор так уже перенесён отдельно
(`move-paginator.md`). Этот план отменяет решение 3 плана `lib-layout.md` («демо в
`src/lib/demo`») — там это была промежуточная остановка.

## Что уже сделано (проверено)

| Часть | Где сделано | Состояние |
|---|---|---|
| Пагинатор: страница в папку роута, карточки, `SearchBar`, источники | `move-paginator.md`, ход 118 (`cb5ed95` … `1d540d5`) | ✅ папки `demo/paginator` нет |
| Поиск: логика → хук `usePaginatorSearch` (`components/paginator/search.svelte.ts`), разметка → роут | `move-paginator.md` шаг 2 | ✅ |
| Фильтры: `FiltersPanel` → `components/filters/` | `move-paginator.md` шаг 3 | ✅ |
| Логика поиска и фильтров → пакет `paginate` (`paginate/search`, `paginate/filters`) | `lib-layout.md` шаги 2–3, ход 160 | ✅ |
| `lib/ui` → `components/`, `hooks/`, `utils.ts`; `ui/demo` → `src/lib/demo` | `lib-layout.md` шаги 4–5, ход 161 | ✅ (промежуточно) |

Осталось: 60 файлов в `src/lib/demo/` (6 папок).

## Что куда

### Только своей странице → папка роута

| Сейчас (`src/lib/demo/…`) | Куда | Почему |
|---|---|---|
| `cycle/CycleDemo.svelte` | тело `src/routes/cycle/+page.svelte` | маршрут из 8 строк лишь монтирует его (как `PaginatorDemo` → `+page.svelte`) |
| `spike/SpikeDemo.svelte` | тело `src/routes/spike/+page.svelte` | то же |
| `modals/registry.ts`, `CardModal`, `FlowProbeModal`, `FullpageModal`, `LockedModal`, `SelectModal`, `FloatingMenu`, `sources.svelte.ts` | `src/routes/(site)/(modals-demo)/` | их берёт `+layout.svelte` группы (реестр и источники ядра); `FloatingMenu` нужен и окнам, и странице |
| `modals/SettingsPanel.svelte`, `SourcesPanel.svelte` | `src/routes/(site)/(modals-demo)/modals/` | панели одной страницы `/modals` |
| `modals/index.ts` | удалить | бочка ради одного потребителя |
| `form/handle.ts`, `signup.ts`, `psp.ts` | `src/routes/(site)/(app)/form/` | серверный обработчик, описания и образцы только `/form` |
| `form/index.ts` | удалить | бочка; `/form` импортирует файлы напрямую |
| `db-form/CreateForm`, `RemoveForm`, `SchemaPending`, `description.ts`, `handle.ts`, `schema-handle.ts`, `schema.ts`, `prepare.ts` | `src/routes/(site)/(app)/db-demo/` | формы и обработчики только `/db-demo` |
| `src/lib/server/form-db.test.ts` | `src/routes/(site)/(app)/db-demo/form-db.test.ts` | проверяет описание и `prepare` этой страницы (vitest берёт `src/**/*.test.ts`, в т. ч. роуты — проверено на пагинаторе) |

### Нужно нескольким страницам (решения 1–3 ниже)

| Сейчас | Кто пользуется | Куда (решено) |
|---|---|---|
| `form/ui/*` (`Field`, `Common`, `FieldShell`, 13 видов полей, `resolve.ts`), `forms.config.ts`, `transport.ts`, `extend.ts` (+ тест) | `/form`, `/db-demo`, фильтры `/paginator` | `src/lib/components/form/` — решение 1 |
| `db-list/*` (`DbPostsList`, `DbPostRow`, `DbPostPendingRow`, `ListMeta`, `definition`, `cursor-mode`, `live`, `optimistic`, `fresh` + 4 теста) | `/db-demo`, `/paginator` (источник «БД»), `lib/server/db-list.ts`, `api/db-posts` | `src/routes/(site)/(app)/db-demo/` — решение 2 |
| `db-form/posts.ts` (модель) | `lib/server/db.ts` (ресурс, сид), описание формы `/db-demo` | `src/content/posts.ts` — решение 3 |

## Решения (ход 186)

1. ✅ **Общий набор полей формы → `src/lib/components/form/`**: UI приложения над `lib/form`
   (как `components/filters` над `paginate/filters`). Прежний отказ (работа над фильтрами)
   снят владельцем.
2. ✅ **Список записей БД → папка роута `/db-demo`**. `/paginator` (источник «БД»),
   `lib/server/db-list.ts` и `api/db-posts` импортируют его относительным путём из папки роута.
3. ✅ **Модель `posts` → `src/content/posts.ts`**: рядом с данными и формами фильтров, которыми
   пользуются и сервер, и страницы.

## Шаги (каждый — отдельный коммит с зелёным гейтом)

1. `cycle`, `spike` → тела `+page.svelte`. Проверки: `gate.sh`, `browser-all.sh regressions`
   (и проход `/cycle`, `/spike` скриптом: страница рисуется, консоль чистая).
2. `modals` → `(modals-demo)/` и `(modals-demo)/modals/`; `index.ts` удалить;
   `tooling/classes-audit.mjs:94–97` — новые пути. Проверки: `gate.sh`, `modals`, `shell`.
3. `/form`-only: `handle.ts`, `signup.ts`, `psp.ts` → `(app)/form/`; `index.ts` удалить;
   `tooling/layer-guard.mjs:393` — экшен узнаётся и по относительному импорту обработчика из
   папки роута (+ тест в `layer-guard.test.mjs:166,183`). Проверки: `gate.sh`, `forms`,
   `forms-a11y`.
4. Общий набор полей → решение 1; импорты `/form`, `/db-demo`, `ShikimoriFilters`,
   `RickMortyFilters`; `layer-guard.test.mjs:104`. Проверки: `gate.sh`, `forms`, `forms-a11y`,
   `paginate`, `capabilities`, `shikimori.mjs`.
5. `db-form` → `(app)/db-demo/`, модель → решение 3, `form-db.test.ts` → роут. Проверки:
   `gate.sh`, `db-demo` (5173), `db-demo-browser.check.mjs`.
6. `db-list` → `(app)/db-demo/`; импорты `/paginator` (`../db-demo/…`), `lib/server/db-list.ts`,
   `api/db-posts/+server.ts`. Проверки: `gate.sh`, `db-demo`, `paginate`, `url-storage.check.mjs`.
7. Ссылки и документы: README `lib/form` (стр. 309, 492), `paginate/filters` (161), `lib/db`,
   `db/PORTING.md`, `db/docs/LIVE-APPEND.md`; `docs/audit/ratings.md` — разделы
   `src/lib/ui/demo/*` → разделы роутов и модулей `components`; `lib-layout.md` — решение 3
   отменено этим планом; `move-paginator.md` «Не входит» — ссылка сюда. Исторические журналы
   (`crutches.md`, `framework-imports.md`, `kit3-upgrade.md`) не правим.
8. Папку `src/lib/demo` удалить; `grep -rn "lib/demo" src tooling test` → пусто (кроме журналов).
   Итог: `gate.sh`, сборка, `size-budget` (переезд размер не меняет — сверить), все браузерные
   наборы 4173 и 5173; пуш `upgrade/kit3`.

## Не входит

- Переделка кода демо (только перенос и пути): ~280 строк логики в `(app)/form/+page.svelte`,
  костыль C12 (`handle.ts` `expandFor`), F25 (универсальная панель) — как есть.
- `src/content/*` (кроме новой `posts.ts`) и `src/lib/server/*` — на месте.
- Переименование файлов (`handle.ts` → `handle.server.ts` и т. п.).
