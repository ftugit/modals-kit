<script lang="ts">
  // Адрес здесь не читается и не пишется: страницу из `?page` / `?gallery` и навигацию
  // обслуживает URL-транспорт пагинатора, роутер ему отдаёт хост (канон: `bindsUrl`).
  import { PaginatorScope } from '$lib/paginate/svelte'
  import type { PaginatorState } from '$lib/paginate'
  import {
    DEFAULT_DEMO_CONFIG,
    GALLERY_NAME,
    demoName,
    ensureDemoPaginator,
    type DemoStore,
  } from './definition'
  import type { CatalogItem } from './item-views'
  import type { PaginatorLoaderData } from './types'
  import DemoPaginator from './DemoPaginator.svelte'
  import GalleryDemo from './GalleryDemo.svelte'

  interface Props {
    loaderData: PaginatorLoaderData
  }

  let { loaderData }: Props = $props()

  let storeKind = $state<DemoStore>(DEFAULT_DEMO_CONFIG.store)
  const activeName = $derived(ensureDemoPaginator(storeKind))
  const activeSnapshot = $derived.by<PaginatorState<CatalogItem> | null>(() =>
    storeKind === 'url' && activeName === loaderData.defaultName ? loaderData.snapshot : null
  )

</script>

<PaginatorScope
  snapshots={{
    [loaderData.defaultName]: loaderData.snapshot,
    [GALLERY_NAME]: loaderData.gallerySnapshot,
  }}
>
  <div class="py-10 sm:py-14">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display text-4xl font-semibold tracking-tight">Пагинатор</h1>
        <p class="mt-2 max-w-2xl text-muted-foreground">
          Headless-пагинация на Svelte 5 / SolidJS в духе TanStack: указатель и настройки в{' '}
          <code class="rounded bg-muted/70 px-1">?page</code>,{' '}
          <code class="rounded bg-muted/70 px-1">?page.size</code>,{' '}
          <code class="rounded bg-muted/70 px-1">?page.&lt;опция&gt;</code> (replace, без
          window-скролла) — как цепочка у модалок. Ссылкой можно поделиться: восстановится всё,
          включая раскладку и флаги. То же — через localStorage. Всё вокруг списка — отдельные
          компоненты из <code class="rounded bg-muted/70 px-1">ui/paginator</code>: уберите
          ненужные.
        </p>
        <p class="mt-2 max-w-2xl text-muted-foreground">
          Один пагинатор обслуживает три источника (опция «Источник данных»): локальные товары и
          фото и{' '}
          <b>живой каталог Shikimori</b> — прямые запросы к его API через бэкенд (серверный
          эндпоинт с кэшем и троттлингом, без выгрузки каталога). Поиск — два независимых слоя:
          родной поиск источника (<code class="rounded bg-muted/70 px-1">q</code> →{' '}
          <code class="rounded bg-muted/70 px-1">search</code> в API, работает без lib/search) и
          lib/search поверх него (fuzzy-ранжирование и коррекция опечаток). Обе опции — тумблеры
          демо-панели.
        </p>
      </div>
      <a
        href="/"
        class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        ← на главную
      </a>
    </div>

    <div class="mt-5">
      {#key activeName}
        {#if storeKind === 'url'}
          <DemoPaginator
            name={activeName}
            {storeKind}
            onStore={(s: DemoStore) => (storeKind = s)}
            url={{ snapshot: activeSnapshot }}
          />
        {:else}
          <DemoPaginator
            name={activeName}
            {storeKind}
            onStore={(s: DemoStore) => (storeKind = s)}
          />
        {/if}
      {/key}
    </div>

    <p class="mt-3 text-xs text-muted-foreground">
      paginator name: <code data-testid="current-name">{demoName(storeKind)}</code>
      {#if storeKind === 'url'}
        {' · настройки и страница: GET ?page, ?page.size, ?page.<опция> (replace)'}
      {:else if storeKind === 'local'}
        {' · настройки и страница: localStorage (переживает reload)'}
      {:else if storeKind === 'none'}
        {' · настройки и страница: память (сбрасываются при reload)'}
      {/if}
    </p>

    <GalleryDemo snapshot={loaderData.gallerySnapshot} />
  </div>
</PaginatorScope>
