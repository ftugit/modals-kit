<script lang="ts" generics="T extends { id: string }">
  /**
   * Экран списка. Не знает модель, карточку и поля фильтров.
   *
   * Умеет с первого дня то, что списки каждый раз собирали заново:
   * одна дверь данных (`initial` или `preloadData` одного роута), строка
   * всегда ссылка, кнопка фильтров со счётом, поиск только если его
   * передали. Кнопка фильтров и поиск стоят на фиксированных местах.
   * `Acl` не рисует.
   */
  import { preloadData } from '$app/navigation'
  import { onDestroy, untrack } from 'svelte'
  import { Paginator, SearchBar, Skeleton } from '#components/paginator/index.js'
  import { DEV } from 'esm-env'
  import { tryUsePage } from '#components/shell/index.js'
  import { Button, Surface } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { useIsMobile } from '#hooks/mobile.svelte.js'
  import { useSlotPaginatorScope } from '#hooks/modal-paginator.svelte.js'
  import {
    acquireScopedStore,
    createPaginatorStore,
    getClientStore,
    getState,
    invalidatePaginator,
    releaseScopedStore,
    replacePaginatorSnapshot,
    type PaginatorState,
  } from '#lib/paginate/index.js'
  import { PaginatorScope, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
  import { filtersUseSidebar } from './sidebar.js'
  import type { ListingInitial, ListingProps } from './types.js'

  const lastActor = new Map<string, string | null | undefined>()

  interface Props extends ListingProps<T> {}

  let {
    name,
    pageParam,
    route,
    watch = 'href',
    omitKeys = [],
    loadError = 'load.error',
    ariaLabel,
    title,
    variant = 'plain',
    class: className,
    scope = null,
    url: urlProp,
    initial = null,
    onAcl,
    rowAttrs,
    isSelected,
    rowTestId,
    listTestId,
    pendingTestId,
    filters,
    sidebar,
    filtersForm,
    search,
    identityKey,
    actor,
    item,
    skeleton,
    controls: extraControls,
  }: Props = $props()

  // Имя пагинатора не меняется за жизнь экземпляра: регистрация и стор смотрят в него один раз.
  const paginatorName = untrack(() => name)
  // Реестр слота, не догадка «модалка или страница». Носитель задаёт `sidebar`.
  const page = tryUsePage()
  const narrow = useIsMobile()
  const inSidebar = $derived(filtersUseSidebar(sidebar, narrow.matches) && Boolean(filtersForm) && Boolean(page))
  let warnedNoPage = false
  let releaseSidebar: (() => void) | undefined

  // Слот ставится сразу, не из эффекта: на сервере эффекта нет, а форма
  // обязана быть в HTML. Снятие — когда useIsMobile станет true.
  function placeSidebar() {
    releaseSidebar?.()
    releaseSidebar = undefined
    const zone = sidebar
    const show = filtersUseSidebar(zone, narrow.matches)
    if (!zone || !show) return
    if (!page) {
      if (DEV && !warnedNoPage) {
        warnedNoPage = true
        console.warn('[listing] sidebar: нет контекста страницы, остаётся кнопка')
      }
      return
    }
    const form = filtersForm
    if (!form) return
    releaseSidebar = page.registerSidebarSlot(zone, form)
  }
  placeSidebar()
  $effect(() => {
    void sidebar
    void narrow.matches
    void filtersForm
    placeSidebar()
    return () => {
      releaseSidebar?.()
      releaseSidebar = undefined
    }
  })

  $effect(() => {
    const current = actor
    if (current === undefined) return
    const prev = lastActor.has(paginatorName) ? lastActor.get(paginatorName) : undefined
    if (!lastActor.has(paginatorName)) {
      lastActor.set(paginatorName, current)
      return
    }
    if (prev !== current) {
      lastActor.set(paginatorName, current)
      untrack(() => {
        void invalidatePaginator(paginatorName)
      })
    }
  })

  const slotScope = useSlotPaginatorScope(
    paginatorName,
    untrack(() => (urlProp === false ? { url: false } : undefined)),
  )
  const effectiveUrl = $derived(urlProp !== undefined ? urlProp : slotScope.paginatorUrl)
  const asModalLink = useModalLink()
  const listFrom = $derived.by(() => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(currentSearch())) {
      if (v != null && v !== '') sp.set(k, String(v))
    }
    const qs = sp.toString()
    return qs ? `${route}?${qs}` : route
  })

  let data = $state<ListingInitial<T> | null>(untrack(() => initial))
  let asked: string | null = null

  function buildHref(): string {
    const sp = new URLSearchParams()
    if (effectiveUrl !== false) {
      const skip = new Set(omitKeys)
      for (const [k, v] of Object.entries(currentSearch())) {
        if ((k === pageParam || k.startsWith(`${pageParam}.`)) && !skip.has(k)) sp.set(k, String(v))
      }
    }
    return sp.size ? `${route}?${sp}` : route
  }

  $effect(() => {
    if (initial) {
      data = initial
      asked = null
      if (initial.fact) onAcl?.(initial.fact)
      return
    }
    const token =
      watch === 'href' || effectiveUrl === false
        ? buildHref()
        : String(currentSearch()[`${pageParam}.${watch}`] ?? '')
    const target = buildHref()
    if (asked === token) return
    asked = token
    void (async () => {
      const r = await preloadData(target)
      if (asked !== token) return
      if (r.type !== 'loaded') {
        onAcl?.(loadError)
        return
      }
      const loaded = r.data as ListingInitial<T>
      if (loaded.fact) {
        onAcl?.(loaded.fact)
        return
      }
      data = loaded
    })()
  })

  const snapshot = $derived(data?.snapshot ?? null)

  const scopeKey = untrack(() => (slotScope.store ? null : scope))
  const store = untrack(() =>
    slotScope.store
      ? slotScope.store
      : scopeKey
        ? acquireScopedStore(scopeKey)
        : typeof window === 'undefined'
          ? createPaginatorStore()
          : getClientStore(),
  )
  if (scopeKey) onDestroy(() => releaseScopedStore(scopeKey))

  function switchIdentity(next: PaginatorState<T> | null) {
    if (!identityKey || !next || !store.isHydrated(paginatorName)) return
    const previous = getState(store, paginatorName).extra[identityKey] ?? null
    const incoming = next.extra[identityKey] ?? null
    if (previous !== incoming) replacePaginatorSnapshot(store, paginatorName, next)
  }
  switchIdentity(untrack(() => snapshot))
  $effect.pre(() => {
    switchIdentity(snapshot)
  })

  const pagState = usePaginatorState<T>(paginatorName, store)
  const hasLivePages = $derived(
    Object.keys(pagState().pages).length > 0 || pagState().status !== 'idle' || pagState().reqId > 0,
  )
  const liveExtra = $derived(hasLivePages ? pagState().extra : (snapshot?.extra ?? pagState().extra))
  const livePageSize = $derived(hasLivePages ? pagState().pageSize : (snapshot?.pageSize ?? pagState().pageSize))
  const extraRecord = $derived((liveExtra ?? {}) as Record<string, unknown>)
  const totalItems = $derived(hasLivePages ? (pagState().totalItems ?? snapshot?.totalItems) : snapshot?.totalItems)

  const activeFilters = $derived(
    filters
      ? filters.keys.filter((k) => {
          if (filters.ignore?.includes(k)) return false
          const v = extraRecord[k]
          return typeof v === 'string' && v !== '' && v !== filters.defaults[k]
        }).length + (livePageSize !== filters.pageSize ? 1 : 0)
      : 0,
  )

  const filtersHref = $derived.by(() => {
    if (!filters) return ''
    const qs = new URLSearchParams(Object.entries(currentSearch()).map(([k, v]) => [k, String(v)] as [string, string]))
    const from = currentPathname() + (qs.size ? `?${qs}` : '')
    const fqs = new URLSearchParams({ from })
    for (const [k, v] of Object.entries(filters.query ?? {})) {
      if (v) fqs.set(k, v)
    }
    return `${filters.path}?${fqs}`
  })

  const filterParams = $derived.by(() => {
    if (!filters?.params) return {}
    return typeof filters.params === 'function' ? filters.params(extraRecord) : filters.params
  })

  const showFilters = $derived(Boolean(filters))
  const hasControls = $derived(Boolean(extraControls) || showFilters)
