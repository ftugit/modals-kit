<script lang="ts">
  import { report } from '$lib/app-errors.svelte'
  import { PaginatorHost, usePaginatorState } from '$lib/paginate/svelte'
  import {
    EmptyState,
    ErrorRow,
    LoadingIndicator,
    PageColumns,
    PageNav,
    PaginatorSettings,
    Skeleton,
    type SettingsField,
  } from '$lib/ui/paginator'
  import type { DemoItem } from '../../content/items'
  import {
    DEFAULT_GALLERY_EXTRA,
    GALLERY_EXTRA_SEARCH,
    GALLERY_NAME,
    GALLERY_PAGE_PARAM,
    GALLERY_PAGE_SIZES,
    ensureGalleryPaginator,
    galleryExtraOf,
    type GalleryExtra,
  } from './definition'
  import { shotHeight } from './item-views'
  import ShotTile from './ShotTile.svelte'
  import type { PaginatorState } from '$lib/paginate'

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

    <PaginatorHost
      {name}
      onError={report}
      pageParam={GALLERY_PAGE_PARAM}
      class="h-[360px] scroll-mt-20 overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-sm"
      ariaLabel="Галерея"
      {snapshot}
      extraSearch={GALLERY_EXTRA_SEARCH}
      pageSizes={GALLERY_PAGE_SIZES}
      extraDefaults={DEFAULT_GALLERY_EXTRA}
      mode="single"
      topTrigger="off"
      bottomTrigger="off"
    >
      {#snippet children()}
        {@render GalleryBody({ name })}
      {/snippet}
    </PaginatorHost>
  </div>
</section>

{#snippet GalleryBody({ name }: { name: string })}
  {@const pagState = usePaginatorState<DemoItem>(name)}
  {@const cfg = galleryExtraOf(pagState().extra)}

  <LoadingIndicator {name} />
  <EmptyState {name} />
  <PageColumns
    {name}
    columns={cfg.cols}
    columnWidth={160}
    stretch="25%"
    renderDivider={null}
  >
    {#snippet renderItem(item: DemoItem)}
      <ShotTile {item} prefix="g" />
    {/snippet}
    {#snippet renderSkeleton(ctx)}
      <Skeleton height={shotHeight(ctx.index + 1)} />
    {/snippet}
  </PageColumns>
  <ErrorRow {name} />
{/snippet}
