<script lang="ts">
  /**
   * Список блокировок поверх `Listing`: один пользователь (`uid`) или журнал.
   *
   * «Добавить» открывает создание, если это разрешено. Нажатие на строку
   * открывает карточку записи: правка или чтение решает уже форма.
   */
  import { onDestroy, untrack } from 'svelte'
  import { browser } from '$app/env'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import type { SidebarPlace } from '#components/shell/index.js'
  import { Listing, ListingRow } from '#components/listing/index.js'
  import { Skeleton } from '#components/paginator/index.js'
  import { Button } from '#components/ui/index.js'
  import { grants } from '#lib/db/index.js'
  import { acquireScopedStore, getClientStore, getState, releaseScopedStore, setExtra } from '#lib/paginate/index.js'
    import { useModalLink, type LinkAttrs } from '#hooks/links/index.js'
  import { useSlotPaginatorScope } from '#hooks/modal-paginator.svelte.js'
  import type { AuthErrorCode } from '../error.js'
  import { useGrants } from '../grants.svelte.js'
  import { auth as authResource, block as blockResource } from '../schema.js'
  import type { BlockView } from '../types.js'
  import { vault } from '../vault.svelte.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
  import BlocksFiltersForm, { type BlocksFilterValues } from './BlocksFiltersForm.svelte'
  import { blocksFilterLabels, blocksFilterText } from './blocks-list/filters-form.js'
  import BlockCard from './blocks-list/BlockCard.svelte'
  import {
    BLOCKS_EXTRA_DEFAULTS,
    BLOCKS_FILTER_KEYS,
    BLOCKS_INTERNAL_UID_KEY,
    BLOCKS_NAME,
    BLOCKS_PAGE_PARAM,
    BLOCKS_PAGE_SIZE,
    ensureBlocksPaginator,
    type BlocksRouteData,
  } from './blocks-list/source.js'

  interface Props {
    /** Фиксированный целевой пользователь; пусто — глобальный список всех блокировок. */
    uid?: string | null
    /** Данные `load` роута от страницы или модалки-носителя. */
    initial?: BlocksRouteData | null
    /** Явный ключ изолированной области пагинатора (для немодальных стендов). */
    scope?: string | null
    /** Синхронизировать состояние пагинатора с адресной строкой. */
    url?: boolean
    /** Отказ доступа передаётся носителю для показа `Acl`. */
    onAcl?: (fact: AuthErrorCode) => void
    variant?: UserSurfaceVariant
    class?: string
    /** Зона sidebar. Страница передаёт, модалка — нет. */
    sidebar?: SidebarPlace
  }

  let {
    uid = null,
    initial = null,
    scope = null,
    url = undefined,
    onAcl,
    variant = 'plain',
    class: className,
    sidebar,
  }: Props = $props()

  ensureBlocksPaginator()

  const asModalLink = useModalLink()
  const fixedUid = $derived(uid?.trim() || null)
  const createBlockGrant = useGrants(grants(blockResource).insert)

  const route = $derived(fixedUid ? `/user/${encodeURIComponent(fixedUid)}/blocks` : '/blocks')
  const omitKeys = $derived(fixedUid ? [`${BLOCKS_PAGE_PARAM}.uids`] : [])

  const rowAttrs = (item: BlockView): LinkAttrs => ({
    ...asModalLink(
      'user.blocks.edit',
      fixedUid ? { blockId: item.id, uid: fixedUid } : { blockId: item.id },
    ),
    title: 'Открыть блокировку',
  })

  function filterUids(extra: Record<string, unknown>): string {
    if (fixedUid) return ''
    const selfId = vault.principal
    return String(extra.uids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((id) => Boolean(id) && id !== selfId)
      .join(',')
  }

  const sidebarZone = untrack(() => sidebar)
  const filterSlot = sidebarZone
    ? useSlotPaginatorScope(BLOCKS_NAME, untrack(() => (url === false ? { url: false } : undefined)))
    : undefined
  const filterScope = sidebarZone ? untrack(() => scope) : null
  const ownedScope = Boolean(sidebarZone && filterScope && !filterSlot?.store && browser)
  const filterStore = sidebarZone
    ? (filterSlot?.store ??
      (ownedScope && filterScope
        ? acquireScopedStore(filterScope)
        : browser
          ? getClientStore()
          : undefined))
    : undefined
  if (ownedScope && filterScope) onDestroy(() => releaseScopedStore(filterScope))
  const listFrom = $derived.by(() => {
    const url = visibleAddress().url
    return `${url.pathname}${url.search}`
  })
  let appliedValues = $state<BlocksFilterValues | null>(blocksFrom(untrack(() => initial)))
  let appliedKey = $state('')
  const gBlock = grants(blockResource)
  const gAuth = grants(authResource)
  const filterCaps = useGrants(
    {
      canSeeDeleted: gBlock.selectDeleted,
      canSeeLive: gBlock.select,
      canPickUsers: gAuth.select,
    },
    { ownerId: () => fixedUid },
  )
  const canSeeDeleted = $derived(
    vault.principal !== null ? filterCaps.canSeeDeleted : initial?.canSeeDeleted === true,
  )
  const canSeeLive = $derived(
    vault.principal !== null ? filterCaps.canSeeLive : initial?.canSeeLive !== false,
  )
  const canPickUsers = $derived(
    !fixedUid && (vault.principal !== null ? filterCaps.canPickUsers : initial?.canPickUsers === true),
  )

  function blocksFrom(data: BlocksRouteData | null): BlocksFilterValues | null {
    const snap = data?.snapshot
    if (!snap) return null
    return blockValues((snap.extra ?? {}) as Record<string, unknown>, snap.pageSize || BLOCKS_PAGE_SIZE)
  }

  function blockValues(extra: Record<string, unknown>, pageSize: number): BlocksFilterValues {
    const s = (key: string) => (typeof extra[key] === 'string' ? extra[key] : '')
    return {
      ord: s('ord') || 'created-desc',
      state: s('state') || 'all',
      scopes: s('scopes').split(',').map((part) => part.trim()).filter(Boolean),
      uids: s('uids').split(',').map((part) => part.trim()).filter(Boolean),
      size: pageSize || BLOCKS_PAGE_SIZE,
    }
  }

  $effect(() => {
    if (!filterStore) return
    const sync = () => {
      const state = getState<BlockView>(filterStore, BLOCKS_NAME)
      const extra = (state.extra ?? {}) as Record<string, unknown>
      const pageSize = state.pageSize || BLOCKS_PAGE_SIZE
      const values = blockValues(extra, pageSize)
      appliedValues = values
      appliedKey = [values.ord, values.state, values.scopes.join(','), values.uids.join(','), String(pageSize)].join('|')
    }
    sync()
    const unsub = filterStore.subscribe?.(BLOCKS_NAME, sync)
    return () => unsub?.()
  })

  function applyFilters(patch: Record<string, string | undefined>, pageSize: number) {
    if (!filterStore) return
    void setExtra(filterStore, BLOCKS_NAME, patch, { pageSize })
  }

  function resetFilters() {
    if (!filterStore) return
    void setExtra(
      filterStore,
      BLOCKS_NAME,
      { ord: undefined, state: undefined, scopes: undefined, uids: undefined },
      { pageSize: BLOCKS_PAGE_SIZE },
    )
  }

  function canCreate(payload: BlocksRouteData): boolean {
    return vault.principal !== null
      ? createBlockGrant.current && (!fixedUid || fixedUid !== vault.principal)
      : Boolean(payload.canCreate)
  }
</script>

<Listing
  name={BLOCKS_NAME}
  pageParam={BLOCKS_PAGE_PARAM}
  {route}
  {omitKeys}
  loadError="auth.expired"
  ariaLabel="Список блокировок"
  title={fixedUid ? 'Блокировки пользователя' : 'Блокировки'}
  {variant}
  class={className}
  {scope}
  {url}
  {initial}
  onAcl={onAcl ? (fact) => onAcl(fact as AuthErrorCode) : undefined}
  listTestId="blocks-list"
  pendingTestId="blocks-list-pending"
  identityKey={BLOCKS_INTERNAL_UID_KEY}
  actor={vault.principal}
  {sidebar}
  filters={{
    modal: 'user.blocks.filters',
    path: '/blocks/filters',
    query: fixedUid ? { uid: fixedUid } : undefined,
    keys: BLOCKS_FILTER_KEYS,
    defaults: BLOCKS_EXTRA_DEFAULTS,
    pageSize: BLOCKS_PAGE_SIZE,
    labels: blocksFilterLabels(),
    text: blocksFilterText,
    ignore: fixedUid ? ['uids'] : undefined,
    testId: 'blocks-filters-open',
    params: (extra) => {
      const picked = filterUids(extra)
      return {
        ...(fixedUid ? { uid: fixedUid } : {}),
        ...(!fixedUid && picked ? { uids: picked } : {}),
      }
    },
  }}
>
  {#snippet filtersForm()}
    {#if appliedValues}
      <div class="flex flex-col gap-3" data-testid="blocks-filters-sidebar">
        <h2 class="text-sm font-medium">Фильтры</h2>
        {#key `${appliedKey}:${canSeeDeleted}:${canSeeLive}:${canPickUsers}`}
          <BlocksFiltersForm
            uid={fixedUid}
            {canSeeDeleted}
            {canSeeLive}
            {canPickUsers}
            initial={appliedValues}
            from={listFrom}
            onApply={applyFilters}
            onReset={resetFilters}
          />
        {/key}
      </div>
    {/if}
  {/snippet}
  {#snippet controls({ extra, payload })}
    {#if canCreate(payload as BlocksRouteData)}
      {@const picked = filterUids(extra)}
      <Button
        {...asModalLink(
          'user.blocks.create',
          fixedUid ? { uid: fixedUid } : picked ? { uids: picked } : {},
        )}
        size="sm"
        data-testid="blocks-add-button"
      >
        Добавить
      </Button>
    {/if}
  {/snippet}
  {#snippet row(item)}
    <ListingRow attrs={rowAttrs(item)} id={item.id} testId="block-row">
      <BlockCard item={item} showTarget={!fixedUid} />
    </ListingRow>
  {/snippet}
  {#snippet skeleton()}
    <div class="flex w-full items-center gap-3 px-2 py-2" data-testid="block-skeleton">
      <Skeleton class="h-4 min-w-0 flex-1 basis-0" />
      <Skeleton class="h-4 w-16 shrink-0" />
      <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
      <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
    </div>
  {/snippet}
</Listing>
