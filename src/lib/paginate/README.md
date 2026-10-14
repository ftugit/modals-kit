# src/lib/paginate — headless-пагинация (Svelte 5)

Headless-библиотека пагинации с разделением framework-neutral ядра и тонкого адаптера движка (сейчас — Svelte 5; адаптер SolidJS удалён в аудите, C9, будет написан заново).
Ядро не зависит от фреймворков, DOM и роутера: `src/lib/paginate/` предоставляет чистые функции, контракты, хранилища, трекинг якорей и state machine.

## Возможности

- **Режимы**: `accumulate` (бесконечная лента / подгрузка по краям) и `single` (классическая постраничная навигация).
- **Хранилища и транспорт**: URL-состояние (`?page`, `?page.size`, `?page.<key>`), `localStorage`, `memoryStorage` и cursor-адаптер (`createCursorAdapter`).
- **Скролл и якоря**: Детект маркеров страниц через `IntersectionObserver` с гистерезисом, независимые зоны `topZone` / `bottomZone` (`edge`, `20%`, `40%`, `200px`), сохранение положения контента при prepend (`holdAbove` / CSS scroll anchoring).
- **Раскладки**: Чистая математика колонок (`computeColumns`, `distributeRoundRobin`, `runsOfColumn`, `pageWindow`).
- **Слой источника — единственный вход данных**: пагинатор принимает только
  АДАПТИРОВАННЫЙ источник (`defineSource` + декораторы; см. `source.ts`).
  Источник объявляет возможности (`search`, `scan`, `filters`, `totals`) и
  паспорт записи (`id`/`title`/`texts`); пагинатор отдаёт возможности UI
  (`state.capabilities`), и интерфейс гасит то, чего у источника нет.
  Объект, эмулирующий api слоя, не принимается — нужен бренд слоя.
- **Несколько источников под одним пагинатором** (`composeSources`, выбор по ключу
  extra): смена источника сбрасывает выдачу как смену страницы — ядро ставит
  страницу 1 и снимает запрос и фильтры (`q`, `filters.*` любого варианта), иначе
  они остались бы в адресе без поля, которым их снять. Ключи потребителя (раскладка,
  тумблеры) остаются; ключ, пришедший в том же `setExtra`, тоже:
  ```ts
  setExtra(store, name, { src: 'rm-rest' })                       // q и фильтры сняты
  setExtra(store, name, { src: 'rm-rest', 'filters.status': 'alive' }) // сразу с фильтром
  ```
- **Локальные правки окна без запроса** (`patchItems`, аналог `setQueryData` в TanStack):
  своя форма уже получила строку от сервера — окно правится на месте, счётчики
  сдвигаются, выдача не перезагружается и позиция не теряется.
  ```ts
  const actions = usePaginatorActions('posts')
  actions.patchItems<Post>({ insert: created, at: 'head' }) // новые сверху: в голову страницы 1
  actions.patchItems<Post>({ update: edited })              // та же запись (по id) на месте
  actions.patchItems<Post>({ remove: id })                  // убрать из окна, total − 1
  ```
  Окно меняется, только если место записи в нём загружено (голова — страница 1, хвост —
  `hasNext === false`); постраничный режим держит размер страницы. Вызвавший ручается, что
  запись проходит фильтр текущей выдачи: ядро фильтр источника не исполняет. Запись
  узнаётся по паспорту источника (`adapter.recordFor(extra).id` — URL-, local- и
  cursor-адаптеры пробрасывают его из источника); без паспорта правка отказывает.
- **Ядро — 1-в-1 с исходником** (`SolidHono`, `src/lib/paginate/`): `core.ts`, `types.ts`, реестр и конфиг держат ту же семантику и тот же набор опций (`maxPages`, `reloadKeys`), поэтому «загрузка видна» обеспечивается источником, а не надстройками: в исходнике данные идут по сети, в порте демо-источник моделирует ту же транспортную задержку (`DEMO_TRANSPORT_MS` в `src/content/items.ts`), и скелетоны/плавающий индикатор живут столько же, сколько занял бы реальный запрос.
- **Тонкий адаптер**:
  - `src/lib/paginate/svelte/` — Svelte 5 runes (`$state`, `$derived`, `$effect`) и компоненты со сниппетами.