</script>

{#snippet filtersButton()}
  {#if filters}
    <Button
      {...asModalLink(filters.modal, filterParams, { href: filtersHref })}
      variant="outline"
      size="sm"
      class="shrink-0"
      data-testid={filters.testId}
    >
      Фильтры{#if activeFilters}&nbsp;({activeFilters}){/if}
    </Button>
  {/if}
{/snippet}

{#snippet heading(total: number | undefined)}
  <h2 class="text-lg font-semibold leading-tight tracking-tight">{title}</h2>
  <span class="text-xs text-muted-foreground">всего: {total ?? '—'}</span>
{/snippet}

{#snippet bar()}
  {#if extraControls && data}
    {@render extraControls({ extra: extraRecord, payload: data })}
  {/if}
  {#if showFilters && !inSidebar}
    {@render filtersButton()}
  {/if}
{/snippet}

{#if snapshot}
  <PaginatorScope {store} snapshots={{ [name]: snapshot }}>
    <Surface
      {variant}
      class={cn('min-h-0', className)}
      title={headingTitle}
      controls={hasControls ? bar : undefined}
      data-testid={listTestId}
    >
      {#if search}
        <SearchBar
          name={paginatorName}
          pageParam={pageParam}
          from={listFrom}
          query={typeof extraRecord.q === 'string' ? extraRecord.q : ''}
          label={search.label(extraRecord)}
          placeholder={search.placeholder(extraRecord)}
        />
      {/if}
      <Paginator
        name={paginatorName}
        {ariaLabel}
        {snapshot}
        url={effectiveUrl}
        mode="accumulate"
        topTrigger="direction"
        bottomTrigger="direction"
        topZone="40%"
        bottomZone="40%"
        renderDivider={null}
        class={variant === 'plain' && slotScope.store !== null ? 'min-h-0 flex-1' : 'max-h-[420px]'}
      >
        {#snippet renderItem(row: T)}
          <a
            {...rowAttrs(row)}
            class="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={rowTestId}
            data-id={row.id}
            data-selected={isSelected?.(row.id) || undefined}
          >
            {@render item(row, isSelected?.(row.id) ?? false)}
          </a>
        {/snippet}
        {#snippet renderSkeleton()}
          {#if skeleton}
            {@render skeleton(extraRecord)}
          {:else}
            <Skeleton class="h-9 w-full" />
          {/if}
        {/snippet}
      </Paginator>
    </Surface>
  </PaginatorScope>
{:else}
  <Surface {variant} class={className} data-testid={pendingTestId} aria-busy="true">
    {#snippet title()}
      {@render heading(undefined)}
    {/snippet}
    <div class="flex flex-col gap-2">
      {#each [0, 1, 2] as i (i)}
        <Skeleton class="h-9 w-full" />
      {/each}
    </div>
  </Surface>
{/if}

{#snippet headingTitle()}
  {@render heading(totalItems ?? undefined)}
{/snippet}
