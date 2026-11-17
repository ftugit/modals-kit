<script lang="ts">
  import { Listing, ListingRow } from '#core/ui/listing/index.js'
  import { Skeleton } from '#core/ui/paginator/index.js'
  import { useModalLink, type LinkAttrs } from '#core/hooks/links/index.js'
  import type { AuthErrorCode } from '#modules/user/base/model/error.js'
  import { profilesListRoute } from '#modules/user/base/routes.js'
  import type { UserSurfaceVariant } from '#modules/user/base/svelte/Acl.svelte'
  import type { ProfileListView } from '#modules/user/profile/model/types.js'
  import {
    ensureProfilesPaginator,
    PROFILES_EXTRA_DEFAULTS,
    PROFILES_NAME,
    PROFILES_PAGE_PARAM,
    PROFILES_PAGE_SIZE,
    profilesSnapshot,
    type ProfilesRouteData,
  } from './profiles/source.js'

  interface Props {
    initial?: ProfilesRouteData | null
    scope?: string | null
    url?: boolean
    onAcl?: (fact: AuthErrorCode) => void
    rowAttrs?: (p: ProfileListView) => LinkAttrs
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    initial = null,
    scope = null,
    url = undefined,
    onAcl,
    rowAttrs,
    variant = 'plain',
    class: className,
  }: Props = $props()

  ensureProfilesPaginator()

  const asModalLink = useModalLink()
  const attrsOf = (p: ProfileListView): LinkAttrs =>
    rowAttrs?.(p) ?? { ...asModalLink('user.profile', { id: p.id }), title: 'Открыть профиль' }
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' })
</script>

<Listing
  name={PROFILES_NAME}
  pageParam={PROFILES_PAGE_PARAM}
  route={profilesListRoute.href()}
  loadError="auth.expired"
  ariaLabel="Список профилей"
  title="Профили"
  {variant}
  class={className}
  {scope}
  {url}
  {initial}
  onAcl={onAcl ? (fact) => onAcl(fact as AuthErrorCode) : undefined}
  pendingTestId="profiles-pending"
  search={{
    label: () => 'Поиск по никнейму',
    placeholder: () => 'Подстрока никнейма…',
  }}
>
  {#snippet row(p: ProfileListView, ctx)}
    <ListingRow attrs={attrsOf(p)} id={p.id} testId="profile-row" selected={ctx.selected}>
      <div class="flex items-center gap-3">
        {#if p.avatarUrl}
          <img src={p.avatarUrl} alt="" class="size-8 rounded-full object-cover" />
        {/if}
        <div class="flex flex-col">
          <span class="font-medium">{p.nickname ?? '—'}</span>
          <span class="text-xs text-muted-foreground">{dateFmt.format(new Date(p.createdAt))}</span>
        </div>
      </div>
    </ListingRow>
  {/snippet}
  {#snippet skeleton()}
    <div class="flex w-full items-center gap-3 px-2 py-2" data-testid="profile-skeleton">
      <Skeleton class="size-8 rounded-full" />
      <Skeleton class="h-4 min-w-0 flex-1" />
    </div>
  {/snippet}
</Listing>