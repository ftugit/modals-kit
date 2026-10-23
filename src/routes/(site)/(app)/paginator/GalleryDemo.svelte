<script lang="ts">
  import { report } from '#hooks/app-errors.svelte.js'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'
  import {
    PageNav,
    Paginator,
    PaginatorSettings,
    Skeleton,
    type SettingsField,
  } from '#components/paginator/index.js'
  import type { PaginatorState } from '#lib/paginate/index.js'
  import type { DemoItem } from '#content/demo-catalog/items/items.js'
  import {
    GALLERY_NAME,
    GALLERY_PAGE_SIZES,
    ensureGalleryPaginator,
    galleryExtraOf,
    type GalleryExtra,
  } from './definition'
  import { shotHeight } from '#content/demo-catalog/items/item-views.js'
  import ShotTile from '#content/demo-catalog/items/ui/ShotTile.svelte'

  const GALLERY_FIELDS: SettingsField<GalleryExtra>[] = [
    {
      key: 'cols',
      label: 'Колонки',
      type: 'select',
      parse: (raw) => (raw === 'auto' ? 'auto' : Number(raw)),
      options: [
        ['auto', 'Авто (160px ±25%)'],
        ['2', '2'],
        ['3', '3'],
      ],
    },
  ]

  interface Props {
    snapshot: PaginatorState<DemoItem>
  }

  let { snapshot }: Props = $props()

  const name = ensureGalleryPaginator()
  const pagState = usePaginatorState<DemoItem>(name)
  const cfg = $derived(galleryExtraOf(pagState().extra))
</script>

<section class="mt-12" data-testid="gallery-section">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="font-display text-2xl font-semibold tracking-tight">
        Второй пагинатор на той же странице
      </h2>
      <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
        Свой префикс — <code class="rounded bg-muted/70 px-1">?gallery</code>,{' '}
        <code class="rounded bg-muted/70 px-1">?gallery.size</code>,{' '}
        <code class="rounded bg-muted/70 px-1">?gallery.cols</code> — не пересекается с{' '}
        <code class="rounded bg-muted/70 px-1">?page.*</code>. Навигация и настройки стоят
        вне хоста и находят пагинатор по имени{' '}
        <code class="rounded bg-muted/70 px-1">{GALLERY_NAME}</code>.
      </p>
    </div>
    <div data-testid="gallery-nav">
      <PageNav {name} class="flex items-center gap-3" around={1} />
    </div>
  </div>

  <div class="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
    <PaginatorSettings
      {name}
      class="h-fit rounded-xl border border-border bg-card p-4 text-sm shadow-sm"
      pageSizes={GALLERY_PAGE_SIZES}
      fields={GALLERY_FIELDS}
      values={galleryExtraOf}
    >
      {#snippet footer(ctx)}
        Страница <b data-testid="gallery-page">{ctx.page}</b>, по{' '}
        <b data-testid="gallery-page-size">{ctx.pageSize}</b>.
      {/snippet}
    </PaginatorSettings>

    <Paginator
      {name}
      ariaLabel="Галерея"
      {snapshot}
      variant="card"
      class="h-[360px]"
      layout="columns"
      mode="single"
      columns={cfg.cols}
      columnWidth={160}
      stretch="25%"
      topTrigger="off"
      bottomTrigger="off"
      sentinel={false}
      replaceLoading="off"
      bottomNav={false}
      onError={report}
      renderDivider={null}
    >
      {#snippet renderItem(item: DemoItem)}
        <ShotTile {item} prefix="g" />
      {/snippet}
      {#snippet renderSkeleton(ctx)}
        <Skeleton height={shotHeight(ctx.index + 1)} />
      {/snippet}
    </Paginator>
  </div>
</section>
