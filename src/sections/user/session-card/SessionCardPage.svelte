<script lang="ts">
  // Страница карточки устройства — fallback модалки `user.session`.
  import type { loadSessionCard } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { userSessionRoute, userSessionsRoute } from '#modules/user/base/routes.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import SessionCard from '#modules/user/sessions/svelte/SessionCard.svelte'
  
  let { data }: { data: Awaited<ReturnType<typeof loadSessionCard>> } = $props()
  const renameAction = $derived(data.detail ? `${userSessionRoute.href({ id: data.detail.session.id })}?/rename` : undefined)

  useHeadSeo({
    subTitle: 'Устройство',
    description: 'Сведения об устройстве и его переименование.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-xl">
  {#if data.fact || data.enabled === false}
    <Acl status={data.fact} enabled={data.enabled} backHref={userSessionsRoute.href()} />
  {:else if data.detail}
    <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h1 class="mb-4 text-lg font-semibold leading-tight tracking-tight">Устройство</h1>
      <SessionCard detail={data.detail} backHref={userSessionsRoute.href()} actionHref={renameAction} />
    </div>
  {:else}
    <Acl status="auth.session-unknown" backHref={userSessionsRoute.href()} />
  {/if}
</div>