- **Адрес принадлежит транспорту, не хосту**: URL-ветку включает сам адаптер (у него есть `setRouter`/`observeExternal` — канон: `bindsUrl`), хост лишь отдаёт ему роутер адаптера пакета (`src/lib/paginate/sveltekit/router.ts`; адрес пишет общий писатель `#lib/address`) и реактивный срез поиска. У адаптеров без адреса (local/memory) этих методов нет, и хост адрес не читает вовсе — переключение хранилища не рождает гибрид «страница из storage, фильтры из URL». Ключи адреса хост берёт у адаптера (`searchSpec`), поэтому спецификация не живёт в двух местах.
- **Готовые UI-компоненты**: `src/lib/components/paginator/` (`PageList`, `PageColumns`, `PageNav`, `PageLink`, `PaginatorSettings`, `LoadingIndicator`, `LoadMoreLink`, `EventLog` и др.) и хук поиска без разметки `usePaginatorSearch`.

## Быстрый старт

### Определение пагинатора

```ts
import { defineSource, definePaginator, createUrlAdapter } from '#lib/paginate/index.js'

// Источник: данные + паспорт записи + объявленные возможности.
const products = defineSource<Product>({
  name: 'products',
  record: { id: (r) => String(r.id), title: (r) => r.title, texts: (r) => [r.title] },
  scan: {},        // paginate/search может сканировать (fuzzy по названию)
  totals: true,    // источник отдаёт число страниц
  data: async ({ page, pageSize, signal }) => {
    const res = await fetch(`/api/products?page=${page}&size=${pageSize}`, { signal })
    return res.json()
  },
})

definePaginator({
  name: 'products',
  adapter: createUrlAdapter({
    name: 'products',
    pageParam: 'page',
    pageSize: 20,
    source: products,
    extraSearch: {},          // ключи потребителя (?page.<key>) — deny-safe
  }),
})
```

### Использование в Svelte 5

```svelte
<script lang="ts">
  import { PaginatorHost } from '#lib/paginate/svelte/index.js'
  import { PageList, PageNav, LoadingIndicator, LoadMoreLink } from '#lib/components/paginator/index.js'
</script>

<PaginatorHost name="products" class="h-[500px] overflow-y-auto">
  <LoadingIndicator />
  <LoadMoreLink dir={-1} />
  
  <PageList>
    {#snippet renderItem(item)}
      <div>{item.title}</div>
    {/snippet}
  </PageList>

  <LoadMoreLink dir={1} />
  <PageNav />
</PaginatorHost>
```

## Структура библиотеки

- `src/lib/paginate/` — framework-neutral ядро:
  - `types.ts` — контракты и типы данных.
  - `pure.ts` — чистые функции вычисления метаданных и списков.
  - `layout.ts` — чистая геометрия и распределение колонок.
  - `anchors.ts` — трекер маркеров страниц и сентинелов на базе IntersectionObserver.
  - `storage.ts` — хранилища memory / localStorage с deny-safe валидацией.
  - `adapter-url.ts` — URL-адаптер с типизированными `extraField`.
  - `adapter-local.ts` — local storage адаптер.
  - `adapter-cursor.ts` — opaque cursor-адаптер.
  - `store.ts` — vanilla Store с поддержкой SSR и гидрации.
  - `registry.ts` — реестр экземпляров пагинаторов по имени.
  - `core.ts` — операции ядра (`initPaginator`, `goToPage`, `loadMore`, `setExtra`, `setPageSize`, `patchItems` и др.).
- `src/lib/paginate/search/` — поиск поверх источника (fuzzy-сканирование, словарь
  терминов, коррекция опечаток, статистика перехвата): `#lib/paginate/search/index.js`.
  Часть пакета, но отдельный вход — ядро пагинатора его не тянет. Документация —
  [`search/README.md`](./search/README.md).
- `src/lib/paginate/filters/` — фильтры источника: схема → форма `lib/form`, ключи адреса
  `?page.filters.*`, связки и серверная проверка, картина панели (`#lib/paginate/filters/index.js`).
  Единственная связь с другим пакетом — `lib/form`. Документация — [`filters/README.md`](./filters/README.md).
- `src/lib/paginate/svelte/` — Svelte 5 адаптер (`PaginatorHost`, `PageAnchor`, `EdgeSentinel`, хуки `usePaginator*`);
  `svelte/search/` — хуки поиска (`useSearchCorrection`, `useSearchStats`).
- `src/lib/components/paginator/` — готовые UI-компоненты (UI не часть пакета: переносится только логика).
