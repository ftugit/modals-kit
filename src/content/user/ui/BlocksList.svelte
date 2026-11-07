<script lang="ts">
  /**
   * Список блокировок поверх `Listing`: один пользователь (`uid`) или журнал.
   *
   * «Добавить» открывает создание, если это разрешено. Нажатие на строку
   * открывает карточку записи: правка или чтение решает уже форма.
   */
  import { Listing } from '#components/listing/index.js'
  import { Skeleton } from '#components/paginator/index.js'
  import { Button } from '#components/ui/index.js'
  import { grants } from '#lib/db/index.js'
  import { useModalLink, type LinkAttrs } from '#hooks/links/index.js'
  import type { AuthErrorCode } from '../error.js'
  import { useGrants } from '../grants.svelte.js'
  import { block as blockResource } from '../schema.js'
  import type { BlockView } from '../types.js'
  import { vault } from '../vault.svelte.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
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
  }

  let {
    uid = null,
    initial = null,
    scope = null,
    url = undefined,
    onAcl,
    variant = 'plain',
    class: className,
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
  {rowAttrs}
  rowTestId="block-row"
  listTestId="blocks-list"
  pendingTestId="blocks-list-pending"
  identityKey={BLOCKS_INTERNAL_UID_KEY}
  actor={vault.principal}
  filters={{
    modal: 'user.blocks.filters',
    path: '/blocks/filters',
    query: fixedUid ? { uid: fixedUid } : undefined,
    keys: BLOCKS_FILTER_KEYS,
    defaults: BLOCKS_EXTRA_DEFAULTS,
    pageSize: BLOCKS_PAGE_SIZE,
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
  {#snippet item(row)}
    <BlockCard item={row} showTarget={!fixedUid} />
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
