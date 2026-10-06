<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { PaginatorScope } from '$lib/paginate/svelte'
  import type { MinimalRouter } from '$lib/paginate'
  import {
    DEFAULT_DEMO_CONFIG,
    GALLERY_NAME,
    demoName,
    ensureDemoPaginator,
    type DemoStore,
  } from './definition'
  import type { PaginatorLoaderData } from './loader'
  import DemoPaginator from './DemoPaginator.svelte'
  import GalleryDemo from './GalleryDemo.svelte'

  interface Props {
    loaderData: PaginatorLoaderData
  }

  let { loaderData }: Props = $props()

  let storeKind = $state<DemoStore>(DEFAULT_DEMO_CONFIG.store)
  const activeName = $derived(ensureDemoPaginator(storeKind))

  const router: MinimalRouter = {
    navigate: (opts: { search: (prev: Record<string, unknown>) => Record<string, unknown>; replace?: boolean }) => {
      const current = Object.fromEntries(page.url.searchParams)
      const next = opts.search(current)
      const nextParams = new URLSearchParams()
      for (const [k, v] of Object.entries(next)) {
        if (v != null) nextParams.set(k, String(v))
      }
      const qs = nextParams.toString() ? `?${nextParams.toString()}` : ''
      void goto(`${page.url.pathname}${qs}`, {
        replaceState: opts.replace ?? true,
        noScroll: true,
        keepFocus: true,
      })
    },
    currentSearch: () => Object.fromEntries(page.url.searchParams),
  }

  const externalPage = $derived.by(() => {
    const raw = page.url.searchParams.get('page')
    const n = Number(raw)
    return Number.isInteger(n) && n >= 1 ? n : null
  })

  const galleryExternalPage = $derived.by(() => {
    const raw = page.url.searchParams.get('gallery')
    const n = Number(raw)
    return Number.isInteger(n) && n >= 1 ? n : null
  })
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
            url={{
              snapshot: activeName === loaderData.defaultName ? loaderData.snapshot : null,
              externalPage,
            }}
            {router}
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

    <GalleryDemo
      snapshot={loaderData.gallerySnapshot}
      externalPage={galleryExternalPage}
      {router}
    />
  </div>
</PaginatorScope>
