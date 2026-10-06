# src/lib/paginate — headless-пагинация (SolidJS & Svelte 5)

Headless-библиотека пагинации с разделением framework-neutral ядра и тонких адаптеров для SolidJS и Svelte 5.
Ядро не зависит от фреймворков, DOM и роутера: `src/lib/paginate/` предоставляет чистые функции, контракты, хранилища, трекинг якорей и state machine.

## Возможности

- **Режимы**: `accumulate` (бесконечная лента / подгрузка по краям) и `single` (классическая постраничная навигация).
- **Хранилища и транспорт**: URL-состояние (`?page`, `?page.size`, `?page.<key>`), `localStorage`, `memoryStorage` и cursor-адаптер (`createCursorAdapter`).
- **Скролл и якоря**: Детект маркеров страниц через `IntersectionObserver` с гистерезисом, независимые зоны `topZone` / `bottomZone` (`edge`, `20%`, `40%`, `200px`), сохранение положения контента при prepend (`holdAbove` / CSS scroll anchoring).
- **Раскладки**: Чистая математика колонок (`computeColumns`, `distributeRoundRobin`, `runsOfColumn`, `pageWindow`).
- **Тонкие адаптеры**:
  - `src/lib/paginate/solid/` — SolidJS сигналы и JSX-биндинги.
  - `src/lib/paginate/svelte/` — Svelte 5 runes (`$state`, `$derived`, `$effect`) и компоненты со сниппетами.
- **Готовые UI-компоненты**: `src/lib/ui/paginator/` (`PageList`, `PageColumns`, `PageNav`, `PageLink`, `PaginatorSettings`, `LoadingIndicator`, `LoadMoreLink`, `EventLog` и др.).

## Быстрый старт

### Определение пагинатора

```ts
import { definePaginator, createUrlAdapter } from '$lib/paginate'

definePaginator({
  name: 'products',
  adapter: createUrlAdapter({
    name: 'products',
    pageParam: 'page',
    pageSize: 20,
    source: async ({ page, pageSize, extra }) => {
      const res = await fetch(`/api/products?page=${page}&size=${pageSize}`)
      return res.json()
    },
  }),
})
```

### Использование в Svelte 5

```svelte
<script lang="ts">
  import { PaginatorHost } from '$lib/paginate/svelte'
  import { PageList, PageNav, LoadingIndicator, LoadMoreLink } from '$lib/ui/paginator'
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

### Использование в SolidJS

```tsx
import { PaginatorHost } from '$lib/paginate/solid'
import { PageList, PageNav } from '$lib/ui/paginator'

function ProductsView() {
  return (
    <PaginatorHost name="products" class="h-[500px] overflow-y-auto">
      <PageList renderItem={(item) => <div>{item.title}</div>} />
      <PageNav />
    </PaginatorHost>
  )
}
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
  - `core.ts` — операции ядра (`initPaginator`, `goToPage`, `loadMore`, `setExtra`, `setPageSize` и др.).
- `src/lib/paginate/solid/` — SolidJS адаптер (`PaginatorHost`, `PageAnchor`, `EdgeSentinel`, хуки `usePaginator*`).
- `src/lib/paginate/svelte/` — Svelte 5 адаптер (`PaginatorHost`, `PageAnchor`, `EdgeSentinel`, хуки `usePaginator*`).
- `src/lib/ui/paginator/` — готовые UI-компоненты.
