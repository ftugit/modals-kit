<script lang="ts">
  /**
   * Список блокировок (`user.block`): работает и для конкретного пользователя
   * (`uid` задан — `/user/[id]/blocks` или модалка `user.blocks` из профиля),
   * и как глобальный журнал (`/blocks`).
   *
   * Кнопка «Добавить» рядом со списком открывает `BlockForm` в режиме создания
   * (при наличии `canCreate`). Нажатие на любую строку открывает `BlockForm`
   * для этой записи: пишущие акторы правят разрешённые поля, читатели
   * открывают карточку без возможности отправки (`canSubmit = false`).
   */
  import { preloadData } from '$app/navigation'
  import { onDestroy, untrack } from 'svelte'
  import { grants } from '#lib/db/index.js'
  import { Paginator, Skeleton } from '#components/paginator/index.js'
  import { useModalLink, type LinkAttrs } from '#hooks/links/index.js'
  import { useSlotPaginatorScope } from '#hooks/modal-paginator.svelte.js'
  import { Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import {
    acquireScopedStore,
    createPaginatorStore,
    getClientStore,
    releaseScopedStore,
  } from '#lib/paginate/index.js'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
  import { PaginatorScope, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import type { AuthErrorCode } from '../error.js'
  import { useGrants } from '../grants.svelte.js'
  import { block as blockResource } from '../schema.js'
  import type { BlockView } from '../types.js'
  import { vault } from '../vault.svelte.js'
  import { userSurfaceVariants, type UserSurfaceVariant } from './Acl.svelte'
  import BlockCard from './blocks-list/BlockCard.svelte'
  import {
    BLOCKS_EXTRA_DEFAULTS,
    BLOCKS_FILTER_KEYS,
    BLOCKS_NAME,
    BLOCKS_PAGE_PARAM,
    BLOCKS_PAGE_SIZE,
    ensureBlocksPaginator,
    type BlocksRouteData,
  } from './blocks-list/source.js'

  interface Props {
    /** Фиксированный целевой пользователь; пусто — глобальный список всех блокировок. */
    uid?: string | null
    /** Данные `load` роута от страницы или модалки-носителя (SSR/no-JS/useLoader). */
    initial?: BlocksRouteData | null
    /**
     * Явный ключ изолированной области пагинатора (для немодальных стендов).
     * Внутри модалки область и URL-префикс (`m<k>.*`) выделяются автоматически
     * через `useSlotPaginatorScope`.
     */
    scope?: string | null
    /** Синхронизировать состояние пагинатора с адресной строкой. */
    url?: boolean
    /** Отказ доступа передаётся носителю для показа `Acl`. */
    onAcl?: (fact: AuthErrorCode) => void
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    uid = null,
    initial = null,
    scope = null,
    url: urlProp,
    onAcl,
    variant = 'plain',
    class: className,
  }: Props = $props()

  ensureBlocksPaginator()

  const slotScope = useSlotPaginatorScope(
    BLOCKS_NAME,
    untrack(() => (urlProp === false ? { url: false } : undefined)),
  )
  const effectivePaginatorUrl = $derived(urlProp !== undefined ? urlProp : slotScope.paginatorUrl)

  const asModalLink = useModalLink()
  const fixedUid = $derived(uid?.trim() || null)

  let data = $state<BlocksRouteData | null>(untrack(() => initial))
  let lastFetchKey = ''

  $effect(() => {
    const targetUid = fixedUid
    const searchSnap = currentSearch()

    if (initial) {
      data = initial
      if (initial.fact) onAcl?.(initial.fact)
      return
    }

    const sp = new URLSearchParams()
    if (effectivePaginatorUrl !== false) {
      for (const [k, v] of Object.entries(searchSnap)) {
        if (k === BLOCKS_PAGE_PARAM || k.startsWith(`${BLOCKS_PAGE_PARAM}.`)) {
          if (!targetUid || k !== `${BLOCKS_PAGE_PARAM}.uids`) sp.set(k, String(v))
        }
      }
    }
    const base = targetUid ? `/user/${encodeURIComponent(targetUid)}/blocks` : '/blocks'
    const targetUrl = sp.size ? `${base}?${sp.toString()}` : base
    if (lastFetchKey === targetUrl) return
    lastFetchKey = targetUrl

    void (async () => {
      const r = await preloadData(targetUrl)
      if (lastFetchKey !== targetUrl) return
      if (r.type !== 'loaded') {
        onAcl?.('auth.expired')
        return
      }
      const d = r.data as BlocksRouteData
      if (d.fact) {
        onAcl?.(d.fact)
        return
      }
      data = d
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

  const pagState = usePaginatorState<BlockView>(BLOCKS_NAME, store)
  const hasLivePages = $derived(
    Object.keys(pagState().pages).length > 0 || pagState().status !== 'idle' || pagState().reqId > 0,
  )
  const liveExtra = $derived(hasLivePages ? pagState().extra : (snapshot?.extra ?? pagState().extra))
  const livePageSize = $derived(
    hasLivePages ? pagState().pageSize : (snapshot?.pageSize ?? pagState().pageSize),
  )

  const createBlockGrant = useGrants(grants(blockResource).insert)
  const canCreate = $derived(
    vault.principal !== null
      ? createBlockGrant.current && (!fixedUid || fixedUid !== vault.principal)
      : Boolean(data?.canCreate),
  )

  const filterUids = $derived.by(() => {
    if (fixedUid) return ''
    const raw = String(liveExtra?.uids ?? '')
    const selfId = vault.principal
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((id) => Boolean(id) && id !== selfId)
      .join(',')
  })

  const activeFilters = $derived(
    BLOCKS_FILTER_KEYS.filter((k) => {
      if (fixedUid && k === 'uids') return false
      const v = liveExtra?.[k]
      const fallback = (BLOCKS_EXTRA_DEFAULTS as Record<string, string>)[k]
      return typeof v === 'string' && v !== '' && v !== fallback
    }).length + (livePageSize !== BLOCKS_PAGE_SIZE ? 1 : 0),
  )

  const totalItems = $derived(
    hasLivePages ? (pagState().totalItems ?? snapshot?.totalItems) : snapshot?.totalItems,
  )

  const filtersHref = $derived.by(() => {
    const qs = new URLSearchParams(
      Object.entries(currentSearch()).map(([k, v]) => [k, String(v)] as [string, string]),
    )
    const from = currentPathname() + (qs.size ? `?${qs}` : '')
    const fqs = new URLSearchParams({ from })
    if (fixedUid) fqs.set('uid', fixedUid)
    return `/blocks/filters?${fqs.toString()}`
  })

  const rowAttrs = (item: BlockView): LinkAttrs => ({
    ...asModalLink(
      'user.blocks.edit',
      fixedUid ? { blockId: item.id, uid: fixedUid } : { blockId: item.id },
    ),
    title: 'Открыть блокировку',
  })
</script>

{#if snapshot}
  <PaginatorScope {store} snapshots={{ [BLOCKS_NAME]: snapshot }}>
    <section class={cn('flex min-h-0 flex-col', userSurfaceVariants({ variant }), className)} data-testid="blocks-list">
      <div class="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div class="flex items-baseline gap-2">
          <h2 class="text-lg font-semibold leading-tight tracking-tight">
            {fixedUid ? 'Блокировки пользователя' : 'Блокировки'}
          </h2>
          <span class="text-xs text-muted-foreground">всего: {totalItems ?? '—'}</span>
        </div>

        <div class="flex items-center gap-2">
          {#if canCreate}
            <Button
              {...asModalLink(
                'user.blocks.create',
                fixedUid ? { uid: fixedUid } : filterUids ? { uids: filterUids } : {},
              )}
              size="sm"
              data-testid="blocks-add-button"
            >
              Добавить
            </Button>
          {/if}
          <Button
            {...asModalLink(
              'user.blocks.filters',
              {
                ...(fixedUid ? { uid: fixedUid } : {}),
                ...(!fixedUid && filterUids ? { uids: filterUids } : {}),
              },
              { href: filtersHref },
            )}
            variant="outline"
            size="sm"
            data-testid="blocks-filters-open"
          >
            Фильтры{#if activeFilters}&nbsp;({activeFilters}){/if}
          </Button>
        </div>
      </div>

      <Paginator
        name={BLOCKS_NAME}
        ariaLabel="Список блокировок"
        {snapshot}
        url={effectivePaginatorUrl}
        mode="accumulate"
        topTrigger="direction"
        bottomTrigger="direction"
        topZone="40%"
        bottomZone="40%"
        renderDivider={null}
        class={variant === 'plain' && slotScope.store !== null ? 'min-h-0 flex-1' : 'max-h-[420px]'}
      >
        {#snippet renderItem(item: BlockView)}
          <a
            {...rowAttrs(item)}
            class="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="block-row"
            data-id={item.id}
          >
            <BlockCard {item} showTarget={!fixedUid} />
          </a>
        {/snippet}
        {#snippet renderSkeleton()}
          <div class="flex w-full items-center gap-3 px-2 py-2" data-testid="block-skeleton">
            <Skeleton class="h-4 min-w-0 flex-1 basis-0" />
            <Skeleton class="h-4 w-16 shrink-0" />
            <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
            <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
          </div>
        {/snippet}
      </Paginator>
    </section>
  </PaginatorScope>
{:else}
  <section class={cn(userSurfaceVariants({ variant }), className)} aria-busy="true" data-testid="blocks-list-pending">
    <div class="mb-4 flex items-baseline justify-between gap-3">
      <h2 class="text-lg font-semibold leading-tight tracking-tight">
        {fixedUid ? 'Блокировки пользователя' : 'Блокировки'}
      </h2>
      <span class="text-xs text-muted-foreground">всего: —</span>
    </div>
    <div class="flex flex-col gap-2">
      {#each [0, 1, 2] as i (i)}
        <Skeleton class="h-9 w-full" />
      {/each}
    </div>
  </section>
{/if}
